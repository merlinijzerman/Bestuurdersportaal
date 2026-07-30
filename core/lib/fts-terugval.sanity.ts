// ============================================================
//  Sanity-tests voor core/lib/fts-terugval.ts (30-07-2026).
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/fts-terugval.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import { bouwTerugvalFtsQuery, TERUGVAL_LEXICON_VERSIE } from "./fts-terugval";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("fts-terugval sanity-tests:");

test("de aanleidende vraag levert de juiste OR-keten", () => {
  // Deze vraag liet in productie `methode: "ilike"` achter: de AND-keten
  // (documenten & beleggingsbeleid & ken) matchte niets.
  const r = bouwTerugvalFtsQuery("documenten met beleggingsbeleid ken je?");
  assert.ok(r, "verwacht een terugvalquery");
  assert.deepEqual(r!.termen, ["documenten", "beleggingsbeleid"]);
  assert.equal(r!.query, "documenten OR beleggingsbeleid");
  assert.equal(r!.versie, TERUGVAL_LEXICON_VERSIE);
});

test("vraagwoorden en functiewoorden vallen af", () => {
  const r = bouwTerugvalFtsQuery("Welke documenten met beleggingsbeleid ken je?");
  assert.deepEqual(r!.termen, ["documenten", "beleggingsbeleid"]);
});

test("domeinwoorden blijven staan (besluit/voorstel/beleid zijn onderscheidend)", () => {
  const r = bouwTerugvalFtsQuery("Welke besluiten staan er open over het beleggingsbeleid?");
  assert.ok(r!.termen.includes("besluiten"), r!.query);
  assert.ok(r!.termen.includes("beleggingsbeleid"), r!.query);
  assert.ok(!r!.termen.includes("welke"), r!.query);
  assert.ok(!r!.termen.includes("het"), r!.query);
});

test("korte domeintermen overleven de lengtegrens", () => {
  const r = bouwTerugvalFtsQuery("Wat zegt de Wtp over de ABTN?");
  assert.ok(r!.termen.includes("wtp"), r!.query);
  assert.ok(r!.termen.includes("abtn"), r!.query);
});

test("diacritics en leestekens worden genormaliseerd", () => {
  const r = bouwTerugvalFtsQuery("Welke stukken gaan over de één-en-ander-regeling?");
  assert.ok(r!.query.length > 0);
  assert.ok(!/[?é]/.test(r!.query), r!.query);
});

test("geen dubbele termen", () => {
  const r = bouwTerugvalFtsQuery("beleggingsbeleid en nog eens beleggingsbeleid documenten");
  assert.equal(r!.termen.filter((t) => t === "beleggingsbeleid").length, 1);
});

test("maximaal 8 termen (query-explosie begrensd)", () => {
  const lang =
    "beleggingsbeleid transitieplan solidariteitsreserve dekkingsgraad risicohouding " +
    "premiebeleid uitbesteding klachtenregeling gedragscode verantwoordingsorgaan";
  const r = bouwTerugvalFtsQuery(lang);
  assert.ok(r!.termen.length <= 8, `${r!.termen.length} termen`);
});

test("één inhoudswoord → GEEN terugval (identiek aan de strikte query)", () => {
  // Anders draaien we een tweede, identieke RPC voor niets.
  assert.equal(bouwTerugvalFtsQuery("beleggingsbeleid?"), null);
  assert.equal(bouwTerugvalFtsQuery("Wat is de dekkingsgraad?"), null);
});

test("alleen functiewoorden → null (aanroeper valt door naar de cascade)", () => {
  assert.equal(bouwTerugvalFtsQuery("en of maar dus?"), null);
  assert.equal(bouwTerugvalFtsQuery("   "), null);
});

console.log(`\n${n} sanity-tests geslaagd.`);
