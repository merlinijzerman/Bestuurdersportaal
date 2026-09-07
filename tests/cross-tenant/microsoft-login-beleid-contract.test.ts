// ============================================================================
//  Contracttest Microsoft-loginbeleid fase 1C (#344, PR-A, besluit 0212).
// ----------------------------------------------------------------------------
//  Bron-inspectie (patroon microsoft-login-contract.test.ts): pint de
//  beveiligingsinvarianten van migratie, rollback, gateway, guard, routes en
//  CI-aansluiting. Het GEDRAG in de database staat in
//  supabase/checks/2026_09_07_microsoft_login_beleidsmodus.sql (cross-tenant-ci.sh);
//  de pure beslisregels in core/lib/microsoft-login-beleid-core.sanity.ts.
// ============================================================================
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const lees = (pad: string) => readFileSync(resolve(root, pad), "utf8");
const migratie = lees("supabase/migrations/2026_09_07_microsoft_login_beleidsmodus.sql");
const rollback = lees("supabase/rollbacks/2026_09_07_microsoft_login_beleidsmodus_ROLLBACK.sql");
const suite = lees("supabase/checks/2026_09_07_microsoft_login_beleidsmodus.sql");
const gateway = lees("core/lib/microsoft-login-gateway.ts");
const guard = lees("core/lib/microsoft-login-sessieguard.ts");
const beleidCore = lees("core/lib/microsoft-login-beleid-core.ts");
const koppelingRoute = lees("app/api/microsoft-login/koppeling/route.ts");
const koppelStart = lees("app/api/microsoft-login/koppelen/start/route.ts");
const loginForm = lees("app/login/_components/LoginForm.tsx");
const ci = lees("scripts/cross-tenant-ci.sh");
const capabilities = lees("core/lib/capabilities-map.ts");

const GATEWAY_FUNCTIES_1C = [
  "activering_preflight", "zet_modus", "dekkingsrapport", "beheer_intrekking",
  "verleen_break_glass", "trek_break_glass_in", "maak_uitnodiging", "activeer_uitnodiging",
  "trek_uitnodiging_in", "sessiebeleid",
] as const;

test("1C: modus is de bron, actief de spiegel; migratie is deterministisch en idempotent", () => {
  assert.match(migratie, /add column if not exists modus text not null default 'uit'/);
  assert.match(migratie, /check \(modus in \('uit','optioneel','verplicht'\)\)/);
  assert.match(migratie, /check \(actief = \(modus <> 'uit'\)\)/, "spiegelconstraint maakt drift onmogelijk");
  // De eenmalige backfill: actief → optioneel (gedragsneutraal), rest uit. Achter
  // een guard op de spiegelconstraint, zodat een herhaalde run een gezette
  // `verplicht` niet terugzet naar `optioneel`.
  assert.match(migratie, /set modus = case when actief then 'optioneel' else 'uit' end/);
  assert.match(migratie, /if not exists \(select 1 from pg_constraint where conname = 'fonds_microsoft_login_modus_spiegelt_actief'\) then\s*\n\s*update public\.fonds_microsoft_login/);
  assert.match(migratie, /drop column if exists pilotstatus/);
  assert.doesNotMatch(migratie, /set modus = 'verplicht'/i, "de migratie zet geen enkel fonds op verplicht");
});

test("1C: het wachtwoordpad wordt in de hook getoetst, met een fail-closed richting die geen fonds buitensluit", () => {
  // De hook leest auth.mfa_factors zelf (hij draait als supabase_auth_admin), zodat
  // login_hook_owner geen enkel recht in het auth-schema nodig heeft.
  assert.match(migratie, /from auth\.mfa_factors f where f\.user_id = v_user and f\.status = 'verified'/);
  assert.match(migratie, /login_private\.wachtwoordlogin_toegestaan\(v_user, v_mfa\)/);
  assert.doesNotMatch(migratie, /grant select[^;]*on auth\.mfa_factors/i, "de hookeigenaar krijgt geen auth-rechten");
  // Alleen een expliciete `verplicht` sluit het wachtwoordpad: geen profiel of geen
  // configrij → toegestaan (een afwezig beleid is nooit het strengste beleid).
  assert.match(migratie, /returns boolean language sql security definer set search_path = '' stable as \$\$\s*\n\s*select not exists \(/);
  assert.match(migratie, /and c\.modus = 'verplicht'/);
  // Uitzonderingen: MFA-plichtige break-glass of een geopend koppelvenster.
  assert.match(migratie, /coalesce\(p_heeft_mfa, false\) and exists \(\s*\n\s*select 1 from login_private\.break_glass g/);
  assert.match(migratie, /u\.geactiveerd_op is not null and u\.venster_tot > pg_catalog\.now\(\)/);
  // Niet-oauth zonder user_id is niet te beoordelen → weigeren.
  assert.match(migratie, /if v_user is null then return v_weiger_wachtwoord; end if;/);
  // De hook blijft SECURITY INVOKER met leeg pad en alleen supabase_auth_admin.
  assert.match(migratie, /create or replace function public\.fn_access_token_hook\(event jsonb\) returns jsonb\s*\nlanguage plpgsql set search_path = ''/);
  assert.match(migratie, /grant execute on function public\.fn_access_token_hook\(jsonb\) to supabase_auth_admin/);
});

test("1C: break-glass is minimaal, niet zelf toe te kennen en MFA-plichtig", () => {
  assert.match(migratie, /constraint break_glass_niet_zelf check \(user_id <> uitgegeven_door\)/);
  assert.match(migratie, /constraint break_glass_geldigheid check \(geldig_tot > uitgegeven_op\)/);
  assert.match(migratie, /reden_categorie text not null check \(reden_categorie in \('entra_storing','beheerherstel','migratie'\)\)/,
    "vaste categorieën, geen vrij tekstveld");
  assert.match(migratie, /if p_user = p_actor then[\s\S]{0,400}?'zelf_toekennen'/);
  // De preflight telt alleen uitzonderingen met een GEVERIFIEERDE factor, en faalt
  // gesloten als auth.mfa_factors niet leesbaar is (geen aanname).
  assert.match(migratie, /has_table_privilege\(current_user, 'auth\.mfa_factors', 'select'\)/);
  assert.match(migratie, /'breakglass_onverifieerbaar'/);
  assert.match(migratie, /exists \(select 1 from auth\.mfa_factors f where f\.user_id = g\.user_id and f\.status = 'verified'\)/,
    "de preflight telt alleen uitzonderingen met een geverifieerde factor");
});

test("1C: de beperkte koppel-/herstelsessie bewaart alleen een hash en is eenmalig", () => {
  assert.match(migratie, /constraint herkoppel_token_is_hash check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.doesNotMatch(migratie, /token text|p_token text[^_]/, "het token zelf staat nergens in het datamodel");
  // Atomisch en eenmalig: de update slaagt hooguit één keer per token.
  assert.match(migratie, /update herkoppel_uitnodigingen u\s*\n\s*set geactiveerd_op = now\(\)[\s\S]{0,400}?and u\.geactiveerd_op is null/);
  // Tenantdrift laat de uitnodiging vervallen.
  assert.match(migratie, /'herkoppelen\.geweigerd', 'tenant_mismatch'/);
  // Het venster sluit zodra tid+oid actief gekoppeld is — in beide activeringspaden.
  assert.equal((migratie.match(/update herkoppel_uitnodigingen set voltooid_op = now\(\)/g) ?? []).length, 2);
  // De app levert uitsluitend de hash aan.
  assert.match(gateway, /if \(!\/\^\[0-9a-f\]\{64\}\$\/\.test\(args\.tokenHash\)\) throw new MicrosoftLoginGatewayError\("gateway_fout"\);/);
});

test("1C: activering naar `verplicht` is transactioneel, vergrendeld en fail-closed", () => {
  assert.match(migratie, /perform pg_advisory_xact_lock\(hashtext\('microsoft_login_beleid'\), hashtext\(p_fonds::text\)\)/);
  assert.match(migratie, /from public\.fonds_microsoft_login c where c\.fonds_id = p_fonds for update/, "de configrij wordt vergrendeld");
  assert.match(migratie, /select \* into v_pre from activering_preflight\(p_fonds\);\s*\n\s*if not v_pre\.gereed then/,
    "de preflight draait ÍN de schrijftransactie: een race faalt gesloten");
  assert.match(migratie, /'beleid\.activering_geweigerd', v_pre\.categorie/);
  assert.match(migratie, /return v_pre\.categorie;/);
});

test("1C: persoonlijk ontkoppelen is server-side dicht in `verplicht`", () => {
  // In de database (het echte slot) …
  assert.match(migratie, /'ontkoppelen\.geweigerd', 'ontkoppelen_verplicht'/);
  assert.match(migratie, /return query select null::uuid, 'ontkoppelen_verplicht'::text; return;/,
    "geeft een categorie terug in plaats van te raisen, zodat de audit blijft staan");
  // … én in de route, met de backstop op de gatewaycategorie.
  assert.match(koppelingRoute, /if \(!beleid \|\| !magZelfOntkoppelen\(beleid\.modus, beleid\.linkOnly\)\)/);
  assert.match(koppelingRoute, /if \(categorie === "ontkoppelen_verplicht"\)/);
  assert.match(koppelStart, /if \(!beleid \|\| !magZelfKoppelen\(beleid\.modus, beleid\.linkOnly\)\)/);
});

test("1C: guard L3 beoordeelt élke sessie, ongecachet, met de juiste fail-richting", () => {
  assert.match(guard, /^import "server-only";/m);
  assert.match(guard, /export async function beoordeelPortaalSessie/);
  assert.match(guard, /await sessiebeleid\(gebruikerId\)/);
  assert.match(guard, /BEWUST ONGECACHET/);
  assert.doesNotMatch(guard, /new Map\(|maak[A-Za-z]*Cache|ttlMs|TTL_MS/, "geen cachelaag: intrekken werkt bij het eerstvolgende verzoek");
  assert.match(guard, /categorie === "config_ontbreekt" \? "config" : "fout"/);
  // De pure kern: fout = dicht, ontbrekende configuratie = het wachtwoordpad zoals het was.
  assert.match(beleidCore, /if \(uitval === "fout"\) return \{ toegestaan: false, reden: "gateway-fout" \};/);
  assert.match(beleidCore, /return args\.isOAuth\s*\n\s*\? \{ toegestaan: false, reden: "gateway-fout" \}\s*\n\s*: \{ toegestaan: true, reden: "gateway-niet-geconfigureerd" \};/);
});

test("1C: geen browserpad naar beleid, tenant of binding; capability is smal", () => {
  // De configuratietabel houdt exact twee leespolicies en geen schrijfpolicy.
  assert.doesNotMatch(migratie, /create policy[\s\S]{0,200}?for (insert|update|delete|all) on public\.fonds_microsoft_login/i);
  assert.doesNotMatch(migratie, /grant (insert|update|delete)[^;]*on public\.fonds_microsoft_login to (anon|authenticated|service_role)/i);
  // De nieuwe private tabellen zijn voor élke rol dicht, ook voor de gatewayrol.
  for (const tabel of ["break_glass", "herkoppel_uitnodigingen"]) {
    assert.match(migratie, new RegExp(`revoke all on login_private\\.${tabel} from public, anon, authenticated, service_role, login_gateway`), tabel);
    assert.match(migratie, new RegExp(`alter table login_private\\.${tabel} enable row level security`), tabel);
  }
  // Elke nieuwe functie: EXECUTE uitsluitend voor login_gateway.
  for (const f of GATEWAY_FUNCTIES_1C) {
    assert.match(migratie, new RegExp(`revoke all on function login_private\\.${f}\\([^)]*\\)\\s+from public, anon, authenticated, service_role`), f);
    assert.match(migratie, new RegExp(`grant execute on function login_private\\.${f}\\([^)]*\\)\\s+to login_gateway`), f);
  }
  // De hookhelper is voor de gatewayrol NIET uitvoerbaar.
  assert.match(migratie, /revoke all on function login_private\.wachtwoordlogin_toegestaan\(uuid, boolean\) from public, anon, authenticated, service_role, login_gateway/);
  assert.match(migratie, /grant execute on function login_private\.wachtwoordlogin_toegestaan\(uuid, boolean\) to supabase_auth_admin/);
  // Bevoegdheid: één smalle capability, uitsluitend voor de beheerder.
  assert.match(capabilities, /\| "login\.beleid\.manage"/);
  const voorzitterBlok = capabilities.slice(capabilities.indexOf("  voorzitter: ["), capabilities.indexOf("  bestuurder: ["));
  assert.doesNotMatch(voorzitterBlok, /login\.beleid\.manage/, "de voorzitter draagt de loginbeleid-gate niet");
});

test("1C: meldingen zijn neutraal en verraden geen account", () => {
  assert.match(migratie, /'message', 'Voor deze omgeving logt u in met Microsoft\.'/);
  assert.match(loginForm, /error\.status === 403 \? LOGIN_VERPLICHT_MELDING/);
  // Geen claims, tokens, e-mail of state in de audit van het beleidspad.
  assert.doesNotMatch(migratie, /insert into audit_log[^;]*email/i);
  assert.doesNotMatch(migratie, /p_token\b(?!_hash)/, "alleen de hash bereikt de database");
});

test("1C: rollback zet de F1B-vorm terug en de suite hangt in de gate", () => {
  assert.match(rollback, /add column if not exists pilotstatus text not null default 'uit'/);
  assert.match(rollback, /drop column if exists modus/);
  assert.match(rollback, /drop function if exists login_private\.wachtwoordlogin_toegestaan\(uuid, boolean\)/);
  for (const f of GATEWAY_FUNCTIES_1C) {
    assert.match(rollback, new RegExp(`drop function if exists login_private\\.${f}\\(`), f);
  }
  assert.match(rollback, /drop table if exists login_private\.herkoppel_uitnodigingen/);
  assert.match(rollback, /drop table if exists login_private\.break_glass/);
  // De hook keert terug naar "niet-oauth passeert onvoorwaardelijk".
  assert.match(rollback, /if not v_oauth then\s*\n\s*return event;\s*\n\s*end if;/);
  assert.match(ci, /2026_09_07_microsoft_login_beleidsmodus\.sql/, "check-suite aangesloten in de gate");
  assert.match(suite, /rollback;\s*$/, "de gedragssuite laat niets achter");
});
