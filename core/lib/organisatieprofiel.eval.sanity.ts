// ============================================================
//  Sanity-tests voor de organisatieprofiel-evaluatieset (OP-6, FO §10).
//
//  Dekt de DETERMINISTISCHE randvoorwaarden van gedragscriteria 1/4/5:
//    • het promptblok bevat de marker-instructie [Organisatieprofiel] (crit. 1);
//    • het blok bevat de conflictregel + verificatievraag-instructie (crit. 4);
//    • bij alleen-missie-gevuld bevat het blok GEEN feitregel en markeren de
//      aspecten feiten=leeg, strategie=gevuld (crit. 5);
//    • een leeg profiel levert null → geen blok (crit. 3-regressie).
//  Het feitelijke LLM-gedrag wordt hier NIET getest — dat gebeurt via de
//  menselijke review in evals/organisatieprofiel-gedrag.md (E2).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx lib/organisatieprofiel.eval.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import { bouwOrganisatieprofielBlok } from "./organisatieprofiel";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("organisatieprofiel-eval sanity-tests:");

// ── Casus 1 — volledige feiten + peildatum (criterium 1) ─────────────────────
const casus1 = bouwOrganisatieprofielBlok({
  organisatietype: "bedrijfstakpensioenfonds",
  uitvoerendePartijen: "APG (administratie), diverse vermogensbeheerders",
  omvang: "±120.000 deelnemers",
  kernfeiten: "verplichtgesteld; sector metaal",
  missie: null,
  visie: null,
  strategischeSpeerpunten: null,
  risicohouding: null,
  peildatum: "2026-06-30",
});

test("crit.1 — blok bevat marker-instructie [Organisatieprofiel]", () => {
  assert.ok(casus1);
  assert.match(casus1!.tekst, /\[Organisatieprofiel\]/);
});

test("crit.1 — feit-aspecten gevuld, strategie-aspecten leeg, peildatum gezet", () => {
  const a = casus1!.aspecten;
  assert.equal(a.organisatietype, true);
  assert.equal(a.uitvoerende_partijen, true);
  assert.equal(a.omvang, true);
  assert.equal(a.kernfeiten, true);
  assert.equal(a.missie, false);
  assert.equal(a.visie, false);
  assert.equal(a.strategische_speerpunten, false);
  assert.equal(a.risicohouding, false);
  assert.equal(a.peildatum, "2026-06-30");
});

test("crit.1 — blok bevat een Feiten-regel en de peildatum in de kop", () => {
  assert.match(casus1!.tekst, /Feiten:/);
  assert.match(casus1!.tekst, /peildatum 2026-06-30/);
});

// ── Casus 2 — conflict profiel vs. formeel stuk (criterium 4) ────────────────
// De conflictregel + verificatievraag-instructie moeten ALTIJD in het blok
// staan zodra er inhoud is (het formele tegenstuk komt uit de retrieval, niet
// uit deze fixture — E2 levert dat stuk).
const casus2 = bouwOrganisatieprofielBlok({
  organisatietype: "ondernemingspensioenfonds",
  uitvoerendePartijen: null,
  omvang: null,
  kernfeiten: null,
  missie: "zeker en betaalbaar pensioen voor onze deelnemers",
  visie: null,
  strategischeSpeerpunten: null,
  risicohouding: null,
  peildatum: null,
});

test("crit.4 — blok bevat conflictregel + verificatievraag-instructie", () => {
  assert.ok(casus2);
  // Kernwoorden van de conflict-/verificatieregel (OP-2). Bewust op kernwoorden
  // getoetst i.p.v. een exacte zin: robuust tegen kleine redactie, maar breekt
  // als de conflictregel of verificatie-instructie wegvalt.
  assert.match(casus2!.tekst, /conflict|tegen|recenter/i);
  assert.match(casus2!.tekst, /verificat|controleer|nooit stilzwijgend/i);
});

// ── Casus 3 — alleen missie gevuld, feitvelden leeg (criterium 5) ────────────
const casus3 = bouwOrganisatieprofielBlok({
  organisatietype: null,
  uitvoerendePartijen: null,
  omvang: null,
  kernfeiten: null,
  missie: "een toekomstbestendig collectief pensioen",
  visie: null,
  strategischeSpeerpunten: null,
  risicohouding: null,
  peildatum: null,
});

test("crit.5 — geen Feiten-regel als de feitvelden leeg zijn", () => {
  assert.ok(casus3);
  const a = casus3!.aspecten;
  assert.equal(a.organisatietype, false);
  assert.equal(a.uitvoerende_partijen, false);
  assert.equal(a.omvang, false);
  assert.equal(a.kernfeiten, false);
  assert.equal(a.missie, true);
  // Het blok mag de lege feitvelden niet als feit presenteren.
  assert.doesNotMatch(casus3!.tekst, /Feiten:/);
  assert.match(casus3!.tekst, /Missie:/);
});

// ── Leeg profiel → null (criterium 3, regressie) ─────────────────────────────
test("leeg profiel → null (geen blok, gedrag als nu)", () => {
  const leeg = bouwOrganisatieprofielBlok({
    organisatietype: null,
    uitvoerendePartijen: null,
    omvang: null,
    kernfeiten: null,
    missie: null,
    visie: null,
    strategischeSpeerpunten: null,
    risicohouding: null,
    peildatum: null,
  });
  assert.equal(leeg, null);
});

console.log(`\n${n} sanity-tests geslaagd.`);
