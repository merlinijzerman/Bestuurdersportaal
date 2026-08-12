// ============================================================================
//  measure.ts — match geëxtraheerde units tegen de golden set → metrieken.
// ----------------------------------------------------------------------------
//  Kernmetriek is BINDINGS-PRECISION (van wat als concept X geëxtraheerd is:
//  welk deel is écht X). Precision boven recall: een FOUTBINDING (waarde aan het
//  verkeerde concept) is de gevaarlijke fout. Zie README.md §Meting.
//
//  Draaibaar als CLI (print samenvatting) én importeerbaar door report.ts.
// ============================================================================

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConceptType, Unit, GoldenUnit } from "./types";
import { CONCEPTEN } from "./concepts";
import { jaccard } from "./tekst";

const HIER = dirname(fileURLToPath(import.meta.url));

// Drempels voor het co-loceren van een geëxtraheerde unit met een golden unit.
const JACCARD_MIN = 0.5; // evidence-overlap
const PAGINA_TOLERANTIE = 1; // paginanummers mogen ±1 afwijken

export type Status = "CORRECT" | "MISBOUND" | "UNMATCHED";

// Geëxtraheerde unit verrijkt met matchresultaat.
export interface BeoordeeldeUnit extends Unit {
  status: Status;
  misbound_naar: string | null; // concept waaraan de waarde eigenlijk hoort
  value_ok: boolean | null; // alleen zinvol bij CORRECT
  golden_value: number | string | null; // waarde van de gepaarde golden unit
}

export interface CelMetriek {
  golden_total: number;
  extracted_total: number;
  correct: number;
  misbound: number;
  unmatched: number;
  recall: number | null;
  binding_precision: number | null;
  misbinding_rate: number | null;
  value_checked: number;
  value_correct: number;
  value_accuracy: number | null;
  evidence_accuracy: number | null;
  g1_green: boolean;
}

export interface Metrieken {
  perConcept: Record<string, CelMetriek & { type: ConceptType }>;
  perType: Record<string, CelMetriek>;
  overall: CelMetriek;
  beoordeeld: BeoordeeldeUnit[];
  gemistGolden: GoldenUnit[]; // golden units zonder enige co-locerende extractie
}

export const G1 = {
  binding_precision: 0.9,
  value_accuracy: 0.95,
  evidence_accuracy: 0.9,
};

function paginaCompatibel(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return true; // geen pagina-concept (bv. docx)
  return Math.abs(a - b) <= PAGINA_TOLERANTIE;
}

function coLoceert(e: Unit, g: GoldenUnit): boolean {
  return (
    e.document === g.document &&
    paginaCompatibel(e.page, g.page) &&
    jaccard(e.evidence, g.evidence) >= JACCARD_MIN
  );
}

function waardenGelijk(
  type: ConceptType,
  eVal: number | string | null,
  eCur: string | null,
  gVal: number | string,
  gCur: string | null | undefined
): boolean {
  if (eVal == null) return false;
  if (type === "percentage" || type === "amount") {
    if (typeof eVal !== "number" || typeof gVal !== "number") return false;
    const gelijk = Math.abs(eVal - gVal) <= Math.max(1e-9, 1e-6 * Math.abs(gVal));
    if (type === "amount" && gCur != null) return gelijk && eCur === gCur;
    return gelijk;
  }
  // date (ISO) en policy_choice (enum): string-exact.
  return String(eVal) === String(gVal);
}

function leegCel(): CelMetriek {
  return {
    golden_total: 0,
    extracted_total: 0,
    correct: 0,
    misbound: 0,
    unmatched: 0,
    recall: null,
    binding_precision: null,
    misbinding_rate: null,
    value_checked: 0,
    value_correct: 0,
    value_accuracy: null,
    evidence_accuracy: null,
    g1_green: false,
  };
}

// Verdicht ruwe tellingen tot ratio's + G1-oordeel. `recall` en
// `evidence_accuracy` worden vóór deze aanroep apart gezet (zie compute); hier
// alleen binding-precision, misbinding-rate, value-accuracy en het G1-oordeel.
function sluitCel(c: CelMetriek): CelMetriek {
  const noemer = c.correct + c.misbound + c.unmatched;
  c.binding_precision = noemer > 0 ? c.correct / noemer : null;
  c.misbinding_rate =
    c.extracted_total > 0 ? c.misbound / c.extracted_total : null;
  c.value_accuracy =
    c.value_checked > 0 ? c.value_correct / c.value_checked : null;
  c.g1_green =
    (c.binding_precision ?? 0) >= G1.binding_precision &&
    (c.value_accuracy ?? 0) >= G1.value_accuracy &&
    (c.evidence_accuracy ?? 0) >= G1.evidence_accuracy;
  return c;
}

export function computeMetrieken(
  units: Unit[],
  golden: GoldenUnit[]
): Metrieken {
  const perConcept: Metrieken["perConcept"] = {};
  const perType: Record<string, CelMetriek> = {};
  const overall = leegCel();
  const beoordeeld: BeoordeeldeUnit[] = [];

  for (const def of CONCEPTEN)
    perConcept[def.concept] = { ...leegCel(), type: def.type };
  for (const t of ["percentage", "date", "amount", "policy_choice"])
    perType[t] = leegCel();

  // Evidence-teller apart bijhouden (leegCel zet evidence_accuracy op null).
  const evOk: Record<string, number> = {};
  const bump = (k: string) => (evOk[k] = (evOk[k] ?? 0) + 1);

  // ── Golden-tellingen ──
  for (const g of golden) {
    if (perConcept[g.concept]) perConcept[g.concept].golden_total++;
    if (perType[g.type]) perType[g.type].golden_total++;
    overall.golden_total++;
  }

  // ── Classificeer elke geëxtraheerde unit ──
  const gemistGolden: GoldenUnit[] = [];

  for (const e of units) {
    const type = e.type;
    const cel = perConcept[e.concept];
    const tcel = perType[type];
    if (cel) cel.extracted_total++;
    if (tcel) tcel.extracted_total++;
    overall.extracted_total++;
    if (e.evidence_ok) {
      bump(`c:${e.concept}`);
      bump(`t:${type}`);
      bump("overall");
    }

    // Zoek golden units van HETZELFDE concept die co-loceren.
    const zelfde = golden
      .filter((g) => g.concept === e.concept && coLoceert(e, g))
      .sort((a, b) => jaccard(e.evidence, b.evidence) - jaccard(e.evidence, a.evidence));

    let status: Status;
    let misboundNaar: string | null = null;
    let valueOk: boolean | null = null;
    let goldenValue: number | string | null = null;

    if (zelfde.length > 0) {
      status = "CORRECT";
      const g = zelfde[0];
      goldenValue = g.value_normalized;
      valueOk = waardenGelijk(type, e.value_normalized, e.currency, g.value_normalized, g.currency);
      if (cel) {
        cel.correct++;
        cel.value_checked++;
        if (valueOk) cel.value_correct++;
      }
      if (tcel) {
        tcel.correct++;
        tcel.value_checked++;
        if (valueOk) tcel.value_correct++;
      }
      overall.correct++;
      overall.value_checked++;
      if (valueOk) overall.value_correct++;
    } else {
      // Co-loceert de waarde met een ANDER concept? → foutbinding.
      const ander = golden.find(
        (g) =>
          g.concept !== e.concept &&
          coLoceert(e, g) &&
          waardenGelijk(g.type, e.value_normalized, e.currency, g.value_normalized, g.currency)
      );
      if (ander) {
        status = "MISBOUND";
        misboundNaar = ander.concept;
        goldenValue = ander.value_normalized;
        if (cel) cel.misbound++;
        if (tcel) tcel.misbound++;
        overall.misbound++;
      } else {
        status = "UNMATCHED";
        if (cel) cel.unmatched++;
        if (tcel) tcel.unmatched++;
        overall.unmatched++;
      }
    }

    beoordeeld.push({
      ...e,
      status,
      misbound_naar: misboundNaar,
      value_ok: valueOk,
      golden_value: goldenValue,
    });
  }

  // ── Recall: welke golden units zijn door ≥1 CORRECTe extractie gedekt? ──
  // Per golden unit één keer tellen — `correct` kan bij dubbele extracties >
  // golden_total worden, dus recall wordt op golden-niveau apart geteld.
  const recallHits: Record<string, number> = {};
  for (const g of golden) {
    const gedekt = beoordeeld.some(
      (e) => e.status === "CORRECT" && e.concept === g.concept && coLoceert(e, g)
    );
    if (gedekt) {
      recallHits[`c:${g.concept}`] = (recallHits[`c:${g.concept}`] ?? 0) + 1;
      recallHits[`t:${g.type}`] = (recallHits[`t:${g.type}`] ?? 0) + 1;
      recallHits["overall"] = (recallHits["overall"] ?? 0) + 1;
    } else {
      gemistGolden.push(g);
    }
  }

  // ── Sluit cellen af (ratio's + G1) ──
  const zetEvidence = (c: CelMetriek, key: string) => {
    c.evidence_accuracy =
      c.extracted_total > 0 ? (evOk[key] ?? 0) / c.extracted_total : null;
  };
  const zetRecall = (c: CelMetriek, key: string) => {
    c.recall = c.golden_total > 0 ? (recallHits[key] ?? 0) / c.golden_total : null;
  };

  for (const def of CONCEPTEN) {
    const c = perConcept[def.concept];
    zetEvidence(c, `c:${def.concept}`);
    sluitCel(c);
    zetRecall(c, `c:${def.concept}`);
  }
  for (const t of Object.keys(perType)) {
    zetEvidence(perType[t], `t:${t}`);
    sluitCel(perType[t]);
    zetRecall(perType[t], `t:${t}`);
  }
  zetEvidence(overall, "overall");
  sluitCel(overall);
  zetRecall(overall, "overall");

  return { perConcept, perType, overall, beoordeeld, gemistGolden };
}

// ── CLI: print een korte samenvatting ──────────────────────────────
function pct(x: number | null): string {
  return x == null ? "—" : `${(x * 100).toFixed(0)}%`;
}

function main() {
  const unitsPad = join(HIER, "output", "units.json");
  const goldenPad = join(HIER, "golden_set.json");
  if (!existsSync(unitsPad)) {
    console.error("output/units.json ontbreekt — draai eerst extract.ts.");
    process.exit(1);
  }
  const units: Unit[] = JSON.parse(readFileSync(unitsPad, "utf8"));
  const golden: GoldenUnit[] = existsSync(goldenPad)
    ? JSON.parse(readFileSync(goldenPad, "utf8"))
    : [];
  if (golden.length === 0) {
    console.error(
      "golden_set.json is leeg — zonder ground truth kan er niet gemeten worden."
    );
    process.exit(1);
  }

  const m = computeMetrieken(units, golden);
  console.log("\nPer concept:");
  for (const [naam, c] of Object.entries(m.perConcept)) {
    console.log(
      `  ${naam} [${c.type}]  recall=${pct(c.recall)} bind-prec=${pct(
        c.binding_precision
      )} misbind=${pct(c.misbinding_rate)} value=${pct(c.value_accuracy)} evid=${pct(
        c.evidence_accuracy
      )}  G1=${c.g1_green ? "GROEN" : "rood"}`
    );
  }
  console.log(
    `\nOverall: bind-prec=${pct(m.overall.binding_precision)} value=${pct(
      m.overall.value_accuracy
    )} evid=${pct(m.overall.evidence_accuracy)}`
  );
}

// Alleen draaien als dit bestand direct wordt uitgevoerd (niet bij import).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
