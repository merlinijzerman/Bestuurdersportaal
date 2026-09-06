// ============================================================================
//  Karakterisering vóór wijziging — login-/sessieketen (#335 T2-voorbereiding).
// ----------------------------------------------------------------------------
//  T2 (Microsoft-login, PR-B) raakt de sessieresolutie: login-UI, /auth/callback
//  (L4), haalFondsSessie / withFondsRoute / tenant-, login- en platformlayout
//  (guard L3), uitloggen en de foutmeldingen. Deze suite legt het gedrag van
//  vóór die wijziging vast, via bron-inspectie (patroon: portaalcontext-privacy
//  .test.ts) plus sha256-pins op de kleine, stabiele kernbestanden.
//
//  Twee soorten asserties:
//    • INVARIANT — moet ook ná T2 blijven gelden (wachtwoordpad byte-identiek,
//      ontwerp §6.13). Faalt deze, dan is er een regressie.
//    • BASISLIJN — beschrijft de huidige toestand die T2 BEWUST wijzigt (bv.
//      /auth/callback kent nog geen identiteitsopschoning; er is één inlog-
//      methode). Faalt deze in de T2-PR, dan hoort de wijziging in de PR-tekst
//      gemotiveerd te zijn en wordt de assertie in dezelfde PR omgezet.
//
//  Pins bijwerken: alleen bewust, en bereken de nieuwe sha256 zelf (CLAUDE.md,
//  patroon generatie-kern.sanity.ts) — neem hem niet over uit de foutmelding.
//
//  Draaien: node --import tsx --test tests/cross-tenant/login-keten-karakterisering.test.ts
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const hier = dirname(fileURLToPath(import.meta.url));
const ROOT = join(hier, "..", "..");
const lees = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const sha256 = (tekst: string) => createHash("sha256").update(tekst).digest("hex");

const loginPagina = lees("app", "login", "page.tsx");
const loginLayout = lees("app", "login", "layout.tsx");
const authCallback = lees("app", "auth", "callback", "route.ts");
const fondsSessie = lees("core", "lib", "fonds-sessie.ts");
const supabaseServer = lees("core", "lib", "supabase-server.ts");
const middleware = lees("middleware.ts");
const dashboardLayout = lees("app", "(dashboard)", "layout.tsx");
const platformLayout = lees("app", "(platform)", "platform", "(beveiligd)", "layout.tsx");
const platformLogin = lees("app", "(platform)", "platform", "login", "page.tsx");
const sidebar = lees("core", "components", "Sidebar.tsx");
const platformUitloggen = lees("app", "(platform)", "platform", "_components", "Uitloggen.tsx");
const routeWrapper = lees("core", "lib", "route-wrapper.ts");
const routeMechanismenTest = lees("tests", "cross-tenant", "route-mechanismen.test.ts");

// ── LK-1 · Wachtwoordlogin (tenant) ──────────────────────────────────────────

test("LK-1 INVARIANT — wachtwoordlogin gaat rechtstreeks via de browserclient met de generieke foutmelding", () => {
  assert.match(loginPagina, /^"use client";/, "de loginpagina is een client-component");
  assert.match(loginPagina, /supabase\.auth\.signInWithPassword\(\{\s*email,\s*password: wachtwoord,?\s*\}\)/);
  assert.match(
    loginPagina,
    /setFout\("Inloggen mislukt\. Controleer uw e-mailadres en wachtwoord\."\)/,
    "één generieke melding; geen onderscheid onbekend account / fout wachtwoord"
  );
  // Redirect na login: één volledige navigatie naar "/", géén next-parameter.
  assert.match(loginPagina, /window\.location\.replace\("\/"\)/);
  assert.doesNotMatch(loginPagina, /searchParams|useSearchParams|next=|veiligVervolgpad/, "de login honoreert geen vervolgpad");
  // Geen server action en geen API-route voor het inloggen.
  assert.doesNotMatch(loginPagina, /"use server"|fetch\(/);
});

test("LK-1b BASISLIJN — de tenant-login kent vóór T2 precies één inlogmethode (geen Microsoft-knop)", () => {
  assert.doesNotMatch(loginPagina, /microsoft|Microsoft|azure|oidc|signInWithIdToken|microsoft-login/);
  // De ?error=auth_callback-parameter van /auth/callback wordt vandaag NIET getoond.
  assert.doesNotMatch(loginPagina, /auth_callback|\.get\("error"\)/);
});

// ── LK-2 · Login-layout ──────────────────────────────────────────────────────

test("LK-2 INVARIANT — login-layout stuurt alleen een sessie MET profielen-rij naar '/', een platform-identiteit niet", () => {
  assert.match(loginLayout, /robots: \{ index: false, follow: true \}/);
  assert.match(loginLayout, /\.from\("profielen"\)\s*\.select\("id"\)\s*\.eq\("id", user\.id\)\s*\.maybeSingle\(\)/);
  assert.match(loginLayout, /if \(profiel\) redirect\("\/"\);/, "alleen met profiel terug naar de app (voorkomt redirectlus met platform-identiteit)");
  assert.equal((loginLayout.match(/redirect\(/g) ?? []).length, 1, "precies één redirect in de login-layout");
});

test("LK-2b BASISLIJN — login-layout toetst nog geen Microsoft-binding (guard L3 komt in T2)", () => {
  assert.doesNotMatch(loginLayout, /amr|oauth|actieveBinding|levendeBinding|microsoft/i);
});

// ── LK-3 · /auth/callback ────────────────────────────────────────────────────

test("LK-3 INVARIANT — /auth/callback: code-exchange, veilig vervolgpad, vaste foutredirect", () => {
  assert.match(authCallback, /const next = veiligVervolgpad\(searchParams\.get\("next"\)\);/, "H-03: next uitsluitend via veiligVervolgpad");
  assert.match(authCallback, /supabase\.auth\.exchangeCodeForSession\(code\)/);
  assert.match(authCallback, /NextResponse\.redirect\(`\$\{origin\}\$\{next\}`\)/);
  assert.match(authCallback, /NextResponse\.redirect\(`\$\{origin\}\/login\?error=auth_callback`\)/, "faalpad: altijd /login?error=auth_callback");
  assert.doesNotMatch(authCallback, /service[_-]?role|SUPABASE_SERVICE/i);
});

test("LK-3b BASISLIJN — /auth/callback doet vóór T2 niets met identiteiten (L4 = nieuw gedrag)", () => {
  assert.doesNotMatch(authCallback, /identities|unlinkIdentity|getUserIdentities|signOut|azure|amr/);
});

// ── LK-4 · haalFondsSessie ───────────────────────────────────────────────────

test("LK-4 INVARIANT — haalFondsSessie: geen user → /login; geen fonds-profiel → /login; fonds nooit uit de request", () => {
  assert.match(fondsSessie, /^import "server-only";/m);
  assert.match(fondsSessie, /if \(!user\) redirect\("\/login"\);/);
  assert.match(fondsSessie, /\.from\("profielen"\)\s*\.select\("fonds_id, rol"\)\s*\.eq\("id", user\.id\)\s*\.single\(\)/);
  assert.match(fondsSessie, /if \(!profiel\?\.fonds_id\) redirect\("\/login"\);/);
  assert.equal((fondsSessie.match(/redirect\("\/login"\)/g) ?? []).length, 2, "precies twee fail-safe redirects");
  assert.doesNotMatch(fondsSessie, /searchParams|request\.|req\.|new URL\(|service[_-]?role/i);
  assert.match(fondsSessie, /export type FondsSessie = \{\s*userId: string;\s*fondsId: string;\s*rol: string \| null;\s*\};/);
});

test("LK-4b BASISLIJN — haalFondsSessie kent vóór T2 geen bindingstoets (guard L3 komt in T2)", () => {
  assert.doesNotMatch(fondsSessie, /amr|oauth|actieveBinding|levendeBinding|microsoft/i);
});

// ── LK-5 · Sessieopbouw en refresh ───────────────────────────────────────────

test("LK-5 INVARIANT — server-client: @supabase/ssr met getAll/setAll; cookieschrijven in Server Components is best-effort", () => {
  assert.match(supabaseServer, /createServerClient\(/);
  assert.match(supabaseServer, /process\.env\.NEXT_PUBLIC_SUPABASE_URL!/);
  assert.match(supabaseServer, /process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY!/);
  assert.match(supabaseServer, /getAll\(\) \{\s*return cookieStore\.getAll\(\);\s*\}/);
  assert.match(supabaseServer, /setAll\(cookiesToSet: CookieToSet\[\]\) \{\s*try \{/, "setAll slikt schrijffouten in Server Components (refresh leunt op de browserclient)");
  assert.doesNotMatch(supabaseServer, /service[_-]?role/i);
});

test("LK-5b INVARIANT — middleware doet geen sessie-/DB-check en laat /api en /auth ongemoeid", () => {
  assert.doesNotMatch(middleware, /supabase|createServerClient|getUser|cookies\(\)/i, "geen Supabase in de Edge-middleware");
  assert.match(middleware, /matcher: \["\/\(\(\?!api\|auth\|_next\/static\|_next\/image\|favicon\.ico\|\.\*\\\\\.\.\*\)\.\*\)"\]/, "matcher exact: api en auth uitgezonderd, /login niet");
  assert.match(middleware, /new NextResponse\("Not found", \{ status: 404 \}\)/);
  assert.match(middleware, /NextResponse\.redirect\(url, 307\)/, "marketing /login → app-login is een 307");
});

// ── LK-6 · Tenant-layout (dashboard) ─────────────────────────────────────────

test("LK-6 INVARIANT — dashboard-layout: geen user → /login; geen profiel → /login; host-mismatch is een inline pagina, geen redirect", () => {
  assert.match(dashboardLayout, /if \(!user\) \{\s*redirect\("\/login"\);\s*\}/);
  assert.match(dashboardLayout, /if \(!profiel\) \{\s*redirect\("\/login"\);\s*\}/);
  assert.equal((dashboardLayout.match(/redirect\("\/login"\)/g) ?? []).length, 2, "precies twee redirects naar /login");
  assert.equal((dashboardLayout.match(/redirect\(/g) ?? []).length, 2, "de layout redirect nergens anders heen (mismatch = inline pagina, voorkomt lus)");
  assert.match(dashboardLayout, /beoordeelToegang\(\{\s*resolutie,\s*sessieFondsId,\s*enforce: tenantEnforceAan\(\),?\s*\}\)/);
  assert.match(dashboardLayout, /<h1 className="text-lg font-semibold">Geen toegang op dit adres<\/h1>/);
  assert.match(dashboardLayout, /"Dit webadres hoort bij een ander fonds dan uw account\. Log in via het adres van uw eigen fonds\."/);
  assert.match(dashboardLayout, /"Dit webadres is niet gekoppeld aan een bekend fonds\. Controleer of u het juiste adres van uw fonds gebruikt\."/);
  // Fail-closed bij een harde resolutiefout onder enforce.
  assert.match(dashboardLayout, /if \(tenantEnforceAan\(\)\) \{\s*oordeel = \{ toegestaan: false, reden: "onbekende-host" \};/);
});

test("LK-6b BASISLIJN — dashboard-layout toetst vóór T2 geen Microsoft-binding (guard L3 komt in T2)", () => {
  assert.doesNotMatch(dashboardLayout, /amr|oauth|actieveBinding|levendeBinding|microsoft-login/i);
});

// ── LK-7 · Platform-layout en -login ─────────────────────────────────────────

test("LK-7 INVARIANT — beveiligde platform-layout: drie redirects in vaste volgorde (sessie → identiteit → MFA)", () => {
  const volgorde = [
    /if \(!user\) \{\s*redirect\("\/platform\/login"\);\s*\}/,
    /if \(!identiteit \|\| !identiteit\.actief\) \{\s*redirect\("\/platform\/login\?fout=geen_toegang"\);\s*\}/,
    /if \(!mfaOk\) \{\s*redirect\("\/platform\/login\?mfa=1"\);\s*\}/,
  ];
  let positie = -1;
  for (const patroon of volgorde) {
    const m = patroon.exec(platformLayout);
    assert.ok(m, `ontbrekende poort: ${patroon}`);
    assert.ok(m.index > positie, `poort uit volgorde: ${patroon}`);
    positie = m.index;
  }
  assert.equal((platformLayout.match(/redirect\(/g) ?? []).length, 3);
  assert.match(platformLayout, /export const dynamic = "force-dynamic";/);
});

test("LK-7b INVARIANT — platform-login: eigen wachtwoordpad + MFA; ?fout=geen_toegang logt het account uit", () => {
  assert.match(platformLogin, /setFout\("Inloggen mislukt\. Controleer e-mailadres en wachtwoord\."\)/);
  assert.match(platformLogin, /setFout\("Dit account heeft geen platformtoegang\. U bent uitgelogd\."\);\s*supabase\.auth\.signOut\(\);/);
  assert.match(platformLogin, /mfa\.getAuthenticatorAssuranceLevel\(\)/);
});

test("LK-7c BASISLIJN — platform-layout weigert vóór T2 nog geen oauth-sessies expliciet (R-34 komt in T2)", () => {
  assert.doesNotMatch(platformLayout, /amr|oauth|microsoft/i);
});

// ── LK-8 · Uitloggen ─────────────────────────────────────────────────────────

test("LK-8 INVARIANT — uitloggen: signOut() zonder scope (default global) + één navigatie naar de login", () => {
  assert.match(sidebar, /await supabase\.auth\.signOut\(\);\s*(\/\/[^\n]*\n\s*)*router\.replace\("\/login"\);/, "tenant: signOut → router.replace('/login'), geen refresh");
  assert.doesNotMatch(sidebar, /signOut\(\{/, "geen expliciete scope: Supabase-default 'global'");
  assert.match(sidebar, /sessionStorage\.removeItem\(ACTIEF_GESPREK_SLEUTEL\)/, "besluit 0086: AI-sessiemarkering wissen");
  assert.match(platformUitloggen, /await supabase\.auth\.signOut\(\);\s*router\.push\("\/platform\/login"\);\s*router\.refresh\(\);/);
});

// ── LK-9 · withFondsRoute-naad ───────────────────────────────────────────────

test("LK-9 INVARIANT — withFondsRoute: geen sessie → exact {error:'Niet ingelogd'} / 401, vóór elke andere poort", () => {
  assert.match(routeWrapper, /function nietIngelogd\(\): NextResponse \{\s*return NextResponse\.json\(\{ error: "Niet ingelogd" \}, \{ status: 401 \}\);/);
  assert.match(routeWrapper, /if \(!user\) return nietIngelogd\(\);/);
  assert.match(routeWrapper, /export const withFondsRoute = maakWithFondsRoute\(echteDeps\);/);
  assert.match(routeWrapper, /readonly hostGuard: "afdwingen" \| "geen" \| "route-eigen";/);
});

test("LK-9b BASISLIJN — de wrapper kent vóór T2 geen bindingstoets (guard L3 komt in T2, in dezelfde deps-vorm)", () => {
  assert.doesNotMatch(routeWrapper, /amr|actieveBinding|levendeBinding|microsoft-login/i);
});

// ── LK-10 · Registerdekking van app/auth/** ──────────────────────────────────

function routeBestanden(dir: string): string[] {
  const uit: string[] = [];
  for (const naam of readdirSync(dir)) {
    const pad = join(dir, naam);
    if (statSync(pad).isDirectory()) uit.push(...routeBestanden(pad));
    else if (naam === "route.ts") uit.push(relative(ROOT, pad).split("\\").join("/"));
  }
  return uit;
}

test("LK-10 CENSUS — app/auth/** telt precies twee routes; elke nieuwe OAuth-route hoort eerst in een register", () => {
  // De registergates (route-mechanismen, audit-handelingen) scannen alleen app/api.
  assert.match(routeMechanismenTest, /const API_DIR = join\(ROOT, "app", "api"\);/);
  // Zolang die gates app/auth niet dekken, is deze census de grendel: T2 voegt
  // /auth/microsoft-login/{start,callback} toe en werkt deze lijst BEWUST bij,
  // samen met de registeruitbreiding uit het T2-ontwerp (stap B0).
  assert.deepEqual(routeBestanden(join(ROOT, "app", "auth")).sort(), [
    "app/auth/callback/route.ts",
    "app/auth/microsoft/callback/route.ts",
  ]);
});

// ── LK-11 · Byte-pins op de kleine, stabiele kernbestanden ───────────────────

test("LK-11 PIN — sha256 van de auth-kernbestanden (bewust bijwerken; nieuwe waarde zelf berekenen)", () => {
  const pins: Record<string, string> = {
    "core/lib/fonds-sessie.ts": "71653f231dcc6447d688b901c80ea5f77283cc1868cb5120358e6c33538368b0",
    "app/auth/callback/route.ts": "a321563ab0e7b2bba9e80d9f5a64bf477a9aa680e42156e622c1b24f2bb57faa",
    "core/lib/supabase-server.ts": "ff104b6a4bb390ee3563b901dd461fc6e82f2086cb80923816f8ec381a698872",
    "app/login/layout.tsx": "870513cb5076fdb124e7306d74e1020c455b9fa9a4563506d8a795b4872a56a6",
    "app/login/page.tsx": "9c8f8a3b2144cf812b42d70d92dc0634bcdf73ca390831b8fcab938cba4b3f04",
    "core/lib/redirect-veilig.ts": "e8986ce5c29d7b564ba8e75f0edc6c0913d350daf637d70c61397d2b7b7b97e4",
  };
  const afwijkend: string[] = [];
  for (const [pad, verwacht] of Object.entries(pins)) {
    if (sha256(lees(...pad.split("/"))) !== verwacht) afwijkend.push(pad);
  }
  assert.deepEqual(
    afwijkend,
    [],
    "gewijzigd auth-kernbestand: motiveer de wijziging in de PR, controleer de LK-asserties hierboven en werk de pin bewust bij"
  );
});
