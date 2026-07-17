// ============================================================================
//  Stuurinformatie Operationeel beleid (tab 6) — PURE afleidingslogica (T16).
// ----------------------------------------------------------------------------
//  Isomorf en zonder I/O, zodat de risicovolle rekenlogica sanity-testbaar is
//  (stuurinfo-operationeel.sanity.ts) én de beheer-invoersectie dezelfde
//  afleiding live kan tonen als de server-leeslaag (stuurinfo-bron.ts).
//
//  Kernbesluiten (decisions/0077, werkopdracht tabs 6+7):
//  - De ontwikkeling van de operationele reserve wordt per BRON opgeslagen
//    (reeks oper_mutatie: premie/kostenopslag, beschermingsrendement ±,
//    overrendement, gemist rendement TWK, TWK-invaarmutaties, verrekening
//    reserves, overig, en de KOSTEN als geaggregeerde post −). Totaal mutatie,
//    primo en ultimo worden AFGELEID (stuurinfo-ontwikkeling.ts) — nooit data.
//  - De ULTIMO is per definitie de operationele-reservestand uit de balans
//    (reserve-rij operationele_reserve = balans-leaf ev_toets_oper) — ÉÉN
//    bron, zelfde patroon als de solidariteitsreserve (tab 5).
//  - Norm + band staan als kpi's in € MLN (oper_norm/oper_band_onder/-boven,
//    spreiding-patroon). BEWUST niet op de reserve-rij: die band is in % van
//    de TV en zou het tab 1-stoplicht wijzigen (reserve blijft "monitoring").
//  - Kostendetail per kostensoort (realisatie YTD + begroot) is AANGELEVERD
//    (reeks oper_kosten_realisatie/-begroot). De geaggregeerde kostenpost in
//    de ontwikkeling wordt bewust NIET hard aan het detail gecheckt: het
//    detail is YTD, de post is de kwartaalmutatie (zachte presentatie).
//  - WERKHYPOTHESE (compliancegevoelig, valideren met actuaris/uitvoerder):
//    de TWK-/verrekeningsposten zijn fondsspecifiek/transitiegerelateerd;
//    definities en structurele terugkeer zijn niet bevestigd.
//  - T17 (decisions/0078): de resultaten PP/WZP en AO/PVI (tab 3) zijn
//    AFGELEIDE mutatieregels in de ontwikkeling (na 'Verrekening reserves'):
//    resultaat = binnengekomen risicopremie (tab 7, premie_component) +
//    toegekende dekkingen (tab 3, risicodekking). Eén bron — nooit hier
//    ingevoerd; de leeslaag injecteert de waarden en de RPC-check telt ze
//    hard mee (vorige + som(8) + r_ppwzp + r_aopvi = stand).
// ============================================================================

import { leidReserveStatusAf, type ReserveStatus } from "./stuurinfo-balans";
import {
  leidOntwikkelingAf,
  somMutaties,
  type MutatieBron,
  type Ontwikkeling,
} from "./stuurinfo-ontwikkeling";

// ── Definities (één bron voor reader, validator, beheer-UI en RPC-docs) ──────

export const OPER_MUTATIE_DEFINITIES = [
  { key: "premie_kostenopslag", label: "Premie", volgorde: 1 },
  { key: "beschermingsrendement", label: "Beschermingsrendement", volgorde: 2 },
  { key: "overrendement", label: "Overrendement", volgorde: 3 },
  { key: "gemist_rendement_twk", label: "Gemist rendement (a.g.v. TWK)", volgorde: 4 },
  { key: "twk_invaar", label: "TWK-invaarmutaties", volgorde: 5 },
  { key: "verrekening_reserves", label: "Verrekening reserves", volgorde: 6 },
  { key: "overig", label: "Overig", volgorde: 7 },
  { key: "kosten", label: "Kosten (geaggregeerd)", volgorde: 8 },
] as const;

export type OperMutatieKey = (typeof OPER_MUTATIE_DEFINITIES)[number]["key"];

export const OPER_MUTATIE_KEYS = OPER_MUTATIE_DEFINITIES.map((d) => d.key) as OperMutatieKey[];

/** De AFGELEIDE resultaatregels uit tab 3 (decisions/0078) — nooit opgeslagen;
 *  de leeslaag injecteert de waarden (risicopremie tab 7 + toegekend tab 3). */
export const OPER_RESULTAAT_DEFINITIES = [
  { key: "resultaat_ppwzp", label: "Resultaat PP/WZP (tab 3)", volgorde: 7 },
  { key: "resultaat_aopvi", label: "Resultaat AO/PVI (tab 3)", volgorde: 8 },
] as const;

export type OperResultaatKey = (typeof OPER_RESULTAAT_DEFINITIES)[number]["key"];

export const OPER_RESULTAAT_KEYS =
  OPER_RESULTAAT_DEFINITIES.map((d) => d.key) as OperResultaatKey[];

/** Volledige ontwikkelingsvolgorde: 6 ingevoerde bronnen, de 2 afgeleide
 *  resultaatregels (na 'Verrekening reserves'), dan overig + kosten. */
export const OPER_ONTWIKKELING_DEFINITIES: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly volgorde: number;
}> = [
  ...OPER_MUTATIE_DEFINITIES.filter((d) => d.volgorde <= 6),
  ...OPER_RESULTAAT_DEFINITIES,
  ...OPER_MUTATIE_DEFINITIES
    .filter((d) => d.volgorde > 6)
    .map((d) => ({ key: d.key, label: d.label, volgorde: d.volgorde + 2 })),
];

export const OPER_KOSTEN_DEFINITIES = [
  { key: "uitvoeringskosten", label: "Uitvoeringskosten", volgorde: 1 },
  { key: "vermogensbeheer", label: "Vermogensbeheer", volgorde: 2 },
  { key: "bestuur_overig", label: "Bestuur & overig", volgorde: 3 },
] as const;

export type OperKostenKey = (typeof OPER_KOSTEN_DEFINITIES)[number]["key"];

export const OPER_KOSTEN_KEYS = OPER_KOSTEN_DEFINITIES.map((d) => d.key) as OperKostenKey[];

/** reeks_keys van de mutatiebronnen en het kostendetail (realisatie + begroot). */
export const OPER_MUTATIE_REEKS = "oper_mutatie";
export const OPER_KOSTEN_REALISATIE_REEKS = "oper_kosten_realisatie";
export const OPER_KOSTEN_BEGROOT_REEKS = "oper_kosten_begroot";

/** kpi_keys: norm + band van de operationele reserve, in € MLN (geen % van TV). */
export const OPER_KPI_DEFINITIES = [
  { key: "oper_norm", label: "Norm operationele reserve", eenheid: "mln", volgorde: 30 },
  { key: "oper_band_onder", label: "Band operationele reserve — ondergrens", eenheid: "mln", volgorde: 31 },
  { key: "oper_band_boven", label: "Band operationele reserve — bovengrens", eenheid: "mln", volgorde: 32 },
] as const;

export type OperKpiKey = (typeof OPER_KPI_DEFINITIES)[number]["key"];

export const OPER_KPI_KEYS = OPER_KPI_DEFINITIES.map((d) => d.key) as OperKpiKey[];

// ── Vormen ──────────────────────────────────────────────────────────────────

/** Eén kostendetail-rij (realisatie + begroot per kostensoort, aangeleverd). */
export type OperKostenRegel = {
  key: string;
  label: string;
  volgorde: number;
  realisatie: number | null;
  begroot: number | null;
};

export type OperKostenOverzicht = {
  regels: OperKostenRegel[];
  /** Som van de kostensoorten; null zodra er één ontbreekt (geen halve som). */
  totaalRealisatie: number | null;
  totaalBegroot: number | null;
  /** true = realisatie ≤ begroot; null zonder beide totalen. */
  binnenBudget: boolean | null;
};

/** De operationeel-gegevens van één periode zoals de leeslaag ze aanlevert. */
export type OperPeriodeBron = {
  mutaties: MutatieBron[];
  /** AFGELEIDE resultaten uit tab 3/7 (risicopremie + toegekend — één bron);
   *  null = biometrie-/premie-invoer (nog) niet compleet. */
  resultaatPpwzp: number | null;
  resultaatAopvi: number | null;
  /** Oper-stand uit fonds_stuurinfo_reserve (balansbron) = de ultimo. */
  stand: number | null;
  /** kpi's — € mln; null = (nog) niet ingevoerd. */
  norm: number | null;
  bandOnder: number | null;
  bandBoven: number | null;
};

export type OperOntwikkeling = Ontwikkeling & {
  norm: number | null;
  bandOnder: number | null;
  bandBoven: number | null;
  /** stand − norm (€ mln); null zonder beide. */
  buffer: number | null;
  /** stand ÷ norm × 100 (1 decimaal); null zonder positieve norm. */
  pctVanNorm: number | null;
  /** Status t.o.v. de band in € mln — zelfde éne stoplichtdefinitie als tab 1/5. */
  status: ReserveStatus;
  /** Positie in de band, 0 (ondergrens) … 1 (bovengrens), geclamped; null zonder band/stand. */
  gaugePositie: number | null;
  /** Positie van de norm in de band (voor de norm-markering in de gauge). */
  normPositie: number | null;
};

// ── Afleiding ───────────────────────────────────────────────────────────────

const rondAf1 = (x: number): number => Math.round(x * 10) / 10;

/** Combineert de ingevoerde mutaties met de twee afgeleide resultaatregels
 *  (tab 3) tot één bronnenlijst voor de generieke ontwikkelings-afleiding. */
function metResultaten(
  mutaties: MutatieBron[],
  resultaatPpwzp: number | null,
  resultaatAopvi: number | null
): MutatieBron[] {
  return [
    ...mutaties,
    ...OPER_RESULTAAT_DEFINITIES.map((d) => ({
      puntKey: d.key,
      label: d.label,
      volgorde: d.volgorde,
      waarde: d.key === "resultaat_ppwzp" ? resultaatPpwzp : resultaatAopvi,
    })),
  ];
}

const bandPositie = (
  onder: number | null,
  boven: number | null,
  waarde: number | null
): number | null =>
  onder !== null && boven !== null && boven > onder && waarde !== null
    ? Math.min(1, Math.max(0, (waarde - onder) / (boven - onder)))
    : null;

/**
 * Leidt de ontwikkeling + norm-/bandpositie van de operationele reserve af
 * voor één periode. `vorigeStand` = de oper-reservestand van de voorgaande
 * periode (null als die er niet is — dan wordt de primo teruggerekend).
 */
export function leidOperationeelAf(
  bron: OperPeriodeBron,
  vorigeStand: number | null
): OperOntwikkeling {
  const ontwikkeling = leidOntwikkelingAf(
    OPER_ONTWIKKELING_DEFINITIES,
    metResultaten(bron.mutaties, bron.resultaatPpwzp, bron.resultaatAopvi),
    bron.stand,
    vorigeStand
  );

  const buffer = bron.stand !== null && bron.norm !== null ? bron.stand - bron.norm : null;
  const pctVanNorm =
    bron.stand !== null && bron.norm !== null && bron.norm > 0
      ? rondAf1((bron.stand / bron.norm) * 100)
      : null;

  return {
    ...ontwikkeling,
    norm: bron.norm,
    bandOnder: bron.bandOnder,
    bandBoven: bron.bandBoven,
    buffer,
    pctVanNorm,
    // Band en stand zijn hier beide in € mln — de vergelijkingslogica is
    // dezelfde éne stoplichtdefinitie (leidReserveStatusAf) als tab 1/5.
    status: leidReserveStatusAf(bron.bandOnder, bron.bandBoven, bron.stand),
    gaugePositie: bandPositie(bron.bandOnder, bron.bandBoven, bron.stand),
    normPositie: bandPositie(bron.bandOnder, bron.bandBoven, bron.norm),
  };
}

/** Som van de kwartaalmutatie-bronnen + de afgeleide resultaatregels (tab 3),
 *  zonder stand-anker (beheer-UI, live). Null zodra een bron ontbreekt. */
export function operTotaalMutatie(
  bronnen: MutatieBron[],
  resultaatPpwzp: number | null,
  resultaatAopvi: number | null
): number | null {
  return somMutaties(
    OPER_ONTWIKKELING_DEFINITIES,
    metResultaten(bronnen, resultaatPpwzp, resultaatAopvi)
  );
}

/**
 * Bouwt het kostendetail (realisatie YTD vs. begroot, per kostensoort) op in
 * vaste definitievolgorde. Totalen alleen als álle soorten aanwezig zijn
 * (geen halve som als schijnzekerheid).
 */
export function leidOperKostenAf(
  realisatie: MutatieBron[],
  begroot: MutatieBron[]
): OperKostenOverzicht {
  const perKey = (rijen: MutatieBron[]) => new Map(rijen.map((r) => [r.puntKey, r]));
  const realMap = perKey(realisatie);
  const begrootMap = perKey(begroot);

  const regels: OperKostenRegel[] = OPER_KOSTEN_DEFINITIES.map((d) => ({
    key: d.key,
    label: realMap.get(d.key)?.label ?? d.label,
    volgorde: d.volgorde,
    realisatie: realMap.get(d.key)?.waarde ?? null,
    begroot: begrootMap.get(d.key)?.waarde ?? null,
  }));

  const som = (kies: (r: OperKostenRegel) => number | null): number | null => {
    let totaal = 0;
    for (const r of regels) {
      const w = kies(r);
      if (w === null) return null;
      totaal += w;
    }
    return totaal;
  };

  const totaalRealisatie = som((r) => r.realisatie);
  const totaalBegroot = som((r) => r.begroot);

  return {
    regels,
    totaalRealisatie,
    totaalBegroot,
    binnenBudget:
      totaalRealisatie !== null && totaalBegroot !== null
        ? totaalRealisatie <= totaalBegroot
        : null,
  };
}
