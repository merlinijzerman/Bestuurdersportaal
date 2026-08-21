// ============================================================================
//  §15-matrix — T14 beheer-invoerlaag stuurinformatie (app-laag).
// ----------------------------------------------------------------------------
//  App-laag-invarianten van de invoerlaag zonder DB:
//    (1) SERVER-SIDE GATES: alle drie de API-routes dragen requireCapability
//        met "stuurinformatie.manage" ÉN weigerAlsModuleUit (bron-inspectie);
//        fonds_id komt uit het profiel, nooit uit de body.
//    (2) AFGELEIDE VELDEN READ-ONLY: de payload-allowlist weigert subtotalen
//        en onbekende keys (pure invariant, valideerBalansInvoer).
//    (3) BALANSEVENWICHT HARD: niet-sluitend → 422-vorm (pure invariant), en
//        de RPC in de migratie herhaalt de check (BALANS_SLUIT_NIET).
//    (4) AUDIT-STRUCTUUR: de migratie definieert het append-only log (geen
//        UPDATE/DELETE-policy; fn_log_append_only-triggers; capture-trigger)
//        en de RPC is SECURITY INVOKER zonder fonds-parameter.
//    (5) PERIODE-PARAMETER IS GEEN TENANT-VECTOR: vorm-validatie + kiesPeriode.
//    (6) GEEN DEELNEMER-PII in migratie én sjabloonvelden.
//  De DB-kant (log-isolatie, append-only, trigger, RPC-rolgate onder échte
//  RLS) staat in supabase/checks/2026_07_17_t14_cross_tenant.sql.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/t14-stuurinfo-invoer.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  valideerBalansInvoer,
  valideerPeriodeInvoer,
} from "../../core/lib/stuurinfo-invoer";
import { SJABLOON_VELDEN } from "../../core/lib/stuurinfo-sjabloon";
import { redenFondsIdNietUitProfiel } from "./route-wrapper-bewust";

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, "..", "..", ...p), "utf8");

const ROUTES = [
  "app/api/stuurinformatie/beheer/route.ts",
  "app/api/stuurinformatie/beheer/upload/route.ts",
  "app/api/stuurinformatie/beheer/sjabloon/route.ts",
];

// ── (1) Server-side gates op alle drie de routes ────────────────────────────

test("T14 — elke invoerlaag-route draagt requireCapability('stuurinformatie.manage') én weigerAlsModuleUit", () => {
  for (const pad of ROUTES) {
    const src = lees(pad);
    assert.ok(
      src.includes("requireCapability(") && src.includes('"stuurinformatie.manage"'),
      `${pad} moet de schrijf-capability server-side afdwingen`
    );
    assert.ok(
      src.includes("weigerAlsModuleUit("),
      `${pad} moet de module-beschikbaarheid server-side afdwingen`
    );
  }
});

// Wrapper-bewust (W4, issue #94): de positieve helft van deze invariant — "het
// fonds komt uit het profiel" — kan op twee plekken staan. Klassiek doet de route
// zelf de `profielen`-select (`profiel?.fonds_id`); na de codemod komt het uit
// `ctx.fondsId`, dat `withFondsRoute` uitsluitend uit `haalProfiel` vult.
// `redenFondsIdNietUitProfiel` kiest per route de juiste eis en verankert de
// wrapper-tak met `toetsWrapperFundament()`. Het patroon schrappen zou de guard
// vals-groen maken: dan bewijst niets meer dát het fonds server-side is afgeleid.
// De negatieve helft (nooit uit de body) blijft hier onverkort staan.
test("T14 — fonds_id komt uit het profiel, nooit uit de request-body", () => {
  for (const pad of ROUTES) {
    const src = lees(pad);
    const reden = redenFondsIdNietUitProfiel(src);
    assert.equal(reden, null, `${pad} moet fonds_id uit het profiel afleiden: ${reden}`);
    assert.ok(
      !/body\s*[.[]\s*["']?fonds_id/.test(src),
      `${pad} mag fonds_id nooit uit de body lezen`
    );
  }
});

test("T14 — de schrijvers geven de RPC géén fonds-parameter mee (fonds volgt auth.uid())", () => {
  const src = lees("core/lib/stuurinfo-beheer.ts");
  assert.ok(src.includes('rpc("stuurinfo_balans_opslaan"'), "schrijver gebruikt de RPC");
  assert.ok(!/p_fonds/.test(src), "de RPC-aanroep mag geen fonds-parameter dragen");
});

// ── (2) Afgeleide velden read-only (exhaustieve allowlist) ──────────────────

const geldigeBody = () => ({
  periode: "2026Q2",
  peildatum: "2026-06-30",
  bron: "handmatig",
  invoer_bron: "handmatig",
  activa: { belegd: 2400, overig: 80 },
  passiva: {
    ev_toets_mvev: 10, ev_toets_oper: 9, ev_toets_overig: 2,
    ev_soli: 78, ev_comp: 41, tv: 2328, vuk: 8, overig: 4,
  },
  reserves: { kostenreserve: 40, ao_reserve: 19, ppwzp_reserve: 7, ppwzp_reserve_eerbiedigend: 0.1 },
  grenzen: { solidariteitsreserve: { ondergrens: 1.5, bovengrens: 5.0 } },
  financieringsgraad: 106.0,
});

test("T14 — afgeleide/subtotaal-keys in de payload worden geweigerd (400-vorm)", () => {
  for (const afgeleid of ["toetsvermogen", "eigen_vermogen", "totaal_passiva"]) {
    const body = geldigeBody() as Record<string, unknown>;
    body.passiva = { ...geldigeBody().passiva, [afgeleid]: 1 };
    const r = valideerBalansInvoer(body);
    assert.equal(r.ok, false, `afgeleid veld '${afgeleid}' moet geweigerd worden`);
    if (!r.ok) assert.equal(r.status, 400);
  }
});

// ── (3) Balansevenwicht hard (app-laag 422 + DB-niveau) ─────────────────────

test("T14 — een niet-sluitende balans levert de 422-vorm (geen write)", () => {
  const body = geldigeBody();
  body.activa.belegd = 9999;
  const r = valideerBalansInvoer(body);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 422);
});

test("T14 — de RPC herhaalt evenwicht + gekoppelde standen op DB-niveau (defense-in-depth)", () => {
  const sql = lees("supabase/migrations/2026_07_17_t14_stuurinfo_invoer_audit.sql");
  assert.ok(sql.includes("BALANS_SLUIT_NIET"), "RPC moet het balansevenwicht in SQL afdwingen");
  assert.ok(sql.includes("GEKOPPELDE_STAND_ONGELIJK"), "RPC moet de gekoppelde standen toetsen");
});

// ── (4) Audit-structuur in de migratie ──────────────────────────────────────

test("T14 — het log is append-only: geen UPDATE/DELETE-policy, wél fn_log_append_only-triggers", () => {
  const sql = lees("supabase/migrations/2026_07_17_t14_stuurinfo_invoer_audit.sql");
  const zonderCommentaar = sql.replace(/--.*$/gm, "").replace(/comment on [\s\S]*?;/gi, "");
  const logPolicies = zonderCommentaar.match(/create policy[\s\S]*?on public\.fonds_stuurinfo_log[\s\S]*?;/gi) ?? [];
  assert.ok(logPolicies.length >= 2, "log heeft select+insert-policies");
  for (const p of logPolicies) {
    assert.ok(
      !/for\s+(update|delete)/i.test(p),
      "het log mag geen UPDATE-/DELETE-policy hebben (deny-by-default)"
    );
  }
  assert.ok(
    /trg_fonds_stuurinfo_log_no_update[\s\S]*?fn_log_append_only/i.test(zonderCommentaar) &&
      /trg_fonds_stuurinfo_log_no_delete[\s\S]*?fn_log_append_only/i.test(zonderCommentaar),
    "immutability-triggers via fn_log_append_only aanwezig"
  );
});

test("T14b — hardening: volledige kolomdekking, actor-check op het log, PUBLIC-revoke, waarde-typecheck", () => {
  const sql = lees("supabase/migrations/2026_07_17_t14b_stuurinfo_audit_hardening.sql");
  assert.ok(
    sql.includes("to_jsonb(new) - 'bijgewerkt'"),
    "capture moet de volledige rij loggen (audit-M1: ook delta/toelichting/populatie_n/invoer_bron)"
  );
  assert.ok(
    sql.includes("gebruiker_id is not distinct from auth.uid()"),
    "log-INSERT-policy moet actor-spoofing weigeren"
  );
  assert.ok(/revoke execute on function public\.stuurinfo_balans_opslaan[\s\S]*?from public/i.test(sql),
    "EXECUTE moet ook van PUBLIC ingetrokken zijn (anon erft PUBLIC)");
  assert.ok(sql.includes("ONGELDIGE_WAARDE"), "RPC moet JSON-null-waarden weigeren");
  assert.ok(sql.includes("ONGELDIGE_BRON"), "RPC moet de bron-allowlist afdwingen");
});

test("T14 — capture-trigger op alle vier de datatabellen; RPC is SECURITY INVOKER zonder fonds-parameter", () => {
  const sql = lees("supabase/migrations/2026_07_17_t14_stuurinfo_invoer_audit.sql");
  for (const tabel of ["periode", "kpi", "reeks", "reserve"]) {
    assert.ok(
      sql.includes(`trg_fonds_stuurinfo_${tabel}_audit`),
      `capture-trigger op fonds_stuurinfo_${tabel} aanwezig`
    );
  }
  const rpc = /create or replace function public\.stuurinfo_balans_opslaan\(([\s\S]*?)\)\s*returns/i.exec(sql);
  assert.ok(rpc, "RPC-definitie gevonden");
  assert.ok(!/fonds/i.test(rpc![1]), "RPC-signatuur mag geen fonds-parameter bevatten");
  assert.ok(/security invoker/i.test(sql), "RPC draait SECURITY INVOKER (RLS blijft gelden)");
});

// ── (5) Periode-parameter is geen tenant-vector ─────────────────────────────

test("T14 — kwaadaardige periode-invoer faalt op de vormvalidatie", () => {
  for (const kwaad of ["'; drop table fondsen;--", "2026Q2&fonds=b", "../..", ""]) {
    const r = valideerPeriodeInvoer({ periode: kwaad, peildatum: "2026-09-30", bron: "handmatig" });
    assert.equal(r.ok, false, `periode '${kwaad}' moet geweigerd worden`);
  }
});

// ── (6) Geen deelnemer-PII in migratie én sjabloon ──────────────────────────

test("T14 — migratie en sjabloonvelden bevatten geen individu-identificator (geen deelnemer-PII)", () => {
  const sql = lees("supabase/migrations/2026_07_17_t14_stuurinfo_invoer_audit.sql")
    .replace(/--.*$/gm, "")
    .replace(/comment on [\s\S]*?;/gi, "")
    .toLowerCase();
  const verboden = ["deelnemer_id", "bsn", "burgerservice", "geboortedat", "voornaam", "achternaam", "adres"];
  for (const kolom of verboden) {
    assert.ok(!new RegExp(`\\b${kolom}\\b`).test(sql), `migratie mag geen '${kolom}' bevatten`);
  }
  for (const veld of SJABLOON_VELDEN) {
    assert.ok(
      ["balans_activa", "balans_passiva", "reserve", "reserve_grens", "kpi"].includes(veld.doel.soort),
      `sjabloonveld '${veld.label}' richt zich op fonds-aggregaat`
    );
  }
});

// ── Suppressie-invariant: de invoerlaag zet nooit populatie_n ────────────────

test("T14 — de invoerlaag schrijft nooit populatie_n (suppressie-leeskant blijft intact)", () => {
  for (const pad of [
    "core/lib/stuurinfo-beheer.ts",
    "supabase/migrations/2026_07_17_t14_stuurinfo_invoer_audit.sql",
  ]) {
    const src = lees(pad).replace(/--.*$/gm, "");
    assert.ok(
      !/populatie_n\s*[=,)]/.test(src) || !/insert[\s\S]*populatie_n/i.test(src),
      `${pad} mag populatie_n niet vullen (blijft NULL op invoerrijen)`
    );
  }
});
