// ============================================================================
//  core/lib/bronset.sanity.ts — plateau B / B-4, acceptatiecriterium AC-21.
// ----------------------------------------------------------------------------
//  Bevriest de bevroren reflectiebronset:
//
//   1. DETERMINISME BIJ HERORDENING — dezelfde bronnen in een andere volgorde
//      leveren dezelfde versiehash. Dit is de kern: de retrieval geeft chunks
//      terug in rangorde, en die rangorde is niet stabiel tussen twee runs. Zou
//      de hash eraan hangen, dan zou een reflectie op hetzelfde antwoord een
//      andere "bevroren" set lijken te hebben.
//   2. GEVOELIGHEID — een andere bron, een extra bron of een andere scope moet
//      de hash wél laten kantelen. Een hash die nooit verandert bevriest niets.
//   3. GEEN BRONSET ⇒ null (FR-55/AC-21), niet een hash over de lege string.
//   4. EEN VASTE PIN op de canonieke vorm, zodat een wijziging aan de
//      string-opbouw zichtbaar faalt in plaats van stil door te werken. De
//      SQL-kant in reflectie_transitie() moet dezelfde waarde produceren.
//
//  Uitvoeren: npx tsx core/lib/bronset.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  bepaalBronset,
  canoniekeBronset,
  leesBronsetChunks,
  leesScopeDocumentIds,
} from "./bronset";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// Een realistische retrieval_meta-vorm: precies de sleutels die ná plateau A in
// het append-only spoor blijven staan (`chunks` en `scope.document_ids` zijn
// META_BRON). `sources` staat er bewust NIET in — dat is META_INHOUD en leeft in
// governance_log_inhoud.
const META = {
  methode: "hybride_rrf",
  opgehaald: 12,
  geselecteerd: 3,
  chunks: [
    { id: "c-aaa", document_id: "doc-1", rang: 1 },
    { id: "c-bbb", document_id: "doc-2", rang: 2 },
    { id: "c-ccc", document_id: "doc-1", rang: 3 },
  ],
  scope: { document_ids: ["doc-2", "doc-1"], strategie: "targeted" },
};

test("herordening van de chunklijst verandert de versiehash niet", () => {
  const basis = bepaalBronset(META);
  const omgekeerd = bepaalBronset({ ...META, chunks: [...META.chunks].reverse() });
  const geschud = bepaalBronset({
    ...META,
    chunks: [META.chunks[1], META.chunks[2], META.chunks[0]],
  });
  assert.ok(basis.versie, "er moet een versie zijn");
  assert.equal(omgekeerd.versie, basis.versie);
  assert.equal(geschud.versie, basis.versie);
  // Ook de afgeleide lijsten zijn stabiel gesorteerd.
  assert.deepEqual(omgekeerd.chunkIds, basis.chunkIds);
  assert.deepEqual(basis.chunkIds, ["c-aaa", "c-bbb", "c-ccc"]);
});

test("herordening van de documentscope verandert de versiehash niet", () => {
  const basis = bepaalBronset(META);
  const anders = bepaalBronset({
    ...META,
    scope: { ...META.scope, document_ids: ["doc-1", "doc-2"] },
  });
  assert.equal(anders.versie, basis.versie);
  assert.deepEqual(basis.scopeDocumentIds, ["doc-1", "doc-2"]);
});

test("de rangorde uit retrieval_meta telt niet mee in de hash", () => {
  const basis = bepaalBronset(META);
  const andereRang = bepaalBronset({
    ...META,
    chunks: META.chunks.map((c, i) => ({ ...c, rang: 99 - i })),
  });
  assert.equal(andereRang.versie, basis.versie);
});

test("dubbele chunks tellen één keer", () => {
  const basis = bepaalBronset(META);
  const metDubbel = bepaalBronset({
    ...META,
    chunks: [...META.chunks, META.chunks[0], META.chunks[2]],
  });
  assert.equal(metDubbel.versie, basis.versie);
  assert.deepEqual(metDubbel.chunkIds, basis.chunkIds);
});

test("een andere, extra of ontbrekende bron kantelt de hash wél", () => {
  const basis = bepaalBronset(META);

  const extra = bepaalBronset({
    ...META,
    chunks: [...META.chunks, { id: "c-ddd", document_id: "doc-3", rang: 4 }],
  });
  assert.notEqual(extra.versie, basis.versie);

  const minder = bepaalBronset({ ...META, chunks: META.chunks.slice(0, 2) });
  assert.notEqual(minder.versie, basis.versie);

  // Zelfde chunk-id, ander document: de hash bindt id én document, zodat een
  // verwisseling niet wegvalt.
  const verwisseld = bepaalBronset({
    ...META,
    chunks: [{ ...META.chunks[0], document_id: "doc-9" }, ...META.chunks.slice(1)],
  });
  assert.notEqual(verwisseld.versie, basis.versie);

  const andereScope = bepaalBronset({
    ...META,
    scope: { ...META.scope, document_ids: ["doc-1"] },
  });
  assert.notEqual(andereScope.versie, basis.versie);

  // Scope weg is óók een andere bronset.
  const zonderScope = bepaalBronset({ ...META, scope: undefined });
  assert.notEqual(zonderScope.versie, basis.versie);
});

test("AC-21: geen chunks ⇒ versie null, niet een hash over de lege string", () => {
  for (const meta of [
    { ...META, chunks: [] },
    { methode: "geen", opgehaald: 0, geselecteerd: 0 },
    {},
    null,
    undefined,
    "geen object",
  ]) {
    const b = bepaalBronset(meta);
    assert.equal(b.versie, null, JSON.stringify(meta));
    assert.deepEqual(b.chunkIds, []);
  }
  // Een documentscope zónder chunks is geen bronset: er is niets opgehaald om
  // op te steunen.
  const alleenScope = bepaalBronset({ chunks: [], scope: { document_ids: ["doc-1"] } });
  assert.equal(alleenScope.versie, null);
  assert.deepEqual(alleenScope.scopeDocumentIds, ["doc-1"]);
});

test("half gevulde of onbruikbare chunkrijen worden genegeerd", () => {
  const rommelig = leesBronsetChunks({
    chunks: [
      { id: "c-aaa", document_id: "doc-1" },
      { id: "c-bbb" }, // geen document_id
      { document_id: "doc-2" }, // geen id
      { id: "", document_id: "doc-3" }, // lege id
      null,
      "tekst",
      42,
    ],
  });
  assert.deepEqual(rommelig, [{ id: "c-aaa", document_id: "doc-1" }]);

  assert.deepEqual(leesScopeDocumentIds({ scope: { document_ids: "geen array" } }), []);
  assert.deepEqual(leesScopeDocumentIds({ scope: null }), []);
  assert.deepEqual(leesScopeDocumentIds({}), []);
  assert.deepEqual(
    leesScopeDocumentIds({ scope: { document_ids: ["b", "a", "a", "", 7] } }),
    ["a", "b"]
  );
});

test("de canonieke vorm staat vast (spiegel van de SQL-kant)", () => {
  const canoniek = canoniekeBronset(
    [
      { id: "c-bbb", document_id: "doc-2" },
      { id: "c-aaa", document_id: "doc-1" },
      { id: "c-ccc", document_id: "doc-1" },
    ],
    ["doc-2", "doc-1"]
  );
  // Gesorteerd op de samengestelde tekst "<document_id>:<chunk_id>", gescheiden
  // door "|", dan "#", dan de gesorteerde scope-id's gescheiden door ",".
  assert.equal(canoniek, "doc-1:c-aaa|doc-1:c-ccc|doc-2:c-bbb#doc-1,doc-2");

  // En de hash daarover is de waarde die reflectie_transitie() moet produceren.
  // Reproduceerbaar in SQL met:
  //   select encode(digest('doc-1:c-aaa|doc-1:c-ccc|doc-2:c-bbb#doc-1,doc-2',
  //                        'sha256'), 'hex');
  const verwacht = createHash("sha256").update(canoniek, "utf8").digest("hex");
  assert.equal(
    verwacht,
    "fcd8476d5c09046ce515097823c58a0005a2cbfe7796617d4a883f3d8832140a"
  );
  assert.equal(bepaalBronset(META).versie, verwacht);
});

test("lege bronset zonder scope levert een canonieke vorm die niet leeg is", () => {
  // Puur ter afbakening: canoniekeBronset zelf hasht niet en geeft "#" terug.
  // bepaalBronset onderschept dit geval en levert null — dat is het contract.
  assert.equal(canoniekeBronset([], []), "#");
  assert.equal(bepaalBronset({ chunks: [] }).versie, null);
});

console.log(`\n${n} sanity-tests geslaagd (bronset).`);
