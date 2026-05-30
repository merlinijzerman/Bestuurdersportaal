// ============================================================
//  Sanity-tests voor lib/chunking.ts (segment-chunking, Fase 1b).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx lib/chunking.sanity.ts (of node met TS-strip).
//  Verifieert de risicovolle logica: pagina/paragraaf-tagging per segment en
//  dat een chunk nooit over een segmentgrens heen loopt.
// ============================================================

import assert from "node:assert/strict";
import { maakChunks, maakChunksUitSegmenten } from "./chunking";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("chunking sanity-tests:");

// Eén ruime alinea per segment (> 50 tekens zodat hij niet wordt weggefilterd).
const alineaA = "Dit is de eerste pagina over de financieringsgraad van het pensioenfonds en de bijbehorende solidariteitsreserve.";
const alineaB = "Dit is de tweede pagina over het beleggingsbeleid, het rendement en de beheersing van de renterisico's.";

check("pagina wordt per segment getagd", () => {
  const chunks = maakChunksUitSegmenten([
    { pagina: 1, paragraaf: null, tekst: alineaA },
    { pagina: 2, paragraaf: null, tekst: alineaB },
  ]);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].pagina, 1);
  assert.equal(chunks[1].pagina, 2);
});

check("paragraaf-label (XLSX-tabblad) wordt overgenomen", () => {
  const chunks = maakChunksUitSegmenten([
    { pagina: null, paragraaf: "Tabblad: Premies", tekst: alineaA },
  ]);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].pagina, null);
  assert.equal(chunks[0].paragraaf, "Tabblad: Premies");
});

check("chunk loopt niet over een segmentgrens", () => {
  // Twee korte segmenten zouden zonder segment-grens samengevoegd kunnen worden;
  // per-segment chunking moet ze gescheiden houden (elk eigen pagina).
  const chunks = maakChunksUitSegmenten([
    { pagina: 5, paragraaf: null, tekst: alineaA },
    { pagina: 6, paragraaf: null, tekst: alineaB },
  ]);
  const paginas = new Set(chunks.map((c) => c.pagina));
  assert.deepEqual([...paginas].sort(), [5, 6]);
  // Geen enkele chunk-tekst mag inhoud van beide pagina's bevatten.
  for (const c of chunks) {
    const heeftA = c.tekst.includes("financieringsgraad");
    const heeftB = c.tekst.includes("beleggingsbeleid");
    assert.ok(!(heeftA && heeftB), "chunk mengt twee segmenten");
  }
});

check("groot segment wordt in meerdere chunks gesplitst, alle met dezelfde pagina", () => {
  const grootBlok = Array.from({ length: 40 }, (_, i) =>
    `Alinea ${i} met voldoende inhoud over governance, toezicht en naleving binnen het fonds.`
  ).join("\n\n");
  const chunks = maakChunksUitSegmenten([{ pagina: 3, paragraaf: null, tekst: grootBlok }]);
  assert.ok(chunks.length > 1, "verwacht meerdere chunks");
  assert.ok(chunks.every((c) => c.pagina === 3));
});

check("maakChunks blijft platte string-API bieden", () => {
  const stukken = maakChunks(alineaA + "\n\n" + alineaB);
  assert.ok(Array.isArray(stukken));
  assert.ok(stukken.every((s) => typeof s === "string"));
});

console.log(`\n${n} sanity-tests geslaagd.`);
