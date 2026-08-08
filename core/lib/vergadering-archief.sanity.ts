// ============================================================
//  Sanity-tests voor het archiveren van vergaderingen (besluit 0141).
//
//  Wat hier bevroren wordt:
//   • Archiveren mag pas ná de vergaderdatum — de grens is strikt.
//   • De STATUS speelt geen rol: ook een nooit-afgeronde vergadering uit
//     het verleden mag naar het archief. Dat was de hele aanleiding.
//   • Archiveren is omkeerbaar (geen verkapte verwijdering).
//   • Een gearchiveerde vergadering verschijnt NOOIT óók in komend of
//     afgelopen — precies de dubbeling die er stil in kan sluipen.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx core/lib/vergadering-archief.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  isGearchiveerd,
  magArchiveren,
  magDearchiveren,
  splitsVergaderingen,
} from "./vergadering-archief";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("vergadering-archief sanity-tests:");

const NU = new Date("2026-08-07T12:00:00.000Z");
const GISTEREN = "2026-08-06T10:00:00.000Z";
const VOLGENDE_WEEK = "2026-08-14T10:00:00.000Z";

// ── Archiveren ──────────────────────────────────────────────────────────────

test("een verstreken vergadering mag naar het archief", () => {
  const r = magArchiveren({ datum: GISTEREN, gearchiveerd_op: null }, NU);
  assert.equal(r.mag, true);
});

test("een komende vergadering mag NIET worden gearchiveerd", () => {
  const r = magArchiveren({ datum: VOLGENDE_WEEK, gearchiveerd_op: null }, NU);
  assert.equal(r.mag, false);
  if (!r.mag) assert.equal(r.foutcode, "datum_niet_verstreken");
});

test("de grens is strikt: een vergadering die NU begint is nog niet verstreken", () => {
  const r = magArchiveren({ datum: NU.toISOString(), gearchiveerd_op: null }, NU);
  assert.equal(r.mag, true, "gelijk aan nu telt als verstreken (niet groter dan)");
  const r2 = magArchiveren(
    { datum: new Date(NU.getTime() + 1).toISOString(), gearchiveerd_op: null },
    NU
  );
  assert.equal(r2.mag, false);
});

test("dubbel archiveren wordt geweigerd", () => {
  const r = magArchiveren({ datum: GISTEREN, gearchiveerd_op: GISTEREN }, NU);
  assert.equal(r.mag, false);
  if (!r.mag) assert.equal(r.foutcode, "reeds_gearchiveerd");
});

test("de STATUS speelt geen rol — dat is de aanleiding van dit besluit", () => {
  // De toestand draagt bewust geen `status`. Zou archiveren `afgerond` eisen,
  // dan bleef een nooit-afgeronde vergadering eeuwig in de lijst staan.
  const r = magArchiveren({ datum: GISTEREN, gearchiveerd_op: null }, NU);
  assert.equal(r.mag, true);
});

// ── Terughalen ──────────────────────────────────────────────────────────────

test("archiveren is omkeerbaar", () => {
  const r = magDearchiveren({ datum: GISTEREN, gearchiveerd_op: GISTEREN });
  assert.equal(r.mag, true);
});

test("terughalen van iets dat niet gearchiveerd is wordt geweigerd", () => {
  const r = magDearchiveren({ datum: GISTEREN, gearchiveerd_op: null });
  assert.equal(r.mag, false);
});

test("isGearchiveerd leest alleen gearchiveerd_op", () => {
  assert.equal(isGearchiveerd({ datum: GISTEREN, gearchiveerd_op: null }), false);
  assert.equal(isGearchiveerd({ datum: VOLGENDE_WEEK, gearchiveerd_op: GISTEREN }), true);
});

// ── Splitsing van de lijst ──────────────────────────────────────────────────

const LIJST = [
  { id: "komend-laat", datum: "2026-09-01T10:00:00.000Z", gearchiveerd_op: null },
  { id: "komend-vroeg", datum: "2026-08-10T10:00:00.000Z", gearchiveerd_op: null },
  { id: "afgelopen-recent", datum: "2026-08-05T10:00:00.000Z", gearchiveerd_op: null },
  { id: "afgelopen-oud", datum: "2026-01-05T10:00:00.000Z", gearchiveerd_op: null },
  { id: "archief", datum: "2025-11-05T10:00:00.000Z", gearchiveerd_op: GISTEREN },
];

test("gearchiveerd wint van komend en afgelopen — nooit dubbel", () => {
  const s = splitsVergaderingen(
    [
      ...LIJST,
      // Een gearchiveerde vergadering die in de TOEKOMST ligt: mag alleen in
      // het archief verschijnen, niet ook bij "komend".
      { id: "archief-toekomst", datum: VOLGENDE_WEEK, gearchiveerd_op: GISTEREN },
    ],
    NU
  );
  const alle = [...s.komend, ...s.afgelopen, ...s.gearchiveerd].map((v) => v.id);
  assert.equal(new Set(alle).size, alle.length, "een vergadering staat in precies één sectie");
  assert.equal(s.komend.some((v) => v.id === "archief-toekomst"), false);
  assert.equal(s.gearchiveerd.some((v) => v.id === "archief-toekomst"), true);
});

test("komend loopt oplopend, afgelopen en archief aflopend", () => {
  const s = splitsVergaderingen(LIJST, NU);
  assert.deepEqual(
    s.komend.map((v) => v.id),
    ["komend-vroeg", "komend-laat"]
  );
  assert.deepEqual(
    s.afgelopen.map((v) => v.id),
    ["afgelopen-recent", "afgelopen-oud"]
  );
  assert.deepEqual(
    s.gearchiveerd.map((v) => v.id),
    ["archief"]
  );
});

test("elke vergadering komt precies één keer terug", () => {
  const s = splitsVergaderingen(LIJST, NU);
  assert.equal(s.komend.length + s.afgelopen.length + s.gearchiveerd.length, LIJST.length);
});

console.log(`\n${n} sanity-tests geslaagd.\n`);
