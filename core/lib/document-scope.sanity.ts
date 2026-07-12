// ============================================================
//  Sanity-tests voor lib/document-scope.ts (scope-validatie, increment 1).
//
//  Verifieert de risicovolle beslislogica los van de DB: cross-fonds-afwijzing,
//  gedeactiveerd, niet-geïndexeerd, en het happy path met volgorde-behoud.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx lib/document-scope.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import { valideerScope, type ScopeDocumentRij } from "./document-scope";

function doc(over: Partial<ScopeDocumentRij> & { id: string }): ScopeDocumentRij {
  return {
    titel: "Document",
    bron: "Intern",
    actief: true,
    geindexeerd: true,
    gepubliceerd: null,
    aangemaakt: null,
    heeft_chunks: true,
    ...over,
  };
}

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("document-scope sanity-tests:");

test("happy path: geldig document → ok", () => {
  const r = valideerScope(["a"], [doc({ id: "a", titel: "Beleidsnota" })]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.documenten.length, 1);
    assert.equal(r.documenten[0].titel, "Beleidsnota");
  }
});

test("lege id-lijst → geen_ids", () => {
  const r = valideerScope([], []);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.foutcode, "geen_ids");
});

test("vreemd-fonds / onbekende id (niet in gevonden) → niet_gevonden", () => {
  // RLS gaf de rij niet terug → document ontbreekt in de set.
  const r = valideerScope(["vreemd"], [doc({ id: "eigen" })]);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.foutcode, "niet_gevonden");
    assert.equal(r.document_id, "vreemd");
    // Melding mag geen technische details lekken.
    assert.ok(!/fonds_id|sql|rls/i.test(r.melding));
  }
});

test("gedeactiveerd document → gedeactiveerd", () => {
  const r = valideerScope(["a"], [doc({ id: "a", actief: false, titel: "Oud reglement" })]);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.foutcode, "gedeactiveerd");
    assert.ok(r.melding.includes("Oud reglement"));
  }
});

test("niet-geïndexeerd (geindexeerd=false) → niet_geindexeerd", () => {
  const r = valideerScope(["a"], [doc({ id: "a", geindexeerd: false })]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.foutcode, "niet_geindexeerd");
});

test("geïndexeerd maar zonder chunks → niet_geindexeerd", () => {
  const r = valideerScope(["a"], [doc({ id: "a", geindexeerd: true, heeft_chunks: false })]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.foutcode, "niet_geindexeerd");
});

test("set-scope behoudt de gevraagde volgorde", () => {
  const r = valideerScope(
    ["b", "a"],
    [doc({ id: "a", titel: "A" }), doc({ id: "b", titel: "B" })]
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.documenten.map((d) => d.titel), ["B", "A"]);
});

test("dubbele id's worden ontdubbeld", () => {
  const r = valideerScope(["a", "a"], [doc({ id: "a" })]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.documenten.length, 1);
});

test("eerste falende document bepaalt de melding (deny-fast)", () => {
  // a is ok, b is gedeactiveerd → faalt op b.
  const r = valideerScope(["a", "b"], [doc({ id: "a" }), doc({ id: "b", actief: false, titel: "B" })]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.foutcode, "gedeactiveerd");
});

console.log(`\n${n} sanity-tests geslaagd.`);
