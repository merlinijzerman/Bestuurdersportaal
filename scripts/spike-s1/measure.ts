// ============================================================================
//  measure.ts — match geëxtraheerde units tegen de golden set → metrieken.
// ----------------------------------------------------------------------------
//  Granulariteit = DOCUMENT × CONCEPT (de NovaWerk-oracle is document-niveau).
//  Per (document, concept) is er één canonieke waarde + een lijst distractors.
//  Elke geëxtraheerde unit voor dat (document, concept) is:
//    CORRECT   — waarde == canonical
//    MISBOUND  — waarde == een distractor  (de gevaarlijke fout)
//    SPURIOUS  — iets anders (norm-fout, afgeleide grootheid, hallucinatie)
//
//  Kernmetriek = BINDINGS-PRECISION (correct / geëxtraheerd). Op documentniveau
//  valt "waarde-accuraatheid" samen met binding-precision: er is één juiste
//  waarde per (document, concept), dus een correcte binding ís de juiste waarde.
//
//  Draaibaar als CLI (print samenvatting) én importeerbaar door report.ts.
// ============================================================================

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConceptType, Unit, GoldenUnit } from "./types";
import { CONCEPTEN } from "./concepts";

const HIER = dirname(fileURLToPath(import.meta.url));

export type Status = "CORRECT" | "MISBOUND" | "SPURIOUS";

// Geëxtraheerde unit verrijkt met matchresultaat.
export interface BeoordeeldeUnit extends Unit {
  status: Status;
  golden_canonical: number | string | null; // canonieke waarde van dit (doc, concept)
  matched_distractor: number | string | null; // welke distractor geraakt (bij MISBOUND)
}

// Eén (document, concept)-cel die geen enkele CORRECTe extractie kreeg.
export interface GemisteCel {
  document: string;
  concept: string;
  type: ConceptType;
  canonical: number | string;
  status?: string;
}

export interface CelMetriek {
  golden_cells: number; // aantal (document, concept)-cellen
  cells_recalled: number;
  extracted_total: number;
  correct: number;
  misbound: number;
  spurious: number;
  recall: number | null;
  binding_precision: number | null;
  misbinding_rate: number | null;
  evidence_accuracy: number | null;
  g1_green: boolean;
}

export interface Metrieken {
  perConcept: Record<string, CelMetriek & { type: ConceptType }>;
  perType: Record<string, CelMetriek>;
  overall: CelMetriek;
  beoordeeld: BeoordeeldeUnit[];
  gemisteCellen: GemisteCel[];
}

// G1-poort. Op documentniveau vallen binding-precision en waarde-accuraatheid
// samen; de gate gebruikt daarom binding-precision + bron-accuraatheid.
export const G1 = {
  binding_precision: 0.9,
  value_accuracy: 0.95, // informatief; == binding_precision op documentniveau
  evidence_accuracy: 0.9,
};

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
    // Currency: alleen een TEGENSPRAAK telt (bv. USD vs EUR). Een onbekende
    // (null) currency aan de extractiekant faalt een numeriek correct bedrag
    // niet — value_raw "17545" mist het €-teken maar is wel het juiste bedrag.
    if (type === "amount" && gCur != null && eCur != null) return gelijk && eCur === gCur;
    return gelijk;
  }
  // date (ISO) en policy_choice (enum): string-exact.
  return String(eVal) === String(gVal);
}

function leegCel(): CelMetriek {
  return {
    golden_cells: 0,
    cells_recalled: 0,
    extracted_total: 0,
    correct: 0,
    misbound: 0,
    spurious: 0,
    recall: null,
    binding_precision: null,
    misbinding_rate: null,
    evidence_accuracy: null,
    g1_green: false,
  };
}

function sleutel(doc: string, concept: string): string {
  return `${doc}∥${concept}`;
}

export function computeMetrieken(
  units: Unit[],
  golden: GoldenUnit[]
): Metrieken {
  const perConcept: Metrieken["perConcept"] = {};
  const perType: Record<string, CelMetriek> = {};
  const overall = leegCel();
  const beoordeeld: BeoordeeldeUnit[] = [];
  const gemisteCellen: GemisteCel[] = [];

  for (const def of CONCEPTEN)
    perConcept[def.concept] = { ...leegCel(), type: def.type };
  for (const t of ["percentage", "date", "amount", "policy_choice"])
    perType[t] = leegCel();

  // Golden per (document, concept) indexeren.
  const goldenIndex = new Map<string, GoldenUnit>();
  for (const g of golden) {
    goldenIndex.set(sleutel(g.document, g.concept), g);
    if (perConcept[g.concept]) perConcept[g.concept].golden_cells++;
    if (perType[g.type]) perType[g.type].golden_cells++;
    overall.golden_cells++;
  }

  // Evidence-teller apart (per concept / type / overall).
  const evOk: Record<string, number> = {};
  const bumpEv = (k: string) => (evOk[k] = (evOk[k] ?? 0) + 1);
  // Bijhouden welke (document, concept)-cellen ≥1 CORRECTe unit kregen.
  const cellRecalled = new Set<string>();

  for (const e of units) {
    const type = e.type;
    const cel = perConcept[e.concept];
    const tcel = perType[type];
    if (cel) cel.extracted_total++;
    if (tcel) tcel.extracted_total++;
    overall.extracted_total++;
    if (e.evidence_ok) {
      bumpEv(`c:${e.concept}`);
      bumpEv(`t:${type}`);
      bumpEv("overall");
    }

    const g = goldenIndex.get(sleutel(e.document, e.concept));
    let status: Status = "SPURIOUS";
    let canonical: number | string | null = null;
    let matchedDistractor: number | string | null = null;

    if (g) {
      canonical = g.canonical;
      if (waardenGelijk(type, e.value_normalized, e.currency, g.canonical, g.currency)) {
        status = "CORRECT";
        cellRecalled.add(sleutel(e.document, e.concept));
      } else {
        const d = g.distractors.find((dv) =>
          waardenGelijk(type, e.value_normalized, e.currency, dv, null)
        );
        if (d != null) {
          status = "MISBOUND";
          matchedDistractor = d;
        }
      }
    }

    if (status === "CORRECT") {
      if (cel) cel.correct++;
      if (tcel) tcel.correct++;
      overall.correct++;
    } else if (status === "MISBOUND") {
      if (cel) cel.misbound++;
      if (tcel) tcel.misbound++;
      overall.misbound++;
    } else {
      if (cel) cel.spurious++;
      if (tcel) tcel.spurious++;
      overall.spurious++;
    }

    beoordeeld.push({
      ...e,
      status,
      golden_canonical: canonical,
      matched_distractor: matchedDistractor,
    });
  }

  // Recall per cel + lijst gemiste cellen.
  for (const g of golden) {
    if (cellRecalled.has(sleutel(g.document, g.concept))) {
      if (perConcept[g.concept]) perConcept[g.concept].cells_recalled++;
      if (perType[g.type]) perType[g.type].cells_recalled++;
      overall.cells_recalled++;
    } else {
      gemisteCellen.push({
        document: g.document,
        concept: g.concept,
        type: g.type,
        canonical: g.canonical,
        status: g.status,
      });
    }
  }

  // Ratio's + G1 afsluiten.
  const sluit = (c: CelMetriek, evKey: string) => {
    c.recall = c.golden_cells > 0 ? c.cells_recalled / c.golden_cells : null;
    c.binding_precision =
      c.extracted_total > 0 ? c.correct / c.extracted_total : null;
    c.misbinding_rate =
      c.extracted_total > 0 ? c.misbound / c.extracted_total : null;
    c.evidence_accuracy =
      c.extracted_total > 0 ? (evOk[evKey] ?? 0) / c.extracted_total : null;
    c.g1_green =
      (c.binding_precision ?? 0) >= G1.binding_precision &&
      (c.evidence_accuracy ?? 0) >= G1.evidence_accuracy;
  };
  for (const def of CONCEPTEN) sluit(perConcept[def.concept], `c:${def.concept}`);
  for (const t of Object.keys(perType)) sluit(perType[t], `t:${t}`);
  sluit(overall, "overall");

  return { perConcept, perType, overall, beoordeeld, gemisteCellen };
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
    console.error("golden_set.json is leeg — zonder ground truth kan er niet gemeten worden.");
    process.exit(1);
  }

  const m = computeMetrieken(units, golden);
  console.log("\nPer concept:");
  for (const [naam, c] of Object.entries(m.perConcept)) {
    console.log(
      `  ${naam} [${c.type}]  recall=${pct(c.recall)} bind-prec=${pct(
        c.binding_precision
      )} misbind=${pct(c.misbinding_rate)} evid=${pct(c.evidence_accuracy)}  ` +
        `(C${c.correct}/M${c.misbound}/S${c.spurious})  G1=${c.g1_green ? "GROEN" : "rood"}`
    );
  }
  console.log(
    `\nOverall: bind-prec=${pct(m.overall.binding_precision)} misbind=${pct(
      m.overall.misbinding_rate
    )} evid=${pct(m.overall.evidence_accuracy)} recall=${pct(m.overall.recall)}`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
