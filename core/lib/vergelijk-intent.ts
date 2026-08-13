// ============================================================================
//  core/lib/vergelijk-intent.ts — intentieherkenning + documentkoppeling (T5).
// ----------------------------------------------------------------------------
//  PURE heuristiek (geen DB/SDK), zodat de chat-route-tak los toetsbaar is:
//   1. bepaalVergelijkIntent(vraag) — herkent een vergelijkvraag en haalt twee
//      doel-hints eruit ("vergelijk X met Y", "verschil tussen X en Y", "X vs Y",
//      versietokens v3/v4). Confidence-gated: `vertrouwen` = 'zeker' alleen als er
//      twee onderscheiden hints zijn.
//   2. koppelDocumenten(hints, documenten) — matcht de hints op de fondsdocumenten
//      (titel + versietoken). Geeft een eenduidige (bron,doel) óf de kandidaten voor
//      een verduidelijking. Nooit gokken bij ambiguïteit (acceptatiecriterium).
//
//  De route beslist op basis hiervan: eenduidig → direct vergelijken; anders → een
//  verduidelijkingsvraag. Geen bestuurlijke logica hier.
// ============================================================================

export interface VergelijkIntent {
  isVergelijk: boolean;
  bronHint: string | null;
  doelHint: string | null;
  vertrouwen: "zeker" | "onzeker";
}

// Werkwoorden/sjablonen die een vergelijking aankondigen.
const TRIGGER = /\b(vergelijk\w*|verschil(?:len)?\s+tussen|zet\s+.*\s+naast|versus)\b/i;
// "X vs Y" / "X versus Y".
const VS = /\bvs\.?\b|\bversus\b/i;

// Splitsers tussen de twee doelen: "met", "en", "tegen", "vs", "versus", "ten opzichte van".
const SPLITS = /\s+(?:met|en|tegen|vs\.?|versus|ten\s+opzichte\s+van|t\.?o\.?v\.?)\s+/i;

function opschonen(s: string): string {
  return s.replace(/[?.!,;:]+$/g, "").trim();
}

// Haal na een trigger het "X <splits> Y"-deel eruit. Best-effort.
function haalHints(vraag: string): { bron: string | null; doel: string | null } {
  // Neem de tekst ná het triggerwoord (of de hele zin bij "X vs Y").
  let rest = vraag;
  const m = vraag.match(/\b(vergelijk\w*|verschil(?:len)?\s+tussen)\b/i);
  if (m && m.index != null) {
    rest = vraag.slice(m.index + m[0].length);
  }
  rest = opschonen(rest.replace(/^\s*(?:de|het|een|van)\s+/i, ""));

  const delen = rest.split(SPLITS);
  if (delen.length >= 2) {
    const bron = opschonen(delen[0]);
    const doel = opschonen(delen[1]);
    return { bron: bron || null, doel: doel || null };
  }
  return { bron: null, doel: null };
}

export function bepaalVergelijkIntent(vraag: string): VergelijkIntent {
  const leeg: VergelijkIntent = { isVergelijk: false, bronHint: null, doelHint: null, vertrouwen: "onzeker" };
  if (!vraag || vraag.trim().length === 0) return leeg;

  const isTrigger = TRIGGER.test(vraag) || VS.test(vraag);
  if (!isTrigger) return leeg;

  const { bron, doel } = haalHints(vraag);
  const tweeOnderscheiden =
    !!bron && !!doel && opschonen(bron).toLowerCase() !== opschonen(doel).toLowerCase();

  return {
    isVergelijk: true,
    bronHint: bron,
    doelHint: doel,
    vertrouwen: tweeOnderscheiden ? "zeker" : "onzeker",
  };
}

// ── Documentkoppeling ────────────────────────────────────────────────────────

export interface DocumentRef {
  id: string;
  titel: string;
}

export interface Koppeling {
  bron: DocumentRef | null;
  doel: DocumentRef | null;
  eenduidig: boolean;
  // Kandidaten per hint wanneer niet eenduidig — voedt de verduidelijking.
  bronKandidaten: DocumentRef[];
  doelKandidaten: DocumentRef[];
}

// Versietoken uit een hint of titel: v3, v4, versie 3, "3", enz.
function versieToken(s: string): string | null {
  const m = s.toLowerCase().match(/\b(?:v|versie\s*)(\d{1,3})\b/);
  return m ? m[1] : null;
}

function genormaliseerd(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// Score een document tegen een hint: hoger = betere match. 0 = geen match.
function score(doc: DocumentRef, hint: string): number {
  const h = genormaliseerd(hint);
  const t = genormaliseerd(doc.titel);
  if (h.length === 0) return 0;
  let s = 0;
  // Woord-overlap (zonder de versietokens, die apart wegen).
  const woorden = h.split(" ").filter((w) => w.length >= 3 && !/^v?\d{1,3}$/.test(w));
  for (const w of woorden) {
    if (t.includes(w)) s += 2;
  }
  // Versietoken match is sterk onderscheidend.
  const hv = versieToken(hint);
  const tv = versieToken(doc.titel);
  if (hv && tv && hv === tv) s += 3;
  else if (hv && tv && hv !== tv) s -= 1; // andere versie → minder waarschijnlijk
  // Volledige substring van de titel in de hint (of omgekeerd) → bonus.
  if (t.includes(h) || h.includes(t)) s += 1;
  return s;
}

function besteMatches(hint: string, documenten: DocumentRef[]): DocumentRef[] {
  const gescoord = documenten
    .map((d) => ({ d, s: score(d, hint) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return gescoord.map((x) => x.d);
}

/**
 * Koppel de twee hints aan fondsdocumenten. Eenduidig = elke hint heeft één duidelijk
 * beste, en bron ≠ doel. Anders: kandidaten terug voor een verduidelijking.
 */
export function koppelDocumenten(
  bronHint: string | null,
  doelHint: string | null,
  documenten: DocumentRef[]
): Koppeling {
  const bronKandidaten = bronHint ? besteMatches(bronHint, documenten) : [];
  const doelKandidaten = doelHint ? besteMatches(doelHint, documenten) : [];

  const bron = bronKandidaten[0] ?? null;
  const doel = doelKandidaten[0] ?? null;

  // Eenduidig als: beide een top-kandidaat, ze verschillen, en de top niet
  // ex aequo met de tweede staat (geen dubbelzinnige nummer-1).
  const bronScherp =
    bronKandidaten.length > 0 &&
    (bronKandidaten.length === 1 || score(bronKandidaten[0], bronHint!) > score(bronKandidaten[1], bronHint!));
  const doelScherp =
    doelKandidaten.length > 0 &&
    (doelKandidaten.length === 1 || score(doelKandidaten[0], doelHint!) > score(doelKandidaten[1], doelHint!));

  const eenduidig = !!bron && !!doel && bron.id !== doel.id && bronScherp && doelScherp;

  return { bron, doel, eenduidig, bronKandidaten, doelKandidaten };
}
