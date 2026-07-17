// ============================================================================
//  §15-matrix — T15 tabs 4 (Spreiding) + 5 (Solidariteit) (app-laag).
// ----------------------------------------------------------------------------
//  App-laag-invarianten zonder DB:
//    (1) SERVER-SIDE GATES: de nieuwe tabpagina's dragen vereisModuleToegang
//        (manifest + capability stuurinformatie.view); de beheer-route dekt de
//        nieuwe POST-types met dezelfde gate (bron-inspectie; de gate zelf is
//        al T14-getest).
//    (2) AFGELEIDE VELDEN READ-ONLY: de payload-allowlists weigeren
//        spreidingsvermogen/FG resp. netto vulling/begin-/eindstand en
//        onbekende keys (pure invariant).
//    (3) SOLI-CONSISTENTIE HARD: de RPC-migratie dwingt SOLI_EINDSTAND_ONGELIJK
//        en SOLI_RESERVE_ONTBREEKT af; SECURITY INVOKER zonder fonds-parameter;
//        EXECUTE ingetrokken van PUBLIC/anon.
//    (4) ÉÉN BRON: de band leeft uitsluitend op de soli-reserve-rij — geen
//        soli_band-kpi's in de migraties (zou een tweede waarheid zijn) en de
//        soli-reader leest de band uit fonds_stuurinfo_reserve.
//    (5) GEEN DEELNEMER-PII en geen populatie_n-writes in de T15-migraties/
//        schrijvers (suppressie-leeskant blijft intact).
//  De DB-kant (RPC-rolgate, cross-tenant, eindstand-check onder échte RLS)
//  staat in supabase/checks/2026_07_17_t15_cross_tenant.sql.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/t15-stuurinfo-spreiding-soli.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  valideerSpreidingInvoer,
  valideerSolidariteitInvoer,
} from "../../core/lib/stuurinfo-invoer";

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, "..", "..", ...p), "utf8");

const RPC_MIGRATIE = "supabase/migrations/2026_07_17_t15_stuurinfo_spreiding_soli.sql";
const SEED_MIGRATIE = "supabase/migrations/2026_07_17_t15b_stuurinfo_spreiding_soli_seed.sql";

// ── (1) Server-side gates ────────────────────────────────────────────────────

test("T15 — beide tabpagina's dragen vereisModuleToegang met stuurinformatie.view", () => {
  for (const pad of [
    "app/(dashboard)/dashboard/spreiding/page.tsx",
    "app/(dashboard)/dashboard/solidariteit/page.tsx",
  ]) {
    const src = lees(pad);
    assert.ok(
      src.includes('vereisModuleToegang("stuurinformatie", "stuurinformatie.view")'),
      `${pad} moet de module-/capabilitygate server-side afdwingen`
    );
  }
});

test("T15 — de beheer-route valideert de nieuwe POST-types vóór de schrijvers", () => {
  const src = lees("app/api/stuurinformatie/beheer/route.ts");
  assert.ok(src.includes('case "spreiding"') && src.includes("valideerSpreidingInvoer("));
  assert.ok(src.includes('case "solidariteit"') && src.includes("valideerSolidariteitInvoer("));
  // De gate (capability + module) is generiek per method — T14-test dekt hem;
  // hier alleen borgen dat fonds_id niet alsnog uit de body komt.
  assert.ok(!/body\s*[.[]\s*["']?fonds_id/.test(src), "fonds_id mag nooit uit de body komen");
});

test("T15 — de soli-schrijver geeft de RPC géén fonds-parameter mee", () => {
  const src = lees("core/lib/stuurinfo-beheer.ts");
  assert.ok(src.includes('rpc("stuurinfo_soli_opslaan"'), "schrijver gebruikt de soli-RPC");
  assert.ok(!/p_fonds/.test(src), "de RPC-aanroepen mogen geen fonds-parameter dragen");
});

// ── (2) Afgeleide velden read-only (exhaustieve allowlists) ─────────────────

const geldigeSpreiding = () => ({
  type: "spreiding",
  periode: "2026Q2",
  invoer_bron: "handmatig",
  kerncijfers: {
    beschikbaar: 880,
    voorziening: 864,
    aanpassingsfactor: 0.62,
    band_onder: 85,
    band_boven: 115,
  },
});

test("T15 — spreiding: afgeleide/onbekende keys in kerncijfers → 400-vorm", () => {
  for (const afgeleid of ["spreidingsvermogen", "financieringsgraad", "nep_veld"]) {
    const body = geldigeSpreiding() as Record<string, unknown>;
    body.kerncijfers = { ...geldigeSpreiding().kerncijfers, [afgeleid]: 1 };
    const r = valideerSpreidingInvoer(body);
    assert.equal(r.ok, false, `afgeleid veld '${afgeleid}' moet geweigerd worden`);
    if (!r.ok) assert.equal(r.status, 400);
  }
});

test("T15 — spreiding: voorziening ≤ 0 → 422 (FG-noemer); ontbrekend verplicht veld → 400", () => {
  const nul = geldigeSpreiding();
  nul.kerncijfers.voorziening = 0;
  const r1 = valideerSpreidingInvoer(nul);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.status, 422);

  const leeg = geldigeSpreiding() as Record<string, unknown>;
  leeg.kerncijfers = { beschikbaar: 880, voorziening: 864, band_onder: 85, band_boven: 115 };
  const r2 = valideerSpreidingInvoer(leeg);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.status, 400);
});

test("T15 — spreiding: bandgrenzen nullable, maar orde en bereik worden getoetst", () => {
  const zonderBand = geldigeSpreiding();
  zonderBand.kerncijfers.band_onder = null as unknown as number;
  zonderBand.kerncijfers.band_boven = null as unknown as number;
  assert.equal(valideerSpreidingInvoer(zonderBand).ok, true, "band mag ontbreken (null)");

  const omgekeerd = geldigeSpreiding();
  omgekeerd.kerncijfers.band_onder = 115;
  omgekeerd.kerncijfers.band_boven = 85;
  assert.equal(valideerSpreidingInvoer(omgekeerd).ok, false, "onder > boven moet geweigerd worden");
});

// T17 (decisions/0078): de vulling-allowlist is nog DRIE invoerbronnen; het
// netto langleven-resultaat is afgeleid uit tab 3 (reeks langleven) en bestaat
// bewust niet meer als invoer-key (micro_langleven/langleven → 400).
const geldigeSoli = () => ({
  type: "solidariteit",
  periode: "2026Q2",
  invoer_bron: "handmatig",
  vulling: { premie: 1.1, rendement: 4.6, overrendementsbijdrage: 4.9 },
  uitdeling: 0,
  grenzen: { ondergrens: 1.5, bovengrens: 5.0 },
});

test("T15/T17 — solidariteit: afgeleide/onbekende keys in vulling → 400-vorm", () => {
  // micro_langleven en langleven zijn afgeleid (tab 3) — geen invoer meer.
  for (const afgeleid of ["netto_vulling", "beginstand", "eindstand", "micro_langleven", "langleven", "nep"]) {
    const body = geldigeSoli() as Record<string, unknown>;
    body.vulling = { ...geldigeSoli().vulling, [afgeleid]: 1 };
    const r = valideerSolidariteitInvoer(body);
    assert.equal(r.ok, false, `afgeleid veld '${afgeleid}' moet geweigerd worden`);
    if (!r.ok) assert.equal(r.status, 400);
  }
});

test("T15/T17 — solidariteit: vulling mag ±; uitdeling < 0 → 422", () => {
  assert.equal(valideerSolidariteitInvoer(geldigeSoli()).ok, true, "±-vulling is geldig");
  const negatief = geldigeSoli();
  negatief.uitdeling = -1;
  const r = valideerSolidariteitInvoer(negatief);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 422);
});

test("T15 — solidariteit: ontbrekende bron of grenzen-object → 400", () => {
  const zonderBron = geldigeSoli() as Record<string, unknown>;
  zonderBron.vulling = { premie: 1.1, rendement: 4.6 };
  assert.equal(valideerSolidariteitInvoer(zonderBron).ok, false);

  const zonderGrenzen = geldigeSoli() as Record<string, unknown>;
  delete zonderGrenzen.grenzen;
  assert.equal(valideerSolidariteitInvoer(zonderGrenzen).ok, false);
});

// ── (3) RPC-structuur in de migratie ─────────────────────────────────────────

test("T15 — RPC: SECURITY INVOKER, geen fonds-parameter, harde soli-checks, PUBLIC-revoke", () => {
  const sql = lees(RPC_MIGRATIE);
  const rpc = /create or replace function public\.stuurinfo_soli_opslaan\(([\s\S]*?)\)\s*returns/i.exec(sql);
  assert.ok(rpc, "RPC-definitie gevonden");
  assert.ok(!/fonds/i.test(rpc![1]), "RPC-signatuur mag geen fonds-parameter bevatten");
  assert.ok(/security invoker/i.test(sql), "RPC draait SECURITY INVOKER (RLS blijft gelden)");
  assert.ok(sql.includes("SOLI_RESERVE_ONTBREEKT"), "RPC eist een bestaande soli-reserve-rij");
  assert.ok(sql.includes("SOLI_EINDSTAND_ONGELIJK"), "RPC dwingt de eindstand-consistentie hard af");
  assert.ok(sql.includes("ONGELDIGE_VULLING"), "RPC draagt de vulling-allowlist");
  assert.ok(
    /revoke execute on function public\.stuurinfo_soli_opslaan[\s\S]*?from public, anon/i.test(sql),
    "EXECUTE moet van PUBLIC én anon ingetrokken zijn (T14b-les)"
  );
});

// ── (4) Eén bron: band uitsluitend op de reserve-rij ─────────────────────────

test("T15 — geen soli_band-kpi's (band = reserve-rij, dezelfde bron als tab 1)", () => {
  for (const pad of [RPC_MIGRATIE, SEED_MIGRATIE]) {
    // Commentaar strippen: de ontwerptoelichting benoemt de verworpen
    // kpi-variant expliciet — alleen echte SQL telt.
    const sql = lees(pad).replace(/--.*$/gm, "").toLowerCase();
    assert.ok(!sql.includes("soli_band"), `${pad} mag geen soli_band-kpi introduceren (tweede waarheid)`);
  }
  const reader = lees("core/lib/stuurinfo-bron.ts");
  assert.ok(
    /haalStuurinfoSolidariteit[\s\S]*?fonds_stuurinfo_reserve[\s\S]*?solidariteitsreserve/.test(reader),
    "de soli-reader leest band/stand uit fonds_stuurinfo_reserve (zelfde bron als tab 1)"
  );
});

test("T15 — micro-langleven was in de T15-seed één reeks-punt (soli_vulling), geen kpi-duplicaat", () => {
  // T15-tijdlijn: het biometrische resultaat leefde als reeks-punt
  // soli_vulling.micro_langleven (geen tweede kpi-opslag). T17 (decisions/0078)
  // vervangt dit door reader-afleiding uit de langleven-reeks en ruimt het
  // punt in t17b op — zie de dedicated T17-test voor de nieuwe invariant.
  const seed = lees(SEED_MIGRATIE);
  assert.ok(seed.includes("'micro_langleven'"), "T15-seed vulde het micro-langleven-punt");
  assert.ok(
    !/kpi[\s\S]{0,400}micro_langleven/i.test(seed.replace(/--.*$/gm, "")),
    "micro-langleven bestond niet óók als kpi (één bron)"
  );
});

// ── (5) Geen PII / geen populatie_n-writes ───────────────────────────────────

test("T15 — migraties bevatten geen individu-identificator en zetten nooit populatie_n", () => {
  for (const pad of [RPC_MIGRATIE, SEED_MIGRATIE]) {
    const sql = lees(pad).replace(/--.*$/gm, "").toLowerCase();
    for (const kolom of ["deelnemer_id", "bsn", "burgerservice", "geboortedat", "voornaam", "achternaam", "adres"]) {
      assert.ok(!new RegExp(`\\b${kolom}\\b`).test(sql), `${pad} mag geen '${kolom}' bevatten`);
    }
    assert.ok(!/insert[\s\S]*?populatie_n/i.test(sql), `${pad} mag populatie_n niet vullen (blijft NULL)`);
  }
  const schrijver = lees("core/lib/stuurinfo-beheer.ts").replace(/\/\/.*$/gm, "");
  assert.ok(!/populatie_n/.test(schrijver), "de schrijvers zetten nooit populatie_n");
});

// ── Periode-parameter blijft geen tenant-vector ──────────────────────────────

test("T15 — kwaadaardige periode-invoer faalt op de vormvalidatie (beide validators)", () => {
  for (const kwaad of ["'; drop table fondsen;--", "2026Q2&fonds=b", "../..", ""]) {
    const s = geldigeSpreiding() as Record<string, unknown>;
    s.periode = kwaad;
    assert.equal(valideerSpreidingInvoer(s).ok, false, `spreiding-periode '${kwaad}' geweigerd`);
    const z = geldigeSoli() as Record<string, unknown>;
    z.periode = kwaad;
    assert.equal(valideerSolidariteitInvoer(z).ok, false, `soli-periode '${kwaad}' geweigerd`);
  }
});
