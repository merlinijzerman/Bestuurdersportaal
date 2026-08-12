// ============================================================
//  Sanity-tests voor lib/rag-select.ts (RAG-selectie).
//
//  Geen testframework in de repo; dit script draait standalone met assert.
//  Uitvoeren: npx tsx lib/rag-select.sanity.ts   (of: node met TS-strip).
//  Verifieert de risicovolle, pure logica: dedup, max-per-document, limiet
//  en volgorde-behoud.
// ============================================================

import assert from "node:assert/strict";
import {
  selecteerChunks,
  selecteerMetConstraints,
  jaccard,
  woordSet,
  type SelecteerbareChunk,
  type RepresentatieConstraints,
} from "./rag-select";

function chunk(id: string, document_id: string, tekst: string, rang = 1): SelecteerbareChunk {
  return { id, document_id, tekst, rang };
}

// Chunk mét bibliotheek voor de constraint-tests (bibliotheek === "generiek" =
// generieke groep; al het andere = fonds — zelfde conventie als de productiecode).
interface LibChunk extends SelecteerbareChunk {
  bibliotheek: "fonds" | "generiek";
}
function lchunk(
  id: string,
  document_id: string,
  tekst: string,
  bibliotheek: "fonds" | "generiek"
): LibChunk {
  return { id, document_id, tekst, bibliotheek, rang: 1 };
}
const libVan = (c: LibChunk) => c.bibliotheek;
// Basis-constraints (alle minima 0) = gedragsequivalent aan selecteerChunks.
function constraints(over: Partial<RepresentatieConstraints> = {}): RepresentatieConstraints {
  return { fondsMin: 0, generiekMin: 0, perSourceMin: 0, maxPerSource: 3, maxTotal: 8, ...over };
}

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("rag-select sanity-tests:");

check("jaccard van identieke sets = 1", () => {
  assert.equal(jaccard(woordSet("alpha beta gamma"), woordSet("alpha beta gamma")), 1);
});

check("jaccard van disjuncte sets = 0", () => {
  assert.equal(jaccard(woordSet("alpha beta"), woordSet("delta epsilon")), 0);
});

check("behoudt volgorde en respecteert maxResults", () => {
  const input = [
    chunk("a", "d1", "financieringsgraad horizon stijgt fors dit jaar"),
    chunk("b", "d2", "solidariteitsreserve blijft binnen bandbreedte stabiel"),
    chunk("c", "d3", "rendement portefeuille overtreft de benchmark ruim"),
  ];
  const uit = selecteerChunks(input, 2);
  assert.equal(uit.length, 2);
  assert.deepEqual(uit.map((c) => c.id), ["a", "b"]);
});

check("dedup verwijdert bijna-identieke chunk", () => {
  const input = [
    chunk("a", "d1", "de financieringsgraad van het fonds bedraagt honderdvijf procent eind jaar"),
    chunk("b", "d2", "de financieringsgraad van het fonds bedraagt honderdvijf procent eind jaar extra"),
    chunk("c", "d3", "een geheel ander onderwerp over uitbesteding en dienstverlening risico"),
  ];
  const uit = selecteerChunks(input, 8);
  // b is bijna identiek aan a → weggefilterd; a en c blijven.
  assert.deepEqual(uit.map((c) => c.id), ["a", "c"]);
});

check("maxPerDocument beperkt chunks per document", () => {
  const input = [
    chunk("a", "d1", "eerste fragment over premie inning discipline werkgevers"),
    chunk("b", "d1", "tweede fragment over dekking beleggingen rendement obligaties"),
    chunk("c", "d1", "derde fragment over governance toezicht naleving compliance"),
    chunk("d", "d1", "vierde fragment over deelnemers communicatie pensioenoverzicht"),
    chunk("e", "d2", "fragment uit een tweede document over actuariele aannames"),
  ];
  const uit = selecteerChunks(input, 8, 2);
  // Max 2 uit d1, plus 1 uit d2.
  assert.equal(uit.filter((c) => c.document_id === "d1").length, 2);
  assert.equal(uit.filter((c) => c.document_id === "d2").length, 1);
  assert.deepEqual(uit.map((c) => c.id), ["a", "b", "e"]);
});

check("lege invoer geeft lege uitvoer", () => {
  assert.deepEqual(selecteerChunks([], 8), []);
});

// ── T1 — representatie-constraintlaag (selecteerMetConstraints) ──────────────

check("nulminima ≡ selecteerChunks (non-regressie, flag-uit-equivalent)", () => {
  // Input met dedup- én maxPerDoc-druk, zodat de equivalentie betekenis heeft.
  const input = [
    lchunk("a", "d1", "eerste fragment over premie inning discipline werkgevers", "fonds"),
    lchunk("b", "d1", "eerste fragment over premie inning discipline werkgevers extra", "fonds"),
    lchunk("c", "d1", "tweede fragment over governance toezicht naleving compliance", "fonds"),
    lchunk("d", "d1", "derde fragment over deelnemers communicatie pensioenoverzicht", "fonds"),
    lchunk("e", "d2", "geheel ander onderwerp over uitbesteding en dienstverlening risico", "generiek"),
  ];
  const viaConstraints = selecteerMetConstraints(input, constraints({ maxPerSource: 2, maxTotal: 8 }), libVan);
  const viaChunks = selecteerChunks(input, 8, 2);
  assert.deepEqual(viaConstraints.map((c) => c.id), viaChunks.map((c) => c.id));
});

check("gecombineerd forceert ≥1 fonds én ≥1 generiek onder krap budget", () => {
  // Ranking zet generiek bovenaan; zonder quotum zou de fonds-bron wegvallen.
  const input = [
    lchunk("g1", "d1", "toezichtkader en sectorpraktijk over partnerbegrip generiek", "generiek"),
    lchunk("g2", "d2", "externe definitie van nabestaandenbegrippen in het normenkader", "generiek"),
    lchunk("f1", "d3", "ons fondsbeleid rond partnerbegrip en nabestaandenpensioen intern", "fonds"),
  ];
  const uit = selecteerMetConstraints(input, constraints({ fondsMin: 1, generiekMin: 1, maxTotal: 2 }), libVan);
  assert.equal(uit.length, 2);
  assert.equal(uit.filter((c) => c.bibliotheek === "fonds").length, 1);
  assert.equal(uit.filter((c) => c.bibliotheek === "generiek").length, 1);
});

check("fonds forceert ≥1 fondsbron ook al staat generiek bovenaan", () => {
  const input = [
    lchunk("g1", "d1", "algemeen kader over dekkingsgraad en toezicht sectorbreed", "generiek"),
    lchunk("g2", "d2", "wettelijke definitie van de solidariteitsreserve toelichting", "generiek"),
    lchunk("g3", "d4", "richtlijn over prudent person beleggingsbeginsel generiek", "generiek"),
    lchunk("f1", "d3", "ons interne beleggingsbeleid en risicobereidheid fondsbesluit", "fonds"),
  ];
  const uit = selecteerMetConstraints(input, constraints({ fondsMin: 1, maxTotal: 2 }), libVan);
  assert.ok(uit.some((c) => c.bibliotheek === "fonds"), "verwacht ≥1 fondsbron");
});

check("generiek-profiel forceert géén fondsbron (no-regressie zuiver generiek)", () => {
  const input = [
    lchunk("g1", "d1", "algemeen kader over dekkingsgraad en toezicht sectorbreed", "generiek"),
    lchunk("g2", "d2", "wettelijke definitie van de solidariteitsreserve toelichting", "generiek"),
    lchunk("f1", "d3", "ons interne beleggingsbeleid en risicobereidheid fondsbesluit", "fonds"),
  ];
  // fondsMin 0 (generiek/undefined-profiel): de selectie mag géén fonds forceren.
  const uit = selecteerMetConstraints(input, constraints({ maxTotal: 2 }), libVan);
  assert.deepEqual(uit.map((c) => c.id), ["g1", "g2"]);
});

check("onhaalbaar minimum faalt niet — door met wat er is", () => {
  const input = [
    lchunk("g1", "d1", "algemeen kader over dekkingsgraad en toezicht sectorbreed", "generiek"),
    lchunk("g2", "d2", "wettelijke definitie van de solidariteitsreserve toelichting", "generiek"),
  ];
  // fondsMin 2, maar 0 fondskandidaten → geen exception, generieke set blijft.
  const uit = selecteerMetConstraints(input, constraints({ fondsMin: 2, maxTotal: 8 }), libVan);
  assert.deepEqual(uit.map((c) => c.id), ["g1", "g2"]);
});

check("perSourceMin reserveert per bron (T5-voorbereiding)", () => {
  const input = [
    lchunk("a", "d1", "eerste fragment doc een over premie inning discipline", "fonds"),
    lchunk("b", "d1", "tweede fragment doc een over governance en naleving toezicht", "fonds"),
    lchunk("c", "d1", "derde fragment doc een over communicatie met deelnemers", "fonds"),
    lchunk("e", "d2", "fragment uit doc twee over actuariele aannames en rente", "fonds"),
  ];
  // Zonder perSourceMin zou top-2 tweemaal d1 zijn; met perSourceMin 1 komt d2 erin.
  const uit = selecteerMetConstraints(input, constraints({ perSourceMin: 1, maxTotal: 2 }), libVan);
  assert.equal(uit.length, 2);
  assert.deepEqual(new Set(uit.map((c) => c.document_id)), new Set(["d1", "d2"]));
});

check("maxPerSource wordt gerespecteerd binnen de constraint-selectie", () => {
  const input = [
    lchunk("a", "d1", "eerste fragment doc een over premie inning discipline", "fonds"),
    lchunk("b", "d1", "tweede fragment doc een over governance en naleving toezicht", "fonds"),
    lchunk("c", "d1", "derde fragment doc een over communicatie met deelnemers", "fonds"),
    lchunk("e", "d2", "fragment uit doc twee over actuariele aannames en rente", "fonds"),
  ];
  const uit = selecteerMetConstraints(input, constraints({ maxPerSource: 1, maxTotal: 8 }), libVan);
  assert.equal(uit.filter((c) => c.document_id === "d1").length, 1);
});

check("constraint-selectie behoudt inkomende (rang-)volgorde in de uitvoer", () => {
  const input = [
    lchunk("g1", "d1", "generiek kader een over toezicht en sectorpraktijk", "generiek"),
    lchunk("g2", "d2", "generiek kader twee over wettelijke definities begrippen", "generiek"),
    lchunk("f1", "d3", "ons interne fondsbesluit over het beleggingsbeleid", "fonds"),
  ];
  // fonds wordt gereserveerd (index 2) maar de uitvoer staat in inkomende volgorde.
  const uit = selecteerMetConstraints(input, constraints({ fondsMin: 1, maxTotal: 2 }), libVan);
  assert.deepEqual(uit.map((c) => c.id), ["g1", "f1"]);
});

console.log(`\n${n} sanity-tests geslaagd.`);
