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
  constraintsVoorProfiel,
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

// ── T1 — constraint-afleiding uit het profiel (constraintsVoorProfiel) ───────
const budget = { maxTotal: 8, maxPerSource: 3 };

test("generiek → geen quotum (fondsMin 0)", () => {
  assert.deepEqual(constraintsVoorProfiel("generiek", budget), {
    fondsMin: 0, generiekMin: 0, perSourceMin: 0, maxPerSource: 3, maxTotal: 8,
  });
});
test("undefined-profiel → basis (non-regressief, gelijk aan generiek)", () => {
  assert.deepEqual(constraintsVoorProfiel(undefined, budget), constraintsVoorProfiel("generiek", budget));
});
test("fonds → fondsMin 1", () => {
  const c = constraintsVoorProfiel("fonds", budget);
  assert.equal(c.fondsMin, 1);
  assert.equal(c.generiekMin, 0);
});
test("gecombineerd → fondsMin 1 + generiekMin 1", () => {
  const c = constraintsVoorProfiel("gecombineerd", budget);
  assert.equal(c.fondsMin, 1);
  assert.equal(c.generiekMin, 1);
});
test("vergelijking → perSourceMin q (T5-voorbereiding, default 1)", () => {
  assert.equal(constraintsVoorProfiel("vergelijking", budget).perSourceMin, 1);
  assert.equal(constraintsVoorProfiel("vergelijking", { ...budget, vergelijkMin: 3 }).perSourceMin, 3);
});
test("budget (maxTotal/maxPerSource) wordt doorgegeven", () => {
  const c = constraintsVoorProfiel("fonds", { maxTotal: 5, maxPerSource: 2 });
  assert.equal(c.maxTotal, 5);
  assert.equal(c.maxPerSource, 2);
});

console.log(`\n${n} sanity-tests geslaagd.`);
