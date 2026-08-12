// ============================================================================
//  core/lib/reflectie-richtingen.ts — Plateau B-opt / tranche 3: de vraagkeuze
//  als pure, testbare kern.
// ----------------------------------------------------------------------------
//  WAAROM DIT BESTAAT
//
//  De verdiepingsvraag mag contextueel worden gekozen, maar binnen HARDE
//  guardrails (VOORSTEL §A-bis). Dit is een herziening van het
//  non-classificatieprincipe: een richting afleiden om de volgende vraag te
//  kiezen ís een classificatie op inhoud. Dat mag hier — mits de zes guardrails
//  overeind blijven. Deze module borgt er twee machinaal:
//
//    • de DETERMINISTISCHE vraag blijft de vloer: faalt de generatie of de
//      validatie, dan valt de functie terug op `standaardVraag(ingang)`;
//    • de vraag wordt niet gestreamd maar GEVALIDEERD: `valideerVerdiepings-
//      vraag()` is de machinale ondergrens (AC-R1 t/m R7).
//
//  De overige vier guardrails leven elders: de richting poort niets af (elke
//  richting leidt tot dezelfde volgende stap), wordt NERGENS opgeslagen (ze mag
//  de request niet verlaten — audit-meta.sanity.ts bewaakt dat), wordt nooit als
//  conclusie getoond (promptregel), en de vraag draagt een verplichte uitweg
//  (AC-R5 hieronder).
//
//  ⚠ De RICHTING is geen conclusie over de gebruiker en wordt nergens bewaard.
//  Ze bestaat om precies één ding te doen: de volgende vraag kiezen. Deze module
//  bevat geen enkel pad naar opslag, logging of retrieval. Pure functies.
//
//  Getest via reflectie-richtingen.sanity.ts.
// ============================================================================

import { INGANG_VERDIEPING, type ReflectieIngang } from "./reflectie-flow";

/**
 * De GESLOTEN lijst richtingen per ingang (VOORSTEL §D). Het model kiest er één
 * uit om de vraag te vormen; een richting buiten deze lijst is ongeldig. De
 * lijsten mogen elkaar overlappen (bewust: een verkeerd gekozen ingang mag nooit
 * een doodlopende weg zijn — de verplichte uitweg vangt dat op).
 */
export const RICHTINGEN: Record<ReflectieIngang, readonly string[]> = {
  mis_iets: ["informatie", "onderbouwing", "alternatief", "perspectief", "consequentie"],
  twijfel: ["onderbouwing", "aannames", "redenering", "evenwichtigheid", "uitlegbaarheid", "niet_pluis"],
  risico: ["gevolg", "afhankelijkheid", "uitvoerbaarheid", "planning", "beheersbaarheid"],
  overtuigt: ["dragend_argument", "bewijs", "ondersteunde_aanname", "navolgbaarheid"],
} as const;

/** Is `richting` een geldige richting voor deze ingang? */
export function isGeldigeRichting(ingang: ReflectieIngang, richting: unknown): boolean {
  return (
    typeof richting === "string" &&
    (RICHTINGEN[ingang] as readonly string[]).includes(richting)
  );
}

/**
 * De deterministische terugval-vraag per ingang — de vloer (VOORSTEL §D). Dit is
 * exact de vaste vraag uit `reflectie-flow.ts`; hier hergebruikt zodat er één
 * bron van waarheid is. Faalt de adaptieve generatie of de validatie, dan deze.
 */
export function standaardVraag(ingang: ReflectieIngang): string {
  return INGANG_VERDIEPING[ingang];
}

/**
 * De deterministische TEGENPERSPECTIEF-vraag per ingang (B-opt tranche 4a,
 * VOORSTEL §G). Dit is de terugval voor de knop "Wat pleit er tegen?": de
 * assistent VRAAGT om het tegenargument, hij levert het niet. Bewust komma-vrij
 * gehouden zodat de vraag zijn eigen validator passeert (geen valse
 * "biedt-richtingen-aan"-detectie). Formuleringen uit VOORSTEL §G — voor
 * `overtuigt` de variant die het vertrouwen bevraagt zonder een oordeel te
 * veronderstellen.
 */
export const TEGENPERSPECTIEF_VRAAG: Record<ReflectieIngang, string> = {
  mis_iets:
    "Wat pleit er in de stukken of in uw eigen ervaring het sterkst de andere kant op?",
  twijfel:
    "Wat pleit er in de stukken of in uw eigen ervaring het sterkst de andere kant op?",
  risico:
    "Wat pleit er in de stukken of in uw eigen ervaring het sterkst de andere kant op?",
  overtuigt: "Welk gegeven zou uw vertrouwen hier aan het wankelen kunnen brengen?",
};

export function tegenperspectiefVraag(ingang: ReflectieIngang): string {
  return TEGENPERSPECTIEF_VRAAG[ingang];
}

// ── De validator (AC-R1 t/m R7) ─────────────────────────────────────────────
// Falen betekent terugval op de deterministische vraag. Dit is de machinale
// ONDERGRENS, niet de norm — de norm staat in SP_REFLECTIE_REGELS.

/** Taalvormen waarin een diagnose zich verstopt (AC-R4). Hoofdletterongevoelig. */
export const DIAGNOSE_BLOCKLIST = [
  "waarschijnlijk",
  "komt voort uit",
  "u voelt",
  "kennelijk",
  "u specificeert",
  "u geeft aan dat u",
  "het is nog niet duidelijk",
  "het lijkt erop dat u",
  "begrijpelijk dat u",
  "terecht dat u",
] as const;

/** De verplichte uitweg (AC-R5) — een variant uit deze kleine allowlist. */
export const UITWEG_ALLOWLIST = [
  "of zit dat ergens anders",
  "of zit het ergens anders",
  "of ergens anders",
  "of iets anders",
  "of ziet u het anders",
  "of ziet u een ander",
] as const;

/**
 * Formuleringen die een uitspraak doen over de HERKOMST/samenstelling van het
 * eerdere antwoord (AC-R7). Zonder de server-injectie (§0.2/§3d) mag het model
 * hier niets over zeggen — dat zou schijnzekerheid over bronherkomst zijn.
 */
export const SAMENSTELLING_TERMEN = [
  "algemene kennis",
  "algemene wetskennis",
  "modelkennis",
  "kennis van het model",
  "geverifieerde webbron",
  "webbron",
  "deels gebaseerd op uw stukken",
  "deels op uw stukken",
] as const;

export interface ValidatieOpties {
  /** De bronnummers die in de bevroren set voorkomen; [Bron N] daarbuiten faalt (AC-R6). */
  bevrorenBronNummers?: number[];
  /** Heeft de server de samenstelling feitelijk meegegeven (§3d)? Zo niet: geen herkomstuitspraak (AC-R7). */
  samenstellingMeegegeven?: boolean;
}

export interface ValidatieUitkomst {
  ok: boolean;
  /** Machinale reden bij afkeur; uitsluitend voor de terugval-beslissing, niet voor de gebruiker. */
  reden?: string;
}

/**
 * Toetst één verdiepingsvraag tegen de vormeisen (AC-R1 t/m R7). Puur; geen I/O.
 * Bij `ok: false` valt de aanroeper terug op `standaardVraag(ingang)`.
 */
export function valideerVerdiepingsvraag(
  tekst: string,
  opties: ValidatieOpties = {}
): ValidatieUitkomst {
  const t = (tekst ?? "").trim();
  if (!t) return { ok: false, reden: "leeg" };
  const laag = t.toLowerCase();

  // AC-R1 — ten hoogste 60 woorden.
  const woorden = t.split(/\s+/).filter(Boolean).length;
  if (woorden > 60) return { ok: false, reden: "te_lang" };

  // AC-R2 — precies één vraagteken.
  const vraagtekens = (t.match(/\?/g) ?? []).length;
  if (vraagtekens !== 1) return { ok: false, reden: "vraagtekens" };

  // AC-R3 — geen koppen of rubrieken: geen markdown-kop, geen opsommingsteken,
  // geen regel die volledig in hoofdletters staat (een rubriek-etiket).
  for (const regel of t.split("\n")) {
    const r = regel.trim();
    if (!r) continue;
    if (/^#{1,6}\s/.test(r)) return { ok: false, reden: "kop" };
    if (/^[-*•]\s/.test(r)) return { ok: false, reden: "opsomming" };
    const letters = r.replace(/[^A-Za-zÀ-ÿ]/g, "");
    if (letters.length >= 4 && letters === letters.toUpperCase() && /\s/.test(r)) {
      return { ok: false, reden: "hoofdletterrubriek" };
    }
  }

  // AC-R4 — geen diagnosetaal uit de blocklist.
  for (const term of DIAGNOSE_BLOCKLIST) {
    if (laag.includes(term)) return { ok: false, reden: `blocklist:${term}` };
  }

  // AC-R6 — geen [Bron N] buiten de bevroren set.
  const toegestaan = new Set(opties.bevrorenBronNummers ?? []);
  const bronRefs = [...t.matchAll(/\[bron\s*(\d+)\]/gi)].map((m) => Number.parseInt(m[1], 10));
  for (const n of bronRefs) {
    if (!toegestaan.has(n)) return { ok: false, reden: `bron_buiten_set:${n}` };
  }

  // AC-R5 — biedt de vraag twee of meer richtingen aan, dan is een open uitweg
  // verplicht. Heuristiek voor "biedt richtingen aan": een bronverankering
  // ([Bron N]) of een opsomming van ≥ 2 komma-gescheiden alternatieven.
  const heeftUitweg = UITWEG_ALLOWLIST.some((u) => laag.includes(u));
  const kommas = (t.match(/,/g) ?? []).length;
  const biedtRichtingenAan = bronRefs.length > 0 || kommas >= 2;
  if (biedtRichtingenAan && !heeftUitweg) return { ok: false, reden: "geen_uitweg" };

  // AC-R7 — geen uitspraak over de samenstelling/herkomst van het eerdere
  // antwoord zonder de server-injectie (§3d).
  if (!opties.samenstellingMeegegeven) {
    for (const s of SAMENSTELLING_TERMEN) {
      if (laag.includes(s)) return { ok: false, reden: `samenstelling:${s}` };
    }
  }

  return { ok: true };
}
