// ============================================================================
//  §15-matrix — T16 tabs 6 (Operationeel) + 7 (Premie & compensatie) (app-laag).
// ----------------------------------------------------------------------------
//  App-laag-invarianten zonder DB:
//    (1) SERVER-SIDE GATES: de nieuwe tabpagina's dragen vereisModuleToegang
//        (manifest + capability stuurinformatie.view); de beheer-route dekt de
//        nieuwe POST-types met dezelfde gate (bron-inspectie; de gate zelf is
//        al T14-getest).
//    (2) AFGELEIDE VELDEN READ-ONLY: de payload-allowlists weigeren totaal
//        mutatie/primo/ultimo/totaal premie en onbekende keys (pure invariant).
//    (3) CONSISTENTIE HARD: de RPC-migratie dwingt OPER_/COMP_MUTATIE_ONGELIJK
//        en OPER_/COMP_RESERVE_ONTBREEKT af; SECURITY INVOKER zonder
//        fonds-parameter; EXECUTE ingetrokken van PUBLIC/anon.
//    (4) ÉÉN BRON: de ultimo's komen uit fonds_stuurinfo_reserve
//        (operationele_reserve/compensatiedepot — dezelfde bron als tab 1);
//        de oper-band leeft als kpi in € mln en raakt de reserve-rij niet
//        (het tab 1-stoplicht blijft "monitoring").
//    (5) GEEN DEELNEMER-PII en geen populatie_n-writes in de T16-migraties/
//        schrijvers (suppressie-leeskant blijft intact); de prognose-reeks is
//        seed/upload-only (geen handinvoer-pad in de RPC).
//  De DB-kant (RPC-rolgate, cross-tenant, consistentie onder échte RLS)
//  staat in supabase/checks/2026_07_18_t16_cross_tenant.sql.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/t16-stuurinfo-oper-premie.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  valideerOperationeelInvoer,
  valideerPremieInvoer,
} from "../../core/lib/stuurinfo-invoer";

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, "..", "..", ...p), "utf8");

const RPC_MIGRATIE = "supabase/migrations/2026_07_18_t16_stuurinfo_oper_premie.sql";
const SEED_MIGRATIE = "supabase/seeds/schema/2026_07_18_t16b_stuurinfo_oper_premie_seed.sql";

// ── (1) Server-side gates ────────────────────────────────────────────────────

test("T16 — beide tabpagina's dragen vereisModuleToegang met stuurinformatie.view", () => {
  for (const pad of [
    "app/(dashboard)/dashboard/operationeel/page.tsx",
    "app/(dashboard)/dashboard/premie/page.tsx",
  ]) {
    const src = lees(pad);
    assert.ok(
      src.includes('vereisModuleToegang("stuurinformatie", "stuurinformatie.view")'),
      `${pad} moet de module-/capabilitygate server-side afdwingen`
    );
  }
});

test("T16 — de beheer-route valideert de nieuwe POST-types vóór de schrijvers", () => {
  const src = lees("app/api/stuurinformatie/beheer/route.ts");
  assert.ok(src.includes('case "operationeel"') && src.includes("valideerOperationeelInvoer("));
  assert.ok(src.includes('case "premie"') && src.includes("valideerPremieInvoer("));
  // De gate (capability + module) is generiek per method — T14-test dekt hem;
  // hier alleen borgen dat fonds_id niet alsnog uit de body komt.
  assert.ok(!/body\s*[.[]\s*["']?fonds_id/.test(src), "fonds_id mag nooit uit de body komen");
});

test("T16 — de schrijvers geven de RPC's géén fonds-parameter mee", () => {
  const src = lees("core/lib/stuurinfo-beheer.ts");
  assert.ok(src.includes('rpc("stuurinfo_operationeel_opslaan"'), "schrijver gebruikt de oper-RPC");
  assert.ok(src.includes('rpc("stuurinfo_premie_opslaan"'), "schrijver gebruikt de premie-RPC");
  assert.ok(!/p_fonds/.test(src), "de RPC-aanroepen mogen geen fonds-parameter dragen");
});

// ── (2) Afgeleide velden read-only (exhaustieve allowlists) ─────────────────

const geldigOperationeel = () => ({
  type: "operationeel",
  periode: "2026Q2",
  invoer_bron: "handmatig",
  mutaties: {
    premie_kostenopslag: 0,
    beschermingsrendement: -0.1,
    overrendement: 1.3,
    gemist_rendement_twk: 0.1,
    twk_invaar: 0.2,
    verrekening_reserves: 0.2,
    overig: 0.1,
    kosten: -0.8,
  },
  norm: 8.0,
  band_onder: 6.0,
  band_boven: 12.0,
  kosten_realisatie: { uitvoeringskosten: 1.9, vermogensbeheer: 0.9, bestuur_overig: 0.3 },
  kosten_begroot: { uitvoeringskosten: 2.1, vermogensbeheer: 1.0, bestuur_overig: 0.2 },
});

test("T16 — operationeel: afgeleide/onbekende keys in mutaties → 400-vorm", () => {
  for (const afgeleid of ["totaal_mutatie", "primo", "ultimo", "nep_veld"]) {
    const body = geldigOperationeel() as Record<string, unknown>;
    body.mutaties = { ...geldigOperationeel().mutaties, [afgeleid]: 1 };
    const r = valideerOperationeelInvoer(body);
    assert.equal(r.ok, false, `afgeleid veld '${afgeleid}' moet geweigerd worden`);
    if (!r.ok) assert.equal(r.status, 400);
  }
});

test("T16 — operationeel: ontbrekende mutatiebron of kostensoort → 400; negatieve kosten → 422", () => {
  const zonderBron = geldigOperationeel() as Record<string, unknown>;
  const mutaties = { ...geldigOperationeel().mutaties } as Record<string, number>;
  delete mutaties.kosten;
  zonderBron.mutaties = mutaties;
  const r1 = valideerOperationeelInvoer(zonderBron);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.status, 400);

  const negatief = geldigOperationeel();
  negatief.kosten_realisatie.uitvoeringskosten = -1;
  const r2 = valideerOperationeelInvoer(negatief);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.status, 422);
});

test("T16 — operationeel: mutaties mogen ± zijn; band nullable maar orde getoetst; norm < 0 → 422", () => {
  assert.equal(valideerOperationeelInvoer(geldigOperationeel()).ok, true, "±-mutaties zijn geldig");

  const zonderBand = geldigOperationeel() as Record<string, unknown>;
  zonderBand.band_onder = null;
  zonderBand.band_boven = null;
  assert.equal(valideerOperationeelInvoer(zonderBand).ok, true, "band mag ontbreken (null)");

  const omgekeerd = geldigOperationeel();
  omgekeerd.band_onder = 12.0;
  omgekeerd.band_boven = 6.0;
  assert.equal(valideerOperationeelInvoer(omgekeerd).ok, false, "onder > boven moet geweigerd worden");

  const negNorm = geldigOperationeel();
  negNorm.norm = -1;
  const r = valideerOperationeelInvoer(negNorm);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 422);
});

const geldigPremie = () => ({
  type: "premie",
  periode: "2026Q2",
  invoer_bron: "handmatig",
  componenten_eur: {
    spaarpremie: 15.8,
    risico_ppwzp: 1.1,
    risico_aop: 0.1,
    risico_pvi: 1.0,
    opslag_uitvoeringskosten: 0.6,
    opslag_toekomstige_kosten: 0.4,
  },
  componenten_pct: {
    spaarpremie: 26.31,
    risico_ppwzp: 1.84,
    risico_aop: 0.12,
    risico_pvi: 1.68,
    opslag_uitvoeringskosten: 0.97,
    opslag_toekomstige_kosten: 0.71,
  },
  comp_mutaties: {
    premie: 0,
    beschermingsrendement: -0.1,
    overrendement: 0.2,
    onttrekkingen: -1.6,
    verrekening_reserves: 0,
    overig: 0.1,
  },
  toekenning: 6.5,
  startomvang: 60,
  ondergrens_pct: 40,
});

test("T16 — premie: afgeleide/onbekende keys in componenten/mutaties → 400-vorm", () => {
  for (const afgeleid of ["totaal_premie", "nep_veld"]) {
    const body = geldigPremie() as Record<string, unknown>;
    body.componenten_eur = { ...geldigPremie().componenten_eur, [afgeleid]: 1 };
    const r = valideerPremieInvoer(body);
    assert.equal(r.ok, false, `afgeleid veld '${afgeleid}' moet geweigerd worden`);
    if (!r.ok) assert.equal(r.status, 400);
  }
  for (const afgeleid of ["totaal_mutatie", "primo", "ultimo"]) {
    const body = geldigPremie() as Record<string, unknown>;
    body.comp_mutaties = { ...geldigPremie().comp_mutaties, [afgeleid]: 1 };
    const r = valideerPremieInvoer(body);
    assert.equal(r.ok, false, `afgeleid veld '${afgeleid}' moet geweigerd worden`);
    if (!r.ok) assert.equal(r.status, 400);
  }
});

test("T16 — premie: de uitputtingsprognose-reeks bestaat niet in de payload-vorm (upload-only)", () => {
  const body = geldigPremie() as Record<string, unknown>;
  body.prognose = { "2026": 41 };
  // Een onbekende top-level key wordt genegeerd door de validator (die leest
  // alleen de bekende velden) — maar de reeks mag nergens een schrijfpad
  // hebben: de RPC-migratie raakt comp_uitputting_prognose niet.
  const sql = lees(RPC_MIGRATIE).replace(/--.*$/gm, "").toLowerCase();
  assert.ok(
    !sql.includes("comp_uitputting_prognose"),
    "de RPC mag de prognose-reeks niet schrijven (seed/upload-only)"
  );
});

test("T16 — premie: negatieve component/toekenning → 422; % buiten 0–100 → 400", () => {
  const negComponent = geldigPremie();
  negComponent.componenten_eur.spaarpremie = -1;
  const r1 = valideerPremieInvoer(negComponent);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.status, 422);

  const negToekenning = geldigPremie();
  negToekenning.toekenning = -1;
  const r2 = valideerPremieInvoer(negToekenning);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.status, 422);

  const pctFout = geldigPremie();
  pctFout.componenten_pct.spaarpremie = 130;
  const r3 = valideerPremieInvoer(pctFout);
  assert.equal(r3.ok, false);
  if (!r3.ok) assert.equal(r3.status, 400);

  // Onttrekkingen zijn een ±-post (negatief = uitputting) — geldig.
  assert.equal(valideerPremieInvoer(geldigPremie()).ok, true);
});

// ── (3) RPC-structuur in de migratie ─────────────────────────────────────────

test("T16 — RPC's: SECURITY INVOKER, geen fonds-parameter, harde checks, PUBLIC-revoke", () => {
  const sql = lees(RPC_MIGRATIE);
  for (const naam of ["stuurinfo_operationeel_opslaan", "stuurinfo_premie_opslaan"]) {
    const rpc = new RegExp(
      `create or replace function public\\.${naam}\\(([\\s\\S]*?)\\)\\s*returns`,
      "i"
    ).exec(sql);
    assert.ok(rpc, `RPC-definitie ${naam} gevonden`);
    assert.ok(!/fonds/i.test(rpc![1]), `${naam} mag geen fonds-parameter bevatten`);
    assert.ok(
      new RegExp(
        `revoke execute on function public\\.${naam}[\\s\\S]*?from public, anon`,
        "i"
      ).test(sql),
      `EXECUTE moet van PUBLIC én anon ingetrokken zijn voor ${naam} (T14b-les)`
    );
  }
  assert.ok(/security invoker/i.test(sql), "RPC's draaien SECURITY INVOKER (RLS blijft gelden)");
  for (const check of [
    "OPER_RESERVE_ONTBREEKT",
    "OPER_MUTATIE_ONGELIJK",
    "COMP_RESERVE_ONTBREEKT",
    "COMP_MUTATIE_ONGELIJK",
    "ONGELDIGE_MUTATIES",
    "ONGELDIGE_KOSTEN",
    "ONGELDIGE_COMPONENTEN",
    "ONGELDIGE_WAARDE",
  ]) {
    assert.ok(sql.includes(check), `RPC-migratie draagt de harde check ${check}`);
  }
});

// ── (4) Eén bron: ultimo's uit de reserve-rijen; oper-band als kpi ───────────

test("T16 — de readers lezen de ultimo's uit fonds_stuurinfo_reserve (zelfde bron als tab 1)", () => {
  const reader = lees("core/lib/stuurinfo-bron.ts");
  assert.ok(
    /haalStuurinfoOperationeel[\s\S]*?fonds_stuurinfo_reserve[\s\S]*?operationele_reserve/.test(reader),
    "de oper-reader leest de stand uit fonds_stuurinfo_reserve (operationele_reserve)"
  );
  assert.ok(
    /haalStuurinfoPremie[\s\S]*?fonds_stuurinfo_reserve[\s\S]*?compensatiedepot/.test(reader),
    "de premie-reader leest de stand uit fonds_stuurinfo_reserve (compensatiedepot)"
  );
});

test("T16 — de oper-band leeft als kpi (€ mln) en raakt de reserve-rij-band niet", () => {
  const sql = lees(RPC_MIGRATIE).replace(/--.*$/gm, "");
  // De oper-RPC mag fonds_stuurinfo_reserve alleen LEZEN (select ... stand),
  // nooit updaten: de reserve-band is in % van de TV en stuurt het
  // tab 1-stoplicht (blijft "monitoring" — decisions/0077).
  assert.ok(
    !/update\s+public\.fonds_stuurinfo_reserve/i.test(sql),
    "de T16-RPC's mogen de reserve-rij niet updaten (stand/band zijn van de balans-save)"
  );
  assert.ok(sql.includes("'oper_band_onder'") && sql.includes("'oper_band_boven'"),
    "de oper-band wordt als kpi geschreven");
});

// ── (5) Geen PII / geen populatie_n-writes ───────────────────────────────────

test("T16 — migraties bevatten geen individu-identificator en zetten nooit populatie_n", () => {
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

// ── Seed-consistentie: depot-correctie houdt de balans sluitend ──────────────

test("T16 — de seed corrigeert het Q1-depot mét compensatie in 'overig' (balans blijft sluiten)", () => {
  const seed = lees(SEED_MIGRATIE).replace(/--.*$/gm, "");
  // Horizon: ev_comp → 42,4 en overig → 2,6 in dezelfde update-set.
  assert.ok(/\('ev_comp',\s*42\.4\),\s*\('overig',\s*2\.6\)/.test(seed),
    "horizon-correctie: ev_comp 42,4 + overig 2,6 (som blijft 2432)");
  assert.ok(/\('ev_comp',\s*18\.6\),\s*\('overig',\s*0\.4\)/.test(seed),
    "meridiaan-correctie: ev_comp 18,6 + overig 0,4 (som blijft 1045)");
  // De gekoppelde reserve-rij gaat mee (stand + pct).
  assert.ok(/set stand = 42\.4, pct_waarde = 1\.9/.test(seed), "horizon-reserve-rij mee");
  assert.ok(/set stand = 18\.6, pct_waarde = 1\.9/.test(seed), "meridiaan-reserve-rij mee");
});

// ── Periode-parameter blijft geen tenant-vector ──────────────────────────────

test("T16 — kwaadaardige periode-invoer faalt op de vormvalidatie (beide validators)", () => {
  for (const kwaad of ["'; drop table fondsen;--", "2026Q2&fonds=b", "../..", ""]) {
    const o = geldigOperationeel() as Record<string, unknown>;
    o.periode = kwaad;
    assert.equal(valideerOperationeelInvoer(o).ok, false, `oper-periode '${kwaad}' geweigerd`);
    const p = geldigPremie() as Record<string, unknown>;
    p.periode = kwaad;
    assert.equal(valideerPremieInvoer(p).ok, false, `premie-periode '${kwaad}' geweigerd`);
  }
});
