// ============================================================================
//  §15 — T6 auditdossier-afschrift: toegang & tenant-isolatie (app-laag).
// ----------------------------------------------------------------------------
//  Twee lagen, zoals overal in dit project:
//   • App-laag (dit bestand): bron-inspectie op de routes/worker + de migratie.
//     Bewijst dat de gates AANWEZIG zijn en dat het jobmodel de service-role
//     uitsluitend in de worker gebruikt.
//   • DB-laag: supabase/checks/2026_08_09_afschriften_xtenant.sql — daar wordt
//     onder échte RLS bewezen dat fonds B niets van fonds A ziet en dat het
//     bureau de zip niet uit storage kan trekken.
//
//  Draaien: node --import tsx --test tests/cross-tenant/afschrift-toegang.test.ts
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, "..", "..", ...p), "utf8");

const USER_ROUTES: { pad: string[]; wat: string }[] = [
  { pad: ["app", "api", "procedures", "[id]", "afschrift", "route.ts"], wat: "aanmaken" },
  { pad: ["app", "api", "procedures", "[id]", "afschriften", "route.ts"], wat: "lijst" },
  { pad: ["app", "api", "procedures", "[id]", "afschriften", "[afschriftId]", "download", "route.ts"], wat: "download" },
  { pad: ["app", "api", "procedures", "[id]", "afschriften", "[afschriftId]", "route.ts"], wat: "intrekken" },
];

// ── (1) De user-routes draaien onder de RLS-client, NOOIT service-role ──────

test("AFS-1 — elke user-route gebruikt createServerSupabase (RLS), niet de service-role", () => {
  for (const { pad, wat } of USER_ROUTES) {
    const bron = lees(...pad);
    assert.ok(
      bron.includes("createServerSupabase("),
      `${pad.join("/")} (${wat}) gebruikt de RLS-client niet`
    );
    assert.ok(
      !bron.includes("createServiceSupabase") && !bron.includes("SUPABASE_SERVICE_ROLE_KEY"),
      `${pad.join("/")} (${wat}) raakt de service-role — dat mag alleen de worker`
    );
  }
});

// ── (2) Bureau-gate op genereren én downloaden (ontwerpbeslissing 4) ────────

test("AFS-2 — aanmaken en downloaden weigeren de bureau-rol server-side met 403", () => {
  for (const naam of ["afschrift", "download"]) {
    const pad =
      naam === "afschrift"
        ? ["app", "api", "procedures", "[id]", "afschrift", "route.ts"]
        : ["app", "api", "procedures", "[id]", "afschriften", "[afschriftId]", "download", "route.ts"];
    const bron = lees(...pad);
    assert.ok(bron.includes("isBureauRol("), `${naam}: bureau-gate ontbreekt`);
    assert.match(
      bron,
      /isBureauRol\([\s\S]{0,120}?\)\s*\)\s*\{[\s\S]{0,200}?status:\s*403/,
      `${naam}: weigert niet met 403`
    );
  }
});

// ── (3) De host↔fonds-guard staat op de muterende/gevoelige routes ──────────

test("AFS-3 — aanmaken, download en intrekken dwingen host↔fonds af", () => {
  for (const pad of [
    ["app", "api", "procedures", "[id]", "afschrift", "route.ts"],
    ["app", "api", "procedures", "[id]", "afschriften", "[afschriftId]", "download", "route.ts"],
    ["app", "api", "procedures", "[id]", "afschriften", "[afschriftId]", "route.ts"],
  ]) {
    const bron = lees(...pad);
    assert.ok(bron.includes("beoordeelRouteHostToegang("), `${pad.join("/")} mist de host-guard`);
  }
});

// ── (4) De worker is CRON-only + service-role + app-surface-skip ────────────

test("AFS-4 — de worker-route is CRON-secret-gated en draait alleen in het beheer-project", () => {
  const bron = lees("app", "api", "internal", "afschrift-worker", "route.ts");
  assert.ok(bron.includes("CRON_SECRET"), "worker mist de CRON_SECRET-gate");
  assert.ok(bron.includes("timingSafeEqual"), "worker vergelijkt het secret niet constant-time");
  assert.ok(bron.includes('process.env.DEPLOY_TARGET === "app"'), "worker skipt de app-surface niet");
  assert.ok(bron.includes("createServiceSupabase("), "worker gebruikt de service-role niet");
});

// ── (5) De download mint de signed URL onder de user-sessie ─────────────────

test("AFS-5 — de download mint de signed URL onder de RLS-client (storage-policy geldt)", () => {
  const bron = lees("app", "api", "procedures", "[id]", "afschriften", "[afschriftId]", "download", "route.ts");
  assert.match(
    bron,
    /createSignedUrl/,
    "de download maakt geen signed URL"
  );
  // De signed URL wordt op `supabase` (createServerSupabase) gemaakt, niet op een
  // service-client — zodat de storage-leespolicy (eigen fonds + niet-bureau) geldt.
  assert.ok(!bron.includes("createServiceSupabase"), "download gebruikt service-role → omzeilt storage-RLS");
});

// ── (6) Intrekken raakt uitsluitend ingetrokken_* (freeze-trigger-conform) ──

test("AFS-6 — intrekken update alleen de ingetrokken_*-velden (geen delete)", () => {
  const bron = lees("app", "api", "procedures", "[id]", "afschriften", "[afschriftId]", "route.ts");
  assert.ok(bron.includes(".update({"), "intrekken doet geen update");
  assert.ok(!/\.delete\(\)/.test(bron), "intrekken mag geen delete uitvoeren");
  const updateBlok = bron.slice(bron.indexOf(".update({"), bron.indexOf(".update({") + 300);
  assert.ok(updateBlok.includes("ingetrokken_op"), "intrekken zet ingetrokken_op niet");
  // Geen integriteitsveld in dezelfde update (freeze-trigger zou dat weigeren).
  for (const verboden of ["sha256", "opslag_pad", "status:", "bytes"]) {
    assert.ok(!updateBlok.includes(verboden), `intrekken raakt bevroren veld ${verboden}`);
  }
});

// ── (7) De migratie: RLS-patroon, bureau-uitsluiting, geen delete-policy ────

test("AFS-7 — de migratie draagt het tenant-RLS-patroon met bureau-uitsluiting en géén delete", () => {
  const m = lees("supabase", "migrations", "2026_08_09_procedure_afschriften.sql");
  // Tenant-predicaat (schema-brede vorm).
  assert.ok(
    m.includes("fonds_id = (select fonds_id from public.profielen where id = auth.uid())"),
    "het tenant-predicaat wijkt af van de schema-brede vorm"
  );
  // SELECT/INSERT/UPDATE aanwezig; INSERT + storage-read sluiten bureau uit.
  assert.ok(m.includes('create policy "fonds afschriften lezen"'));
  assert.ok(m.includes('create policy "fonds afschriften aanmaken"'));
  assert.ok(m.includes('create policy "fonds afschriften bijwerken"'));
  assert.ok(m.includes('create policy "afschriften storage lezen"'));
  const bureauUitsluitingen = m.match(/is distinct from 'bestuursbureau'/g) ?? [];
  assert.ok(bureauUitsluitingen.length >= 2, `verwacht ≥2 bureau-uitsluitingen (insert + storage), gevonden ${bureauUitsluitingen.length}`);
  // GEEN delete-policy + append-only trigger.
  assert.ok(!/for\s+delete/.test(m), "er mag geen delete-policy zijn");
  assert.ok(m.includes("before delete on public.procedure_afschriften"), "no-delete-trigger ontbreekt");
  // De claim-RPC is service-role-only (gate H).
  assert.ok(
    m.includes("revoke execute on function public.afschriften_claim_jobs(text, integer, integer)\n  from public, anon, authenticated"),
    "de claim-RPC is niet ingetrokken van anon/authenticated"
  );
});

test("AFS-8 — de hardening dicht de grants (H1) en bevriest de integriteitskolommen (M1)", () => {
  const h = lees("supabase", "migrations", "2026_08_09_procedure_afschriften_hardening.sql");
  assert.ok(h.includes("revoke all on public.procedure_afschriften from anon"), "anon-grants niet ingetrokken (TRUNCATE-gat)");
  assert.ok(h.includes("fn_afschrift_bevries_kolommen"), "kolom-freeze-trigger ontbreekt");
  assert.ok(h.includes("before update on public.procedure_afschriften"), "freeze-trigger niet op UPDATE gezet");
  // Bureau ook van UPDATE uitgesloten (M2).
  assert.ok(h.includes("is distinct from 'bestuursbureau'"), "bureau niet van UPDATE uitgesloten");
});
