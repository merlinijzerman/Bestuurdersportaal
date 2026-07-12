// ============================================================
//  Sanity-tests voor lib/agendapunt-context.ts (ADR 0028).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx lib/agendapunt-context.sanity.ts
//  Verifieert: herkomststring, toelichtingsblok (met/zonder toelichting),
//  het herkomstlabel en de scheiding van de drie herkomsten in de regels.
// ============================================================

import assert from "node:assert/strict";
import {
  TOELICHTING_LABEL,
  SP_AGENDAPUNT_REGELS,
  heeftToelichting,
  bouwToelichtingBlok,
  herkomstString,
  type AgendapuntSeed,
} from "./agendapunt-context";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("agendapunt-context sanity-tests:");

// ── Herkomststring (criterium 6 — auditspoor) ───────────────────────────────
check("herkomstString → agendapunt:<id>", () => {
  assert.equal(herkomstString("abc-123"), "agendapunt:abc-123");
});

// ── heeftToelichting ────────────────────────────────────────────────────────
check("heeftToelichting: lege/whitespace/null → false, tekst → true", () => {
  const basis = { id: "x", titel: "T" };
  assert.equal(heeftToelichting({ ...basis, toelichting: null }), false);
  assert.equal(heeftToelichting({ ...basis, toelichting: "" }), false);
  assert.equal(heeftToelichting({ ...basis, toelichting: "   " }), false);
  assert.equal(heeftToelichting({ ...basis, toelichting: "iets" }), true);
});

// ── Toelichtingsblok ────────────────────────────────────────────────────────
check("toelichtingsblok bevat herkomst-kop, titel en toelichting", () => {
  const seed: AgendapuntSeed = {
    id: "p1",
    titel: "Wijziging beleggingsbeleid",
    toelichting: "Het bestuur overweegt de aandelenallocatie te verlagen.",
  };
  const blok = bouwToelichtingBlok(seed);
  assert.ok(blok.includes("geen vastgestelde fondsbron"));
  assert.ok(blok.includes("Wijziging beleggingsbeleid"));
  assert.ok(blok.includes("aandelenallocatie te verlagen"));
});

check("toelichtingsblok zonder toelichting → expliciete leeg-melding, geen crash", () => {
  const seed: AgendapuntSeed = { id: "p2", titel: "Mededelingen", toelichting: null };
  const blok = bouwToelichtingBlok(seed);
  assert.ok(blok.includes("Mededelingen"));
  assert.ok(blok.toLowerCase().includes("geen toelichting"));
});

// ── Labelregels (criterium 3 — herkomstscheiding) ───────────────────────────
check("herkomstlabel is [Toelichting agendapunt]", () => {
  assert.equal(TOELICHTING_LABEL, "[Toelichting agendapunt]");
});

check("regels scheiden de drie herkomsten expliciet", () => {
  assert.ok(SP_AGENDAPUNT_REGELS.includes(TOELICHTING_LABEL));
  assert.ok(SP_AGENDAPUNT_REGELS.includes("[Bron N]"));
  assert.ok(SP_AGENDAPUNT_REGELS.includes("[Algemene kennis]"));
  // De regels verbieden expliciet [Bron N] voor de toelichting.
  assert.ok(/NOOIT \[Bron N\]/i.test(SP_AGENDAPUNT_REGELS) ||
    SP_AGENDAPUNT_REGELS.includes("Gebruik hiervoor NOOIT [Bron N]"));
});

check("regels geven geen 'geen bron'-weigering bij 0 stukken", () => {
  assert.ok(/geen .?geen bron.?-weigering/i.test(SP_AGENDAPUNT_REGELS) ||
    SP_AGENDAPUNT_REGELS.includes('GEEN "geen bron"-weigering'));
});

console.log(`\n${n} sanity-tests geslaagd.`);
