// ============================================================================
//  Stuurinformatie Solidariteitsbeleid (tab 5) — PURE afleidingslogica (T15).
// ----------------------------------------------------------------------------
//  Isomorf en zonder I/O, zodat de risicovolle rekenlogica sanity-testbaar is
//  (stuurinfo-soli.sanity.ts) én de beheer-invoersectie dezelfde afleiding
//  live kan tonen als de server-leeslaag (stuurinfo-bron.ts).
//
//  Kernbesluiten (decisions/0076 + 0078, werkopdrachten Solidariteit + Biometrie):
//  - De vulling van de solidariteitsreserve wordt per INVOERBRON opgeslagen
//    (reeks soli_vulling: premie, rendement, overrendementsbijdrage) + de
//    uitdeling (kpi soli_uitdeling). Netto vulling, beginstand en eindstand
//    worden hier AFGELEID — nooit data.
//  - De langleven-post (SOLI_LANGLEVEN_POST, volgorde 3) is het AFGELEIDE
//    netto langleven-resultaat uit tab 3 (reeks langleven: micro + macro +
//    vrijval — stuurinfo-biometrie.ts). ÉÉN bron, reader-afleiding
//    (decisions/0078 — vervangt het T15-opslagpunt soli_vulling.
//    micro_langleven): de leeslaag injecteert de waarde als langlevenNetto,
//    en de RPC stuurinfo_soli_opslaan berekent 'm zelf uit de langleven-reeks
//    (SOLI_LANGLEVEN_ONTBREEKT als die onvolledig is).
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

/** De drie INVOERBRONNEN (opgeslagen als soli_vulling-rijen; volgorde 3 is
 *  gereserveerd voor de afgeleide langleven-post). */
export const SOLI_VULLING_INVOER_DEFINITIES = [
  { key: "premie", label: "Premie", volgorde: 1 },
  { key: "rendement", label: "Rendement", volgorde: 2 },
  { key: "overrendementsbijdrage", label: "Overrendementsbijdrage", volgorde: 4 },
] as const;

export type SoliVullingInvoerKey = (typeof SOLI_VULLING_INVOER_DEFINITIES)[number]["key"];

export const SOLI_VULLING_INVOER_KEYS =
  SOLI_VULLING_INVOER_DEFINITIES.map((d) => d.key) as SoliVullingInvoerKey[];

/** De AFGELEIDE langleven-post (netto langleven-resultaat, tab 3) — nooit
 *  opgeslagen; de leeslaag injecteert de waarde (decisions/0078). */
export const SOLI_LANGLEVEN_POST = {
  key: "langleven",
  label: "Netto langleven resultaat",
  volgorde: 3,
} as const;

/** Volledige ontwikkelingsvolgorde (3 invoerbronnen + afgeleide langleven-post). */
export const SOLI_VULLING_DEFINITIES = [
  ...SOLI_VULLING_INVOER_DEFINITIES,
  SOLI_LANGLEVEN_POST,
].sort((a, b) => a.volgorde - b.volgorde) as ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly volgorde: number;
}>;

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
  /** AFGELEID netto langleven-resultaat (tab 3, reeks langleven — één bron);
   *  null = biometrie-invoer (nog) niet compleet. */
  langlevenNetto: number | null;
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
  /** Bronregels in vaste volgorde (premie, rendement, langleven-post [afgeleid,
   *  tab 3], overrendementsbijdrage). */
  bronnen: Array<{ key: string; label: string; volgorde: number; waarde: number | null }>;
  /** Som van de drie invoerbronnen + de afgeleide langleven-post; null zodra
   *  een bron ontbreekt (geen halve som). */
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

/** Som van de drie invoerbronnen + de afgeleide langleven-post; null zodra er
 *  een ontbreekt (geen schijnzekerheid). */
export function nettoVullingVan(
  vulling: SoliVullingBron[],
  langlevenNetto: number | null
): number | null {
  if (langlevenNetto === null) return null;
  const perKey = new Map(vulling.map((b) => [b.puntKey, b.waarde]));
  let som = langlevenNetto;
  for (const def of SOLI_VULLING_INVOER_DEFINITIES) {
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
  const bronnen = SOLI_VULLING_DEFINITIES.map((def) =>
    def.key === SOLI_LANGLEVEN_POST.key
      ? {
          // De langleven-post is AFGELEID (tab 3) — waarde uit langlevenNetto,
          // nooit uit een opgeslagen soli_vulling-rij (decisions/0078).
          key: def.key,
          label: def.label,
          volgorde: def.volgorde,
          waarde: bron.langlevenNetto,
        }
      : {
          key: def.key,
          label: perKey.get(def.key)?.label ?? def.label,
          volgorde: def.volgorde,
          waarde: perKey.get(def.key)?.waarde ?? null,
        }
  );

  const netto = nettoVullingVan(bron.vulling, bron.langlevenNetto);

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
