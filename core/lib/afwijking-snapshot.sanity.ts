// ============================================================
//  Snapshot-pin — TS-helft (P3/PR-C, #168, besluit 0192).
//
//  De afwijking-snapshot ("wat ontbreekt per zwaarte") wordt in SQL berekend
//  (fn_stap_open_per_zwaarte) omdat de afrondfunctie zelfstandig fail-closed moet
//  zijn en de poort niet op een meegegeven waarde mag baseren. Twee implementaties
//  van dezelfde regel is precies de divergentie die readiness fataal werd (0187).
//  Deze pin bindt de twee: SQL en TS asserten DEZELFDE open-per-zwaarte op DEZELFDE
//  regels.
//
//  - SQL-helft: supabase/checks/2026_08_27_p3c_afwijking.sql — #1 (basis-vectoren),
//    #9 (alle 8 gebonden-feit-bronnen), #10 (v_dubbel-uitsluiting/ambiguïteit),
//    #11 (besluitvraag=''), tegen de DB.
//  - TS-helft (dit bestand): dezelfde REGELS door de ECHTE `vervuldViaBinding` van
//    core/lib/decision.ts + de uitsluiting/activatie/ambiguïteit/field-uitzondering,
//    elk met verwijzing naar de regels in decision.ts die ze spiegelen.
//
//  Wat de TS-helft NIET kan: de bron-SET toetsen (welke van de 8 tabellen SQL telt)
//  — een gebonden feit is hier een `gebonden: number`. Dát dekt de SQL-helft (#9,
//  min_aantal=8 over alle 8 bronnen). De TS-helft dekt de reken- en filterregels.
//
//  Bewust GEEN live TS↔SQL-vergelijking: de testketen heeft geen rauwe-DB-node-
//  client. De binding loopt via de gedeelde verwachte uitkomst.
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
  gebonden: number; // aantal gebonden feiten op de sleutel (bron-agnostisch)
  arm: "template" | "instance";
  documenttype?: string | null;
  uitgesloten?: boolean; // template-uitsluiting (alleen template-arm)
  inactief?: boolean;    // conditional niet actief (alleen template-arm)
  veld_pad?: string;
};

const sleutel = (v: Vector) =>
  `1|${v.type}|${v.documenttype ?? v.label}`;

// decision.scope is leeg, decision.besluitvraag is '' → beide field-vereisten open.
const SCOPE_LEEG = true;
const BESLUITVRAAG_LEEG = true;

const VECTOREN: Vector[] = [
  { label: "K-doc", type: "document", zwaarte: "kritiek", min: 1, gebonden: 0, arm: "template" },
  { label: "V-doc", type: "document", zwaarte: "vereist", min: 1, gebonden: 0, arm: "template" },
  { label: "O-doc", type: "document", zwaarte: "optioneel", min: 1, gebonden: 0, arm: "template" },
  { label: "Vv-doc", type: "document", zwaarte: "vereist", min: 2, gebonden: 2, arm: "template" }, // vervuld (min>1)
  { label: "Vx-doc", type: "document", zwaarte: "vereist", min: 1, gebonden: 0, arm: "template", uitgesloten: true },
  { label: "Scope", type: "field", zwaarte: "vereist", min: 1, gebonden: 0, arm: "template", veld_pad: "decision.scope" },
  { label: "Vi-doc", type: "document", zwaarte: "vereist", min: 1, gebonden: 0, arm: "instance" },
  // Ambiguïteit/uitsluiting (spiegelt SQL #10): een UITGESLOTEN template + een
  // ACTIEVE instantie met dezelfde sleutel + één gebonden feit → NIET ambigu (de
  // uitgesloten tweeling telt niet mee), dus de instantie is vervuld, niet open.
  { label: "COLLIDE", type: "document", zwaarte: "vereist", min: 1, gebonden: 0, arm: "template", documenttype: null, uitgesloten: true },
  { label: "COLLIDE", type: "document", zwaarte: "vereist", min: 1, gebonden: 1, arm: "instance", documenttype: null },
  // Activatie (spiegelt de filter die readiness/decision.ts alleen op de template-arm
  // toepassen): een INACTIEVE conditional-vereiste valt uit de set → nooit open.
  { label: "Inactief-doc", type: "document", zwaarte: "kritiek", min: 1, gebonden: 0, arm: "template", inactief: true },
  // besluitvraag='' (spiegelt SQL #11): field open.
  { label: "Besluitvraag-veld", type: "field", zwaarte: "vereist", min: 1, gebonden: 0, arm: "template", veld_pad: "decision.besluitvraag" },
];

// De verwachte open-per-zwaarte — dezelfde uitkomst-regel die de SQL-helft assert.
const VERWACHT: Record<Zwaarte, string[]> = {
  kritiek: ["K-doc"], // Inactief-doc valt weg (activatie); COLLIDE vervuld
  vereist: ["V-doc", "Scope", "Vi-doc", "Besluitvraag-veld"], // Vv/Vx/COLLIDE weg
  optioneel: ["O-doc"],
};

// Spiegelt decision.ts: eerst de set filteren (uitsluiting r578-589 + activatie
// r642-650/773), dán de sleutel-ambiguïteit tellen over die gefilterde set
// (r756-766), dán per vereiste vervuld bepalen (field r780-807 / binding r822-827).
function berekenOpen(vectoren: Vector[]): Record<Zwaarte, string[]> {
  const actief = vectoren.filter((v) => !v.uitgesloten && !v.inactief);
  const sleutelAantal = new Map<string, number>();
  for (const v of actief) {
    if (v.type === "field") continue;
    sleutelAantal.set(sleutel(v), (sleutelAantal.get(sleutel(v)) ?? 0) + 1);
  }
  const open: Record<Zwaarte, string[]> = { kritiek: [], vereist: [], optioneel: [] };
  for (const v of actief) {
    let vervuld: boolean;
    if (v.type === "field") {
      if (v.veld_pad === "decision.scope") vervuld = !SCOPE_LEEG;
      else if (v.veld_pad === "decision.besluitvraag") vervuld = !BESLUITVRAAG_LEEG;
      else vervuld = false;
    } else if ((sleutelAantal.get(sleutel(v)) ?? 0) > 1) {
      vervuld = false; // ambigu → fail-closed (decision.ts r817)
    } else {
      vervuld = vervuldViaBinding(v.type, v.gebonden, v.min);
    }
    if (!vervuld && !open[v.zwaarte].includes(v.label)) open[v.zwaarte].push(v.label);
  }
  return open;
}

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

test("open-per-zwaarte matcht de gedeelde SQL-verwachting (snapshot-pin)", () => {
  const gevonden = berekenOpen(VECTOREN);
  for (const z of ["kritiek", "vereist", "optioneel"] as Zwaarte[]) {
    assert.deepEqual(
      [...gevonden[z]].sort(),
      [...VERWACHT[z]].sort(),
      `zwaarte ${z}: TS-helft wijkt af van de gedeelde verwachting — SQL en TS lopen uiteen`
    );
  }
});

test("min_aantal>1 vervult pas bij genoeg gebonden feiten (Vv-doc)", () => {
  assert.equal(vervuldViaBinding("document", 2, 2), true);
  assert.equal(vervuldViaBinding("document", 1, 2), false);
});

test("uitgesloten en inactieve vereisten vallen uit de set", () => {
  const open = berekenOpen(VECTOREN);
  const alle = [...open.kritiek, ...open.vereist, ...open.optioneel];
  assert.ok(!alle.includes("Vx-doc"), "uitgesloten Vx-doc mag niet open staan");
  assert.ok(!alle.includes("Inactief-doc"), "inactieve vereiste mag niet in de set zitten");
});

test("uitgesloten tweeling maakt een botsende actieve instantie NIET ambigu (COLLIDE)", () => {
  const open = berekenOpen(VECTOREN);
  const alle = [...open.kritiek, ...open.vereist, ...open.optioneel];
  assert.ok(!alle.includes("COLLIDE"), "COLLIDE is vervuld (1 feit, niet ambigu) → niet open");
});

test("besluitvraag='' telt als niet ingevuld (field open)", () => {
  assert.ok(berekenOpen(VECTOREN).vereist.includes("Besluitvraag-veld"));
});

console.log(`\nafwijking-snapshot.sanity: ${n} checks groen (pin gebonden aan de SQL-helft, incl. ambiguïteit/activatie/field).`);
