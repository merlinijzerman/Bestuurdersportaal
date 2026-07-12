// ============================================================
//  Sanity-tests voor de regelgebaseerde notulensegmentatie (Increment D).
//
//  Geen testframework in de repo; standalone met assert (patroon
//  lib/chunking.sanity.ts / lib/capabilities.sanity.ts).
//  Uitvoeren: npx tsx lib/notulen.sanity.ts
//
//  Dekt DoD-regressiepunten: 3 (bronvermelding) en 8 (idempotente segmentatie),
//  plus de kernheuristiek (nummer-/titelmatch, geen-koppen-fallback).
// ============================================================

import assert from "node:assert/strict";
import {
  stelSegmentenVoor,
  notulenBronLabel,
  titelOverlap,
  type AgendapuntRef,
} from "./notulen";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("notulen sanity-tests:");

const agendapunten: AgendapuntRef[] = [
  { id: "ap-1", titel: "Opening en mededelingen", volgorde: 1 },
  { id: "ap-2", titel: "Vaststelling jaarrekening 2025", volgorde: 2 },
  { id: "ap-3", titel: "Herziening beleggingsbeleid", volgorde: 3 },
];

const notulen = [
  "1. Opening en mededelingen",
  "De voorzitter opent de vergadering om 10:00 uur. Geen mededelingen.",
  "",
  "2. Vaststelling jaarrekening 2025",
  "De jaarrekening 2025 wordt zonder wijzigingen vastgesteld door het bestuur.",
  "",
  "3. Herziening beleggingsbeleid",
  "Het bestuur bespreekt het voorstel tot herziening van het beleggingsbeleid.",
].join("\n");

test("genummerde koppen → segment per agendapunt, gekoppeld op volgorde", () => {
  const segs = stelSegmentenVoor(notulen, agendapunten);
  assert.equal(segs.length, 3);
  assert.equal(segs[0].agendapunt_id, "ap-1");
  assert.equal(segs[1].agendapunt_id, "ap-2");
  assert.equal(segs[2].agendapunt_id, "ap-3");
  assert.equal(segs[0].match_bron, "kop_nummer");
  assert.ok(segs[1].tekst.includes("jaarrekening 2025 wordt zonder wijzigingen"));
});

test("segment_index is sequentieel vanaf 0", () => {
  const segs = stelSegmentenVoor(notulen, agendapunten);
  segs.forEach((s, i) => assert.equal(s.segment_index, i));
});

test("idempotent: tweemaal segmenteren geeft identiek resultaat (regressie 8)", () => {
  const a = stelSegmentenVoor(notulen, agendapunten);
  const b = stelSegmentenVoor(notulen, agendapunten);
  assert.deepEqual(a, b);
});

test("kop zonder nummer maar met titel-overlap koppelt via titelmatch", () => {
  const tekst = [
    "Herziening beleggingsbeleid",
    "Discussie over de nieuwe assetallocatie en het risicokader.",
  ].join("\n");
  const segs = stelSegmentenVoor(tekst, agendapunten);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].agendapunt_id, "ap-3");
  assert.equal(segs[0].match_bron, "titelmatch");
});

test("geen koppen → één ongekoppeld segment met de hele tekst", () => {
  const tekst = "Een doorlopend verslag zonder enige kopstructuur of nummering hier.";
  const segs = stelSegmentenVoor(tekst, agendapunten);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].agendapunt_id, null);
  assert.equal(segs[0].match_bron, "geen");
  assert.equal(segs[0].tekst, tekst);
});

test("lege tekst → geen voorstellen", () => {
  assert.deepEqual(stelSegmentenVoor("", agendapunten), []);
  assert.deepEqual(stelSegmentenVoor("   \n  ", agendapunten), []);
});

test("nummer zonder bijpassend agendapunt → segment zonder koppeling", () => {
  const tekst = ["9. Rondvraag", "Niets voor de rondvraag."].join("\n");
  const segs = stelSegmentenVoor(tekst, agendapunten);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].agendapunt_id, null);
  assert.equal(segs[0].titel, "Rondvraag");
});

test("titelOverlap: identiek=1, disjunct=0", () => {
  assert.equal(titelOverlap("Vaststelling jaarrekening", "Vaststelling jaarrekening"), 1);
  assert.equal(titelOverlap("appels peren", "auto fiets"), 0);
});

// ── Regressie 3 — bronvermelding ───────────────────────────────────────────
test("bronlabel = 'Vastgestelde notulen [verg], agendapunt N — [titel]'", () => {
  assert.equal(
    notulenBronLabel("Bestuursvergadering 12 maart 2026", 2, "Vaststelling jaarrekening 2025"),
    "Vastgestelde notulen Bestuursvergadering 12 maart 2026, agendapunt 2 — Vaststelling jaarrekening 2025"
  );
});

test("bronlabel zonder agendapunt → alleen vergadering", () => {
  assert.equal(
    notulenBronLabel("Bestuursvergadering 12 maart 2026", null, null),
    "Vastgestelde notulen Bestuursvergadering 12 maart 2026"
  );
});

console.log(`\n${n} sanity-tests geslaagd.`);
