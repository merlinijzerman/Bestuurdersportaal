// ============================================================================
//  lib/notulen.ts — regelgebaseerde segmentvoorstellen voor notulen (Increment D).
//
//  GEEN AI-call (decisions/0006 B6 = half-automatisch; precedent lib/classificatie.ts
//  en lib/vraagtype.ts: deterministisch, auditbaar, puur testbaar). Het systeem
//  STELT segmenten VOOR; de secretaris bevestigt/corrigeert (capability
//  notulen.segment.confirm). Pas bevestigde segmenten worden geïndexeerd.
//
//  Supabase-vrij en zuiver — geen runtime-imports — zodat de heuristiek
//  deterministisch te testen is (lib/notulen.sanity.ts).
//
//  Strategie:
//    1. Detecteer kop-regels: genummerd ("1. ...", "1) ...", "Agendapunt 3: ..."),
//       of een korte regel die sterk lijkt op een agendapunttitel.
//    2. Splits de notulentekst op die koppen in blokken.
//    3. Koppel elk blok aan een agendapunt via (a) nummermatch op volgorde, of
//       (b) titel-overlap boven een drempel. Geen match → agendapunt_id null
//       (secretaris koppelt handmatig).
//  Idempotent: pure functie van (tekst, agendapunten) → identieke voorstellen.
// ============================================================================

/** Minimale agendapuntverwijzing voor de matcher. */
export interface AgendapuntRef {
  id: string;
  titel: string;
  volgorde: number;
}

/** Eén voorgesteld segment (nog niet bevestigd, nog geen chunks). */
export interface SegmentVoorstel {
  segment_index: number;
  titel: string | null;
  tekst: string;
  agendapunt_id: string | null;
  agendapunt_volgorde: number | null;
  /** Waarop de koppeling/segmentgrens berust — voor transparantie in de UI/audit. */
  match_bron: "kop_nummer" | "kop_titel" | "titelmatch" | "geen";
}

/** Drempels centraal en tunebaar (patroon CLASSIFICATIE_DREMPELS). */
export const NOTULEN_DREMPELS = {
  /** Minimale Jaccard-token-overlap (0..1) om een kop/blok aan een agendapunt te koppelen. */
  titel_overlap_min: 0.5,
  /** Een kandidaat-kopregel is hoogstens zo lang (tekens). */
  kop_max_lengte: 90,
  /** Minimale bloklengte (tekens) om als zelfstandig segment te tellen. */
  segment_min_lengte: 20,
} as const;

/**
 * Bronvermelding voor een (vastgesteld) notulensegment, zoals getoond aan de AI
 * en in de bronkaart: "Vastgestelde notulen [vergadering], agendapunt N — [titel]".
 * Pure functie (geen DB) zodat ze deterministisch te testen is (regressietest 3).
 */
export function notulenBronLabel(
  vergaderingTitel: string,
  agendapuntVolgnummer: number | null,
  agendapuntTitel: string | null
): string {
  let apDeel = "";
  if (agendapuntVolgnummer != null) {
    apDeel = `, agendapunt ${agendapuntVolgnummer}`;
    if (agendapuntTitel) apDeel += ` — ${agendapuntTitel}`;
  } else if (agendapuntTitel) {
    apDeel = `, agendapunt — ${agendapuntTitel}`;
  }
  return `Vastgestelde notulen ${vergaderingTitel}${apDeel}`;
}

// ── Tekstnormalisatie ───────────────────────────────────────────────────────
const STOPWOORDEN = new Set([
  "de", "het", "een", "en", "van", "voor", "met", "op", "te", "ter", "in", "om",
  "aan", "bij", "tot", "of", "der", "den", "dan", "naar", "over",
]);

function normaliseer(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // diacritica weg
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normaliseer(s)
    .split(" ")
    .filter((w) => w.length > 1 && !STOPWOORDEN.has(w));
}

/** Jaccard-overlap tussen twee token-sets (0..1). */
export function titelOverlap(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let gemeen = 0;
  for (const t of ta) if (tb.has(t)) gemeen++;
  return gemeen / (ta.size + tb.size - gemeen);
}

// ── Kopdetectie ─────────────────────────────────────────────────────────────
interface Kop {
  titel: string;
  nummer: number | null;
}

// "1. Titel" / "1) Titel" / "1 Titel"
const RE_GENUMMERD = /^\s*(\d{1,2})\s*[.)]\s+(.+?)\s*$/;
// "Agendapunt 3: Titel" / "Punt 3 - Titel"
const RE_AGENDAPUNT = /^\s*(?:agendapunt|punt)\s+(\d{1,2})\s*[:.\-)]?\s*(.*?)\s*$/i;

/** Detecteert of een regel een kop is; null = geen kop. */
function detecteerKop(regel: string, agendapunten: AgendapuntRef[]): Kop | null {
  const trimmed = regel.trim();
  if (!trimmed) return null;

  const mAgenda = trimmed.match(RE_AGENDAPUNT);
  if (mAgenda) {
    return { nummer: parseInt(mAgenda[1], 10), titel: mAgenda[2].trim() || trimmed };
  }
  const mNum = trimmed.match(RE_GENUMMERD);
  if (mNum) {
    return { nummer: parseInt(mNum[1], 10), titel: mNum[2].trim() };
  }
  // Korte regel die sterk op een agendapunttitel lijkt (kop zonder nummer).
  if (trimmed.length <= NOTULEN_DREMPELS.kop_max_lengte && !/[.!?]$/.test(trimmed)) {
    for (const ap of agendapunten) {
      if (titelOverlap(trimmed, ap.titel) >= NOTULEN_DREMPELS.titel_overlap_min) {
        return { nummer: null, titel: trimmed };
      }
    }
  }
  return null;
}

// ── Koppeling kop → agendapunt ──────────────────────────────────────────────
function koppelAgendapunt(
  kop: Kop,
  agendapunten: AgendapuntRef[]
): { ap: AgendapuntRef | null; bron: SegmentVoorstel["match_bron"] } {
  // 1) Nummermatch op volgorde (sterkste signaal).
  if (kop.nummer != null) {
    const opNummer = agendapunten.find((a) => a.volgorde === kop.nummer);
    if (opNummer) return { ap: opNummer, bron: "kop_nummer" };
  }
  // 2) Beste titel-overlap boven de drempel.
  let beste: AgendapuntRef | null = null;
  let besteScore = 0;
  for (const ap of agendapunten) {
    const score = titelOverlap(kop.titel, ap.titel);
    if (score > besteScore) {
      besteScore = score;
      beste = ap;
    }
  }
  if (beste && besteScore >= NOTULEN_DREMPELS.titel_overlap_min) {
    return { ap: beste, bron: kop.nummer != null ? "kop_titel" : "titelmatch" };
  }
  return { ap: null, bron: "geen" };
}

// ── Hoofdfunctie ────────────────────────────────────────────────────────────
/**
 * Stelt segmenten voor op basis van de notulentekst en de agendapunten van de
 * vergadering. Deterministisch en idempotent. Levert VOORSTELLEN (bevestigd=false
 * bij wegschrijven); nooit auto-publicatie.
 *
 * Geen koppen gevonden → één ongekoppeld segment met de hele tekst (de secretaris
 * splitst/koppelt handmatig). Lege tekst → geen voorstellen.
 */
export function stelSegmentenVoor(
  tekst: string,
  agendapunten: AgendapuntRef[]
): SegmentVoorstel[] {
  if (!tekst || !tekst.trim()) return [];
  const regels = tekst.split(/\r?\n/);

  // Vind kopposities.
  const koppen: { index: number; kop: Kop }[] = [];
  regels.forEach((regel, i) => {
    const kop = detecteerKop(regel, agendapunten);
    if (kop) koppen.push({ index: i, kop });
  });

  // Geen koppen → één ongekoppeld blok.
  if (koppen.length === 0) {
    return [
      {
        segment_index: 0,
        titel: null,
        tekst: tekst.trim(),
        agendapunt_id: null,
        agendapunt_volgorde: null,
        match_bron: "geen",
      },
    ];
  }

  // Eventuele preambule vóór de eerste kop wordt aan het eerste segment geplakt.
  const voorstellen: SegmentVoorstel[] = [];
  for (let k = 0; k < koppen.length; k++) {
    const start = koppen[k].index;
    const eind = k + 1 < koppen.length ? koppen[k + 1].index : regels.length;
    const blokRegels = regels.slice(start + 1, eind);
    const blokTekst = blokRegels.join("\n").trim();

    const { ap, bron } = koppelAgendapunt(koppen[k].kop, agendapunten);
    voorstellen.push({
      segment_index: voorstellen.length,
      titel: koppen[k].kop.titel || (ap ? ap.titel : null),
      tekst: blokTekst,
      agendapunt_id: ap ? ap.id : null,
      agendapunt_volgorde: ap ? ap.volgorde : null,
      match_bron: bron,
    });
  }

  return voorstellen;
}
