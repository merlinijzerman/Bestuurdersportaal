// ============================================================
//  Sanity-tests voor lib/weeg-regime.ts (T4 Regime-borging, Deel B).
//
//  Dekt de T4-DoD: fonds met een specifiek regime demoveert het TEGENGESTELDE
//  regime (niet uitsluiten); beide/algemeen/NULL nooit gedemoveerd; fonds zonder
//  specifiek regime = no-op (non-regressief).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/weeg-regime.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import { weegRegime, isExternKaderVoorFonds } from "./weeg-regime";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("weeg-regime sanity-tests:");

// ── isExternKaderVoorFonds (definitie gedeeld met de weging + prompt-B6) ──────
test("wvb-fonds: pw is extern kader, wvb/beide/algemeen/NULL niet", () => {
  assert.equal(isExternKaderVoorFonds("pw", "wvb"), true);
  assert.equal(isExternKaderVoorFonds("wvb", "wvb"), false);
  assert.equal(isExternKaderVoorFonds("beide", "wvb"), false);
  assert.equal(isExternKaderVoorFonds("algemeen", "wvb"), false);
  assert.equal(isExternKaderVoorFonds(null, "wvb"), false); // NULL ≡ algemeen
  assert.equal(isExternKaderVoorFonds(undefined, "wvb"), false);
});
test("pw-fonds: wvb is extern kader, pw niet", () => {
  assert.equal(isExternKaderVoorFonds("wvb", "pw"), true);
  assert.equal(isExternKaderVoorFonds("pw", "pw"), false);
  assert.equal(isExternKaderVoorFonds("beide", "pw"), false);
});
test("fonds zonder specifiek regime → niets is extern kader", () => {
  for (const fr of ["beide", "algemeen", null, undefined] as const) {
    assert.equal(isExternKaderVoorFonds("pw", fr), false);
    assert.equal(isExternKaderVoorFonds("wvb", fr), false);
  }
});

// ── Weging ──
type C = { id: string; reg: string | null };
const regVan = (c: C) => c.reg;
// retrieval-/bronsoortvolgorde: pw, wvb, beide, algemeen, NULL.
const set: C[] = [
  { id: "pw1", reg: "pw" },
  { id: "wvb1", reg: "wvb" },
  { id: "beide1", reg: "beide" },
  { id: "alg1", reg: "algemeen" },
  { id: "null1", reg: null },
];

test("wvb-fonds → pw gedemoveerd naar onderaan, rest stabiel", () => {
  const r = weegRegime(set, regVan, "wvb").map((c) => c.id);
  // pw1 zakt achteraan; wvb1/beide1/alg1/null1 behouden hun onderlinge volgorde.
  assert.deepEqual(r, ["wvb1", "beide1", "alg1", "null1", "pw1"]);
});
test("pw-fonds → wvb gedemoveerd naar onderaan", () => {
  const r = weegRegime(set, regVan, "pw").map((c) => c.id);
  assert.deepEqual(r, ["pw1", "beide1", "alg1", "null1", "wvb1"]);
});
test("niets weggegooid — gedemoveerd regime blijft als aanvullend kader", () => {
  const r = weegRegime(set, regVan, "wvb");
  assert.equal(r.length, set.length);
  assert.ok(r.some((c) => c.reg === "pw")); // pw nog aanwezig, alleen lager
});
test("beide-fonds → geen demotie (cross-cutting), ingangsvolgorde terug", () => {
  const r = weegRegime(set, regVan, "beide").map((c) => c.id);
  assert.deepEqual(r, set.map((c) => c.id));
});
test("fonds zonder regime (NULL/undefined) → no-op (non-regressief)", () => {
  assert.deepEqual(weegRegime(set, regVan, null).map((c) => c.id), set.map((c) => c.id));
  assert.deepEqual(weegRegime(set, regVan, undefined).map((c) => c.id), set.map((c) => c.id));
});
test("stabiliteit: meerdere pw-chunks behouden onderlinge (relevantie)volgorde", () => {
  const s: C[] = [
    { id: "pwA", reg: "pw" },
    { id: "wvbA", reg: "wvb" },
    { id: "pwB", reg: "pw" },
    { id: "wvbB", reg: "wvb" },
  ];
  const r = weegRegime(s, regVan, "wvb").map((c) => c.id);
  // wvb-chunks eerst (in originele volgorde), dán pw-chunks (in originele volgorde).
  assert.deepEqual(r, ["wvbA", "wvbB", "pwA", "pwB"]);
});
test("lege set → lege set", () => {
  assert.deepEqual(weegRegime([] as C[], regVan, "wvb"), []);
});

console.log(`\n${n} sanity-tests geslaagd.`);
