// ============================================================
//  Sanity-tests voor lib/weeg-bronsoort.ts (Increment G).
//
//  Dekt regressietests TO §6.2 #17/#18/#24: fondsvraag → fonds primair,
//  sector-/toezichtvraag → generiek primair, en dat generiek als AANVULLEND
//  kader beschikbaar blijft (niet weggegooid) zolang er fondsdocs zijn.
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx lib/weeg-bronsoort.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  bepaalBronsoortprofiel,
  weegBronsoort,
} from "./weeg-bronsoort";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("weeg-bronsoort sanity-tests:");

// ── Profieldetectie ──
test("fondsvraag (default) → fonds", () => {
  assert.equal(bepaalBronsoortprofiel("Wat is onze dekkingsgraad?"), "fonds");
  assert.equal(bepaalBronsoortprofiel("Wat zegt ons beleid over indexatie?"), "fonds");
  assert.equal(bepaalBronsoortprofiel("Wanneer is dit besluit genomen?"), "fonds"); // geen extern signaal
});
test("sector-/toezichtvraag → generiek", () => {
  assert.equal(bepaalBronsoortprofiel("Wat verwacht DNB op dit punt?"), "generiek");
  assert.equal(bepaalBronsoortprofiel("Wat schrijft de Pensioenwet voor?"), "generiek");
  assert.equal(bepaalBronsoortprofiel("Welke toezichtverwachting geldt er?"), "generiek");
  assert.equal(bepaalBronsoortprofiel("Wat is de sectorbrede richtlijn?"), "generiek");
});
test("dubbel signaal → gecombineerd", () => {
  assert.equal(
    bepaalBronsoortprofiel("Hoe verhoudt ons beleid zich tot de DNB-toezichtverwachting?"),
    "gecombineerd"
  );
});

// ── Weging ──
type C = { id: string; bib: string | null };
const bibVan = (c: C) => c.bib;
// retrieval-volgorde (op relevantie): generiek, fonds, fonds, generiek.
const set: C[] = [
  { id: "g1", bib: "generiek" },
  { id: "f1", bib: "fonds" },
  { id: "f2", bib: "fonds" },
  { id: "g2", bib: "generiek" },
];

test("#17 fondsprofiel → fondsdocs primair, generiek aanvullend (stabiel)", () => {
  const r = weegBronsoort(set, bibVan, "fonds").map((c) => c.id);
  assert.deepEqual(r, ["f1", "f2", "g1", "g2"]);
});
test("#18 generiekprofiel → generiek primair", () => {
  const r = weegBronsoort(set, bibVan, "generiek").map((c) => c.id);
  assert.deepEqual(r, ["g1", "g2", "f1", "f2"]);
});
test("gecombineerd → originele relevantievolgorde behouden", () => {
  const r = weegBronsoort(set, bibVan, "gecombineerd").map((c) => c.id);
  assert.deepEqual(r, ["g1", "f1", "f2", "g2"]);
});
test("#24 generiek wordt nooit weggegooid (blijft als aanvullend kader)", () => {
  const r = weegBronsoort(set, bibVan, "fonds");
  assert.equal(r.length, set.length); // niets verdwijnt
  assert.ok(r.some((c) => c.bib === "generiek")); // generiek nog aanwezig
  // maar pas ná alle fondsdocs:
  const ids = r.map((c) => c.id);
  assert.ok(ids.indexOf("f1") < ids.indexOf("g1"));
  assert.ok(ids.indexOf("f2") < ids.indexOf("g1"));
});
test("NULL/onbekende bibliotheek telt als niet-generiek (fondszijde)", () => {
  const met: C[] = [{ id: "x", bib: null }, { id: "g", bib: "generiek" }];
  const r = weegBronsoort(met, bibVan, "fonds").map((c) => c.id);
  assert.deepEqual(r, ["x", "g"]);
});

console.log(`\n${n} sanity-tests geslaagd.`);
