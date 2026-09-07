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
  "trek_uitnodiging_in", "sessiebeleid", "open_breakglass_venster", "breakglass_overzicht",
] as const;

/** Elke functie die de DEKKING van een fonds kan veranderen neemt dezelfde
 *  advisory lock; anders kan zij tussen de activeringspreflight en de omslag naar
 *  `verplicht` glippen (reviewbevinding 2). */
const DEKKINGSMUTATIES = [
  "zet_modus", "beheer_intrekking", "verleen_break_glass", "trek_break_glass_in",
  "maak_uitnodiging", "activeer_uitnodiging", "trek_uitnodiging_in", "start_intrekking",
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

test("1C: een uitzonderingssessie krijgt een BEPERKTE rol, geen portaaltoegang", () => {
  // De hook schaalt af naar een rol die niets mag; PostgREST doet daar `set role`
  // op, dus de begrenzing zit in de database en niet in de app.
  assert.match(migratie, /jsonb_set\(event, '\{claims,role\}', '"portaal_beperkt"'::jsonb, true\)/);
  assert.match(migratie, /if v_niveau = 'vol' then return event; end if;/);
  // De rol bestaat, is lid van authenticator en heeft precies één leesrecht.
  assert.match(migratie, /raise exception 'portaal_beperkt \(NOLOGIN\) ontbreekt/);
  assert.match(migratie, /raise exception 'portaal_beperkt is geen lid van authenticator/);
  assert.match(migratie, /grant select \(id, fonds_id, rol, naam\) on public\.profielen to portaal_beperkt;/);
  assert.match(migratie, /create policy "beperkte sessie leest eigen profiel" on public\.profielen\s*\n\s*for select to portaal_beperkt using \(id = \(select auth\.uid\(\)\)\);/);
  for (const revoke of [
    /revoke all on all tables\s+in schema public\s+from portaal_beperkt;/,
    /revoke all on all functions in schema public\s+from portaal_beperkt;/,
    /revoke all on all tables\s+in schema storage from portaal_beperkt;/,
    /revoke usage on schema storage from portaal_beperkt;/,
    /revoke usage on schema login_private from portaal_beperkt;/,
  ]) assert.match(migratie, revoke);
  // De app volgt: een beperkte sessie komt niet voorbij de wrapper of de layouts.
  assert.match(lees("core/lib/route-wrapper.ts"), /if \(sessieOordeel\.beperkt === true\)[\s\S]{0,220}?magBeperkteSessieRoute\(new URL\(request\.url\)\.pathname\)\) return nietIngelogd\(\);/);
  assert.match(lees("core/lib/fonds-sessie.ts"), /if \(sessieOordeel\.beperkt\) redirect\(BEPERKTE_SESSIE_PAD\);/);
  assert.match(lees("app/(dashboard)/layout.tsx"), /if \(sessieOordeel\.beperkt\) redirect\(BEPERKTE_SESSIE_PAD\);/);
  // En de rolclaim is bindend, ook als het beleid iets anders zou zeggen.
  assert.match(beleidCore, /if \(args\.rol === ROL_BEPERKT\) \{/);
});

test("1C: alle dekkingsmutaties nemen dezelfde fondslock", () => {
  assert.match(migratie, /create or replace function login_private\.fondslock\(p_fonds uuid\)/);
  assert.match(migratie, /select pg_advisory_xact_lock\(hashtext\('microsoft_login_beleid'\), hashtext\(p_fonds::text\)\);/);
  for (const fn of DEKKINGSMUTATIES) {
    const start = migratie.indexOf(`function login_private.${fn}(`);
    assert.ok(start > 0, `${fn} ontbreekt`);
    const body = migratie.slice(start, migratie.indexOf("end $$;", start));
    assert.match(body, /perform fondslock\(p_fonds\)/, `${fn} neemt de fondslock niet`);
  }
  // Een nieuw of verplaatst profiel loopt niet door die functies heen: trigger.
  assert.match(migratie, /create trigger trg_profiel_fondslock\s*\n\s*before insert or update of fonds_id or delete on public\.profielen/);
  assert.doesNotMatch(migratie, /pg_advisory_xact_lock\([^)]*\);\s*\n\s*select c\.modus/, "zet_modus gebruikt de gedeelde helper, geen eigen lock");
});

test("1C: verhogen is een expliciete, geaudite handeling — geen bijwerking van de guard", () => {
  // P1: zonder bestaand venster geeft de hook NOOIT de volledige rol. Anders kan
  // een client de app overslaan en rechtstreeks bij GoTrue refreshen.
  assert.match(migratie, /and a\.venster_tot > pg_catalog\.now\(\)\) then 'vol'\s*\n\s*else 'beperkt'/);
  assert.doesNotMatch(migratie, /else 'vol' {2,}-- eerste verzoek/, "de oude fallback mag niet terug");
  // De guard oordeelt alleen; hij opent geen vensters meer.
  assert.doesNotMatch(guard, /openBreakglassVenster/, "de guard heeft geen bijwerking");
  // Het openen loopt via één expliciete route, met eigen audithandeling.
  const route = lees("app/api/microsoft-login/verhoging/route.ts");
  assert.match(route, /audit: \{ handeling: "microsoft-login\.breakglass\.verhoging" \}/);
  assert.match(route, /if \("categorie" in r\) \{[\s\S]*?status: 403/, "een mislukte opening wordt niet genegeerd");
  assert.match(beleidCore, /"\/api\/microsoft-login\/verhoging",/);
  // En de echte GoTrue-test hangt in de blokkerende gate.
  assert.match(ci, /node scripts\/breakglass-directe-refresh\.mjs/);
  const bewijs = lees("scripts/breakglass-directe-refresh.mjs");
  assert.match(bewijs, /grant_type=refresh_token/, "de test refresht rechtstreeks bij GoTrue");
  assert.match(bewijs, /een DIRECTE refresh \(app overgeslagen\) geeft géén volledige rol/);
  assert.match(bewijs, /dezelfde MFA-verificatie opent geen tweede venster/);
  assert.match(bewijs, /met een NIEUWE verificatie mag het wél/);
});

test("1C: één verhoging per MFA-verificatie — vers, eenmalig en atomair", () => {
  // De verhoging hangt aan het amr-tijdstip; anders kan een oude AAL2-sessie na
  // afloop van het venster eindeloos opnieuw verhogen (reviewbevinding P1, ronde 3).
  assert.match(migratie, /mfa_geverifieerd_op timestamptz not null/);
  assert.match(migratie, /create unique index if not exists break_glass_activering_mfa_eenmalig\s*\n\s*on login_private\.break_glass_activeringen \(user_id, mfa_geverifieerd_op\);/,
    "eenmaligheid komt van een unieke index, niet van applicatielogica");
  // Fail-closed zonder tijdstip, en een oud of toekomstig tijdstip telt niet.
  assert.match(migratie, /if p_mfa_op is null then\s*\n\s*return query select null::timestamptz, 'mfa_ontbreekt'::text; return;/);
  assert.match(migratie, /if p_mfa_op > now\(\) \+ c_max_vooruit or now\(\) - p_mfa_op > c_max_leeftijd then/);
  assert.match(migratie, /exception when unique_violation then[\s\S]{0,320}?'mfa_hergebruikt'/);
  // De hook koppelt op EXACT dezelfde verificatie, en weigert zonder tijdstip.
  assert.match(migratie, /when p_mfa_op is null then 'beperkt'/);
  assert.match(migratie, /and a\.mfa_geverifieerd_op = p_mfa_op\s*\n\s*and a\.venster_tot > pg_catalog\.now\(\)\) then 'vol'/);
  // De route leest het tijdstip uit het token en gaat dicht als het ontbreekt.
  const route = lees("app/api/microsoft-login/verhoging/route.ts");
  assert.match(route, /mfaVerificatieUitAccessToken\(token\)/);
  assert.match(route, /magBreakglassVerhogen\(\{ beleid, aal, mfaGeverifieerdOp \}\)/);
  assert.match(beleidCore, /args\.mfaGeverifieerdOp instanceof Date/);
});

test("1C: de fondslock gaat in canonieke volgorde (geen deadlock bij A→B en B→A)", () => {
  assert.match(migratie, /array_agg\(distinct f order by f\)/, "gesorteerde UUID's, niet de richting van de verplaatsing");
  assert.match(migratie, /for i in 1 \.\. coalesce\(array_length\(v_fondsen, 1\), 0\) loop/);
  assert.doesNotMatch(migratie, /perform login_private\.fondslock\(old\.fonds_id\); end if;\s*\n\s*if new\.fonds_id is not null then/,
    "niet meer oud-dan-nieuw");
});

test("1C: break-glass is een DUURZAME aanwijzing met korte activeringsvensters", () => {
  // Geen einddatum op de aanwijzing zelf: een noodpad dat vanzelf verdampt is bij
  // een Entra-storing geen noodpad (reviewbevinding 4).
  assert.doesNotMatch(migratie, /geldig_tot\s+timestamptz not null/, "de aanwijzing kent geen harde vervaldatum");
  assert.match(migratie, /herzien_voor\s+timestamptz not null/);
  assert.match(migratie, /constraint break_glass_herziening check \(herzien_voor > uitgegeven_op\)/);
  // De verloopbewaking telt mee in de preflight, maar blokkeert niet.
  assert.match(migratie, /breakglass_herziening_verlopen integer/);
  assert.match(migratie, /return query select true, null::text, 0, v_bg, v_herzien;/);
  // De korte vensters staan apart, met precies één auditregel per verhoging.
  assert.match(migratie, /create table if not exists login_private\.break_glass_activeringen/);
  assert.match(migratie, /'breakglass\.gebruikt'/, "het beloofde auditgebeurtenis bestaat");
  assert.match(migratie, /delete from break_glass_activeringen a where a\.break_glass_id = p_id and a\.venster_tot > now\(\)/);
  assert.match(beleidCore, /export const BREAKGLASS_VENSTER_SECONDEN = 60 \* 60;/);
});

test("1C: het wachtwoordpad wordt in de hook getoetst, met een fail-closed richting die geen fonds buitensluit", () => {
  // De hook leest auth.mfa_factors zelf (hij draait als supabase_auth_admin), zodat
  // login_hook_owner geen enkel recht in het auth-schema nodig heeft.
  assert.match(migratie, /from auth\.mfa_factors f where f\.user_id = v_user and f\.status = 'verified'/);
  assert.match(migratie, /login_private\.wachtwoordlogin_niveau\(v_user, v_mfa, v_aal2, v_mfa_op\)/);
  assert.doesNotMatch(migratie, /grant select[^;]*on auth\.mfa_factors/i, "de hookeigenaar krijgt geen auth-rechten");
  // Geen profielrij (platformaccount) → het gewone pad. WÉL een profiel maar GEEN
  // configuratierij → drift, en drift is dicht (reviewbevinding 3).
  assert.match(migratie, /when not exists \(select 1 from public\.profielen p where p\.id = p_user\) then 'vol'/);
  assert.match(migratie, /join public\.fonds_microsoft_login c on c\.fonds_id = p\.fonds_id\s*\n\s*where p\.id = p_user\) then 'geweigerd'/);
  assert.match(migratie, /where p\.id = p_user and c\.modus <> 'verplicht'\) then 'vol'/);
  assert.match(beleidCore, /if \(args\.beleid\.configOntbreekt\) return \{ toegestaan: false, beperkt: false, reden: "config-drift" \};/);
  // Uitzonderingen: MFA-plichtige break-glass of een geopend koppelvenster.
  assert.match(migratie, /coalesce\(p_heeft_mfa, false\) and exists \(/);
  assert.match(migratie, /u\.geactiveerd_op is not null and u\.venster_tot > pg_catalog\.now\(\)/);
  // Niet-oauth zonder user_id is niet te beoordelen → weigeren.
  assert.match(migratie, /if v_user is null then return v_weiger_wachtwoord; end if;/);
  // De hook blijft SECURITY INVOKER met leeg pad en alleen supabase_auth_admin.
  assert.match(migratie, /create or replace function public\.fn_access_token_hook\(event jsonb\) returns jsonb\s*\nlanguage plpgsql set search_path = ''/);
  assert.match(migratie, /grant execute on function public\.fn_access_token_hook\(jsonb\) to supabase_auth_admin/);
});

test("1C: break-glass is minimaal, niet zelf toe te kennen en MFA-plichtig", () => {
  assert.match(migratie, /constraint break_glass_niet_zelf check \(user_id <> uitgegeven_door\)/);
  assert.match(migratie, /constraint break_glass_herziening check \(herzien_voor > uitgegeven_op\)/);
  assert.match(migratie, /reden_categorie text not null check \(reden_categorie in \('entra_storing','beheerherstel','migratie'\)\)/,
    "vaste categorieën, geen vrij tekstveld");
  assert.match(migratie, /if p_user = p_actor then[\s\S]{0,400}?'zelf_toekennen'/);
  // De preflight telt alleen uitzonderingen met een GEVERIFIEERDE factor, en faalt
  // gesloten als auth.mfa_factors niet leesbaar is (geen aanname).
  assert.match(migratie, /has_table_privilege\(current_user, 'auth\.mfa_factors', 'select'\)/);
  assert.match(migratie, /'breakglass_onverifieerbaar'/);
  assert.match(migratie, /select 1 from auth\.mfa_factors f where f\.user_id = g\.user_id and f\.status = 'verified'/,
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
  assert.match(migratie, /perform fondslock\(p_fonds\);\s*\n\s*select c\.modus, c\.entra_tenant_id into v_oud, v_tenant/);
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
  assert.match(beleidCore, /if \(uitval === "fout"\) return \{ toegestaan: false, beperkt: false, reden: "gateway-fout" \};/);
  assert.match(beleidCore, /return args\.isOAuth\s*\n\s*\? \{ toegestaan: false, beperkt: false, reden: "gateway-fout" \}\s*\n\s*: \{ toegestaan: true, beperkt: false, reden: "gateway-niet-geconfigureerd" \};/);
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
  assert.match(migratie, /revoke all on function login_private\.wachtwoordlogin_niveau\(uuid, boolean, boolean, timestamptz\) from public, anon, authenticated, service_role, login_gateway/);
  assert.match(migratie, /grant execute on function login_private\.wachtwoordlogin_niveau\(uuid, boolean, boolean, timestamptz\) to supabase_auth_admin/);
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
  assert.match(rollback, /drop function if exists login_private\.wachtwoordlogin_niveau\(uuid, boolean, boolean, timestamptz\)/);
  assert.match(rollback, /drop policy if exists "beperkte sessie leest eigen profiel" on public\.profielen/);
  assert.match(rollback, /drop trigger if exists trg_profiel_fondslock on public\.profielen/);
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
