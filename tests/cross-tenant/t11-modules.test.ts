// ============================================================================
//  §15-matrix — T11 modules stuurinformatie + klantbeeld (app-laag).
// ----------------------------------------------------------------------------
//  App-laag-invarianten van de config-gedreven module-laag zonder DB:
//    (1) BESCHIKBAARHEID ≠ AUTORISATIE ≠ DATACONTEXT: de view-capabilities zijn
//        een echte rolgate; de manifest-beschikbaarheid is een aparte laag.
//    (2) SERVER-SIDE GATE: elke module-pagina roept de server-guard
//        vereisModuleToegang() aan (bron-inspectie) — niet alleen nav-verborgen.
//    (3) SUPPRESSIE bedraad: de leeslagen passen isOnderdrukt() toe (bron-inspectie)
//        en de drempel is n<10 (pure functie).
//    (4) GEEN DEELNEMER-PII: de T11-datamigratie bevat geen individu-identificator
//        (structuur-inspectie van de kolomdefinities).
//  De DB-kant (cross-tenant RLS + rolgate + deny-delete) staat in de SQL-suite
//  supabase/checks/2026_07_10_t11_cross_tenant.sql.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/t11-modules.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rolHeeftCapability } from "../../lib/capabilities";
import { beschikbareModuleKeys } from "../../lib/module-registry";
import { isOnderdrukt, SUPPRESSIE_DREMPEL } from "../../lib/suppressie";

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, "..", "..", ...p), "utf8");

// ── (1) Beschikbaarheid ≠ autorisatie ───────────────────────────────────────

test("T11 — alle bestuurdersrollen dragen de view-capabilities (aggregaat, geen PII → breed leesrecht)", () => {
  for (const rol of ["beheerder", "voorzitter", "bestuurder"]) {
    assert.equal(rolHeeftCapability(rol, "stuurinformatie.view"), true, `${rol} stuurinformatie.view`);
    assert.equal(rolHeeftCapability(rol, "klantbeeld.view"), true, `${rol} klantbeeld.view`);
  }
});

test("T11 — een onbekende rol / geen profiel heeft GEEN view-capability (server-side geweigerd)", () => {
  assert.equal(rolHeeftCapability("auditor", "stuurinformatie.view"), false);
  assert.equal(rolHeeftCapability(null, "klantbeeld.view"), false);
  assert.equal(rolHeeftCapability(undefined, "stuurinformatie.view"), false);
});

test("T11 — beschikbaarheid is een APARTE laag: manifest-uit verbergt de module ongeacht capability", () => {
  // De capability staat los van de manifest-beschikbaarheid: ook mét view-capability
  // is een via het manifest uitgezette module niet beschikbaar.
  const uit = beschikbareModuleKeys(new Map([["stuurinformatie", false], ["klantbeeld", false]]));
  assert.equal(uit.has("stuurinformatie"), false);
  assert.equal(uit.has("klantbeeld"), false);
  const aan = beschikbareModuleKeys(new Map([["stuurinformatie", true], ["klantbeeld", true]]));
  assert.equal(aan.has("stuurinformatie"), true);
  assert.equal(aan.has("klantbeeld"), true);
});

// ── (2) Server-side gate op elke module-pagina (bron-inspectie) ─────────────

const MODULE_PAGINAS = [
  "app/(dashboard)/dashboard/page.tsx",
  "app/(dashboard)/klantbeeld/deelnemers/page.tsx",
  "app/(dashboard)/klantbeeld/deelnemers/cohorten/page.tsx",
  "app/(dashboard)/klantbeeld/werkgevers/page.tsx",
];

test("T11 — elke module-pagina roept de server-guard vereisModuleToegang() aan", () => {
  for (const pad of MODULE_PAGINAS) {
    const src = lees(pad);
    assert.ok(
      src.includes("vereisModuleToegang("),
      `${pad} zou de server-side module-guard moeten aanroepen (beschikbaarheid + capability)`
    );
  }
});

test("T11 — de pagina-guard weigert server-side met notFound() (geen UI-only verberging)", () => {
  const guard = lees("lib/module-gate-page.ts");
  assert.ok(guard.includes("notFound()"), "guard moet server-side weigeren met notFound()");
  assert.ok(guard.includes("rolHeeftCapability"), "guard moet de capability server-side toetsen");
  assert.ok(guard.includes("moduleBeschikbaar"), "guard moet de manifest-beschikbaarheid server-side toetsen");
});

// ── (3) Suppressie bedraad in de leeslagen + drempel ────────────────────────

test("T11 — de suppressiedrempel is n<10 (besluit 0055)", () => {
  assert.equal(SUPPRESSIE_DREMPEL, 10);
  assert.equal(isOnderdrukt(9), true);
  assert.equal(isOnderdrukt(10), false);
});

test("T11 — beide leeslagen passen de suppressie toe (isOnderdrukt) vóór de client", () => {
  assert.ok(lees("lib/stuurinfo-bron.ts").includes("isOnderdrukt"), "stuurinfo-bron past suppressie toe");
  assert.ok(lees("lib/klantbeeld-bron.ts").includes("isOnderdrukt"), "klantbeeld-bron past suppressie toe");
});

// ── (4) Geen deelnemer-PII in het datamodel (structuur-inspectie) ───────────

test("T11 — de datamigratie bevat GEEN individu-identificator (geen deelnemer-PII)", () => {
  // Alleen de DDL toetsen, niet de toelichting: de header-/kolomcommentaren
  // benoemen de verboden termen juist om uit te leggen dat ze NIET voorkomen.
  const sql = lees("supabase/migrations/2026_07_10_t11_stuurinfo_klantbeeld_data.sql")
    .replace(/--.*$/gm, "") // strip line-comments
    .replace(/comment on [\s\S]*?;/gi, "") // strip comment-on-statements (bevatten uitleg)
    .toLowerCase();
  const verboden = [
    "deelnemer_id",
    "bsn",
    "burgerservice",
    "geboortedat",
    "voornaam",
    "achternaam",
    "roepnaam",
    "adres",
  ];
  for (const kolom of verboden) {
    // Kolomdefinitie-vorm: "<naam> <type>" of "<naam>," — we weren elke identifier-vorm.
    const regex = new RegExp(`\\b${kolom}\\b`);
    assert.ok(!regex.test(sql), `migratie mag geen '${kolom}' kolom/veld bevatten (deelnemer-PII)`);
  }
});
