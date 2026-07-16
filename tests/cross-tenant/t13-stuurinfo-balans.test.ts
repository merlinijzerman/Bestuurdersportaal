// ============================================================================
//  §15-matrix — T13 Balans-tab bestuurdersdashboard (app-laag).
// ----------------------------------------------------------------------------
//  App-laag-invarianten van het periodemodel + de reserves zonder DB:
//    (1) SERVER-SIDE GATE: de Balans-tab én de placeholder-tabs roepen de
//        server-guard vereisModuleToegang() aan (bron-inspectie) — de zes
//        "Binnenkort"-tabs zijn dus écht gegate pagina's, geen UI-verberging.
//    (2) PERIODE-PARAMETER IS GEEN TENANT-VECTOR: de ?periode=-waarde wordt
//        uitsluitend gevalideerd tegen de eigen registry (kiesPeriode:
//        onbekend → nieuwste); het fonds komt nooit uit de URL.
//    (3) STOPLICHT = ÉÉN AFGELEIDE DEFINITIE: status volgt uit stand t.o.v.
//        band; geen band → monitoring (geen status-kolom in de data).
//    (4) GEEN DEELNEMER-PII: de T13-datamigratie bevat geen individu-
//        identificator (structuur-inspectie van de kolomdefinities).
//  De DB-kant (cross-tenant RLS + rolgate + deny-delete) staat in de SQL-suite
//  supabase/checks/2026_07_16_t13_cross_tenant.sql.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/t13-stuurinfo-balans.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { kiesPeriode, leidReserveStatusAf } from "../../core/lib/stuurinfo-balans";

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, "..", "..", ...p), "utf8");

// ── (1) Server-side gate op de Balans-tab én de placeholder-tabs ────────────

test("T13 — Balans-tab en placeholder-tabs roepen de server-guard vereisModuleToegang() aan", () => {
  for (const pad of [
    "app/(dashboard)/dashboard/page.tsx",
    "app/(dashboard)/dashboard/[tab]/page.tsx",
  ]) {
    const src = lees(pad);
    assert.ok(
      src.includes("vereisModuleToegang("),
      `${pad} zou de server-side module-guard moeten aanroepen (beschikbaarheid + capability)`
    );
  }
});

test("T13 — de placeholder-route hanteert een allowlist met notFound() voor onbekende tabs", () => {
  const src = lees("app/(dashboard)/dashboard/[tab]/page.tsx");
  assert.ok(src.includes("notFound()"), "onbekende tab-keys moeten server-side 404 geven");
});

// ── (2) Periode-parameter is geen tenant-vector ─────────────────────────────

test("T13 — een onbekende/kwaadaardige ?periode= valt terug op de nieuwste EIGEN periode", () => {
  const eigen = [
    { periode: "2026Q1", peildatum: "2026-03-31", volgorde: 1 },
    { periode: "2026Q2", peildatum: "2026-06-30", volgorde: 2 },
  ];
  for (const poging of ["2031Q9", "'; drop table fondsen;--", "", "2026Q2&fonds=b"]) {
    const { gekozen } = kiesPeriode(eigen, poging);
    assert.equal(gekozen?.periode, "2026Q2", `poging '${poging}' moet op de nieuwste periode uitkomen`);
  }
});

test("T13 — de leeslaag leest de registry met een expliciete eigen-fonds-filter (RLS + defense-in-depth)", () => {
  const bron = lees("core/lib/stuurinfo-bron.ts");
  assert.ok(bron.includes('from("fonds_stuurinfo_periode")'), "leeslaag leest de periode-registry");
  assert.ok(bron.includes('eq("fonds_id", fondsId)'), "leeslaag filtert expliciet op het eigen fonds");
});

// ── (3) Stoplicht = één afgeleide definitie (besluit 0074) ──────────────────

test("T13 — stoplichtstatus is afgeleid: band → ok/onder/boven, geen band → monitoring", () => {
  assert.equal(leidReserveStatusAf(1.5, 5.0, 3.3), "ok");
  assert.equal(leidReserveStatusAf(1.5, 5.0, 1.2), "onder");
  assert.equal(leidReserveStatusAf(1.5, 5.0, 5.4), "boven");
  assert.equal(leidReserveStatusAf(null, null, 99), "monitoring");
});

test("T13 — de reserve-tabel heeft bewust GEEN status-kolom (geen dubbele waarheid)", () => {
  const ddl = lees("supabase/migrations/2026_07_16_t13_stuurinfo_periode_reserve.sql")
    .replace(/--.*$/gm, "")
    .replace(/comment on [\s\S]*?;/gi, "");
  const reserveDdl = /create table if not exists public\.fonds_stuurinfo_reserve[\s\S]*?\);/i.exec(ddl)?.[0] ?? "";
  assert.ok(reserveDdl.length > 0, "reserve-DDL gevonden");
  assert.ok(!/\bstatus\b/i.test(reserveDdl), "fonds_stuurinfo_reserve mag geen status-kolom hebben (afgeleid)");
});

// ── (4) Geen deelnemer-PII in het T13-datamodel (structuur-inspectie) ───────

test("T13 — de datamigratie bevat GEEN individu-identificator (geen deelnemer-PII)", () => {
  const sql = lees("supabase/migrations/2026_07_16_t13_stuurinfo_periode_reserve.sql")
    .replace(/--.*$/gm, "")
    .replace(/comment on [\s\S]*?;/gi, "")
    .toLowerCase();
  const verboden = [
    "deelnemer_id", "bsn", "burgerservice", "geboortedat",
    "voornaam", "achternaam", "roepnaam", "adres",
  ];
  for (const kolom of verboden) {
    const regex = new RegExp(`\\b${kolom}\\b`);
    assert.ok(!regex.test(sql), `migratie mag geen '${kolom}' kolom/veld bevatten (deelnemer-PII)`);
  }
});
