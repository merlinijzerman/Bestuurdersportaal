// ============================================================================
//  §15-matrix — T17 tab 3 (Biometrische rendementen) (app-laag).
// ----------------------------------------------------------------------------
//  App-laag-invarianten zonder DB:
//    (1) SERVER-SIDE GATES: de tab 3-pagina draagt vereisModuleToegang
//        (manifest + capability stuurinformatie.view); de beheer-route dekt het
//        nieuwe POST-type "biometrie" met dezelfde gate (bron-inspectie; de
//        gate zelf is al T14-getest). fonds_id nooit uit de body.
//    (2) AFGELEIDE VELDEN READ-ONLY: de payload-allowlists weigeren netto
//        langleven / resultaat_ppwzp / resultaat_aopvi én de risicopremies uit
//        tab 7 (die zijn read-only referentie, geen invoer). Tekenconventies
//        hard: vrijval ≥ 0 (opbrengst), toegekend ≤ 0 (last) → 422.
//    (3) ÉÉN-BRON-KOPPELING: de soli-RPC leest netto langleven uit de
//        langleven-reeks (SOLI_LANGLEVEN_ONTBREEKT) en de vulling-allowlist is
//        naar 3 invoerbronnen teruggebracht (geen micro_langleven-invoer);
//        de oper-RPC telt de resultaten PP/WZP en AO/PVI mee in de som-check
//        (OPER_PREMIE_/OPER_BIOMETRIE_ONTBREEKT). De biometrie-save is een
//        batch-upsert op fonds_stuurinfo_reeks (RLS + audittrigger), geen RPC.
//    (4) GEEN DEELNEMER-PII en geen populatie_n-writes in de T17-migraties/
//        schrijvers (suppressie-leeskant blijft intact).
//  De DB-kant (RPC-rolgate, cross-tenant, de nieuwe consistentie onder échte
//  RLS) staat in supabase/checks/2026_07_19_t17_cross_tenant.sql.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/t17-stuurinfo-biometrie.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { valideerBiometrieInvoer } from "../../core/lib/stuurinfo-invoer";
import {
  leidBiometrieAf,
  nettoLangleven,
  risicopremiesVan,
} from "../../core/lib/stuurinfo-biometrie";

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, "..", "..", ...p), "utf8");

const RPC_MIGRATIE = "supabase/migrations/2026_07_19_t17_stuurinfo_biometrie.sql";
const SEED_MIGRATIE = "supabase/seeds/schema/2026_07_19_t17b_stuurinfo_biometrie_seed.sql";

const bron = (puntKey: string, waarde: number | null) => ({
  puntKey,
  label: null,
  volgorde: 0,
  waarde,
});

// ── (1) Server-side gates ────────────────────────────────────────────────────

test("T17 — de tab 3-pagina draagt vereisModuleToegang met stuurinformatie.view", () => {
  const src = lees("app/(dashboard)/dashboard/biometrie/page.tsx");
  assert.ok(
    src.includes('vereisModuleToegang("stuurinformatie", "stuurinformatie.view")'),
    "de biometrie-tab moet de module-/capabilitygate server-side afdwingen"
  );
});

test("T17 — biometrie is een gebouwde tab (uit de placeholder-allowlist gehaald)", () => {
  const src = lees("app/(dashboard)/dashboard/[tab]/page.tsx");
  assert.ok(/GEBOUWDE_TABS\s*=\s*\[[^\]]*"biometrie"/.test(src), "biometrie moet in GEBOUWDE_TABS staan");
  assert.ok(!/TOELICHTING[\s\S]*biometrie:/.test(src), "de biometrie-placeholdertekst moet weg zijn");
});

test("T17 — de beheer-route valideert het POST-type 'biometrie' vóór de schrijver; fonds_id niet uit de body", () => {
  const src = lees("app/api/stuurinformatie/beheer/route.ts");
  assert.ok(src.includes('case "biometrie"') && src.includes("valideerBiometrieInvoer("));
  assert.ok(src.includes("slaBiometrieOp("), "de route roept de biometrie-schrijver aan");
  assert.ok(!/body\s*[.[]\s*["']?fonds_id/.test(src), "fonds_id mag nooit uit de body komen");
});

test("T17 — de biometrie-schrijver is een reeks-upsert (geen fonds-parameter, geen RPC-fonds)", () => {
  const src = lees("core/lib/stuurinfo-beheer.ts");
  assert.ok(/slaBiometrieOp[\s\S]*?\.from\("fonds_stuurinfo_reeks"\)[\s\S]*?\.upsert/.test(src),
    "slaBiometrieOp upsert op fonds_stuurinfo_reeks");
  assert.ok(/slaBiometrieOp\(\s*\n?\s*fondsId: string/.test(src) || /slaBiometrieOp\(fondsId/.test(src),
    "fonds_id komt als server-side afgeleide parameter, nooit uit de body");
});

// ── (2) Afgeleide velden read-only + tekenconventies ────────────────────────

const geldigeBiometrie = () => ({
  type: "biometrie",
  periode: "2026Q2",
  invoer_bron: "handmatig",
  langleven: { micro: -0.8, macro: -1.2, vrijval: 1.4 },
  toegekend: { ppwzp_toegekend: -0.3, aopvi_toegekend: -0.4 },
});

test("T17 — afgeleide/onbekende keys in langleven → 400-vorm", () => {
  // netto is afgeleid; de risicopremies (tab 7) horen niet in de langleven-set.
  for (const afgeleid of ["netto", "resultaat_ppwzp", "ppwzp_premie", "nep"]) {
    const body = geldigeBiometrie() as Record<string, unknown>;
    body.langleven = { ...geldigeBiometrie().langleven, [afgeleid]: 1 };
    const r = valideerBiometrieInvoer(body);
    assert.equal(r.ok, false, `afgeleid/onbekend veld '${afgeleid}' moet geweigerd worden`);
    if (!r.ok) assert.equal(r.status, 400);
  }
});

test("T17 — afgeleide/onbekende keys in toegekend → 400-vorm (premies zijn tab 7, geen invoer)", () => {
  for (const afgeleid of ["ppwzp_premie", "aopvi_premie", "resultaat_aopvi", "nep"]) {
    const body = geldigeBiometrie() as Record<string, unknown>;
    body.toegekend = { ...geldigeBiometrie().toegekend, [afgeleid]: -1 };
    const r = valideerBiometrieInvoer(body);
    assert.equal(r.ok, false, `afgeleid/onbekend veld '${afgeleid}' moet geweigerd worden`);
    if (!r.ok) assert.equal(r.status, 400);
  }
});

test("T17 — ontbrekende bron → 400", () => {
  const zonderVrijval = geldigeBiometrie() as Record<string, unknown>;
  zonderVrijval.langleven = { micro: -0.8, macro: -1.2 };
  const r1 = valideerBiometrieInvoer(zonderVrijval);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.status, 400);

  const zonderToegekend = geldigeBiometrie() as Record<string, unknown>;
  zonderToegekend.toegekend = { ppwzp_toegekend: -0.3 };
  const r2 = valideerBiometrieInvoer(zonderToegekend);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.status, 400);
});

test("T17 — tekenconventies hard: vrijval < 0 → 422; toegekend > 0 → 422", () => {
  assert.equal(valideerBiometrieInvoer(geldigeBiometrie()).ok, true, "geldige bronnen worden geaccepteerd");
  // micro/macro mogen ± zijn (positief langleven-resultaat mogelijk).
  const positiefMacro = geldigeBiometrie();
  positiefMacro.langleven.macro = 0.5;
  assert.equal(valideerBiometrieInvoer(positiefMacro).ok, true, "micro/macro mogen positief zijn");

  const vrijvalNeg = geldigeBiometrie();
  vrijvalNeg.langleven.vrijval = -0.1;
  const r1 = valideerBiometrieInvoer(vrijvalNeg);
  assert.equal(r1.ok, false, "vrijval is een opbrengst en kan niet negatief zijn");
  if (!r1.ok) assert.equal(r1.status, 422);

  const toegekendPos = geldigeBiometrie();
  toegekendPos.toegekend.ppwzp_toegekend = 0.3;
  const r2 = valideerBiometrieInvoer(toegekendPos);
  assert.equal(r2.ok, false, "toegekende dekkingen zijn lasten (≤ 0)");
  if (!r2.ok) assert.equal(r2.status, 422);
});

// ── (3) Afleiding + één-bron-koppeling ──────────────────────────────────────

test("T17 — netto langleven = micro + macro + vrijval; resultaat = premie + toegekend", () => {
  const b = leidBiometrieAf(
    [bron("micro", -0.8), bron("macro", -1.2), bron("vrijval", 1.4)],
    [bron("ppwzp_toegekend", -0.3), bron("aopvi_toegekend", -0.4)],
    [bron("risico_ppwzp", 1.1), bron("risico_aop", 0.1), bron("risico_pvi", 1.0)]
  );
  assert.ok(b.langleven.netto !== null && Math.abs(b.langleven.netto - -0.6) < 1e-9);
  assert.ok(b.ppwzp.resultaat !== null && Math.abs(b.ppwzp.resultaat - 0.8) < 1e-9);
  assert.ok(b.aopvi.resultaat !== null && Math.abs(b.aopvi.resultaat - 0.7) < 1e-9);
  // AO/PVI-premie = AOP + PVI (beide vereist — geen halve som).
  assert.equal(risicopremiesVan([bron("risico_ppwzp", 1.1), bron("risico_aop", 0.1)]).aopvi, null);
  assert.equal(nettoLangleven([bron("micro", -0.8), bron("macro", -1.2)]), null);
});

test("T17 — de soli-RPC leest netto langleven uit de langleven-reeks (SOLI_LANGLEVEN_ONTBREEKT); vulling = 3 invoerbronnen", () => {
  const sql = lees(RPC_MIGRATIE);
  assert.ok(sql.includes("SOLI_LANGLEVEN_ONTBREEKT"),
    "de soli-RPC weigert zonder complete langleven-reeks");
  assert.ok(/reeks_key\s*=\s*'langleven'/.test(sql) && /'micro','macro','vrijval'/.test(sql),
    "de soli-RPC leidt netto langleven af uit de langleven-reeks");
  // De vulling-allowlist mag micro_langleven niet meer als invoer accepteren.
  const soliRpc = /stuurinfo_soli_opslaan[\s\S]*?\$\$;/.exec(sql)?.[0] ?? "";
  assert.ok(
    /p_vulling\s*\?&\s*array\['premie','rendement','overrendementsbijdrage'\]/.test(soliRpc),
    "de vulling-allowlist is naar 3 invoerbronnen teruggebracht"
  );
  assert.ok(!/micro_langleven/.test(soliRpc), "de soli-RPC schrijft/accepteert micro_langleven niet meer");
});

test("T17 — de oper-RPC telt de resultaten PP/WZP en AO/PVI mee (één bron uit tab 3/7)", () => {
  const sql = lees(RPC_MIGRATIE);
  for (const check of ["OPER_PREMIE_ONTBREEKT", "OPER_BIOMETRIE_ONTBREEKT", "OPER_MUTATIE_ONGELIJK"]) {
    assert.ok(sql.includes(check), `de oper-RPC draagt de harde check ${check}`);
  }
  assert.ok(/reeks_key\s*=\s*'premie_component'/.test(sql) && /reeks_key\s*=\s*'risicodekking'/.test(sql),
    "de oper-check leidt de resultaten af uit premie_component (tab 7) + risicodekking (tab 3)");
  // De resultaten mogen niet als opgeslagen oper_mutatie-punten bestaan
  // (geen dubbele opslag) — de allowlist blijft exact de 8 bronnen.
  assert.ok(!/'resultaat_ppwzp'|'resultaat_aopvi'/.test(sql.replace(/--.*$/gm, "")),
    "de resultaten worden niet als reeks-punten opgeslagen (afgeleid in de leeslaag)");
});

test("T17 — RPC's: SECURITY INVOKER, geen fonds-parameter, PUBLIC/anon-revoke", () => {
  const sql = lees(RPC_MIGRATIE);
  for (const naam of ["stuurinfo_soli_opslaan", "stuurinfo_operationeel_opslaan"]) {
    const rpc = new RegExp(
      `create or replace function public\\.${naam}\\(([\\s\\S]*?)\\)\\s*returns`,
      "i"
    ).exec(sql);
    assert.ok(rpc, `RPC-definitie ${naam} gevonden`);
    assert.ok(!/fonds/i.test(rpc![1]), `${naam} mag geen fonds-parameter bevatten`);
    assert.ok(
      new RegExp(`revoke execute on function public\\.${naam}[\\s\\S]*?from public, anon`, "i").test(sql),
      `EXECUTE moet van PUBLIC én anon ingetrokken zijn voor ${naam} (T14b-les)`
    );
  }
  assert.ok(/security invoker/i.test(sql), "RPC's draaien SECURITY INVOKER (RLS blijft gelden)");
});

// ── (4) Geen PII / geen populatie_n-writes ───────────────────────────────────

test("T17 — migraties bevatten geen individu-identificator en zetten nooit populatie_n", () => {
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

test("T17 — de staafgrafiek 'biometrisch resultaat naar bron' is niet aanwezig (tab is bewust tabel-only)", () => {
  const src = lees("app/(dashboard)/dashboard/biometrie/page.tsx");
  // De bewust verwijderde staafgrafiek was pure SVG; tab 3 kent geen enkele
  // grafiek meer — alleen sobere, herleidbare tabellen (werkopdracht §5).
  // (De term "staafgrafiek" mag wél in de toelichtende comment staan.)
  assert.ok(!/<svg/i.test(src), "tab 3 mag geen grafiek (SVG) bevatten — alleen tabellen");
});

// ── Periode-parameter blijft geen tenant-vector ──────────────────────────────

test("T17 — kwaadaardige periode-invoer faalt op de vormvalidatie", () => {
  for (const kwaad of ["'; drop table fondsen;--", "2026Q2&fonds=b", "../..", ""]) {
    const body = geldigeBiometrie() as Record<string, unknown>;
    body.periode = kwaad;
    assert.equal(valideerBiometrieInvoer(body).ok, false, `biometrie-periode '${kwaad}' geweigerd`);
  }
});
