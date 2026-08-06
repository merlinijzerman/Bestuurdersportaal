// ============================================================
//  Sanity-tests voor de M-R3 hybride-pogingfusie (besluit 0139).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/rag-hybride-fusie.sanity.ts
//
//  Borgt criterium C van WERKOPDRACHT-RETRIEVAL-DETERMINISME:
//   - de kandidatensets van meerdere pogingen worden gefuseerd (union),
//   - een extra poging kan alleen recall TOEVOEGEN (non-destructief),
//   - de fusie is DETERMINISTISCH (tiebreaker op chunk-id),
//   - de auditherkomst per chunk klopt, en
//   - de fonds-/modus-/filterparameters zijn per CONSTRUCTIE identiek voor elke
//     poging (gedeeldeHybrideParams als enige bron).
// ============================================================

import assert from "node:assert/strict";
import {
  fuseerHybridePogingen,
  gedeeldeHybrideParams,
  type DocumentChunk,
  type HybridePogingResultaat,
} from "./rag";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

function chunk(id: string, rang: number): DocumentChunk {
  return {
    id,
    document_id: "doc-" + id,
    tekst: "",
    pagina: null,
    paragraaf: null,
    chunk_index: 0,
    rang,
    documenten: { titel: "", bron: "", bibliotheek: "generiek", opslag_pad: null },
  };
}

function poging(naam: string, chunks: DocumentChunk[]): HybridePogingResultaat {
  return { naam, chunks };
}

console.log("rag hybride-fusie sanity-tests (M-R3):");

check("fusie is een union over pogingen (disjuncte sets → beide behouden)", () => {
  const { chunks } = fuseerHybridePogingen([
    poging("primair", [chunk("a", 0.5), chunk("b", 0.3)]),
    poging("origineel", [chunk("c", 0.4)]),
  ]);
  assert.deepEqual(new Set(chunks.map((c) => c.id)), new Set(["a", "b", "c"]));
});

check("non-destructief: elke chunk uit de primaire poging overleeft de fusie", () => {
  const primair = [chunk("a", 0.5), chunk("b", 0.3), chunk("c", 0.1)];
  const { chunks } = fuseerHybridePogingen([
    poging("primair", primair),
    poging("origineel", [chunk("d", 0.9)]),
  ]);
  for (const p of primair) assert.ok(chunks.some((c) => c.id === p.id), `mist ${p.id}`);
});

check("beste (hoogste) RRF-rang wint bij overlap; herkomst = winnende poging", () => {
  const { chunks, herkomstPerId } = fuseerHybridePogingen([
    poging("primair", [chunk("x", 0.2)]),
    poging("origineel", [chunk("x", 0.8)]),
  ]);
  const x = chunks.find((c) => c.id === "x")!;
  assert.equal(x.rang, 0.8);
  assert.equal(herkomstPerId["x"], "origineel");
});

check("deterministisch: gelijke rang → tiebreaker op chunk-id, volgorde-onafhankelijk", () => {
  const a = fuseerHybridePogingen([
    poging("primair", [chunk("b", 0.5), chunk("a", 0.5), chunk("c", 0.5)]),
  ]).chunks.map((c) => c.id);
  const b = fuseerHybridePogingen([
    poging("primair", [chunk("c", 0.5), chunk("b", 0.5), chunk("a", 0.5)]),
  ]).chunks.map((c) => c.id);
  assert.deepEqual(a, ["a", "b", "c"]);
  assert.deepEqual(a, b);
});

check("hogere rang sorteert vóór lagere, ongeacht invoervolgorde", () => {
  const { chunks } = fuseerHybridePogingen([
    poging("primair", [chunk("laag", 0.1), chunk("hoog", 0.9), chunk("mid", 0.5)]),
  ]);
  assert.deepEqual(chunks.map((c) => c.id), ["hoog", "mid", "laag"]);
});

check("gedeeldeHybrideParams draagt fondsfilter + modus ALTIJD mee (identiek per poging)", () => {
  const p = gedeeldeHybrideParams(30, null, { modus: "actueel", peildatum: "2026-08-06" }, "fonds-123");
  assert.equal(p.p_fonds_id, "fonds-123");
  assert.equal(p.p_modus, "actueel");
  assert.equal(p.p_limit, 30);
  // Ook zonder expliciete fondsfilter blijft de sleutel aanwezig (null = RLS-only).
  const q = gedeeldeHybrideParams(20, null, undefined, null);
  assert.ok("p_fonds_id" in q);
  assert.equal(q.p_fonds_id, null);
});

console.log(`\nAlle ${n} hybride-fusie sanity-checks groen.`);
