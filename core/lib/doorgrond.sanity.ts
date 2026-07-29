// ============================================================
//  Sanity-tests voor core/lib/doorgrond.ts (P2 Deel B).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/doorgrond.sanity.ts
//  Verifieert: afwijkingen-gating op een eerdere versie, de start-voorwaarde
//  (minstens één sectie), de vaste sectievolgorde, de leesbare beurt en de
//  server-instructie (koppen + lengtenorm).
// ============================================================

import assert from "node:assert/strict";
import {
  DOORGROND_SECTIES,
  DOORGROND_PROMPTVARIANT,
  sectieBeschikbaar,
  magDoorgronden,
  sorteerSecties,
  bouwDoorgrondZin,
  bouwDoorgrondInstructie,
} from "./doorgrond";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("doorgrond sanity-tests:");

// ── beschikbaarheid / afwijkingen-gating (besluitpunt 2) ────────────────────
check("afwijkingen alleen beschikbaar met eerdere versie", () => {
  assert.equal(sectieBeschikbaar("afwijkingen", true), true);
  assert.equal(sectieBeschikbaar("afwijkingen", false), false);
});

check("overige secties altijd beschikbaar", () => {
  for (const id of ["samenvatting", "aandachtspunten", "kritische_vragen"] as const) {
    assert.equal(sectieBeschikbaar(id, false), true);
  }
});

// ── startvoorwaarde ──────────────────────────────────────────────────────────
check("nul secties → mag niet starten (criterium 9)", () => {
  assert.equal(magDoorgronden([], true), false);
});

check("één beschikbare sectie → mag starten", () => {
  assert.equal(magDoorgronden(["samenvatting"], false), true);
});

check("afwijkingen zonder eerdere versie → mag niet starten (criterium 10)", () => {
  assert.equal(magDoorgronden(["afwijkingen"], false), false);
  assert.equal(magDoorgronden(["samenvatting", "afwijkingen"], false), false);
  assert.equal(magDoorgronden(["samenvatting", "afwijkingen"], true), true);
});

// ── vaste volgorde + ontdubbeling ────────────────────────────────────────────
check("sorteerSecties behoudt vaste volgorde en ontdubbelt", () => {
  const uit = sorteerSecties(["afwijkingen", "samenvatting", "samenvatting", "kritische_vragen"]);
  assert.deepEqual(uit, ["samenvatting", "kritische_vragen", "afwijkingen"]);
});

// ── zichtbare beurt (B5) ─────────────────────────────────────────────────────
check("leesbare beurt somt secties op in vaste volgorde", () => {
  const zin = bouwDoorgrondZin("Actuarieel rapport Q2 2026", ["aandachtspunten", "samenvatting"]);
  assert.equal(
    zin,
    "Doorgrond «Actuarieel rapport Q2 2026» — samenvatting en bestuurlijke aandachtspunten."
  );
});

check("leesbare beurt bij één sectie (geen 'en')", () => {
  const zin = bouwDoorgrondZin("Jaarverslag 2025", ["samenvatting"]);
  assert.equal(zin, "Doorgrond «Jaarverslag 2025» — samenvatting.");
});

// ── server-instructie (B6) ───────────────────────────────────────────────────
check("instructie bevat de koppen van de gekozen secties, niet van andere", () => {
  const instr = bouwDoorgrondInstructie(["samenvatting", "kritische_vragen"], null);
  assert.ok(instr.includes("## Samenvatting"));
  assert.ok(instr.includes("## Kritische vragen"));
  assert.ok(!instr.includes("## Bestuurlijke aandachtspunten"));
  assert.ok(!instr.includes("## Afwijkingen"));
});

check("instructie legt de vaste lengtenorm en het HITL-kader op", () => {
  const instr = bouwDoorgrondInstructie(["samenvatting"], null);
  assert.ok(/één A4/.test(instr));
  assert.ok(/geen besluit of aanbeveling/.test(instr));
});

check("afwijkingen-instructie benoemt de vorige titel indien bekend", () => {
  const met = bouwDoorgrondInstructie(["afwijkingen"], "Actuarieel rapport Q1 2026");
  assert.ok(met.includes("«Actuarieel rapport Q1 2026»"));
  const zonder = bouwDoorgrondInstructie(["afwijkingen"], null);
  assert.ok(zonder.includes("## Afwijkingen"));
  assert.ok(!zonder.includes("«»"));
});

check("promptvariant en sectiedefinities zijn stabiel", () => {
  assert.equal(DOORGROND_PROMPTVARIANT, "doorgrond_v1_kort");
  assert.equal(DOORGROND_SECTIES.length, 4);
  assert.equal(DOORGROND_SECTIES.filter((s) => s.vereistVorigeVersie).length, 1);
});

console.log(`\n${n} sanity-tests geslaagd.`);
