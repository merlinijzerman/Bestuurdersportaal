// ============================================================================
//  Stuurinformatie beheer-invoerlaag — PURE validatie-/opbouwlogica (T14).
// ----------------------------------------------------------------------------
//  Isomorf en zonder I/O, zodat de risicovolle invoerlogica sanity-testbaar is
//  (stuurinfo-invoer.sanity.ts) en de client dezelfde definities kan gebruiken
//  voor de live berekende velden. De server (route handler + RPC) blijft de
//  security-laag; de UI rekent alleen cosmetisch mee.
//
//  Kernbesluiten (decisions/0075, werkopdracht Beheer-invoerlaag):
//  - EXHAUSTIEVE key-allowlist: de payload bevat exact de leaf-posten;
//    subtotalen (toetsvermogen, eigen vermogen, totalen) bestaan niet in de
//    payload-vorm en zijn dus per definitie read-only.
//  - Balansevenwicht is een HARDE validatie (422): hergebruikt leidBalansAf()
//    uit stuurinfo-balans.ts — één definitie, zelfde tolerantie (0.005).
//  - Eén bron per bedrag: de gedeelde standen (soli/mvev/oper/comp) worden bij
//    Balans ingevoerd; bouwReserveRijen() leidt de reserve-rijen daaruit af.
//  - pct_waarde (= stand / technische voorziening × 100, 1 decimaal) wordt
//    hier berekend voor ALLE reserves — de leeslaag leest pct_waarde voor het
//    stoplicht, dus de definitie moet één plek hebben.
// ============================================================================

import {
  leidBalansAf,
  type BalansBronRij,
  type BalansEvenwicht,
} from "./stuurinfo-balans";
import { SOLI_VULLING_KEYS, type SoliVullingKey } from "./stuurinfo-soli";
import {
  OPER_MUTATIE_KEYS,
  OPER_KOSTEN_KEYS,
  type OperMutatieKey,
  type OperKostenKey,
} from "./stuurinfo-operationeel";
import {
  PREMIE_COMPONENT_KEYS,
  COMP_MUTATIE_KEYS,
  type PremieComponentKey,
  type CompMutatieKey,
} from "./stuurinfo-premie";

// ── Taxonomie (labels/volgorde = T13-seed; de RPC draagt dezelfde lijst) ─────

export const ACTIVA_DEFINITIES = [
  { key: "belegd", label: "Belegd vermogen", volgorde: 1 },
  { key: "overig", label: "Overige activa, vorderingen en liquiditeiten", volgorde: 2 },
] as const;

export const PASSIVA_DEFINITIES = [
  { key: "ev_toets_mvev", label: "MVEV-reserve", volgorde: 1 },
  { key: "ev_toets_oper", label: "Operationele reserve", volgorde: 2 },
  { key: "ev_toets_overig", label: "Overig", volgorde: 3 },
  { key: "ev_soli", label: "Solidariteitsreserve", volgorde: 4 },
  { key: "ev_comp", label: "Compensatiedepot", volgorde: 5 },
  { key: "tv", label: "Technische voorziening", volgorde: 6 },
  { key: "vuk", label: "Voorziening uitvoeringskosten", volgorde: 7 },
  { key: "overig", label: "Overige voorzieningen en passiva", volgorde: 8 },
] as const;

export type ActivaKey = (typeof ACTIVA_DEFINITIES)[number]["key"];
export type PassivaKey = (typeof PASSIVA_DEFINITIES)[number]["key"];

export const ACTIVA_KEYS = ACTIVA_DEFINITIES.map((d) => d.key) as ActivaKey[];
export const PASSIVA_KEYS = PASSIVA_DEFINITIES.map((d) => d.key) as PassivaKey[];

/** Reserve-taxonomie (T13-seed: keys, labels, volgorde 1–8). */
export const RESERVE_DEFINITIES = [
  { key: "solidariteitsreserve", label: "Solidariteitsreserve", volgorde: 1 },
  { key: "mvev_reserve", label: "MVEV-reserve", volgorde: 2 },
  { key: "operationele_reserve", label: "Operationele reserve", volgorde: 3 },
  { key: "kostenreserve", label: "Kostenreserve", volgorde: 4 },
  { key: "ao_reserve", label: "AO-reserve", volgorde: 5 },
  { key: "ppwzp_reserve", label: "PP/Wzp-reserve", volgorde: 6 },
  { key: "ppwzp_reserve_eerbiedigend", label: "PP/Wzp-reserve eerbiedigend", volgorde: 7 },
  { key: "compensatiedepot", label: "Compensatiedepot", volgorde: 8 },
] as const;

export type ReserveKey = (typeof RESERVE_DEFINITIES)[number]["key"];

/** Gedeelde standen: reserve-stand = balanswaarde (één bron per bedrag). */
export const GEKOPPELDE_RESERVES: ReadonlyArray<{
  reserveKey: ReserveKey;
  passivaKey: PassivaKey;
}> = [
  { reserveKey: "solidariteitsreserve", passivaKey: "ev_soli" },
  { reserveKey: "mvev_reserve", passivaKey: "ev_toets_mvev" },
  { reserveKey: "operationele_reserve", passivaKey: "ev_toets_oper" },
  { reserveKey: "compensatiedepot", passivaKey: "ev_comp" },
];

/** Vrij invoerbare reserves (sectie Reserves; niet aan de balans gekoppeld). */
export const VRIJE_RESERVE_KEYS = [
  "kostenreserve",
  "ao_reserve",
  "ppwzp_reserve",
  "ppwzp_reserve_eerbiedigend",
] as const;

export type VrijeReserveKey = (typeof VRIJE_RESERVE_KEYS)[number];

/** Herkomst van de rapportageperiode-cijfers (registry-kolom `bron`). */
export const PERIODE_BRONNEN = [
  { key: "uitvoerder_kwartaal", label: "Uitvoerder — kwartaalrapportage" },
  { key: "uitvoerder_maand", label: "Uitvoerder — maandscan" },
  { key: "handmatig", label: "Handmatige opgave" },
] as const;

export type PeriodeBron = (typeof PERIODE_BRONNEN)[number]["key"];

export type InvoerBron = "handmatig" | "upload";

// ── Payload-vormen ───────────────────────────────────────────────────────────

export type SoliGrenzen = { ondergrens: number | null; bovengrens: number | null };

export type BalansReservesInvoer = {
  periode: string;
  peildatum: string; // ISO ('2026-06-30')
  bron: PeriodeBron;
  invoerBron: InvoerBron;
  activa: Record<ActivaKey, number>;
  passiva: Record<PassivaKey, number>;
  reserves: Record<VrijeReserveKey, number>;
  /** Band solidariteitsreserve (% van TV); null = geen grens. Verplicht veld —
   *  de UI/upload levert altijd de actuele waarden mee (voorgevuld uit GET). */
  grenzen: { solidariteitsreserve: SoliGrenzen };
  financieringsgraad: number;
};

export type PeriodeInvoer = {
  periode: string;
  peildatum: string;
  bron: PeriodeBron;
};

/** Rij voor fonds_stuurinfo_reserve zoals de RPC hem verwacht. */
export type ReserveRijInvoer = {
  reserve_key: ReserveKey;
  label: string;
  stand: number;
  pct_waarde: number;
  ondergrens: number | null;
  bovengrens: number | null;
  volgorde: number;
};

export type InvoerValidatie =
  | { ok: true; invoer: BalansReservesInvoer; evenwicht: BalansEvenwicht }
  | { ok: false; status: 400 | 422; fout: string };

export type PeriodeValidatie =
  | { ok: true; invoer: PeriodeInvoer }
  | { ok: false; fout: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

const PERIODE_REGEX = /^\d{4}Q[1-4]$/;
const ISO_DATUM_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isGetal = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Afronden op 1 decimaal (pct_waarde-conventie van de T13-seed). */
export const rondAf1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * Deterministische sorteerwaarde: jaar*4 + kwartaal ('2026Q2' → 8106).
 * Zo sorteert een later ingevoerde historische periode altijd correct.
 * De RPC rekent dezelfde formule in SQL — één definitie per laag, sanity-getest.
 */
export function periodeVolgorde(periode: string): number {
  const m = PERIODE_REGEX.exec(periode);
  if (!m) return 0;
  return Number(periode.slice(0, 4)) * 4 + Number(periode.slice(5, 6));
}

/**
 * Valideert exact de verwachte keys op een object: elke key aanwezig én een
 * finite number, geen enkele key te veel. Subtotalen/afgeleide velden bestaan
 * niet in de allowlist en worden dus altijd geweigerd.
 */
function leesExacteGetallen<K extends string>(
  waarde: unknown,
  keys: readonly K[],
  veldnaam: string
): { ok: true; record: Record<K, number> } | { ok: false; fout: string } {
  if (!isRecord(waarde)) return { ok: false, fout: `Veld '${veldnaam}' ontbreekt of is geen object.` };
  const onbekend = Object.keys(waarde).filter((k) => !(keys as readonly string[]).includes(k));
  if (onbekend.length > 0) {
    return { ok: false, fout: `Onbekend of afgeleid veld in '${veldnaam}': ${onbekend.join(", ")}.` };
  }
  const record = {} as Record<K, number>;
  for (const k of keys) {
    const v = waarde[k];
    if (!isGetal(v)) return { ok: false, fout: `Veld '${veldnaam}.${k}' ontbreekt of is geen getal.` };
    record[k] = v;
  }
  return { ok: true, record };
}

function valideerPeriodeVelden(
  body: Record<string, unknown>
): { ok: true; invoer: PeriodeInvoer } | { ok: false; fout: string } {
  const { periode, peildatum, bron } = body;
  if (typeof periode !== "string" || !PERIODE_REGEX.test(periode)) {
    return { ok: false, fout: "Ongeldige periode — verwacht kwartaalvorm zoals '2026Q2'." };
  }
  if (
    typeof peildatum !== "string" ||
    !ISO_DATUM_REGEX.test(peildatum) ||
    Number.isNaN(Date.parse(peildatum))
  ) {
    return { ok: false, fout: "Ongeldige peildatum — verwacht een datum zoals '2026-06-30'." };
  }
  if (typeof bron !== "string" || !PERIODE_BRONNEN.some((b) => b.key === bron)) {
    return { ok: false, fout: "Ongeldige bron — kies uit de vaste bronnenlijst." };
  }
  return { ok: true, invoer: { periode, peildatum, bron: bron as PeriodeBron } };
}

// ── Validatie: nieuwe periode ────────────────────────────────────────────────

export function valideerPeriodeInvoer(body: unknown): PeriodeValidatie {
  if (!isRecord(body)) return { ok: false, fout: "Ongeldige aanvraag." };
  return valideerPeriodeVelden(body);
}

// ── Validatie: balans + reserves (de kern van de invoerlaag) ────────────────

/**
 * Valideert de volledige save-payload: periodevelden, invoerbron, exhaustieve
 * key-allowlists, grenzen en het balansevenwicht (via leidBalansAf — zelfde
 * definitie en tolerantie als het dashboard). 400 = vormfout; 422 = balans
 * sluit niet of TV onbruikbaar. Bij ok is de payload veilig voor de RPC.
 */
export function valideerBalansInvoer(body: unknown): InvoerValidatie {
  if (!isRecord(body)) return { ok: false, status: 400, fout: "Ongeldige aanvraag." };

  const periodeCheck = valideerPeriodeVelden(body);
  if (!periodeCheck.ok) return { ok: false, status: 400, fout: periodeCheck.fout };

  const invoerBron = body.invoer_bron;
  if (invoerBron !== "handmatig" && invoerBron !== "upload") {
    return { ok: false, status: 400, fout: "Ongeldige invoerbron (handmatig/upload)." };
  }

  const activa = leesExacteGetallen(body.activa, ACTIVA_KEYS, "activa");
  if (!activa.ok) return { ok: false, status: 400, fout: activa.fout };
  const passiva = leesExacteGetallen(body.passiva, PASSIVA_KEYS, "passiva");
  if (!passiva.ok) return { ok: false, status: 400, fout: passiva.fout };
  const reserves = leesExacteGetallen(body.reserves, VRIJE_RESERVE_KEYS, "reserves");
  if (!reserves.ok) return { ok: false, status: 400, fout: reserves.fout };

  if (!isGetal(body.financieringsgraad) || body.financieringsgraad < 0 || body.financieringsgraad > 1000) {
    return { ok: false, status: 400, fout: "Ongeldige financieringsgraad (0–1000%)." };
  }

  // Grenzen (band solidariteitsreserve, % van TV). Verplicht aanwezig; waarden
  // nullable (null = geen grens).
  const grenzenVeld = isRecord(body.grenzen) ? body.grenzen.solidariteitsreserve : undefined;
  if (!isRecord(grenzenVeld)) {
    return { ok: false, status: 400, fout: "Veld 'grenzen.solidariteitsreserve' ontbreekt." };
  }
  const leesGrens = (v: unknown, naam: string): { ok: true; waarde: number | null } | { ok: false; fout: string } => {
    if (v === null) return { ok: true, waarde: null };
    if (!isGetal(v) || v < 0 || v > 100) return { ok: false, fout: `Ongeldige ${naam} (0–100% of leeg).` };
    return { ok: true, waarde: v };
  };
  const onder = leesGrens(grenzenVeld.ondergrens, "ondergrens");
  if (!onder.ok) return { ok: false, status: 400, fout: onder.fout };
  const boven = leesGrens(grenzenVeld.bovengrens, "bovengrens");
  if (!boven.ok) return { ok: false, status: 400, fout: boven.fout };
  if (onder.waarde !== null && boven.waarde !== null && onder.waarde > boven.waarde) {
    return { ok: false, status: 400, fout: "De ondergrens ligt boven de bovengrens." };
  }

  // Technische voorziening draagt de pct-noemer: zonder positieve TV geen
  // betekenisvolle reservepercentages (en geen realistische balans).
  if (passiva.record.tv <= 0) {
    return { ok: false, status: 422, fout: "Technische voorziening moet groter dan nul zijn." };
  }

  const invoer: BalansReservesInvoer = {
    ...periodeCheck.invoer,
    invoerBron,
    activa: activa.record,
    passiva: passiva.record,
    reserves: reserves.record,
    grenzen: { solidariteitsreserve: { ondergrens: onder.waarde, bovengrens: boven.waarde } },
    financieringsgraad: body.financieringsgraad,
  };

  // Balansevenwicht — dezelfde afleiding en tolerantie als het dashboard.
  const evenwicht = berekenEvenwicht(invoer.activa, invoer.passiva);
  if (!evenwicht.sluit) {
    return {
      ok: false,
      status: 422,
      fout: `Balans sluit niet — verschil € ${formatteerVerschil(evenwicht.verschil)} mln (activa − passiva).`,
    };
  }

  return { ok: true, invoer, evenwicht };
}

/** Evenwicht van een leaves-set via leidBalansAf (één definitie, T13). */
export function berekenEvenwicht(
  activa: Record<ActivaKey, number>,
  passiva: Record<PassivaKey, number>
): BalansEvenwicht {
  const naarRijen = (
    record: Record<string, number>,
    definities: ReadonlyArray<{ key: string; label: string; volgorde: number }>
  ): BalansBronRij[] =>
    definities.map((d) => ({
      puntKey: d.key,
      label: d.label,
      volgorde: d.volgorde,
      waarde: record[d.key] ?? 0,
    }));
  return leidBalansAf(
    naarRijen(activa, ACTIVA_DEFINITIES),
    naarRijen(passiva, PASSIVA_DEFINITIES),
    null,
    null
  ).evenwicht;
}

const formatteerVerschil = (verschil: number): string =>
  (Math.round(Math.abs(verschil) * 10) / 10).toLocaleString("nl-NL");

// ── Reserve-rijen opbouwen (gekoppelde standen + pct-berekening) ─────────────

/**
 * Bouwt de 8 reserve-rijen voor de RPC. Gedeelde standen komen uit de balans-
 * passiva (één bron per bedrag); vrije reserves uit de Reserves-sectie.
 * pct_waarde = stand / TV × 100 op 1 decimaal, voor alle rijen. Alleen de
 * solidariteitsreserve draagt de band; de overige reserves zijn bandloos
 * (→ "monitoring" in de leeslaag, T13-besluit).
 */
export function bouwReserveRijen(invoer: BalansReservesInvoer): ReserveRijInvoer[] {
  const tv = invoer.passiva.tv;
  const standVan = (key: ReserveKey): number => {
    const gekoppeld = GEKOPPELDE_RESERVES.find((g) => g.reserveKey === key);
    if (gekoppeld) return invoer.passiva[gekoppeld.passivaKey];
    return invoer.reserves[key as VrijeReserveKey];
  };
  return RESERVE_DEFINITIES.map((d) => ({
    reserve_key: d.key,
    label: d.label,
    stand: standVan(d.key),
    pct_waarde: rondAf1((standVan(d.key) / tv) * 100),
    ondergrens: d.key === "solidariteitsreserve" ? invoer.grenzen.solidariteitsreserve.ondergrens : null,
    bovengrens: d.key === "solidariteitsreserve" ? invoer.grenzen.solidariteitsreserve.bovengrens : null,
    volgorde: d.volgorde,
  }));
}

// ════════════════════════════════════════════════════════════════════════════
//  Tab 4 (Spreiding) + tab 5 (Solidariteit) — invoervalidatie (T15, 0076)
// ════════════════════════════════════════════════════════════════════════════

/** Payload-veldnamen Spreiding-sectie (afgeleide velden — spreidingsvermogen,
 *  financieringsgraad — bestaan bewust niet in de vorm → allowlist-400). */
export const SPREIDING_VELD_KEYS = [
  "beschikbaar",
  "voorziening",
  "aanpassingsfactor",
  "band_onder",
  "band_boven",
] as const;

export type SpreidingInvoer = {
  periode: string;
  invoerBron: InvoerBron;
  beschikbaar: number;
  voorziening: number;
  /** Aangeleverde waarde van de actuaris (±) — nooit berekend (decisions/0076). */
  aanpassingsfactor: number;
  /** Bandbreedte uitkeringsfase (%); null = geen grens. */
  bandOnder: number | null;
  bandBoven: number | null;
};

export type SpreidingValidatie =
  | { ok: true; invoer: SpreidingInvoer }
  | { ok: false; status: 400 | 422; fout: string };

/** Nullable grens binnen [min, max]; null = geen grens. */
const leesGrensWaarde = (
  v: unknown,
  naam: string,
  min: number,
  max: number
): { ok: true; waarde: number | null } | { ok: false; fout: string } => {
  if (v === null) return { ok: true, waarde: null };
  if (!isGetal(v) || v < min || v > max) {
    return { ok: false, fout: `Ongeldige ${naam} (${min}–${max}% of leeg).` };
  }
  return { ok: true, waarde: v };
};

/**
 * Valideert de Spreiding-payload: exhaustieve key-allowlist op 'kerncijfers'
 * (400), drie verplichte getallen + nullable bandgrenzen, en 422 zodra de
 * voorziening onbruikbaar is als FG-noemer (≤ 0).
 */
export function valideerSpreidingInvoer(body: unknown): SpreidingValidatie {
  if (!isRecord(body)) return { ok: false, status: 400, fout: "Ongeldige aanvraag." };

  const { periode } = body;
  if (typeof periode !== "string" || !PERIODE_REGEX.test(periode)) {
    return { ok: false, status: 400, fout: "Ongeldige periode — verwacht kwartaalvorm zoals '2026Q2'." };
  }
  const invoerBron = body.invoer_bron;
  if (invoerBron !== "handmatig" && invoerBron !== "upload") {
    return { ok: false, status: 400, fout: "Ongeldige invoerbron (handmatig/upload)." };
  }

  const kerncijfers = body.kerncijfers;
  if (!isRecord(kerncijfers)) {
    return { ok: false, status: 400, fout: "Veld 'kerncijfers' ontbreekt of is geen object." };
  }
  const onbekend = Object.keys(kerncijfers).filter(
    (k) => !(SPREIDING_VELD_KEYS as readonly string[]).includes(k)
  );
  if (onbekend.length > 0) {
    return { ok: false, status: 400, fout: `Onbekend of afgeleid veld in 'kerncijfers': ${onbekend.join(", ")}.` };
  }
  for (const k of ["beschikbaar", "voorziening", "aanpassingsfactor"] as const) {
    if (!isGetal(kerncijfers[k])) {
      return { ok: false, status: 400, fout: `Veld 'kerncijfers.${k}' ontbreekt of is geen getal.` };
    }
  }
  // Bandgrenzen: percentages rond de 100 (85–115 in de seed) — ruim toegestaan.
  const onder = leesGrensWaarde(kerncijfers.band_onder ?? null, "ondergrens", 0, 200);
  if (!onder.ok) return { ok: false, status: 400, fout: onder.fout };
  const boven = leesGrensWaarde(kerncijfers.band_boven ?? null, "bovengrens", 0, 200);
  if (!boven.ok) return { ok: false, status: 400, fout: boven.fout };
  if (onder.waarde !== null && boven.waarde !== null && onder.waarde > boven.waarde) {
    return { ok: false, status: 400, fout: "De ondergrens ligt boven de bovengrens." };
  }

  const beschikbaar = kerncijfers.beschikbaar as number;
  const voorziening = kerncijfers.voorziening as number;
  if (voorziening <= 0) {
    return { ok: false, status: 422, fout: "Uitkeringsvermogen (voorziening) moet groter dan nul zijn." };
  }

  return {
    ok: true,
    invoer: {
      periode,
      invoerBron,
      beschikbaar,
      voorziening,
      aanpassingsfactor: kerncijfers.aanpassingsfactor as number,
      bandOnder: onder.waarde,
      bandBoven: boven.waarde,
    },
  };
}

export type SolidariteitInvoer = {
  periode: string;
  invoerBron: InvoerBron;
  /** Vulling naar bron (±, € mln) — micro_langleven = biometrisch resultaat tab 3. */
  vulling: Record<SoliVullingKey, number>;
  uitdeling: number;
  /** Band solidariteitsreserve (zelfde vorm als de balans-payload — één bron). */
  grenzen: SoliGrenzen;
};

export type SolidariteitValidatie =
  | { ok: true; invoer: SolidariteitInvoer }
  | { ok: false; status: 400 | 422; fout: string };

/**
 * Valideert de Solidariteit-payload: exhaustieve key-allowlist op 'vulling'
 * (exact de vier bronnen — netto vulling/beginstand/eindstand bestaan niet in
 * de vorm), uitdeling ≥ 0 (422) en de bandgrenzen (zelfde regels als de
 * balans-payload). De RPC herhaalt deze checks + de eindstand-consistentie
 * op DB-niveau (defense-in-depth).
 */
export function valideerSolidariteitInvoer(body: unknown): SolidariteitValidatie {
  if (!isRecord(body)) return { ok: false, status: 400, fout: "Ongeldige aanvraag." };

  const { periode } = body;
  if (typeof periode !== "string" || !PERIODE_REGEX.test(periode)) {
    return { ok: false, status: 400, fout: "Ongeldige periode — verwacht kwartaalvorm zoals '2026Q2'." };
  }
  const invoerBron = body.invoer_bron;
  if (invoerBron !== "handmatig" && invoerBron !== "upload") {
    return { ok: false, status: 400, fout: "Ongeldige invoerbron (handmatig/upload)." };
  }

  const vulling = leesExacteGetallen(body.vulling, SOLI_VULLING_KEYS, "vulling");
  if (!vulling.ok) return { ok: false, status: 400, fout: vulling.fout };

  if (!isGetal(body.uitdeling)) {
    return { ok: false, status: 400, fout: "Veld 'uitdeling' ontbreekt of is geen getal." };
  }
  if (body.uitdeling < 0) {
    return { ok: false, status: 422, fout: "Uitdeling kan niet negatief zijn." };
  }

  const grenzenVeld = isRecord(body.grenzen) ? body.grenzen : undefined;
  if (!grenzenVeld) {
    return { ok: false, status: 400, fout: "Veld 'grenzen' ontbreekt." };
  }
  const onder = leesGrensWaarde(grenzenVeld.ondergrens ?? null, "ondergrens", 0, 100);
  if (!onder.ok) return { ok: false, status: 400, fout: onder.fout };
  const boven = leesGrensWaarde(grenzenVeld.bovengrens ?? null, "bovengrens", 0, 100);
  if (!boven.ok) return { ok: false, status: 400, fout: boven.fout };
  if (onder.waarde !== null && boven.waarde !== null && onder.waarde > boven.waarde) {
    return { ok: false, status: 400, fout: "De ondergrens ligt boven de bovengrens." };
  }

  return {
    ok: true,
    invoer: {
      periode,
      invoerBron,
      vulling: vulling.record,
      uitdeling: body.uitdeling,
      grenzen: { ondergrens: onder.waarde, bovengrens: boven.waarde },
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  Tab 6 (Operationeel) + tab 7 (Premie & compensatie) — invoervalidatie
//  (T16, decisions/0077)
// ════════════════════════════════════════════════════════════════════════════

/** Gedeelde kop van de tab 6/7-payloads: periode + invoerbron. */
const leesPeriodeEnInvoerBron = (
  body: Record<string, unknown>
):
  | { ok: true; periode: string; invoerBron: InvoerBron }
  | { ok: false; fout: string } => {
  const { periode } = body;
  if (typeof periode !== "string" || !PERIODE_REGEX.test(periode)) {
    return { ok: false, fout: "Ongeldige periode — verwacht kwartaalvorm zoals '2026Q2'." };
  }
  const invoerBron = body.invoer_bron;
  if (invoerBron !== "handmatig" && invoerBron !== "upload") {
    return { ok: false, fout: "Ongeldige invoerbron (handmatig/upload)." };
  }
  return { ok: true, periode, invoerBron };
};

/** Nullable bedraggrens in € mln (geen %-boodschap); null = geen grens. */
const leesBedragGrens = (
  v: unknown,
  naam: string
): { ok: true; waarde: number | null } | { ok: false; fout: string } => {
  if (v === null || v === undefined) return { ok: true, waarde: null };
  if (!isGetal(v) || v < 0) {
    return { ok: false, fout: `Ongeldige ${naam} (€ mln ≥ 0 of leeg).` };
  }
  return { ok: true, waarde: v };
};

export type OperationeelInvoer = {
  periode: string;
  invoerBron: InvoerBron;
  /** Mutatiebronnen (±, € mln) — incl. de kosten als geaggregeerde post (−).
   *  Totaal mutatie, primo en ultimo bestaan bewust niet in de vorm. */
  mutaties: Record<OperMutatieKey, number>;
  /** Norm operationele reserve (€ mln, aangeleverd). */
  norm: number;
  /** Band in € mln; null = geen grens. */
  bandOnder: number | null;
  bandBoven: number | null;
  /** Kostendetail YTD per kostensoort (aangeleverd; ≥ 0). */
  kostenRealisatie: Record<OperKostenKey, number>;
  kostenBegroot: Record<OperKostenKey, number>;
};

export type OperationeelValidatie =
  | { ok: true; invoer: OperationeelInvoer }
  | { ok: false; status: 400 | 422; fout: string };

/**
 * Valideert de Operationeel-payload: exhaustieve key-allowlists op 'mutaties'
 * en het kostendetail (afgeleide velden — totaal mutatie, primo, ultimo —
 * bestaan niet in de vorm → 400), norm/kosten ≥ 0 en bandgrenzen in € mln.
 * De RPC herhaalt deze checks + de mutatie-consistentie tegen de reserve-
 * standen op DB-niveau (OPER_MUTATIE_ONGELIJK — defense-in-depth).
 */
export function valideerOperationeelInvoer(body: unknown): OperationeelValidatie {
  if (!isRecord(body)) return { ok: false, status: 400, fout: "Ongeldige aanvraag." };

  const kop = leesPeriodeEnInvoerBron(body);
  if (!kop.ok) return { ok: false, status: 400, fout: kop.fout };

  const mutaties = leesExacteGetallen(body.mutaties, OPER_MUTATIE_KEYS, "mutaties");
  if (!mutaties.ok) return { ok: false, status: 400, fout: mutaties.fout };

  const realisatie = leesExacteGetallen(body.kosten_realisatie, OPER_KOSTEN_KEYS, "kosten_realisatie");
  if (!realisatie.ok) return { ok: false, status: 400, fout: realisatie.fout };
  const begroot = leesExacteGetallen(body.kosten_begroot, OPER_KOSTEN_KEYS, "kosten_begroot");
  if (!begroot.ok) return { ok: false, status: 400, fout: begroot.fout };
  for (const k of OPER_KOSTEN_KEYS) {
    if (realisatie.record[k] < 0 || begroot.record[k] < 0) {
      return { ok: false, status: 422, fout: "Kosten kunnen niet negatief zijn." };
    }
  }

  if (!isGetal(body.norm)) {
    return { ok: false, status: 400, fout: "Veld 'norm' ontbreekt of is geen getal." };
  }
  if (body.norm < 0) {
    return { ok: false, status: 422, fout: "De norm kan niet negatief zijn." };
  }

  const onder = leesBedragGrens(body.band_onder, "ondergrens");
  if (!onder.ok) return { ok: false, status: 400, fout: onder.fout };
  const boven = leesBedragGrens(body.band_boven, "bovengrens");
  if (!boven.ok) return { ok: false, status: 400, fout: boven.fout };
  if (onder.waarde !== null && boven.waarde !== null && onder.waarde > boven.waarde) {
    return { ok: false, status: 400, fout: "De ondergrens ligt boven de bovengrens." };
  }

  return {
    ok: true,
    invoer: {
      periode: kop.periode,
      invoerBron: kop.invoerBron,
      mutaties: mutaties.record,
      norm: body.norm,
      bandOnder: onder.waarde,
      bandBoven: boven.waarde,
      kostenRealisatie: realisatie.record,
      kostenBegroot: begroot.record,
    },
  };
}

export type PremieInvoer = {
  periode: string;
  invoerBron: InvoerBron;
  /** Premiecomponenten: € én % grondslag, beide AANGELEVERD (uitvoerder).
   *  Totaal premie bestaat bewust niet in de vorm (afgeleid). */
  componentenEur: Record<PremieComponentKey, number>;
  componentenPct: Record<PremieComponentKey, number>;
  /** Depot-mutatiebronnen (±, € mln; onttrekkingen −). */
  compMutaties: Record<CompMutatieKey, number>;
  /** Compensatietoekenning per jaar (€ mln, ≥ 0). */
  toekenning: number;
  /** Startomvang depot (€ mln, > 0) — voor de vulgraad; null = onbekend. */
  startomvang: number | null;
  /** Ondergrens als % van de startomvang; null = geen ondergrens. */
  ondergrensPct: number | null;
};

export type PremieValidatie =
  | { ok: true; invoer: PremieInvoer }
  | { ok: false; status: 400 | 422; fout: string };

/**
 * Valideert de Premie & compensatie-payload: exhaustieve key-allowlists op
 * de componenten (€ én %) en de depot-mutaties (afgeleide velden — totaal
 * premie, totaal mutatie, primo, ultimo — bestaan niet in de vorm → 400);
 * premies/toekenning ≥ 0 en %-waarden 0–100. De uitputtingsprognose-reeks
 * zit bewust NIET in deze payload (seed/upload-only). De RPC herhaalt de
 * checks + de mutatie-consistentie (COMP_MUTATIE_ONGELIJK).
 */
export function valideerPremieInvoer(body: unknown): PremieValidatie {
  if (!isRecord(body)) return { ok: false, status: 400, fout: "Ongeldige aanvraag." };

  const kop = leesPeriodeEnInvoerBron(body);
  if (!kop.ok) return { ok: false, status: 400, fout: kop.fout };

  const eur = leesExacteGetallen(body.componenten_eur, PREMIE_COMPONENT_KEYS, "componenten_eur");
  if (!eur.ok) return { ok: false, status: 400, fout: eur.fout };
  const pct = leesExacteGetallen(body.componenten_pct, PREMIE_COMPONENT_KEYS, "componenten_pct");
  if (!pct.ok) return { ok: false, status: 400, fout: pct.fout };
  for (const k of PREMIE_COMPONENT_KEYS) {
    if (eur.record[k] < 0) {
      return { ok: false, status: 422, fout: "Premiecomponenten kunnen niet negatief zijn." };
    }
    if (pct.record[k] < 0 || pct.record[k] > 100) {
      return { ok: false, status: 400, fout: "Ongeldig %-aandeel (0–100%)." };
    }
  }

  const mutaties = leesExacteGetallen(body.comp_mutaties, COMP_MUTATIE_KEYS, "comp_mutaties");
  if (!mutaties.ok) return { ok: false, status: 400, fout: mutaties.fout };

  if (!isGetal(body.toekenning)) {
    return { ok: false, status: 400, fout: "Veld 'toekenning' ontbreekt of is geen getal." };
  }
  if (body.toekenning < 0) {
    return { ok: false, status: 422, fout: "De toekenning kan niet negatief zijn." };
  }

  const startomvang = body.startomvang ?? null;
  if (startomvang !== null && !isGetal(startomvang)) {
    return { ok: false, status: 400, fout: "Ongeldige startomvang (€ mln of leeg)." };
  }
  if (startomvang !== null && startomvang <= 0) {
    return { ok: false, status: 422, fout: "De startomvang moet groter dan nul zijn (of leeg)." };
  }

  const ondergrens = leesGrensWaarde(body.ondergrens_pct ?? null, "ondergrens", 0, 100);
  if (!ondergrens.ok) return { ok: false, status: 400, fout: ondergrens.fout };

  return {
    ok: true,
    invoer: {
      periode: kop.periode,
      invoerBron: kop.invoerBron,
      componentenEur: eur.record,
      componentenPct: pct.record,
      compMutaties: mutaties.record,
      toekenning: body.toekenning,
      startomvang,
      ondergrensPct: ondergrens.waarde,
    },
  };
}
