// ============================================================================
//  Stuurinformatie Spreidingsbeleid (tab 4) — PURE afleidingslogica (T15).
// ----------------------------------------------------------------------------
//  Isomorf en zonder I/O, zodat de risicovolle rekenlogica sanity-testbaar is
//  (stuurinfo-spreiding.sanity.ts) én de beheer-invoersectie dezelfde
//  afleiding live kan tonen als de server-leeslaag (stuurinfo-bron.ts).
//
//  Kernbesluiten (decisions/0076, werkopdracht Spreiding+Solidariteit):
//  - Alleen INVOER staat in de data (kpi-rijen uitkeringsfase_*): beschikbaar
//    vermogen, voorziening, aanpassingsfactor en de bandgrenzen. Het
//    spreidingsvermogen (beschikbaar − voorziening) en de financieringsgraad
//    van de collectieve uitkeringsfase (beschikbaar ÷ voorziening) worden
//    hier AFGELEID — geen opgeslagen duplicaat dat kan afwijken.
//  - De aanpassingsfactor (na spreiden) is een aangeleverde waarde van de
//    actuaris (ABTN-formule, fondsspecifiek) en wordt bewust NIET in het
//    portaal nagerekend — voorkomt een "tweede waarheid".
//  - WERKHYPOTHESE (compliancegevoelig, valideren met de actuaris): het model
//    gaat uit van een collectieve uitkeringsfase met eigen financieringsgraad
//    en bandbreedte (85–115 in de seed) — zie de werkopdracht/decisions/0076.
// ============================================================================

import { richtingVan, type Richting } from "./stuurinfo-balans";

// ── Definities (één bron voor reader, validator, beheer-UI en seed-docs) ─────

export const SPREIDING_KPI_DEFINITIES = [
  {
    key: "uitkeringsfase_beschikbaar",
    label: "Totaal beschikbaar vermogen (uitkeringsfase)",
    eenheid: "mln",
    volgorde: 10,
  },
  {
    key: "uitkeringsfase_voorziening",
    label: "Uitkeringsvermogen (voorziening)",
    eenheid: "mln",
    volgorde: 11,
  },
  {
    key: "uitkeringsfase_aanpassingsfactor",
    label: "Aanpassingsfactor (na spreiden)",
    eenheid: "pct",
    volgorde: 12,
  },
  {
    key: "uitkeringsfase_band_onder",
    label: "Bandbreedte uitkeringsfase — ondergrens",
    eenheid: "pct",
    volgorde: 13,
  },
  {
    key: "uitkeringsfase_band_boven",
    label: "Bandbreedte uitkeringsfase — bovengrens",
    eenheid: "pct",
    volgorde: 14,
  },
] as const;

export type SpreidingKpiKey = (typeof SPREIDING_KPI_DEFINITIES)[number]["key"];

export const SPREIDING_KPI_KEYS = SPREIDING_KPI_DEFINITIES.map((d) => d.key) as SpreidingKpiKey[];

/** reeks_key van de FG-maandreeks (seed-only; handinvoer via het latere uploadticket). */
export const UITKERINGSFASE_FG_REEKS = "uitkeringsfase_fg_maand";

// ── Vormen ──────────────────────────────────────────────────────────────────

/** De vijf ingevoerde kerncijfers van één periode (null = (nog) niet ingevoerd). */
export type SpreidingKerncijfers = {
  beschikbaar: number | null;
  voorziening: number | null;
  aanpassingsfactor: number | null;
  bandOnder: number | null;
  bandBoven: number | null;
};

export type SpreidingAfleiding = {
  /** beschikbaar − voorziening; null zodra een van beide ontbreekt. */
  spreidingsvermogen: number | null;
  /** beschikbaar ÷ voorziening × 100, 1 decimaal; null zonder bruikbare noemer. */
  financieringsgraad: number | null;
};

/** Eén regel van de kerncijfertabel "Ontwikkeling collectieve uitkeringsfase". */
export type SpreidingRegel = {
  key: string;
  label: string;
  /** true = afgeleide rij (vet in de UI, bestaat niet in de data). */
  afgeleid: boolean;
  eenheid: "mln" | "pct" | "pct_signed";
  huidig: number | null;
  vorig: number | null;
  richting: Richting | null;
};

/** Eén punt van de FG-maandreeks (uit fonds_stuurinfo_reeks). */
export type FgMaandPunt = { puntKey: string; label: string | null; volgorde: number; waarde: number | null };

// ── Afleiding ───────────────────────────────────────────────────────────────

const rondAf1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * Leidt spreidingsvermogen en financieringsgraad af uit de ingevoerde
 * kerncijfers. Een voorziening ≤ 0 geeft geen FG (geen deling door nul of
 * betekenisloos negatief percentage — geen schijnzekerheid).
 */
export function leidSpreidingAf(k: SpreidingKerncijfers): SpreidingAfleiding {
  const spreidingsvermogen =
    k.beschikbaar !== null && k.voorziening !== null ? k.beschikbaar - k.voorziening : null;
  const financieringsgraad =
    k.beschikbaar !== null && k.voorziening !== null && k.voorziening > 0
      ? rondAf1((k.beschikbaar / k.voorziening) * 100)
      : null;
  return { spreidingsvermogen, financieringsgraad };
}

const tabelRichting = (huidig: number | null, vorig: number | null): Richting | null =>
  huidig === null ? null : richtingVan(huidig, vorig);

/**
 * Bouwt de kerncijfertabel (huidig + voorgaand kwartaal, prototypevolgorde):
 * beschikbaar → voorziening → spreidingsvermogen (afgeleid) → FG (afgeleid) →
 * aanpassingsfactor (invoer). De bandgrenzen horen bij de trendgrafiek en
 * staan bewust niet in de tabel.
 */
export function bouwSpreidingTabel(
  huidig: SpreidingKerncijfers,
  vorig: SpreidingKerncijfers | null
): SpreidingRegel[] {
  const afgeleidH = leidSpreidingAf(huidig);
  const afgeleidV = vorig ? leidSpreidingAf(vorig) : null;

  const regel = (
    key: string,
    label: string,
    afgeleid: boolean,
    eenheid: SpreidingRegel["eenheid"],
    h: number | null,
    v: number | null
  ): SpreidingRegel => ({ key, label, afgeleid, eenheid, huidig: h, vorig: v, richting: tabelRichting(h, v) });

  return [
    regel("beschikbaar", "Totaal beschikbaar vermogen", false, "mln", huidig.beschikbaar, vorig?.beschikbaar ?? null),
    regel("voorziening", "Uitkeringsvermogen (voorziening)", false, "mln", huidig.voorziening, vorig?.voorziening ?? null),
    regel("spreidingsvermogen", "Spreidingsvermogen", true, "mln", afgeleidH.spreidingsvermogen, afgeleidV?.spreidingsvermogen ?? null),
    regel("financieringsgraad", "Financieringsgraad", true, "pct", afgeleidH.financieringsgraad, afgeleidV?.financieringsgraad ?? null),
    regel("aanpassingsfactor", "Aanpassingsfactor (na spreiden)", false, "pct_signed", huidig.aanpassingsfactor, vorig?.aanpassingsfactor ?? null),
  ];
}

/**
 * Sorteert en normaliseert de FG-maandreeks voor de trendgrafiek. Punten
 * zonder waarde vallen weg (de grafiek tekent alleen echte metingen —
 * geen geïnterpoleerde schijnzekerheid).
 */
export function bouwFgMaandreeks(punten: FgMaandPunt[]): Array<{ label: string; waarde: number }> {
  return punten
    .slice()
    .sort((a, b) => a.volgorde - b.volgorde)
    .filter((p): p is FgMaandPunt & { waarde: number } => p.waarde !== null)
    .map((p) => ({ label: p.label ?? p.puntKey, waarde: Number(p.waarde) }));
}
