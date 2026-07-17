// ============================================================================
//  Stuurinformatie Biometrische rendementen (tab 3) — PURE afleidingslogica
//  (T17).
// ----------------------------------------------------------------------------
//  Isomorf en zonder I/O, zodat de risicovolle rekenlogica sanity-testbaar is
//  (stuurinfo-biometrie.sanity.ts) én de beheer-invoersectie dezelfde
//  afleiding live kan tonen als de server-leeslaag (stuurinfo-bron.ts).
//
//  Kernbesluiten (decisions/0078, werkopdracht tab 3):
//  - Alleen de BRONNEN zijn data: reeks langleven (micro ±, macro ±,
//    vrijval ≥ 0 = opbrengst) en reeks risicodekking (ppwzp_toegekend ≤ 0,
//    aopvi_toegekend ≤ 0). Netto langleven en de resultaten PP/WZP en AO/PVI
//    worden hier AFGELEID — nooit opgeslagen.
//  - De BINNENGEKOMEN risicopremies zijn de bestaande premie_component-rijen
//    van tab 7 (risico_ppwzp; risico_aop + risico_pvi) — één bron, tab 3
//    leest ze alleen (geen tweede opslag, geen tweede invoer).
//  - VERREKENING met de reserves (één bron over tabs 3/5/6):
//    * netto langleven → de langleven-post in de solidariteitsreserve-
//      ontwikkeling (tab 5, stuurinfo-soli.ts — SOLI_LANGLEVEN_POST);
//    * resultaat PP/WZP + resultaat AO/PVI → afgeleide mutatieregels in de
//      operationele-reserve-ontwikkeling (tab 6, stuurinfo-operationeel.ts).
//    De RPC's stuurinfo_soli_opslaan/stuurinfo_operationeel_opslaan spiegelen
//    deze afleiding hard op DB-niveau (SOLI_LANGLEVEN_ONTBREEKT,
//    OPER_PREMIE_/OPER_BIOMETRIE_ONTBREEKT, *_ONGELIJK).
//  - WERKHYPOTHESE (compliancegevoelig, valideren met actuaris/ABTN): de
//    verrekenrichting (langleven → solidariteitsreserve; risicodekkingen →
//    operationele reserve) en de vrijval-bij-overlijden als aparte
//    langleven-post naast micro-langleven zijn nog niet actuarieel bevestigd.
// ============================================================================

import { somMutaties, type MutatieBron } from "./stuurinfo-ontwikkeling";

// ── Definities (één bron voor reader, validator, beheer-UI en RPC-docs) ──────

export const LANGLEVEN_DEFINITIES = [
  { key: "micro", label: "Micro-langleven", volgorde: 1 },
  { key: "macro", label: "Macro-langleven", volgorde: 2 },
  { key: "vrijval", label: "Vrijval van kapitaal bij overlijden", volgorde: 3 },
] as const;

export type LanglevenKey = (typeof LANGLEVEN_DEFINITIES)[number]["key"];

export const LANGLEVEN_KEYS = LANGLEVEN_DEFINITIES.map((d) => d.key) as LanglevenKey[];

export const RISICODEKKING_DEFINITIES = [
  { key: "ppwzp_toegekend", label: "Toegekende PP/WZP", volgorde: 1 },
  { key: "aopvi_toegekend", label: "Toegekende AO/PVI", volgorde: 2 },
] as const;

export type RisicodekkingKey = (typeof RISICODEKKING_DEFINITIES)[number]["key"];

export const RISICODEKKING_KEYS = RISICODEKKING_DEFINITIES.map((d) => d.key) as RisicodekkingKey[];

/** reeks_keys van de biometrische bronnen (fonds_stuurinfo_reeks). */
export const LANGLEVEN_REEKS = "langleven";
export const RISICODEKKING_REEKS = "risicodekking";

/** punt_keys van de binnengekomen risicopremies in premie_component (tab 7) —
 *  verwijzing naar de bestaande bron, géén eigen opslag (decisions/0078). */
export const RISICOPREMIE_PPWZP_PUNT = "risico_ppwzp";
export const RISICOPREMIE_AOPVI_PUNTEN = ["risico_aop", "risico_pvi"] as const;

// ── Vormen ──────────────────────────────────────────────────────────────────

export type LanglevenOverzicht = {
  /** Bronregels in vaste definitievolgorde (datalabel wint, definitie = fallback). */
  bronnen: Array<{ key: string; label: string; volgorde: number; waarde: number | null }>;
  /** micro + macro + vrijval; null zodra een bron ontbreekt (geen halve som). */
  netto: number | null;
};

/** Eén risicodekkingstabel (PP/WZP of AO/PVI): premie − toegekend = resultaat. */
export type RisicodekkingTabel = {
  /** Binnengekomen risicopremie (tab 7, premie_component) — read-only bron. */
  premie: number | null;
  /** Toegekende dekkingen (≤ 0, tab 3-invoer). */
  toegekend: number | null;
  /** premie + toegekend; null zodra een bron ontbreekt (geen halve som). */
  resultaat: number | null;
};

/** De biometrie-gegevens van één periode, volledig afgeleid uit de bronnen. */
export type BiometriePeriode = {
  langleven: LanglevenOverzicht;
  ppwzp: RisicodekkingTabel;
  aopvi: RisicodekkingTabel;
};

// ── Afleiding ───────────────────────────────────────────────────────────────

/** Netto langleven-resultaat; null zodra een bron ontbreekt (geen schijnzekerheid). */
export function nettoLangleven(bronnen: MutatieBron[]): number | null {
  return somMutaties(LANGLEVEN_DEFINITIES, bronnen);
}

/** Bouwt de langleven-tabel (bronregels + afgeleid netto) op in definitievolgorde. */
export function leidLanglevenAf(bronnen: MutatieBron[]): LanglevenOverzicht {
  const perKey = new Map(bronnen.map((b) => [b.puntKey, b]));
  return {
    bronnen: LANGLEVEN_DEFINITIES.map((def) => ({
      key: def.key,
      label: perKey.get(def.key)?.label ?? def.label,
      volgorde: def.volgorde,
      waarde: perKey.get(def.key)?.waarde ?? null,
    })),
    netto: nettoLangleven(bronnen),
  };
}

/** premie + toegekend = resultaat; null zodra één van beide ontbreekt. */
export function leidRisicodekkingAf(
  premie: number | null,
  toegekend: number | null
): RisicodekkingTabel {
  return {
    premie,
    toegekend,
    resultaat: premie !== null && toegekend !== null ? premie + toegekend : null,
  };
}

/**
 * Leest de binnengekomen risicopremies uit premie_component-rijen (tab 7):
 * PP/WZP = risico_ppwzp; AO/PVI = risico_aop + risico_pvi (beide vereist —
 * een halve som zou stil een verkeerd resultaat geven).
 */
export function risicopremiesVan(
  componenten: MutatieBron[]
): { ppwzp: number | null; aopvi: number | null } {
  const perKey = new Map(componenten.map((c) => [c.puntKey, c.waarde]));
  const ppwzp = perKey.get(RISICOPREMIE_PPWZP_PUNT) ?? null;
  let aopvi: number | null = 0;
  for (const punt of RISICOPREMIE_AOPVI_PUNTEN) {
    const w = perKey.get(punt);
    if (w === null || w === undefined) {
      aopvi = null;
      break;
    }
    aopvi += Number(w);
  }
  return { ppwzp: ppwzp === null ? null : Number(ppwzp), aopvi };
}

/** Waarde van één toegekend-punt uit de risicodekking-rijen; null indien afwezig. */
export function toegekendVan(
  dekking: MutatieBron[],
  key: RisicodekkingKey
): number | null {
  const w = dekking.find((d) => d.puntKey === key)?.waarde;
  return w === null || w === undefined ? null : Number(w);
}

/**
 * Leidt de volledige biometrie-periode af: langleven-tabel + de twee
 * risicodekkingstabellen (premie uit tab 7, toegekend uit tab 3-invoer).
 */
export function leidBiometrieAf(
  langlevenBronnen: MutatieBron[],
  dekking: MutatieBron[],
  premieComponenten: MutatieBron[]
): BiometriePeriode {
  const premies = risicopremiesVan(premieComponenten);
  return {
    langleven: leidLanglevenAf(langlevenBronnen),
    ppwzp: leidRisicodekkingAf(premies.ppwzp, toegekendVan(dekking, "ppwzp_toegekend")),
    aopvi: leidRisicodekkingAf(premies.aopvi, toegekendVan(dekking, "aopvi_toegekend")),
  };
}
