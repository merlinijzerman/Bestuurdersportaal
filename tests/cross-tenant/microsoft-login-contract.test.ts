// ============================================================================
//  Contracttest Microsoft-login fase 1B (#335, T1/PR-A, besluit 0211).
// ----------------------------------------------------------------------------
//  Bron-inspectie (patroon microsoft-connector-contract.test.ts): pint de
//  beveiligingsinvarianten van migratie, rollback, gateway, check-suite en
//  CI-aansluiting. De DB-gedragstoets zelf staat in
//  supabase/checks/2026_09_06_microsoft_login_fase1b.sql (cross-tenant-ci.sh).
// ============================================================================
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const lees = (pad: string) => readFileSync(resolve(root, pad), "utf8");
const migratie = lees("supabase/migrations/2026_09_06_microsoft_login_fase1b.sql");
const rollback = lees("supabase/rollbacks/2026_09_06_microsoft_login_fase1b_ROLLBACK.sql");
const suite = lees("supabase/checks/2026_09_06_microsoft_login_fase1b.sql");
const gateway = lees("core/lib/microsoft-login-gateway.ts");
const gatewayConfig = lees("core/lib/microsoft-login-gateway-config-core.ts");
const bindingCore = lees("core/lib/microsoft-login-binding-core.ts");
const ci = lees("scripts/cross-tenant-ci.sh");
const allowlist = lees("supabase/checks/allowlist-grants.tsv");
const fixture = lees("scripts/testdb-apply-migrations.sh");

const GATEWAY_FUNCTIES = [
  "lees_config", "reserveer_identiteit", "activeer_identiteit", "herstel_koppeling", "markeer_mislukt",
  "start_intrekking", "voltooi_intrekking", "zoek_identiteit", "levende_binding", "markeer_gebruikt",
  "maak_transactie", "consumeer_transactie", "registreer_gebeurtenis",
] as const;

test("F1B: rol-grendel, privaat schema en standaard-uit configuratie", () => {
  assert.match(migratie, /raise exception 'login_gateway-login ontbreekt/);
  assert.match(migratie, /raise exception 'login_hook_owner \(NOLOGIN\) ontbreekt/);
  assert.match(migratie, /revoke all on schema login_private from public, anon, authenticated, service_role/);
  assert.match(migratie, /actief\s+boolean not null default false/);
  assert.match(migratie, /constraint fonds_microsoft_login_actief_vereist_tenant/);
  assert.match(migratie, /select id, false, 'uit' from public\.fondsen/);
  assert.match(migratie, /trg_fonds_microsoft_login_standaard/);
  // Geen schrijfpolicy op de publieke configtabel: alleen twee leespolicies
  // (authenticated eigen fonds; login_hook_owner tenantgebonden voor de helper).
  const policies = migratie.match(/create policy "[^"]+" on public\.fonds_microsoft_login[\s\S]*?;/g) ?? [];
  assert.equal(policies.length, 2);
  assert.ok(policies.every((p) => /for select to (authenticated|login_hook_owner)/.test(p)));
  assert.ok(policies.some((p) => /for select to authenticated[\s\S]*auth\.uid\(\)/.test(p)));
  assert.match(migratie, /trg_fonds_microsoft_login_audit/);
  assert.doesNotMatch(migratie, /set actief = true/i, "de migratie activeert geen enkel fonds");
});

test("F1B: toestandsmodel en unieke levende slots in de database", () => {
  assert.match(migratie, /check \(status in \('pending','active','revoking','revoked','failed'\)\)/);
  assert.match(migratie, /microsoft_identiteiten_levend_per_identiteit[\s\S]*?\(tid, oid\)\s*where status in \('pending','active','revoking'\)/);
  assert.match(migratie, /microsoft_identiteiten_levend_per_account[\s\S]*?\(user_id\)\s*where status in \('pending','active','revoking'\)/);
  assert.match(migratie, /microsoft_identiteiten_pending_vereist_vervaltijd/);
  assert.match(migratie, /profielen p where p\.id = p_user and p\.fonds_id = p_fonds/, "fondsconsistentie bij reserveren");
  assert.match(migratie, /returns table\(id uuid, categorie text\)/, "reserveren raist niet: audit blijft staan");
  assert.match(migratie, /trg_login_audit_no_update/);
  assert.match(migratie, /trg_login_audit_no_delete/);
});

test("F1B: hook is SECURITY INVOKER met lege search_path; alleen de helper is DEFINER onder login_hook_owner", () => {
  const hook = migratie.slice(migratie.indexOf("create or replace function public.fn_access_token_hook"));
  assert.match(hook, /^create or replace function public\.fn_access_token_hook\(event jsonb\) returns jsonb\nlanguage plpgsql set search_path = '' as/);
  assert.doesNotMatch(hook.slice(0, hook.indexOf("$$;")), /security definer/i);
  assert.match(hook, /i\.provider not in \('email','phone'\)/);
  assert.match(hook, /v_aantal <> 1 or v_provider <> 'azure' or v_sub is null or v_tid is null or v_oid is null/);
  assert.match(hook, /identity_data->'custom_claims'->>'tid'/);
  assert.match(hook, /identity_data->'custom_claims'->>'oid'/);
  assert.match(hook, /coalesce\(e->>'method', e #>> '\{\}'\) = 'oauth'/, "refresh via amr");
  assert.match(hook, /exception when others then[\s\S]*'http_code', 403/, "fail-closed bij interne fout");
  assert.doesNotMatch(hook, /raise (notice|log|warning)/i, "de hook logt niets");
  assert.match(migratie, /revoke all on function public\.fn_access_token_hook\(jsonb\) from public, anon, authenticated, service_role/);
  assert.match(migratie, /grant execute on function public\.fn_access_token_hook\(jsonb\) to supabase_auth_admin/);
  assert.match(migratie, /grant usage on schema public to supabase_auth_admin/);
  // helper
  assert.match(migratie, /set local role login_hook_owner;\n(?:--[^\n]*\n)*create or replace function login_private\.identiteit_toegestaan/);
  assert.match(migratie, /identiteit_toegestaan[\s\S]*?returns boolean language sql security definer set search_path = '' stable/);
  assert.match(migratie, /b\.sub = p_sub and b\.tid = p_tid and b\.oid = p_oid/);
  // Actuele stand: profiel in het fonds van de binding, config actief, tenant gelijk.
  assert.match(migratie, /join public\.profielen p\s+on p\.id = b\.user_id and p\.fonds_id = b\.fonds_id/);
  assert.match(migratie, /join public\.fonds_microsoft_login c\s+on c\.fonds_id = b\.fonds_id\s+and c\.actief = true\s+and pg_catalog\.lower\(c\.entra_tenant_id\) = pg_catalog\.lower\(b\.tid\)/);
  // Minimale kolomrechten + tenantgebonden policies voor login_hook_owner.
  assert.match(migratie, /grant select \(id, fonds_id\) on public\.profielen to login_hook_owner/);
  assert.match(migratie, /grant select \(fonds_id, actief, entra_tenant_id\) on public\.fonds_microsoft_login to login_hook_owner/);
  assert.match(migratie, /create policy "hook owner leest profiel fonds" on public\.profielen\n\s+for select to login_hook_owner using \(fonds_id is not null\)/);
  assert.match(migratie, /create policy "hook owner leest loginconfig" on public\.fonds_microsoft_login\n\s+for select to login_hook_owner using \(fonds_id is not null\)/);
  assert.doesNotMatch(migratie, /grant (select|all) on public\.profielen to login_hook_owner/, "geen tabelbrede SELECT op profielen");
  assert.match(migratie, /grant usage on schema public to login_hook_owner/);
  // Reserveren dwingt dezelfde configuratie vroeg af.
  assert.match(migratie, /'login_uit'::text/);
  assert.match(migratie, /'tenant_mismatch'::text/);
  assert.match(migratie, /revoke all on function login_private\.identiteit_toegestaan\(uuid, text, text, text\) from public, anon, authenticated, service_role, login_gateway/);
  assert.match(migratie, /grant execute on function login_private\.identiteit_toegestaan\(uuid, text, text, text\) to supabase_auth_admin/);
  assert.match(migratie, /create policy "hook owner leest bindingen" on login_private\.microsoft_identiteiten\n\s+for select to login_hook_owner using \(true\)/);
  assert.match(migratie, /grant select on login_private\.microsoft_identiteiten to login_hook_owner/);
  assert.match(migratie, /revoke create on schema login_private from login_hook_owner/);
  assert.match(migratie, /revoke login_hook_owner from postgres/);
});

test("F1B: login_gateway mag exact de dertien gatewayfuncties uitvoeren en niets anders", () => {
  for (const f of GATEWAY_FUNCTIES) {
    assert.match(migratie, new RegExp(`grant execute on function login_private\\.${f}\\([^)]*\\)\\s+to login_gateway`), f);
  }
  const grants = migratie.match(/grant execute on function login_private\.[a-z_]+\([^)]*\)\s+to login_gateway/g) ?? [];
  assert.equal(grants.length, GATEWAY_FUNCTIES.length);
  assert.doesNotMatch(migratie, /identiteit_toegestaan\([^)]*\)\s+to login_gateway/);
  assert.doesNotMatch(migratie, /verval_verlopen_reserveringen\(\)\s+to login_gateway/);
  assert.match(migratie, /revoke all on all tables\s+in schema login_private from public, anon, authenticated, service_role/);
  assert.match(migratie, /revoke all on all functions in schema login_private from public, anon, authenticated, service_role/);
  assert.match(migratie, /alter default privileges in schema login_private revoke all on tables\s+from public, anon, authenticated, service_role/);
  assert.doesNotMatch(migratie, /grant (select|insert|update|delete|all)[^;]* on login_private\.[a-z_]+ to login_gateway/);
});

test("F1B: gateway is server-only, gebruikt alleen login_private-functies en geen service-role of Graph", () => {
  assert.match(gateway, /^import "server-only";/m);
  assert.doesNotMatch(gateway, /SUPABASE_SERVICE_ROLE_KEY|supabase-platform|service_role|createClient\(/i);
  assert.doesNotMatch(gateway, /graph\.microsoft\.com/);
  assert.doesNotMatch(gateway, /from "[^"]*microsoft-(vault|connector|config)[^"]*"/, "login-gateway importeert niets uit het Graph-connectordomein");
  assert.match(gateway, /LOGIN_GATEWAY_DATABASE_URL/);
  assert.match(gateway, /rejectUnauthorized: true/);
  assert.match(gateway, /max: 2/);
  const aanroepen = [...gateway.matchAll(/login_private\.([a-z_]+)\(/g)].map((m) => m[1]!);
  assert.ok(aanroepen.length >= GATEWAY_FUNCTIES.length);
  for (const f of aanroepen) assert.ok((GATEWAY_FUNCTIES as readonly string[]).includes(f), `gateway roept ${f} aan, niet in de allowlist`);
  assert.doesNotMatch(gateway, /from login_private\.[a-z_]+\s+where|insert into login_private|update login_private|delete from login_private/i, "geen directe tabeltoegang");
  assert.doesNotMatch(gateway, /console\.(log|error|warn)/, "de gateway logt niets (categorieën via de aanroeper)");
  assert.match(gateway, /gatewayFoutcategorie\(fout\)/);
  assert.match(gatewayConfig, /LOGIN_GATEWAY|Login-gateway/);
  assert.match(gatewayConfig, /SEED_DOELOMGEVING|doelomgeving !== "local"/);
  assert.match(bindingCore, /pending: \["active", "failed"\]/);
  assert.match(bindingCore, /"login_uit",\n\s+"tenant_mismatch"/);
  assert.match(bindingCore, /revoked: \[\]/);
});

test("F1B: rollback is fail-closed op auditverlies en zet login_gateway op NOLOGIN", () => {
  assert.match(rollback, /raise exception 'login_private\.audit_log bevat % regels/);
  assert.match(rollback, /alter role login_gateway nologin/);
  assert.match(rollback, /drop function if exists public\.fn_access_token_hook\(jsonb\)/);
  assert.match(rollback, /drop table if exists public\.fonds_microsoft_login/);
  assert.match(rollback, /drop schema if exists login_private cascade/);
  assert.match(rollback, /revoke login_hook_owner from postgres/);
  assert.match(rollback, /drop policy if exists "hook owner leest profiel fonds" on public\.profielen/);
  assert.match(rollback, /revoke all on public\.profielen from login_hook_owner/);
  assert.match(rollback, /revoke usage on schema public from login_hook_owner/);
  assert.doesNotMatch(rollback, /drop role/i, "rollen blijven bestaan (patroon microsoft_vault)");
});

test("F1B: check-suite is aangesloten in cross-tenant-ci.sh, met ROL-regel en de verplichte scenario's", () => {
  assert.match(ci, /SQL_M365F1B="supabase\/checks\/2026_09_06_microsoft_login_fase1b\.sql"/);
  assert.match(ci, /psql "\$DB_URL" -v ON_ERROR_STOP=1 -f "\$SQL_M365F1B"/);
  assert.match(suite, /^--\s*ROL:\s*postgres/m);
  for (const scenario of [
    "H1: wachtwoordsessie passeert ongewijzigd", "H2: oauth zonder identiteit → 403", "H3: identiteit zonder binding → 403",
    "H4: pending voor A staat identiteit B niet toe", "H5: geldige pending voor exact deze identiteit → toegestaan",
    "H6: verlopen pending → 403", "H7: active → toegestaan", "H7b: refresh bij active → toegestaan",
    "H8a: tid wijkt af → 403", "H8b: oid wijkt af → 403", "H8c: oid ontbreekt → 403", "H8e: sub (provider_id) wijkt af → 403",
    "H9a: twee OAuth-identiteiten → 403", "H9b: alleen google-identiteit → 403", "H10a: revoking → 403", "H10b: revoked → 403",
    "H10c: failed → 403", "H11: helperfout → 403 (fail-closed)", "H12: reserveren onder een ander fonds dan het profiel wordt geweigerd",
    "H13a: dezelfde tid+oid voor een ander account/fonds wordt geweigerd", "H13b: tweede levende identiteit voor hetzelfde account wordt geweigerd",
    "H15: replay levert niets", "H16: update op audit_log had moeten falen", "H17: login_gateway kon de bindingstabel lezen",
    "H17: authenticated kon een gatewayfunctie uitvoeren", "H17: service_role kon de bindingstabel lezen", "H17: authenticated ziet alleen eigen fondsconfig",
    "H18: actief zonder tenant had moeten falen",
    "H19: actieve correcte binding → toegestaan", "H20: profiel naar ander fonds → 403", "H20: refresh na fondsverplaatsing → 403",
    "H21: flag uit → initiële uitgifte 403", "H21: flag uit → refresh 403", "H21: binding blijft bestaan bij flag uit",
    "H21: reserveren bij flag uit → login_uit", "H22: andere geconfigureerde tenant → 403", "H22: reserveren met afwijkende tenant → tenant_mismatch",
    "H22b: binding-tid ≠ geconfigureerde tenant → 403", "H23: ontbrekende fondsconfiguratie → 403",
    "H24: flag/tenant/fonds hersteld → toegestaan", "H24: wachtwoordsessie onaangeroerd", "H11b: echte helper hersteld → toegestaan",
  ]) {
    assert.ok(suite.includes(scenario), `scenario ontbreekt in de suite: ${scenario}`);
  }
  assert.match(suite, /^rollback;\s*$/m, "DEEL 2 laat niets achter");
});

test("F1B: publieke objecten staan in de grants-allowlist; lokale fixture provisioneert beide rollen", () => {
  for (const regel of [
    "FUNC\tpublic\tfn_access_token_hook(event jsonb)\tfunction\tanon\t-",
    "FUNC\tpublic\tfn_access_token_hook(event jsonb)\tfunction\tauthenticated\t-",
    "FUNC\tpublic\tfn_access_token_hook(event jsonb)\tfunction\tservice_role\t-",
    "FUNC\tpublic\tfn_fonds_microsoft_login_audit()\tfunction\tservice_role\t-",
    "FUNC\tpublic\tfn_fonds_microsoft_login_standaard()\tfunction\tanon\t-",
    "REL\tpublic\tfonds_microsoft_login\ttable\tanon\t-",
    "REL\tpublic\tfonds_microsoft_login\ttable\tauthenticated\tSELECT",
  ]) {
    assert.ok(allowlist.includes(regel), `allowlist mist: ${regel.replace(/\t/g, " | ")}`);
  }
  assert.match(fixture, /create role login_gateway\s+login/);
  assert.match(fixture, /create role login_hook_owner\s+nologin/);
});
