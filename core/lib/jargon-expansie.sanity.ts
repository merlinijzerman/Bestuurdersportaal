// ============================================================
//  Sanity-tests voor lib/jargon-expansie.ts (R1.4 — FTS-jargonexpansie).
//
//  Geen testframework in de repo; dit script draait standalone met assert.
//  Uitvoeren: npx tsx lib/jargon-expansie.sanity.ts
//  Verifieert de risicovolle logica: expansie in beide richtingen, geen expansie
//  op gewone woorden, idempotentie, append-only (originele query blijft intact),
//  en woordgrens-match (geen substring-false-positives).
// ============================================================

import assert from "node:assert/strict";
import { expandeerFtsQuery } from "./jargon-expansie";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("jargon-expansie sanity-tests:");

check("afkorting → voluit (wtp)", () => {
  const r = expandeerFtsQuery("wat betekent de wtp voor ons herstelplan");
  assert.ok(r.query.includes('"wet toekomst pensioenen"'), "voluit als phrase toegevoegd");
  assert.ok(r.query.startsWith("wat betekent de wtp voor ons herstelplan"), "originele query intact vooraan");
  assert.ok(r.query.includes(" or "), "OR-append gebruikt");
  assert.equal(r.toegepast.length, 1);
  assert.deepEqual(r.toegepast[0], { van: "wtp", naar: "wet toekomst pensioenen" });
});

check("voluit → afkorting (pensioenwet)", () => {
  const r = expandeerFtsQuery("wat zegt de pensioenwet over medezeggenschap");
  assert.ok(/\bor pw\b/.test(r.query), "afkorting toegevoegd");
  assert.deepEqual(r.toegepast[0], { van: "pensioenwet", naar: "pw" });
});

check("geen expansie op gewone woorden", () => {
  const r = expandeerFtsQuery("wat is het beleid rondom communicatie met deelnemers");
  assert.equal(r.query, "wat is het beleid rondom communicatie met deelnemers");
  assert.equal(r.toegepast.length, 0);
});

check("woordgrens: 'vo' matcht niet binnen 'volgens'", () => {
  const r = expandeerFtsQuery("wat staat er volgens het reglement");
  assert.equal(r.toegepast.length, 0, "'volgens' triggert geen VO-expansie");
  assert.equal(r.query, "wat staat er volgens het reglement");
});

check("woordgrens: losstaand 'vo' expandeert wél", () => {
  const r = expandeerFtsQuery("welke rol heeft het vo");
  assert.ok(r.query.includes("verantwoordingsorgaan"));
  assert.deepEqual(r.toegepast[0], { van: "vo", naar: "verantwoordingsorgaan" });
});

check("idempotent: tweede expansie wijzigt de query niet", () => {
  const eerste = expandeerFtsQuery("uitleg over de abtn").query;
  const tweede = expandeerFtsQuery(eerste).query;
  assert.equal(tweede, eerste, "expandeer(expandeer(q)) === expandeer(q)");
});

check("idempotent: al aanwezig voluit → geen dubbele append", () => {
  const r = expandeerFtsQuery('wtp of "wet toekomst pensioenen"');
  assert.equal(r.toegepast.length, 0, "beide termen al aanwezig");
});

check("diakriet-ongevoelige match (financiele markten → afm)", () => {
  const r = expandeerFtsQuery("toezicht door de autoriteit financiele markten");
  assert.ok(/\bor afm\b/.test(r.query));
});

check("meerdere jargontermen in één vraag", () => {
  const r = expandeerFtsQuery("verhouding tussen dnb en afm bij de wtp");
  const naar = r.toegepast.map((e) => e.naar);
  assert.ok(naar.includes("de nederlandsche bank"));
  assert.ok(naar.includes("autoriteit financiële markten"));
  assert.ok(naar.includes("wet toekomst pensioenen"));
});

check("expansie-cap begrenst het aantal OR-termen", () => {
  const r = expandeerFtsQuery("wtp pw abtn ufr ftk dnb afm szw ecb bpf");
  assert.ok(r.toegepast.length <= 6, "MAX_EXPANSIES gerespecteerd");
});

console.log(`\n${n} sanity-tests geslaagd.`);
