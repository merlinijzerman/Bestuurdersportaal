// ============================================================================
//  Stuurinformatie — PURE generieke ontwikkelings-afleiding (T16).
// ----------------------------------------------------------------------------
//  Tab 6 (operationele reserve) en tab 7 (compensatiedepot) tonen allebei een
//  ontwikkelingstabel "Primo → mutaties naar bron → Totaal mutatie → Ultimo".
//  De afleiding is identiek; deze module is de ÉNE definitie (geen twee
//  kopieën die uiteen kunnen lopen). Isomorf en zonder I/O, zodat de logica
//  sanity-testbaar is (stuurinfo-ontwikkeling.sanity.ts) én de beheer-
//  invoersecties dezelfde afleiding live tonen als de server-leeslaag.
//
//  Kernbesluiten (werkopdracht tabs 6+7, decisions/0077 — soli-patroon 0076):
//  - Alleen de MUTATIEBRONNEN zijn data (reeks oper_mutatie / comp_mutatie);
//    totaal mutatie, primo en ultimo worden hier AFGELEID — nooit opgeslagen.
//  - De ULTIMO is per definitie de stand uit de balans (reserve-rij
//    operationele_reserve resp. compensatiedepot — één bron per bedrag);
//    primo = stand van de voorgaande periode. De afgeleide ultimo
//    (primo + totaal mutatie) moet daarmee sporen: de RPC's weigeren een
//    inconsistente save hard (OPER_/COMP_MUTATIE_ONGELIJK) en de leeslaag
//    signaleert een achteraf ontstane afwijking via `consistent`.
//  - Zonder voorgaande periode wordt de primo TERUGGEREKEND
//    (stand − totaal mutatie) — dan is er geen onafhankelijke check.
// ============================================================================

// ── Vormen ──────────────────────────────────────────────────────────────────

/** Eén mutatiebron-definitie (key/label/volgorde — één bron per taxonomie). */
export type MutatieDefinitie = { readonly key: string; readonly label: string; readonly volgorde: number };

/** Eén mutatiebron-rij uit fonds_stuurinfo_reeks. */
export type MutatieBron = {
  puntKey: string;
  label: string | null;
  volgorde: number;
  waarde: number | null;
};

export type Ontwikkeling = {
  /** Stand voorgaande periode, of teruggerekend (stand − totaal mutatie). */
  primo: number | null;
  /** Bronregels in vaste definitievolgorde (datalabel wint, definitie = fallback). */
  bronnen: Array<{ key: string; label: string; volgorde: number; waarde: number | null }>;
  /** Som van alle bronnen; null zodra een bron ontbreekt (geen halve som). */
  totaalMutatie: number | null;
  /** primo + totaal mutatie (afgeleid); null zonder volledige invoer. */
  ultimo: number | null;
  /** De balansbron (reserve-stand) — het anker waarmee de ultimo moet sporen. */
  stand: number | null;
  /** false = afgeleide ultimo wijkt af van de balans-stand (tolerantie 0.005). */
  consistent: boolean;
};

// ── Afleiding ───────────────────────────────────────────────────────────────

/** Numerieke tolerantie ultimo↔balans-stand — één definitie voor leeslaag,
 *  beheer-UI en (gespiegeld in SQL) de RPC-checks *_MUTATIE_ONGELIJK. */
export const ONTWIKKELING_TOLERANTIE = 0.005;

/** Som van de gedefinieerde bronnen; null zodra er een ontbreekt (geen schijnzekerheid). */
export function somMutaties(
  definities: ReadonlyArray<MutatieDefinitie>,
  bronnen: MutatieBron[]
): number | null {
  const perKey = new Map(bronnen.map((b) => [b.puntKey, b.waarde]));
  let som = 0;
  for (const def of definities) {
    const w = perKey.get(def.key);
    if (w === null || w === undefined) return null;
    som += Number(w);
  }
  return som;
}

/**
 * Leidt de ontwikkeling (primo → mutaties → ultimo) van één periode af.
 * `stand` = de reserve-stand van deze periode uit de balans (het anker);
 * `vorigeStand` = de stand van de voorgaande periode (null als die er niet
 * is — dan wordt de primo teruggerekend uit de eigen stand).
 */
export function leidOntwikkelingAf(
  definities: ReadonlyArray<MutatieDefinitie>,
  bronnen: MutatieBron[],
  stand: number | null,
  vorigeStand: number | null
): Ontwikkeling {
  const perKey = new Map(bronnen.map((b) => [b.puntKey, b]));
  const bronRegels = definities.map((def) => ({
    key: def.key,
    label: perKey.get(def.key)?.label ?? def.label,
    volgorde: def.volgorde,
    waarde: perKey.get(def.key)?.waarde ?? null,
  }));

  const totaal = somMutaties(definities, bronnen);

  const primo =
    vorigeStand !== null
      ? vorigeStand
      : stand !== null && totaal !== null
        ? stand - totaal
        : null;

  const ultimo = primo !== null && totaal !== null ? primo + totaal : null;

  // Alleen toetsbaar met een onafhankelijke primo én een balans-stand;
  // zonder die twee is er niets om tegen af te wijken (geen vals alarm).
  const consistent =
    ultimo === null || stand === null ? true : Math.abs(ultimo - stand) < ONTWIKKELING_TOLERANTIE;

  return { primo, bronnen: bronRegels, totaalMutatie: totaal, ultimo, stand, consistent };
}
