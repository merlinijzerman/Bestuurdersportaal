// ============================================================================
//  Stuurinformatie Excel-sjabloon — PURE mapping-/parselogica (T14).
// ----------------------------------------------------------------------------
//  Isomorf en zonder I/O (geen xlsx-import — werkt op unknown[][], zoals
//  xlsx-segment.ts): de upload-route parseert het werkblad met SheetJS en
//  geeft de 2D-array aan deze module; de client hergebruikt parseNlGetal voor
//  de invoervelden. Sanity-getest (stuurinfo-sjabloon.sanity.ts).
//
//  Kernbesluiten (decisions/0075):
//  - EIGEN vast sjabloon: kolom A = veldlabel (vast), B = waarde, C = eenheid
//    (informatief, genegeerd). Herkenning op GENORMALISEERD label (trim/
//    lowercase/diacritics/whitespace/koppeltekens) — exacte match, geen fuzzy.
//  - Subtotalen staan bewust NIET in het sjabloon (afgeleid, read-only).
//  - Onherkende labels worden zichtbaar gemaakt (⚠ in het controlescherm)
//    maar nooit gecommit; ontbrekende verplichte velden blokkeren de commit
//    ("maak vereisten expliciet").
//  - Uitbreidbaar per tab-ticket: latere tabs voegen secties toe aan
//    SJABLOON_VELDEN zonder de parser te wijzigen.
// ============================================================================

import {
  type ActivaKey,
  type PassivaKey,
  type VrijeReserveKey,
  type SoliGrenzen,
} from "./stuurinfo-invoer";

// ── Sjabloon-specificatie ────────────────────────────────────────────────────

export type SjabloonDoel =
  | { soort: "balans_activa"; key: ActivaKey }
  | { soort: "balans_passiva"; key: PassivaKey }
  | { soort: "reserve"; key: VrijeReserveKey }
  | { soort: "reserve_grens"; key: "ondergrens" | "bovengrens" }
  | { soort: "kpi"; key: "financieringsgraad" };

export type SjabloonVeld = {
  /** Exact kolom-A-label van het sjabloon (herkenning op genormaliseerde vorm). */
  label: string;
  eenheid: string;
  /** Weergavenaam in het controlescherm ('Balans › Belegd vermogen'). */
  doelLabel: string;
  /** Verplicht voor commit; de soli-grenzen zijn optioneel (behoud huidige). */
  verplicht: boolean;
  doel: SjabloonDoel;
};

/**
 * Vaste sjabloonvelden (Balans-tab + reserves). NB: 'Overig toetsvermogen'
 * disambigueert bewust het DB-label "Overig" (ev_toets_overig) — in een plat
 * bestand zijn twee posten die "Overig" heten niet te onderscheiden. Latere
 * tab-tickets breiden deze lijst uit met hun eigen sectie.
 */
export const SJABLOON_VELDEN: SjabloonVeld[] = [
  // Balans — activa (€ mln)
  { label: "Belegd vermogen", eenheid: "€ mln", doelLabel: "Balans › Belegd vermogen", verplicht: true, doel: { soort: "balans_activa", key: "belegd" } },
  { label: "Overige activa, vorderingen en liquiditeiten", eenheid: "€ mln", doelLabel: "Balans › Overige activa", verplicht: true, doel: { soort: "balans_activa", key: "overig" } },
  // Balans — passiva (€ mln)
  { label: "MVEV-reserve", eenheid: "€ mln", doelLabel: "Balans › MVEV-reserve", verplicht: true, doel: { soort: "balans_passiva", key: "ev_toets_mvev" } },
  { label: "Operationele reserve", eenheid: "€ mln", doelLabel: "Balans › Operationele reserve", verplicht: true, doel: { soort: "balans_passiva", key: "ev_toets_oper" } },
  { label: "Overig toetsvermogen", eenheid: "€ mln", doelLabel: "Balans › Overig (toetsvermogen)", verplicht: true, doel: { soort: "balans_passiva", key: "ev_toets_overig" } },
  { label: "Solidariteitsreserve", eenheid: "€ mln", doelLabel: "Balans › Solidariteitsreserve", verplicht: true, doel: { soort: "balans_passiva", key: "ev_soli" } },
  { label: "Compensatiedepot", eenheid: "€ mln", doelLabel: "Balans › Compensatiedepot", verplicht: true, doel: { soort: "balans_passiva", key: "ev_comp" } },
  { label: "Technische voorziening", eenheid: "€ mln", doelLabel: "Balans › Technische voorziening", verplicht: true, doel: { soort: "balans_passiva", key: "tv" } },
  { label: "Voorziening uitvoeringskosten", eenheid: "€ mln", doelLabel: "Balans › Voorziening uitvoeringskosten", verplicht: true, doel: { soort: "balans_passiva", key: "vuk" } },
  { label: "Overige voorzieningen en passiva", eenheid: "€ mln", doelLabel: "Balans › Overige voorzieningen en passiva", verplicht: true, doel: { soort: "balans_passiva", key: "overig" } },
  // Financieringsgraad (%)
  { label: "Financieringsgraad", eenheid: "%", doelLabel: "Balans › Financieringsgraad", verplicht: true, doel: { soort: "kpi", key: "financieringsgraad" } },
  // Reserves — vrije standen (€ mln)
  { label: "Kostenreserve", eenheid: "€ mln", doelLabel: "Reserves › Kostenreserve", verplicht: true, doel: { soort: "reserve", key: "kostenreserve" } },
  { label: "AO-reserve", eenheid: "€ mln", doelLabel: "Reserves › AO-reserve", verplicht: true, doel: { soort: "reserve", key: "ao_reserve" } },
  { label: "PP/Wzp-reserve", eenheid: "€ mln", doelLabel: "Reserves › PP/Wzp-reserve", verplicht: true, doel: { soort: "reserve", key: "ppwzp_reserve" } },
  { label: "PP/Wzp-reserve eerbiedigend", eenheid: "€ mln", doelLabel: "Reserves › PP/Wzp-reserve eerbiedigend", verplicht: true, doel: { soort: "reserve", key: "ppwzp_reserve_eerbiedigend" } },
  // Band solidariteitsreserve (% van TV) — optioneel (ontbreken = behoud huidige)
  { label: "Solidariteitsreserve - ondergrens", eenheid: "% van TV", doelLabel: "Reserves › Solidariteitsreserve — ondergrens", verplicht: false, doel: { soort: "reserve_grens", key: "ondergrens" } },
  { label: "Solidariteitsreserve - bovengrens", eenheid: "% van TV", doelLabel: "Reserves › Solidariteitsreserve — bovengrens", verplicht: false, doel: { soort: "reserve_grens", key: "bovengrens" } },
];

// ── Label-normalisatie ───────────────────────────────────────────────────────

/**
 * Normaliseert een veldlabel voor de match: trim → lowercase → diacritics weg
 * → alle koppelteken-varianten (‐-–—) uniform → whitespace samengevouwen →
 * interpunctie aan de randen weg. Exacte match op de genormaliseerde vorm.
 */
export function normaliseerLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/^[\s:;.,]+|[\s:;.,]+$/g, "");
}

// ── NL-getalparsing (gedeeld met de invoervelden in de UI) ──────────────────

/**
 * Parseert een celwaarde/invoerveld als NL-genoteerd getal:
 *   2400 → 2400 · "2.400" → 2400 · "0,1" → 0.1 · "2.400,5" → 2400.5 ·
 *   "1,5%" → 1.5 · "+3,2" → 3.2 · "−4" → -4 · "" / rommel → null.
 * Zonder komma geldt een punt alleen als duizendtal-scheiding in het vaste
 * patroon 1.234(.567) — anders als decimaalteken ("0.1" → 0.1).
 */
export function parseNlGetal(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (s === "") return null;
  s = s
    .replace(/−/g, "-") // unicode-minus
    .replace(/[€%\s]/g, "")
    .replace(/^\+/, "");
  if (s === "" || s === "-") return null;
  if (s.includes(",")) {
    // NL-notatie: punt = duizendtal, komma = decimaal. Een punt NÁ de komma
    // ("2,400.5" — US-notatie) zou stil misparsen → expliciet weigeren
    // (null = "ontbrekend" in het controlescherm, niet stil een fout getal).
    if (s.indexOf(".", s.indexOf(",")) !== -1) return null;
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    // Alleen-punten in strikt duizendtalpatroon: "2.400" → 2400.
    s = s.replace(/\./g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ── Sjabloon parsen ──────────────────────────────────────────────────────────

export type HerkendVeld = { veld: SjabloonVeld; waarde: number };
export type OnherkendVeld = { label: string; waarde: number | null };

export type SjabloonParseResultaat = {
  herkend: HerkendVeld[];
  onherkend: OnherkendVeld[];
  /** Verplichte sjabloonvelden zonder (bruikbare) waarde in het bestand. */
  ontbrekend: string[];
};

const genormaliseerdeVelden = new Map(
  SJABLOON_VELDEN.map((v) => [normaliseerLabel(v.label), v])
);

/**
 * Parseert de 2D-array van het werkblad (kolom A label, B waarde; kolom C+
 * genegeerd). Kop- en lege rijen worden overgeslagen; rijvolgorde is vrij.
 * Een dubbel label wint met de laatste rij (expliciet gedrag, geen fout).
 */
export function parseSjabloonRijen(rijen: unknown[][]): SjabloonParseResultaat {
  const gevonden = new Map<string, HerkendVeld>();
  const onherkend: OnherkendVeld[] = [];
  const zonderWaarde = new Set<string>();

  for (const rij of rijen) {
    const ruwLabel = rij?.[0];
    if (typeof ruwLabel !== "string" || ruwLabel.trim() === "") continue;
    const genorm = normaliseerLabel(ruwLabel);
    if (genorm === "veld" || genorm === "veldlabel") continue; // koprij
    const veld = genormaliseerdeVelden.get(genorm);
    const waarde = parseNlGetal(rij[1]);
    if (!veld) {
      onherkend.push({ label: ruwLabel.trim(), waarde });
      continue;
    }
    if (waarde === null) {
      zonderWaarde.add(veld.label);
      gevonden.delete(veld.label);
      continue;
    }
    zonderWaarde.delete(veld.label);
    gevonden.set(veld.label, { veld, waarde });
  }

  const ontbrekend = SJABLOON_VELDEN.filter(
    (v) => v.verplicht && !gevonden.has(v.label)
  ).map((v) => v.label);

  return { herkend: [...gevonden.values()], onherkend, ontbrekend };
}

// ── Controlescherm-rijen (herkend/waarde/Δ vorige/status) ────────────────────

/** Referentiewaarden van de voorgaande periode (vorm = InvoerSnapshot). */
export type SjabloonReferentie = {
  activa: Record<ActivaKey, number | null>;
  passiva: Record<PassivaKey, number | null>;
  reserves: Record<VrijeReserveKey, number | null>;
  grenzen: { solidariteitsreserve: SoliGrenzen };
  financieringsgraad: number | null;
};

export type ControleVeld = {
  bronLabel: string;
  doelLabel: string | null;
  doel: SjabloonDoel | null;
  waarde: number | null;
  deltaVorige: number | null;
  status: "herkend" | "onherkend";
};

function referentieWaarde(ref: SjabloonReferentie, doel: SjabloonDoel): number | null {
  switch (doel.soort) {
    case "balans_activa":
      return ref.activa[doel.key];
    case "balans_passiva":
      return ref.passiva[doel.key];
    case "reserve":
      return ref.reserves[doel.key];
    case "reserve_grens":
      return ref.grenzen.solidariteitsreserve[doel.key];
    case "kpi":
      return ref.financieringsgraad;
  }
}

/**
 * Bouwt de controlescherm-rijen: herkende velden (met Δ t.o.v. de voorgaande
 * periode) in sjabloonvolgorde, gevolgd door onherkende labels (⚠, worden
 * nooit gecommit).
 */
export function bouwControleVelden(
  resultaat: SjabloonParseResultaat,
  referentie: SjabloonReferentie | null
): ControleVeld[] {
  const opLabel = new Map(resultaat.herkend.map((h) => [h.veld.label, h]));
  const rijen: ControleVeld[] = [];
  for (const veld of SJABLOON_VELDEN) {
    const h = opLabel.get(veld.label);
    if (!h) continue;
    const vorig = referentie ? referentieWaarde(referentie, veld.doel) : null;
    rijen.push({
      bronLabel: veld.label,
      doelLabel: veld.doelLabel,
      doel: veld.doel,
      waarde: h.waarde,
      deltaVorige: vorig === null ? null : Math.round((h.waarde - vorig) * 100) / 100,
      status: "herkend",
    });
  }
  for (const o of resultaat.onherkend) {
    rijen.push({
      bronLabel: o.label,
      doelLabel: null,
      doel: null,
      waarde: o.waarde,
      deltaVorige: null,
      status: "onherkend",
    });
  }
  return rijen;
}

// ── Sjabloon-download-inhoud ─────────────────────────────────────────────────

export const SJABLOON_WERKBLAD = "Stuurinformatie";

/**
 * De download-inhoud als array-of-arrays: koprij + één rij per veld (waarde
 * leeg). Roundtrip-garantie: parseSjabloonRijen(sjabloonAoa()) herkent elk
 * veld (sanity-getest).
 */
export function sjabloonAoa(): (string | null)[][] {
  return [
    ["Veld", "Waarde", "Eenheid"],
    ...SJABLOON_VELDEN.map((v) => [v.label, null, v.eenheid]),
  ];
}
