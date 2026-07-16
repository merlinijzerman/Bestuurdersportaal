// ============================================================================
//  Stuurinformatie Premie- & compensatiebeleid (tab 7) — PURE afleiding (T16).
// ----------------------------------------------------------------------------
//  Isomorf en zonder I/O, zodat de risicovolle rekenlogica sanity-testbaar is
//  (stuurinfo-premie.sanity.ts) én de beheer-invoersectie dezelfde afleiding
//  live kan tonen als de server-leeslaag (stuurinfo-bron.ts).
//
//  Kernbesluiten (decisions/0077, werkopdracht tabs 6+7):
//  - Premiecomponenten worden per component opgeslagen: € per periode (reeks
//    premie_component) én % van de premiegrondslag (reeks premie_component_pct)
//    — beide AANGELEVERD door de uitvoerder, niet in het portaal berekend
//    (werkopdracht: de echte splitsing en de grondslagdefinitie zijn
//    openstaande valideerpunten). Totaal premie (€ en %) wordt AFGELEID.
//  - De KPI-tegel toont het afgeleide KWARTAALTOTAAL (besluit Merlin) — geen
//    aangeleverde jaarpremie-kpi die van de componenten kan gaan afwijken.
//  - Het compensatiedepot ontwikkelt per BRON (reeks comp_mutatie: premie,
//    beschermingsrendement ±, overrendement, onttrekkingen −, verrekening
//    reserves, overig). Totaal mutatie, primo en ultimo AFGELEID
//    (stuurinfo-ontwikkeling.ts); de ULTIMO = depot-stand uit de balans
//    (reserve-rij compensatiedepot = balans-leaf ev_comp) — ÉÉN bron.
//  - De uitputtingsprognose (reeks comp_uitputting_prognose, punt per jaar)
//    is een AANGELEVERDE ALM-reeks (seed/upload — geen handinvoer, geen
//    berekening in het portaal). Ondergrens-kruisjaar en vulgraad worden
//    hier afgeleid uit de reeks + kpi's comp_startomvang/comp_ondergrens_pct.
//  - Premiedekkingsgraad en "wie compenseert wie" zijn BEWUST verwijderd
//    (werkopdracht-besluit 7).
// ============================================================================

import {
  leidOntwikkelingAf,
  somMutaties,
  type MutatieBron,
  type Ontwikkeling,
} from "./stuurinfo-ontwikkeling";

// ── Definities (één bron voor reader, validator, beheer-UI en RPC-docs) ──────

export const PREMIE_COMPONENT_DEFINITIES = [
  { key: "spaarpremie", label: "Spaarpremie", volgorde: 1 },
  { key: "risico_ppwzp", label: "Risicopremie PP/WZP", volgorde: 2 },
  { key: "risico_aop", label: "Risicopremie AOP", volgorde: 3 },
  { key: "risico_pvi", label: "Risicopremie PVI", volgorde: 4 },
  { key: "opslag_uitvoeringskosten", label: "Opslag uitvoeringskosten", volgorde: 5 },
  { key: "opslag_toekomstige_kosten", label: "Opslag toekomstige kosten", volgorde: 6 },
] as const;

export type PremieComponentKey = (typeof PREMIE_COMPONENT_DEFINITIES)[number]["key"];

export const PREMIE_COMPONENT_KEYS = PREMIE_COMPONENT_DEFINITIES.map(
  (d) => d.key
) as PremieComponentKey[];

export const COMP_MUTATIE_DEFINITIES = [
  { key: "premie", label: "Premie", volgorde: 1 },
  { key: "beschermingsrendement", label: "Beschermingsrendement", volgorde: 2 },
  { key: "overrendement", label: "Overrendement", volgorde: 3 },
  { key: "onttrekkingen", label: "Onttrekkingen (compensatietoekenning)", volgorde: 4 },
  { key: "verrekening_reserves", label: "Verrekening reserves", volgorde: 5 },
  { key: "overig", label: "Overig", volgorde: 6 },
] as const;

export type CompMutatieKey = (typeof COMP_MUTATIE_DEFINITIES)[number]["key"];

export const COMP_MUTATIE_KEYS = COMP_MUTATIE_DEFINITIES.map((d) => d.key) as CompMutatieKey[];

/** reeks_keys: premiecomponenten (€ en % grondslag), depot-mutaties, prognose. */
export const PREMIE_COMPONENT_REEKS = "premie_component";
export const PREMIE_COMPONENT_PCT_REEKS = "premie_component_pct";
export const COMP_MUTATIE_REEKS = "comp_mutatie";
/** Uitputtingsprognose: punt_key = jaartal ('2026'…), per rapportageperiode
 *  (snapshot). Seed/upload-only — geen handinvoer (werkopdracht-scopegrens). */
export const COMP_PROGNOSE_REEKS = "comp_uitputting_prognose";

/** kpi_keys tab 7 (toekenning/jaar, startomvang depot, prognose-ondergrens). */
export const PREMIE_KPI_DEFINITIES = [
  { key: "comp_toekenning_jaar", label: "Compensatietoekenning per jaar", eenheid: "mln", volgorde: 40 },
  { key: "comp_startomvang", label: "Startomvang compensatiedepot", eenheid: "mln", volgorde: 41 },
  { key: "comp_ondergrens_pct", label: "Ondergrens compensatiedepot (% van startomvang)", eenheid: "pct", volgorde: 42 },
] as const;

export type PremieKpiKey = (typeof PREMIE_KPI_DEFINITIES)[number]["key"];

export const PREMIE_KPI_KEYS = PREMIE_KPI_DEFINITIES.map((d) => d.key) as PremieKpiKey[];

// ── Vormen ──────────────────────────────────────────────────────────────────

/** Eén premiecomponent-regel: % grondslag + € huidig/vorig (alles aangeleverd). */
export type PremieRegel = {
  key: string;
  label: string;
  volgorde: number;
  pct: number | null;
  huidig: number | null;
  vorig: number | null;
};

export type PremieTabel = {
  regels: PremieRegel[];
  /** Afgeleide totalen (som componenten); null zodra één component ontbreekt. */
  totaalPct: number | null;
  totaalHuidig: number | null;
  totaalVorig: number | null;
};

/** Eén prognosepunt (punt_key = jaartal). */
export type PrognosePunt = { puntKey: string; volgorde: number; waarde: number | null };

export type UitputtingAfleiding = {
  /** Gesorteerde prognosepunten met echte waarden (geen geïnterpoleerde gaten). */
  punten: Array<{ jaar: string; waarde: number }>;
  /** ondergrens_pct × startomvang ÷ 100 (€ mln); null zonder beide kpi's. */
  ondergrensBedrag: number | null;
  /** Eerste prognosejaar onder het ondergrens-bedrag; null zonder kruising. */
  kruisjaarOndergrens: string | null;
  /** Laatste prognosejaar + de stand daar (voor de signalering/KPI-tegel). */
  laatsteJaar: string | null;
  laatsteWaarde: number | null;
  /** stand ÷ startomvang × 100 (1 decimaal); null zonder positieve startomvang. */
  gevuldPct: number | null;
};

// ── Afleiding ───────────────────────────────────────────────────────────────

const rondAf1 = (x: number): number => Math.round(x * 10) / 10;

const somAlsCompleet = (waarden: Array<number | null>): number | null => {
  let som = 0;
  for (const w of waarden) {
    if (w === null) return null;
    som += w;
  }
  return som;
};

/**
 * Bouwt de premiecomponententabel (huidig + voorgaand kwartaal) in vaste
 * definitievolgorde en leidt de totalen af. De % grondslag hoort bij de
 * GEKOZEN periode (de aangeleverde premietabel van dat kwartaal).
 */
export function leidPremieTabelAf(
  eurHuidig: MutatieBron[],
  pctHuidig: MutatieBron[],
  eurVorig: MutatieBron[] | null
): PremieTabel {
  const perKey = (rijen: MutatieBron[] | null) =>
    new Map((rijen ?? []).map((r) => [r.puntKey, r]));
  const eurMap = perKey(eurHuidig);
  const pctMap = perKey(pctHuidig);
  const vorigMap = perKey(eurVorig);

  const regels: PremieRegel[] = PREMIE_COMPONENT_DEFINITIES.map((d) => ({
    key: d.key,
    label: eurMap.get(d.key)?.label ?? d.label,
    volgorde: d.volgorde,
    pct: pctMap.get(d.key)?.waarde ?? null,
    huidig: eurMap.get(d.key)?.waarde ?? null,
    vorig: vorigMap.get(d.key)?.waarde ?? null,
  }));

  return {
    regels,
    totaalPct: somAlsCompleet(regels.map((r) => r.pct)),
    totaalHuidig: somAlsCompleet(regels.map((r) => r.huidig)),
    totaalVorig: eurVorig ? somAlsCompleet(regels.map((r) => r.vorig)) : null,
  };
}

/**
 * Leidt de depot-ontwikkeling af voor één periode (generieke logica —
 * stuurinfo-ontwikkeling.ts). `stand` = depot-stand uit de balans (ultimo);
 * `vorigeStand` = stand voorgaande periode (null → primo teruggerekend).
 */
export function leidCompDepotAf(
  mutaties: MutatieBron[],
  stand: number | null,
  vorigeStand: number | null
): Ontwikkeling {
  return leidOntwikkelingAf(COMP_MUTATIE_DEFINITIES, mutaties, stand, vorigeStand);
}

/** Som van de depot-mutatiebronnen zonder stand-anker (beheer-UI, live). */
export function compTotaalMutatie(bronnen: MutatieBron[]): number | null {
  return somMutaties(COMP_MUTATIE_DEFINITIES, bronnen);
}

/**
 * Leidt de uitputtingssignalering af uit de aangeleverde ALM-prognosereeks +
 * kpi's. Er wordt bewust NIETS geëxtrapoleerd buiten de reeks (geen eigen
 * ALM-berekening — geen schijnzekerheid): het kruisjaar is het eerste
 * prognosejaar ónder het ondergrens-bedrag, de "uitputting" is de laatste
 * prognosestand zoals aangeleverd.
 */
export function leidUitputtingAf(
  prognose: PrognosePunt[],
  stand: number | null,
  startomvang: number | null,
  ondergrensPct: number | null
): UitputtingAfleiding {
  const punten = prognose
    .slice()
    .sort((a, b) => a.volgorde - b.volgorde)
    .filter((p): p is PrognosePunt & { waarde: number } => p.waarde !== null)
    .map((p) => ({ jaar: p.puntKey, waarde: Number(p.waarde) }));

  const ondergrensBedrag =
    startomvang !== null && startomvang > 0 && ondergrensPct !== null
      ? rondAf1((startomvang * ondergrensPct) / 100)
      : null;

  const kruisjaarOndergrens =
    ondergrensBedrag !== null
      ? punten.find((p) => p.waarde < ondergrensBedrag)?.jaar ?? null
      : null;

  const laatste = punten.length > 0 ? punten[punten.length - 1] : null;

  return {
    punten,
    ondergrensBedrag,
    kruisjaarOndergrens,
    laatsteJaar: laatste?.jaar ?? null,
    laatsteWaarde: laatste?.waarde ?? null,
    gevuldPct:
      stand !== null && startomvang !== null && startomvang > 0
        ? rondAf1((stand / startomvang) * 100)
        : null,
  };
}
