// Sanity-pin voor de besluitmoment-telling (P3/PR-D, #168, §7).
//
// De telling zelf voegt geen vervullingslogica toe — `vervuld` komt uit de ENE
// D10-implementatie (decision.ts, gepind tegen SQL via de afwijking-snapshot-pin).
// Deze pin bewaakt alléén de groepering/telling: de unie stap-N ∪ besluitmoment_stap-N,
// de indeling per zwaarte, en "iets open boven optioneel".
//
// Standalone; uitvoeren: npx tsx core/lib/besluitmoment-telling.sanity.ts

import assert from "node:assert/strict";
import type { EvidenceItem } from "./decision-view";
import {
  openVoorBesluitmoment,
  openStaandeVereisten,
  heeftOpenBovenOptioneel,
} from "./besluitmoment-telling";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

function ev(p: Partial<EvidenceItem> & { label: string; stap_volgorde: number }): EvidenceItem {
  return {
    requirement_type: "document",
    documenttype: null,
    toelichting: null,
    verplicht: true,
    blokkerend: false,
    vervuld: false,
    bron_type: null,
    bron_id: null,
    bron_titel: null,
    bron: "template",
    instance_id: null,
    besluitmoment_stap: null,
    ...p,
  };
}

// Vectoren: besluitmoment op stap 5; een kritieke op stap 5 zelf, een vereiste op
// stap 2 die via besluitmoment_stap=5 meetelt, een vervulde (telt niet), een
// optionele op stap 5, en een vereiste op stap 3 die NIET bij besluitmoment 5 hoort.
const EVIDENCE: EvidenceItem[] = [
  ev({ label: "K5", stap_volgorde: 5, blokkerend: true }),                       // kritiek, eigen stap
  ev({ label: "V2->5", stap_volgorde: 2, besluitmoment_stap: 5 }),              // vereist, via besluitmoment
  ev({ label: "Vervuld2->5", stap_volgorde: 2, besluitmoment_stap: 5, vervuld: true }), // telt niet
  ev({ label: "O5", stap_volgorde: 5, verplicht: false }),                      // optioneel, eigen stap
  ev({ label: "V3", stap_volgorde: 3 }),                                        // vereist, hoort NIET bij 5
];

test("openVoorBesluitmoment(5) = stap-5 ∪ besluitmoment_stap=5, per zwaarte", () => {
  const open = openVoorBesluitmoment(EVIDENCE, 5);
  assert.deepEqual(open.kritiek.map((o) => o.label), ["K5"]);
  assert.deepEqual(open.vereist.map((o) => o.label).sort(), ["V2->5"]);
  assert.deepEqual(open.optioneel.map((o) => o.label), ["O5"]);
  // De vervulde en de stap-3-vereiste horen er niet bij.
  assert.ok(!JSON.stringify(open).includes("Vervuld"));
  assert.ok(!JSON.stringify(open).includes("V3"));
});

test("requirement_sleutel wordt correct gevormd", () => {
  const open = openVoorBesluitmoment(EVIDENCE, 5);
  assert.equal(open.kritiek[0].requirement_sleutel, "5|document|K5");
  assert.equal(open.vereist[0].requirement_sleutel, "2|document|V2->5");
});

test("openStaandeVereisten = alle open van het dossier, per zwaarte", () => {
  const open = openStaandeVereisten(EVIDENCE);
  assert.equal(open.kritiek.length, 1);
  assert.deepEqual(open.vereist.map((o) => o.label).sort(), ["V2->5", "V3"]);
  assert.equal(open.optioneel.length, 1);
});

test("heeftOpenBovenOptioneel: kritiek/vereist wel, alleen-optioneel niet", () => {
  assert.equal(heeftOpenBovenOptioneel(openStaandeVereisten(EVIDENCE)), true);
  const alleenOptioneel = openStaandeVereisten([ev({ label: "O", stap_volgorde: 1, verplicht: false })]);
  assert.equal(heeftOpenBovenOptioneel(alleenOptioneel), false);
});

console.log(`\nbesluitmoment-telling.sanity: ${n} checks groen.`);
