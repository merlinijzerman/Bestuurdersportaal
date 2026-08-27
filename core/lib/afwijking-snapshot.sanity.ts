// ============================================================
//  Snapshot-pin — TS-helft (P3/PR-C, #168, besluit 0192).
//
//  De afwijking-snapshot ("wat ontbreekt per zwaarte") wordt in SQL berekend
//  (fn_stap_open_per_zwaarte) omdat de afrondfunctie zelfstandig fail-closed moet
//  zijn en de poort niet op een meegegeven waarde mag baseren. Twee implementaties
//  van dezelfde telling is precies de divergentie die readiness fataal werd
//  (0187). Deze pin bindt de twee: SQL en TS asserten DEZELFDE open-per-zwaarte op
//  DEZELFDE vectoren.
//
//  - SQL-helft: supabase/checks/2026_08_27_p3c_afwijking.sql (#1), tegen de DB.
//  - TS-helft (dit bestand): dezelfde vectoren door de ECHTE regel die
//    core/lib/decision.ts gebruikt — `vervuldViaBinding` voor de gebonden-feit-
//    telling, plus de gemotiveerde field-uitzondering en de uitsluiting, elk met
//    een verwijzing naar de regels in decision.ts die ze spiegelen.
//
//  Bewust GEEN live TS↔SQL-vergelijking: de testketen heeft geen rauwe-DB-node-
//  client. De binding loopt via de gedeelde verwachte uitkomst (VERWACHT), niet via
//  een aanroep. Wijzigt de telregel in decision.ts, dan valt deze pin; wijkt de SQL
//  af, dan valt de SQL-helft — beide op dezelfde VERWACHT-waarde.
//
//  Geen testframework; standalone. Uitvoeren: npx tsx core/lib/afwijking-snapshot.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import type { RequirementType } from "./decision-view";
import { vervuldViaBinding } from "./vervulling";

type Zwaarte = "kritiek" | "vereist" | "optioneel";
type Vector = {
  label: string;
  type: RequirementType;
  zwaarte: Zwaarte;
  min: number;
  gebonden: number; // aantal gebonden feiten op de sleutel
  arm: "template" | "instance";
  uitgesloten?: boolean;
  veld_pad?: string;
};

// Gedeelde vectoren met de SQL-helft (2026_08_27_p3c_afwijking.sql, #1).
// decision.scope is leeg → de field-vereiste staat open (decision.ts r789-791).
const SCOPE_LEEG = true;
const VECTOREN: Vector[] = [
  { label: "K-doc", type: "document", zwaarte: "kritiek", min: 1, gebonden: 0, arm: "template" },
  { label: "V-doc", type: "document", zwaarte: "vereist", min: 1, gebonden: 0, arm: "template" },
  { label: "O-doc", type: "document", zwaarte: "optioneel", min: 1, gebonden: 0, arm: "template" },
  { label: "Vv-doc", type: "document", zwaarte: "vereist", min: 2, gebonden: 2, arm: "template" }, // vervuld (min_aantal>1)
  { label: "Vx-doc", type: "document", zwaarte: "vereist", min: 1, gebonden: 0, arm: "template", uitgesloten: true },
  { label: "Scope", type: "field", zwaarte: "vereist", min: 1, gebonden: 0, arm: "template", veld_pad: "decision.scope" },
  { label: "Vi-doc", type: "document", zwaarte: "vereist", min: 1, gebonden: 0, arm: "instance" },
];

// De verwachte open-per-zwaarte — dezelfde waarde die de SQL-helft assert.
const VERWACHT: Record<Zwaarte, string[]> = {
  kritiek: ["K-doc"],
  vereist: ["V-doc", "Scope", "Vi-doc"], // Vv-doc vervuld, Vx-doc uitgesloten
  optioneel: ["O-doc"],
};

/** Spiegelt decision.ts: uitsluiting (r578-589), field-uitzondering (r780-807),
 *  en de gebonden-feit-telling via de ECHTE `vervuldViaBinding` (r822-827). */
function staatOpen(v: Vector): boolean {
  if (v.uitgesloten) return false; // uitgesloten telt niet mee in de set
  let vervuld: boolean;
  if (v.type === "field") {
    // Gemotiveerde uitzondering: geen gebonden feit maar een veld/event.
    vervuld = v.veld_pad === "decision.scope" ? !SCOPE_LEEG : false;
  } else {
    vervuld = vervuldViaBinding(v.type, v.gebonden, v.min);
  }
  return !vervuld;
}

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

test("open-per-zwaarte matcht de gedeelde SQL-verwachting (snapshot-pin)", () => {
  const gevonden: Record<Zwaarte, string[]> = { kritiek: [], vereist: [], optioneel: [] };
  for (const v of VECTOREN) {
    if (staatOpen(v)) gevonden[v.zwaarte].push(v.label);
  }
  for (const z of ["kritiek", "vereist", "optioneel"] as Zwaarte[]) {
    assert.deepEqual(
      [...gevonden[z]].sort(),
      [...VERWACHT[z]].sort(),
      `zwaarte ${z}: TS-helft wijkt af van de gedeelde verwachting — SQL en TS lopen uiteen`
    );
  }
});

test("min_aantal>1 vervult pas bij genoeg gebonden feiten (Vv-doc)", () => {
  assert.equal(staatOpen(VECTOREN.find((v) => v.label === "Vv-doc")!), false, "2 feiten ≥ min 2 → vervuld");
});

test("uitgesloten vereiste telt niet mee (Vx-doc)", () => {
  assert.equal(staatOpen(VECTOREN.find((v) => v.label === "Vx-doc")!), false);
});

test("instantie-arm vereiste telt wel mee (Vi-doc)", () => {
  assert.equal(staatOpen(VECTOREN.find((v) => v.label === "Vi-doc")!), true);
});

console.log(`\nafwijking-snapshot.sanity: ${n} checks groen (pin gebonden aan de SQL-helft).`);
