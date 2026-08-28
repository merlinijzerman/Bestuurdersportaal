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
  openVoorBesluitmomenten,
  openElders,
  tellPerZwaarte,
  besluitmomentSignaal,
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
  ev({ label: "B5", stap_volgorde: 5, besluitmoment_stap: 5, blokkerend: true }), // ZOWEL eigen stap 5 ALS besluitmoment 5
];

test("openVoorBesluitmoment(5) = stap-5 ∪ besluitmoment_stap=5, per zwaarte", () => {
  const open = openVoorBesluitmoment(EVIDENCE, 5);
  assert.deepEqual(open.kritiek.map((o) => o.label).sort(), ["B5", "K5"]);
  assert.deepEqual(open.vereist.map((o) => o.label).sort(), ["V2->5"]);
  assert.deepEqual(open.optioneel.map((o) => o.label), ["O5"]);
  // De vervulde en de stap-3-vereiste horen er niet bij.
  assert.ok(!JSON.stringify(open).includes("Vervuld"));
  assert.ok(!JSON.stringify(open).includes("V3"));
});

test("een vereiste die aan BEIDE armen voldoet (stap 5 én besluitmoment 5) telt precies één keer", () => {
  const open = openVoorBesluitmoment(EVIDENCE, 5);
  const b5 = open.kritiek.filter((o) => o.label === "B5");
  assert.equal(b5.length, 1, "B5 (stap_volgorde=5 én besluitmoment_stap=5) mag niet dubbelgeteld worden");
});

test("requirement_sleutel wordt correct gevormd", () => {
  const open = openVoorBesluitmoment(EVIDENCE, 5);
  assert.equal(open.kritiek[0].requirement_sleutel, "5|document|K5");
  assert.equal(open.vereist[0].requirement_sleutel, "2|document|V2->5");
});

test("openStaandeVereisten = alle open van het dossier, per zwaarte", () => {
  const open = openStaandeVereisten(EVIDENCE);
  assert.deepEqual(open.kritiek.map((o) => o.label).sort(), ["B5", "K5"]);
  assert.deepEqual(open.vereist.map((o) => o.label).sort(), ["V2->5", "V3"]);
  assert.equal(open.optioneel.length, 1);
});

test("heeftOpenBovenOptioneel: kritiek/vereist wel, alleen-optioneel niet", () => {
  assert.equal(heeftOpenBovenOptioneel(openStaandeVereisten(EVIDENCE)), true);
  const alleenOptioneel = openStaandeVereisten([ev({ label: "O", stap_volgorde: 1, verplicht: false })]);
  assert.equal(heeftOpenBovenOptioneel(alleenOptioneel), false);
});

test("openVoorBesluitmomenten(unie van meerdere besluitmomenten) = scope 3 ∪ 5", () => {
  // Nu tellen ook stap-3-vereisten mee (tweede besluitmoment). B5 blijft één keer.
  const open = openVoorBesluitmomenten(EVIDENCE, [3, 5]);
  assert.deepEqual(open.kritiek.map((o) => o.label).sort(), ["B5", "K5"]);
  assert.deepEqual(open.vereist.map((o) => o.label).sort(), ["V2->5", "V3"]);
  assert.equal(open.kritiek.filter((o) => o.label === "B5").length, 1, "geen dubbeltelling over meerdere N");
});

test("openElders = open BUITEN de besluitmoment-scope, per zwaarte", () => {
  // Besluitmoment alleen stap 5: V3 (stap 3, geen koppeling) valt buiten → elders.
  const elders = openElders(EVIDENCE, [5]);
  assert.deepEqual(elders.vereist.map((o) => o.label), ["V3"]);
  assert.equal(elders.kritiek.length, 0);
  // Wat in scope zit, telt NIET als elders (geen overlap met openVoorBesluitmomenten).
  assert.ok(!JSON.stringify(elders).includes("K5"));
  assert.ok(!JSON.stringify(elders).includes("V2->5"));
});

test("tellPerZwaarte geeft alleen aantallen (de vorm van open_elders)", () => {
  assert.deepEqual(tellPerZwaarte(openElders(EVIDENCE, [5])), {
    kritiek: 0,
    vereist: 1,
    optioneel: 0,
  });
});

test("besluitmomentSignaal: iets open → soort 'open' met de per-zwaarte-lijst", () => {
  const sig = besluitmomentSignaal(EVIDENCE, [5]);
  assert.equal(sig.soort, "open");
  if (sig.soort === "open") {
    assert.deepEqual(sig.open.kritiek.map((o) => o.label).sort(), ["B5", "K5"]);
  }
});

test("besluitmomentSignaal: vereisten aanwezig én alle vervuld → 'alle-vervuld'", () => {
  const alleVervuld: EvidenceItem[] = [
    ev({ label: "K5", stap_volgorde: 5, blokkerend: true, vervuld: true }),
    ev({ label: "O5", stap_volgorde: 5, verplicht: false, vervuld: true }),
  ];
  assert.equal(besluitmomentSignaal(alleVervuld, [5]).soort, "alle-vervuld");
});

test("besluitmomentSignaal: NIETS gekoppeld → 'geen-vereisten' (geen vals groen)", () => {
  // Alle evidence hoort bij ANDERE stappen; besluitmoment 5 heeft niets → mag niet
  // als "alles rond" gelezen worden (§7 r434, de vals-groen-val).
  const elders: EvidenceItem[] = [ev({ label: "V3", stap_volgorde: 3, vervuld: true })];
  assert.equal(besluitmomentSignaal(elders, [5]).soort, "geen-vereisten");
});

test("besluitmomentSignaal: ALLEEN een open optionele in scope → 'open' (niet vals-groen)", () => {
  // Load-bearing: een besluitmoment met uitsluitend een OPEN optionele vereiste is
  // niet "alle-vervuld". De strip toont "{n} optioneel"; dat mag niet als groen lezen.
  const alleenOptioneel: EvidenceItem[] = [
    ev({ label: "Overvuld", stap_volgorde: 5, verplicht: false, vervuld: true }),
    ev({ label: "Oopen", stap_volgorde: 5, verplicht: false }),
  ];
  const sig = besluitmomentSignaal(alleenOptioneel, [5]);
  assert.equal(sig.soort, "open", "alleen-optioneel-open mag niet als alle-vervuld lezen");
  if (sig.soort === "open") {
    assert.equal(sig.open.kritiek.length, 0);
    assert.equal(sig.open.vereist.length, 0);
    assert.deepEqual(sig.open.optioneel.map((o) => o.label), ["Oopen"]);
  }
});

test("besluitmomentSignaal: lege besluitmoment-set of onbekende N → 'geen-vereisten'", () => {
  // Geen vereist_besluit-stap (besluitmomentStappen=[]) en een N die nergens
  // voorkomt: beide leveren 'geen-vereisten', nooit een groene geruststelling.
  assert.equal(besluitmomentSignaal(EVIDENCE, []).soort, "geen-vereisten");
  assert.equal(besluitmomentSignaal(EVIDENCE, [99]).soort, "geen-vereisten");
});

console.log(`\nbesluitmoment-telling.sanity: ${n} checks groen.`);
