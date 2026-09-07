#!/usr/bin/env node
// ============================================================================
//  Break-glass: directe GoTrue-refresh zonder het portaal te bezoeken (#344).
// ----------------------------------------------------------------------------
//  WAAROM DEZE TEST BESTAAT
//  Reviewbevinding P1 (7 september 2026): de Auth-hook gaf een break-glassaccount
//  na een verse MFA-verificatie de VOLLEDIGE rol, in de veronderstelling dat de
//  app daarna wel het activeringsvenster zou openen. Een client kan dat verzoek
//  overslaan en rechtstreeks bij GoTrue refreshen — en houdt dan volledige tokens
//  zonder venster en zonder auditregel. Een SQL-suite ziet dat niet: die roept de
//  hookfunctie aan, niet GoTrue.
//
//  Deze test doet daarom het echte werk: hij praat uitsluitend met de Auth-API en
//  met PostgREST, en raakt de Next.js-app niet één keer aan.
//
//  VOLGORDE (elke stap is een assertie)
//    1. wachtwoordlogin in modus `verplicht`      → beperkte rol
//    2. MFA-verificatie (AAL2), nog geen venster  → nog steeds beperkt
//    3. DIRECTE refresh, app overgeslagen         → nog steeds beperkt   ← P1
//    4. venster geopend (zoals de verhogingsroute) → normale rol
//    5. venster verlopen, opnieuw refreshen       → weer beperkt
//    6. PostgREST met een beperkt token           → 403 op documenten
//
//  Draaien:  TEST_DATABASE_URL=… node scripts/breakglass-directe-refresh.mjs
//  Zonder bereikbare stack stopt de test met een duidelijke melding; in CI
//  (XTENANT_REQUIRE_DB=1) is dat ROOD, want daar hoort de stack er te zijn.
// ============================================================================
import { execFileSync } from "node:child_process";
import { maakTotp } from "../tests/e2e/fixtures/totp.mjs";

const API = process.env.SUPABASE_API_URL ?? "http://127.0.0.1:54321";
const DB = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

/**
 * De API-sleutels van de wegwerpstack. Nooit hardcoded — ook niet de publieke
 * CLI-demowaarden: de secretscan van deze repo herkent zo'n JWT terecht als een
 * sleutel in een gevolgd bestand. Volgorde: environment, anders uitvragen bij de
 * draaiende CLI-stack.
 */
function stackSleutels() {
  const uitEnv = {
    anon: process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    service: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  };
  if (uitEnv.anon && uitEnv.service) return uitEnv;
  for (const commando of [["supabase"], ["npx", "--yes", "supabase@2.114.0"]]) {
    try {
      const [bin, ...voor] = commando;
      const uit = execFileSync(bin, [...voor, "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const status = JSON.parse(uit);
      const anon = status.ANON_KEY ?? status.anon_key ?? "";
      const service = status.SERVICE_ROLE_KEY ?? status.service_role_key ?? "";
      if (anon && service) return { anon, service };
    } catch {
      /* volgende poging */
    }
  }
  return { anon: "", service: "" };
}

const FONDS = "34400000-0000-4000-8000-0000000b6001";
const ACTOR = "34400000-0000-4000-8000-0000000b6002";
const EMAIL = "breakglass-directe-refresh@example.test";
const WACHTWOORD = "Breakglass!directe-refresh-344";
const SECRET = "JBSWY3DPEHPK3PXP";
const TENANT = "aaaaaaaa-1111-4111-8111-111111111111";

const verplicht = process.env.XTENANT_REQUIRE_DB === "1";
function stop(bericht) {
  if (verplicht) {
    console.error(`FOUT: ${bericht}`);
    process.exit(1);
  }
  console.log(`OVERGESLAGEN: ${bericht}`);
  process.exit(0);
}
if (!DB) stop("geen TEST_DATABASE_URL/DATABASE_URL — deze test heeft de wegwerpstack nodig.");
const { anon: ANON, service: SERVICE } = stackSleutels();
if (!ANON || !SERVICE) {
  stop("geen API-sleutels gevonden — zet SUPABASE_ANON_KEY en SUPABASE_SERVICE_ROLE_KEY, of start de CLI-stack.");
}

const psql = (sql) =>
  execFileSync(process.env.PSQL_BIN ?? "psql", [DB, "-v", "ON_ERROR_STOP=1", "-tAc", sql], { encoding: "utf8" }).trim();
const json = async (res) => {
  const tekst = await res.text();
  try { return JSON.parse(tekst); } catch { return tekst; }
};
const claims = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));

let fouten = 0;
function eis(voorwaarde, boodschap) {
  if (voorwaarde) { console.log(`  ✓ ${boodschap}`); return; }
  console.error(`  ✗ ${boodschap}`);
  fouten++;
}

async function main() {
  // Draait de hook überhaupt? Zonder hook bewijst deze test niets.
  const hook = psql(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = 'fn_access_token_hook'`);
  if (hook !== "1") stop("fn_access_token_hook ontbreekt — pas eerst de migraties toe.");

  try {
    await fetch(`${API}/auth/v1/health`, { headers: { apikey: ANON } });
  } catch {
    stop(`Auth-API niet bereikbaar op ${API}.`);
  }

  // ── Seed ────────────────────────────────────────────────────────────────
  psql(`insert into public.fondsen (id, naam, slug) values ('${FONDS}', 'Break-glass refreshtest', 'bg-refresh-344')
        on conflict (id) do nothing`);
  psql(`update public.fonds_microsoft_login
           set entra_tenant_id = '${TENANT}', modus = 'verplicht', actief = true
         where fonds_id = '${FONDS}'`);

  // Idempotent: een restant van een eerdere run eerst opruimen.
  const bestaand = psql(`select coalesce((select id::text from auth.users where email = '${EMAIL}'), '')`);
  if (bestaand) {
    await fetch(`${API}/auth/v1/admin/users/${bestaand}`, {
      method: "DELETE", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
  }

  const maak = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: WACHTWOORD, email_confirm: true, app_metadata: { fonds_id: FONDS } }),
  });
  const gebruiker = await json(maak);
  if (!gebruiker?.id) stop(`kon testgebruiker niet aanmaken: ${JSON.stringify(gebruiker).slice(0, 200)}`);
  const uid = gebruiker.id;

  // Een geverifieerde TOTP-factor. `secret` MOET gevuld zijn: GoTrue kan een
  // NULL-secret niet lezen en geeft dan een 500 op elk gebruikerspad.
  psql(`insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at)
        values (gen_random_uuid(), '${uid}', 'bg-refresh-344', 'totp', 'verified', '${SECRET}', now(), now())`);
  const factorId = psql(`select id from auth.mfa_factors where user_id = '${uid}' limit 1`);
  // De actor hoeft geen profiel te hebben: verleen_break_glass toetst het DOEL
  // (dat moet in het fonds zitten) en weigert alleen dat actor = doel.
  psql(`grant login_gateway to postgres;
        begin;
          set local role login_gateway;
          select login_private.verleen_break_glass('${FONDS}', '${uid}', 'entra_storing', '${ACTOR}', 90, 'refreshtest');
        commit;`);

  // ── 1. wachtwoordlogin ──────────────────────────────────────────────────
  const login = await json(await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: WACHTWOORD }),
  }));
  if (!login?.access_token) stop(`wachtwoordlogin gaf geen sessie: ${JSON.stringify(login).slice(0, 200)}`);
  eis(claims(login.access_token).role === "portaal_beperkt", "wachtwoordlogin in `verplicht` geeft de beperkte rol");

  // ── 2. MFA-verificatie ──────────────────────────────────────────────────
  const uitdaging = await json(await fetch(`${API}/auth/v1/factors/${factorId}/challenge`, {
    method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${login.access_token}`, "Content-Type": "application/json" }, body: "{}",
  }));
  const verify = await json(await fetch(`${API}/auth/v1/factors/${factorId}/verify`, {
    method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${login.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ challenge_id: uitdaging.id, code: maakTotp(SECRET) }),
  }));
  if (!verify?.access_token) stop(`MFA-verificatie mislukt: ${JSON.stringify(verify).slice(0, 200)}`);
  const na = claims(verify.access_token);
  eis(na.aal === "aal2", "de MFA-stap levert een AAL2-sessie");
  eis(na.role === "portaal_beperkt", "AAL2 zonder activeringsvenster blijft BEPERKT");
  eis(psql(`select count(*) from login_private.audit_log where user_id = '${uid}' and gebeurtenis = 'breakglass.gebruikt'`) === "0",
      "er is niets geaudit, want er is niets verhoogd");

  // ── 3. DIRECTE refresh, zonder de app aan te raken (de kern van P1) ──────
  const refresh = async (token) => json(await fetch(`${API}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: token }),
  }));
  let sessie = await refresh(verify.refresh_token);
  if (!sessie?.access_token) stop(`refresh mislukt: ${JSON.stringify(sessie).slice(0, 200)}`);
  eis(claims(sessie.access_token).role === "portaal_beperkt",
      "een DIRECTE refresh (app overgeslagen) geeft géén volledige rol");
  eis(psql(`select count(*) from login_private.break_glass_activeringen where user_id = '${uid}'`) === "0",
      "en er is nog steeds geen activeringsvenster");

  // ── 4. venster geopend (wat de verhogingsroute doet) ─────────────────────
  psql(`begin;
          set local role login_gateway;
          select login_private.open_breakglass_venster('${uid}', 3600, 'refreshtest');
        commit;`);
  sessie = await refresh(sessie.refresh_token);
  eis(claims(sessie.access_token).role === "authenticated", "mét venster geeft de refresh de normale rol");
  eis(psql(`select count(*) from login_private.audit_log where user_id = '${uid}' and gebeurtenis = 'breakglass.gebruikt'`) === "1",
      "precies één `breakglass.gebruikt` in de audit");

  // ── 5. venster verlopen ─────────────────────────────────────────────────
  psql(`update login_private.break_glass_activeringen
           set geopend_op = now() - interval '2 hours', venster_tot = now() - interval '1 hour'
         where user_id = '${uid}'`);
  sessie = await refresh(sessie.refresh_token);
  eis(claims(sessie.access_token).role === "portaal_beperkt", "na afloop van het venster zakt de sessie terug");

  // ── 6. PostgREST met een beperkt token ──────────────────────────────────
  const rest = await fetch(`${API}/rest/v1/documenten?select=id&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${sessie.access_token}` },
  });
  eis(rest.status === 403, `PostgREST weigert een beperkt token op documenten (kreeg ${rest.status})`);
  const eigen = await fetch(`${API}/rest/v1/profielen?select=id&limit=5`, {
    headers: { apikey: ANON, Authorization: `Bearer ${sessie.access_token}` },
  });
  const rijen = await json(eigen);
  eis(eigen.status === 200 && Array.isArray(rijen) && rijen.length === 1 && rijen[0]?.id === uid,
      "… en ziet uitsluitend de eigen profielrij");

  // ── Opruimen ────────────────────────────────────────────────────────────
  await fetch(`${API}/auth/v1/admin/users/${uid}`, {
    method: "DELETE", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  psql(`revoke login_gateway from postgres;
        delete from public.fonds_microsoft_login where fonds_id = '${FONDS}';
        delete from public.fondsen where id = '${FONDS}'`);

  if (fouten > 0) {
    console.error(`\nBREAK-GLASS DIRECTE-REFRESHTEST ROOD: ${fouten} assertie(s) gefaald.`);
    process.exit(1);
  }
  console.log("\nOK: een break-glasssessie wordt nooit volledig zonder geaudit activeringsvenster.");
}

main().catch((fout) => {
  console.error(`FOUT: ${fout?.message ?? fout}`);
  process.exit(1);
});
