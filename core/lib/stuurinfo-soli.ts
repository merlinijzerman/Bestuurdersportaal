// ============================================================================
//  Stuurinformatie Solidariteitsbeleid (tab 5) — PURE afleidingslogica (T15).
// ----------------------------------------------------------------------------
//  Isomorf en zonder I/O, zodat de risicovolle rekenlogica sanity-testbaar is
//  (stuurinfo-soli.sanity.ts) én de beheer-invoersectie dezelfde afleiding
//  live kan tonen als de server-leeslaag (stuurinfo-bron.ts).
//
//  Kernbesluiten (decisions/0076, werkopdracht Spreiding+Solidariteit):
//  - De vulling van de solidariteitsreserve wordt per BRON opgeslagen (reeks
//    soli_vulling: premie, rendement, micro_langleven ±, overrendements-
//    bijdrage) + de uitdeling (kpi soli_uitdeling). Netto vulling, beginstand
//    en eindstand worden hier AFGELEID — nooit data.
//  - micro_langleven = het biometrische resultaat van tab 3 (later ticket) —
//    ÉÉN bron: tab 3 leest/schrijft ditzelfde reeks-punt, nooit een tweede
//    losse invoer van hetzelfde bedrag.
//  - De EINDSTAND is per definitie de soli-stand uit de balans (reserve-rij);
//    beginstand = stand van de voorgaande periode. De afgeleide eindstand
//    (begin + netto − uitdeling) moet daarmee sporen: de RPC weigert een
//    inconsistente save hard (SOLI_EINDSTAND_ONGELIJK) en de leeslaag
//    signaleert een achteraf ontstane afwijking via `consistent` (bv. een
//    balans-save ná de soli-save).
//  - Zonder voorgaande periode wordt de beginstand TERUGGEREKEND
//    (stand − netto + uitdeling) — dan is er geen onafhankelijke check.
//  - Band + stoplicht: dezelfde éne bron als tab 1 (reserve-rij ondergrens/
//    bovengrens + leidReserveStatusAf uit stuurinfo-balans.ts).
// ============================================================================

import { leidReserveStatusAf, type ReserveStatus } from "./stuurinfo-balans";

// ── Definities (één bron voor reader, validator, beheer-UI en RPC-docs) ──────

export const SOLI_VULLING_DEFINITIES = [
  { key: "premie", label: "Premie", volgorde: 1 },
  { key: "rendement", label: "Rendement", volgorde: 2 },
  { key: "micro_langleven", label: "Resultaat micro-langleven", volgorde: 3 },
  { key: "overrendementsbijdrage", label: "Overrendementsbijdrage", volgorde: 4 },
] as const;

export type SoliVullingKey = (typeof SOLI_VULLING_DEFINITIES)[number]["key"];

export const SOLI_VULLING_KEYS = SOLI_VULLING_DEFINITIES.map((d) => d.key) as SoliVullingKey[];

/** reeks_key van de vullingsbronnen en kpi_key van de uitdeling. */
export const SOLI_VULLING_REEKS = "soli_vulling";
export const SOLI_UITDELING_KPI = "soli_uitdeling";

// ── Vormen ──────────────────────────────────────────────────────────────────

/** Eén vullingsbron-rij uit fonds_stuurinfo_reeks (soli_vulling). */
export type SoliVullingBron = {
  puntKey: string;
  label: string | null;
  volgorde: number;
  waarde: number | null;
};

/** De soli-gegevens van één periode zoals de leeslaag ze aanlevert. */
export type SoliPeriodeBron = {
  vulling: SoliVullingBron[];
  /** kpi soli_uitdeling; null = (nog) niet ingevoerd. */
  uitdeling: number | null;
  /** Soli-stand uit fonds_stuurinfo_reserve (balansbron) = de eindstand. */
  stand: number | null;
  pctWaarde: number | null;
  ondergrens: number | null;
  bovengrens: number | null;
};

export type SoliOntwikkeling = {
  /** Stand voorgaande periode, of teruggerekend (stand − netto + uitdeling). */
  beginstand: number | null;
  /** Bronregels in vaste volgorde (premie, rendement, micro-langleven, overrendementsbijdrage). */
  bronnen: Array<{ key: string; label: string; volgorde: number; waarde: number | null }>;
  /** Som van de vier bronnen; null zodra een bron ontbreekt (geen halve som). */
  nettoVulling: number | null;
  uitdeling: number | null;
  /** beginstand + netto − uitdeling (afgeleid); null zonder volledige invoer. */
  eindstand: number | null;
  /** De balansbron (reserve-stand) — het anker waarmee eindstand moet sporen. */
  stand: number | null;
  /** false = afgeleide eindstand wijkt af van de balans-stand (tolerantie 0.005). */
  consistent: boolean;
  pctWaarde: number | null;
  ondergrens: number | null;
  bovengrens: number | null;
  status: ReserveStatus;
  /** Positie in de band, 0 (ondergrens) … 1 (bovengrens), geclamped; null zonder band/stand%. */
  gaugePositie: number | null;
};

// ── Afleiding ───────────────────────────────────────────────────────────────

/** Numerieke tolerantie eindstand↔balans-stand — één definitie voor leeslaag,
 *  beheer-UI en (gespiegeld in SQL) de RPC-check SOLI_EINDSTAND_ONGELIJK. */
export const SOLI_TOLERANTIE = 0.005;

/** Som van de vier bronnen; null zodra er een ontbreekt (geen schijnzekerheid). */
export function nettoVullingVan(vulling: SoliVullingBron[]): number | null {
  const perKey = new Map(vulling.map((b) => [b.puntKey, b.waarde]));
  let som = 0;
  for (const def of SOLI_VULLING_DEFINITIES) {
    const w = perKey.get(def.key);
    if (w === null || w === undefined) return null;
    som += Number(w);
  }
  return som;
}

/**
 * Leidt de ontwikkeling van de solidariteitsreserve af voor één periode.
 * `vorigeStand` = de soli-reserve-stand van de voorgaande periode (null als
 * die er niet is — dan wordt de beginstand teruggerekend uit de eigen stand).
 */
export function leidSoliOntwikkelingAf(
  bron: SoliPeriodeBron,
  vorigeStand: number | null
): SoliOntwikkeling {
  const perKey = new Map(bron.vulling.map((b) => [b.puntKey, b]));
  const bronnen = SOLI_VULLING_DEFINITIES.map((def) => ({
    key: def.key,
    label: perKey.get(def.key)?.label ?? def.label,
    volgorde: def.volgorde,
    waarde: perKey.get(def.key)?.waarde ?? null,
  }));

  const netto = nettoVullingVan(bron.vulling);

  const beginstand =
    vorigeStand !== null
      ? vorigeStand
      : bron.stand !== null && netto !== null && bron.uitdeling !== null
        ? bron.stand - netto + bron.uitdeling
        : null;

  const eindstand =
    beginstand !== null && netto !== null && bron.uitdeling !== null
      ? beginstand + netto - bron.uitdeling
      : null;

  // Alleen toetsbaar met een onafhankelijke beginstand én een balans-stand;
  // zonder die twee is er niets om tegen af te wijken (geen vals alarm).
  const consistent =
    eindstand === null || bron.stand === null
      ? true
      : Math.abs(eindstand - bron.stand) < SOLI_TOLERANTIE;

  const gaugePositie =
    bron.ondergrens !== null &&
    bron.bovengrens !== null &&
    bron.bovengrens > bron.ondergrens &&
    bron.pctWaarde !== null
      ? Math.min(1, Math.max(0, (bron.pctWaarde - bron.ondergrens) / (bron.bovengrens - bron.ondergrens)))
      : null;

  return {
    beginstand,
    bronnen,
    nettoVulling: netto,
    uitdeling: bron.uitdeling,
    eindstand,
    stand: bron.stand,
    consistent,
    pctWaarde: bron.pctWaarde,
    ondergrens: bron.ondergrens,
    bovengrens: bron.bovengrens,
    status: leidReserveStatusAf(bron.ondergrens, bron.bovengrens, bron.pctWaarde),
    gaugePositie,
  };
}
