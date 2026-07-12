// ============================================================
//  Sanity-tests voor lib/rag-select.ts (RAG-selectie).
//
//  Geen testframework in de repo; dit script draait standalone met assert.
//  Uitvoeren: npx tsx lib/rag-select.sanity.ts   (of: node met TS-strip).
//  Verifieert de risicovolle, pure logica: dedup, max-per-document, limiet
//  en volgorde-behoud.
// ============================================================

import assert from "node:assert/strict";
import { selecteerChunks, jaccard, woordSet, type SelecteerbareChunk } from "./rag-select";

function chunk(id: string, document_id: string, tekst: string, rang = 1): SelecteerbareChunk {
  return { id, document_id, tekst, rang };
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

console.log(`\n${n} sanity-tests geslaagd.`);
