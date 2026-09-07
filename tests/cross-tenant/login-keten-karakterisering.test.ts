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
//    • INVARIANT — geldt vóór én ná T2 (wachtwoordpad byte-identiek, ontwerp
//      §6.13). Faalt deze, dan is er een regressie.
//    • T2 — de bewuste wijzigingen van T2 (guard L3 in elk chokepoint, L4 in
//      /auth/callback, Microsoft-knop). Tot B4 stonden hier BASISLIJN-asserties
//      die het oude gedrag pinden; ze zijn in dezelfde PR omgezet (B4/B5).
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
const loginForm = lees("app", "login", "_components", "LoginForm.tsx");
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

test("LK-1 INVARIANT — wachtwoordlogin (nu in LoginForm) gaat rechtstreeks via de browserclient met de generieke foutmelding", () => {
  assert.match(loginForm, /^"use client";/, "het formulier is een client-component");
  assert.match(loginForm, /supabase\.auth\.signInWithPassword\(\{\s*email,\s*password: wachtwoord,?\s*\}\)/);
  assert.match(
    loginForm,
    /setFout\("Inloggen mislukt\. Controleer uw e-mailadres en wachtwoord\."\)/,
    "één generieke melding; geen onderscheid onbekend account / fout wachtwoord"
  );
  // Redirect na wachtwoordlogin: één volledige navigatie naar "/", géén next-parameter.
  assert.match(loginForm, /window\.location\.replace\("\/"\)/);
  assert.doesNotMatch(loginForm, /useSearchParams|next=|veiligVervolgpad/, "het wachtwoordpad honoreert geen vervolgpad");
  // Geen server action en geen API-route voor het wachtwoord-inloggen.
  assert.doesNotMatch(loginForm, /"use server"|fetch\(/);
});

test("LK-1b T2 — de server-pagina beslist over de Microsoft-knop (fail-closed) en toont één neutrale melding voor fout= én error=auth_callback", () => {
  assert.doesNotMatch(loginPagina, /^"use client";/m, "de pagina is nu een server component");
  assert.match(loginPagina, /microsoftLoginBeschikbaarVoorHost\(host\)/);
  assert.match(loginPagina, /fout === LOGIN_FOUT_WAARDE \|\| error === "auth_callback" \? LOGIN_MICROSOFT_MELDING : null/, "V11: één melding voor beide");
  assert.match(loginPagina, /SUPPORTCODE_RE\.test\(sc\)/, "supportcode strikt gevalideerd uit de URL");
  assert.match(loginPagina, /from "@\/core\/lib\/microsoft-login-meldingen-core"/, "de pagina leest de teksten uit de browserveilige module");
  // De knop is een kale link naar de startroute, zonder parameters; alleen gerenderd bij `microsoftLogin`.
  assert.match(loginForm, /\{microsoftLogin && \(/);
  assert.match(loginForm, /href="\/auth\/microsoft-login\/start"/);
  assert.doesNotMatch(loginForm, /login_hint|domain_hint|prompt=/);
});

// ── LK-2 · Login-layout ──────────────────────────────────────────────────────

test("LK-2 INVARIANT — login-layout stuurt alleen een sessie MET profielen-rij naar '/', een platform-identiteit niet", () => {
  assert.match(loginLayout, /robots: \{ index: false, follow: true \}/);
  assert.match(loginLayout, /\.from\("profielen"\)\s*\.select\("id"\)\s*\.eq\("id", user\.id\)\s*\.maybeSingle\(\)/);
  assert.match(loginLayout, /if \(profiel\) redirect\("\/"\);/, "alleen met profiel terug naar de app (voorkomt redirectlus met platform-identiteit)");
  assert.equal((loginLayout.match(/redirect\(/g) ?? []).length, 1, "precies één redirect in de login-layout");
});

test("LK-2b T2 — login-layout: oauth-sessie zonder actieve binding blijft op de login (beëindigd), geen redirect naar '/'", () => {
  assert.match(loginLayout, /beoordeelOAuthSessie\(supabase, user\.id\)/);
  assert.match(loginLayout, /if \(!\(await beoordeelOAuthSessie\(supabase, user\.id\)\)\.toegestaan\) \{\s*await beeindigSessie\(supabase\);\s*\} else \{/);
  assert.equal((loginLayout.match(/redirect\(/g) ?? []).length, 1, "nog steeds precies één redirect (naar '/')");
});

// ── LK-3 · /auth/callback ────────────────────────────────────────────────────

test("LK-3 INVARIANT — /auth/callback: code-exchange, veilig vervolgpad, vaste foutredirect", () => {
  assert.match(authCallback, /const next = veiligVervolgpad\(searchParams\.get\("next"\)\);/, "H-03: next uitsluitend via veiligVervolgpad");
  assert.match(authCallback, /supabase\.auth\.exchangeCodeForSession\(code\)/);
  assert.match(authCallback, /NextResponse\.redirect\(`\$\{origin\}\$\{next\}`\)/);
  assert.match(authCallback, /NextResponse\.redirect\(`\$\{origin\}\/login\?error=auth_callback`\)/, "faalpad: altijd /login?error=auth_callback");
  assert.doesNotMatch(authCallback, /service[_-]?role|SUPABASE_SERVICE/i);
});

test("LK-3b T2 — /auth/callback L4: azure-identiteit zonder actieve binding → unlink + sessie weg + /login?error=auth_callback", () => {
  assert.match(authCallback, /if \(user && heeftAzureIdentiteit\(user\)\) \{/, "alleen bij een azure-identiteit wordt de gateway geraadpleegd");
  assert.match(authCallback, /beoordeelOAuthSessie\(supabase, user\.id\)/);
  assert.match(authCallback, /supabase\.auth\.unlinkIdentity\(azure\)/);
  assert.match(authCallback, /await beeindigSessie\(supabase\);/);
  assert.equal((authCallback.match(/\/login\?error=auth_callback/g) ?? []).length, 2, "L4 en het bestaande faalpad delen dezelfde neutrale redirect");
  assert.doesNotMatch(authCallback, /accessToken|idToken|refreshToken|console\.(log|error)\(.*user/);
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

test("LK-4b T2 — haalFondsSessie: guard L3 direct ná de sessiecontrole, vóór het profiel", () => {
  const guard = fondsSessie.indexOf("beoordeelOAuthSessie(supabase, user.id)");
  assert.ok(guard > fondsSessie.indexOf('if (!user) redirect("/login")'), "guard ná de sessiecontrole");
  assert.ok(guard < fondsSessie.indexOf('.from("profielen")'), "guard vóór de profielresolutie");
  assert.match(fondsSessie, /await beeindigSessie\(supabase\);\s*redirect\(LOGIN_NA_BEEINDIGING\);/);
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
  assert.equal((dashboardLayout.match(/redirect\(/g) ?? []).length, 3, "twee naar /login + de L3-beëindiging; mismatch blijft een inline pagina (voorkomt lus)");
  assert.match(dashboardLayout, /beoordeelToegang\(\{\s*resolutie,\s*sessieFondsId,\s*enforce: tenantEnforceAan\(\),?\s*\}\)/);
  assert.match(dashboardLayout, /<h1 className="text-lg font-semibold">Geen toegang op dit adres<\/h1>/);
  assert.match(dashboardLayout, /"Dit webadres hoort bij een ander fonds dan uw account\. Log in via het adres van uw eigen fonds\."/);
  assert.match(dashboardLayout, /"Dit webadres is niet gekoppeld aan een bekend fonds\. Controleer of u het juiste adres van uw fonds gebruikt\."/);
  // Fail-closed bij een harde resolutiefout onder enforce.
  assert.match(dashboardLayout, /if \(tenantEnforceAan\(\)\) \{\s*oordeel = \{ toegestaan: false, reden: "onbekende-host" \};/);
});

test("LK-6b T2 — dashboard-layout: guard L3 ná de sessiecontrole en vóór profiel/host-logica", () => {
  const guard = dashboardLayout.indexOf("beoordeelOAuthSessie(supabase, user.id)");
  assert.ok(guard > dashboardLayout.indexOf('redirect("/login")'), "guard ná !user");
  assert.ok(guard < dashboardLayout.indexOf('.from("profielen")'), "guard vóór de profielresolutie");
  assert.match(dashboardLayout, /await beeindigSessie\(supabase\);\s*redirect\(LOGIN_NA_BEEINDIGING\);/);
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
  assert.equal((platformLayout.match(/redirect\(/g) ?? []).length, 4, "drie poorten + de R-34-weigering van oauth-sessies");
  assert.match(platformLayout, /export const dynamic = "force-dynamic";/);
});

test("LK-7b INVARIANT — platform-login: eigen wachtwoordpad + MFA; ?fout=geen_toegang logt het account uit", () => {
  assert.match(platformLogin, /setFout\("Inloggen mislukt\. Controleer e-mailadres en wachtwoord\."\)/);
  assert.match(platformLogin, /setFout\("Dit account heeft geen platformtoegang\. U bent uitgelogd\."\);\s*supabase\.auth\.signOut\(\);/);
  assert.match(platformLogin, /mfa\.getAuthenticatorAssuranceLevel\(\)/);
});

test("LK-7c T2 — platform-layout weigert elke oauth-sessie (R-34) vóór de identiteitspoort, zonder gateway-aanroep", () => {
  const oauth = platformLayout.indexOf("sessieIsOAuth(await huidigAccessToken(sessie))");
  assert.ok(oauth > platformLayout.indexOf('redirect("/platform/login")'), "ná !user");
  assert.ok(oauth < platformLayout.indexOf("huidigePlatformIdentiteit()"), "vóór de identiteitspoort");
  assert.match(platformLayout, /if \(sessieIsOAuth\(await huidigAccessToken\(sessie\)\)\) \{\s*redirect\("\/platform\/login\?fout=geen_toegang"\);/);
  assert.doesNotMatch(platformLayout, /levendeBinding|microsoft-login-gateway/, "platform raadpleegt de bindingsgateway niet");
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

test("LK-9b T2 — wrapper: guard L3 als geïnjecteerde dep, direct ná auth, met exact de 401-vorm van 'geen sessie'", () => {
  assert.match(routeWrapper, /beoordeelOAuthSessie: \(supabase: RlsClient, gebruikerId: string\) => Promise<\{ toegestaan: boolean \}>;/);
  assert.match(routeWrapper, /if \(!user\) return nietIngelogd\(\);[\s\S]{0,600}?if \(!\(await deps\.beoordeelOAuthSessie\(supabase, user\.id\)\)\.toegestaan\) return nietIngelogd\(\);/);
  const guard = routeWrapper.indexOf("deps.beoordeelOAuthSessie(supabase, user.id)");
  assert.ok(guard < routeWrapper.indexOf("deps.haalProfiel(supabase, user.id)"), "guard vóór de profielresolutie");
  assert.match(routeWrapper, /await import\("@\/core\/lib\/microsoft-login-sessieguard"\)/, "lazy: de sanity blijft server-loos");
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

test("LK-10 CENSUS — app/auth/** telt precies vier routes, alle onder de registergate (B0)", () => {
  // B0 (#335) bracht app/auth/** onder route-mechanismen.test.ts; deze census
  // blijft als tweede grendel: elke nieuwe OAuth-route is een bewuste wijziging
  // hier én in route-mechanismen.expected.json.
  assert.match(routeMechanismenTest, /const AUTH_DIR = join\(ROOT, "app", "auth"\);/);
  assert.deepEqual(routeBestanden(join(ROOT, "app", "auth")).sort(), [
    "app/auth/callback/route.ts",
    "app/auth/microsoft-login/callback/route.ts",
    "app/auth/microsoft-login/start/route.ts",
    "app/auth/microsoft/callback/route.ts",
  ]);
});

// ── LK-11 · Byte-pins op de kleine, stabiele kernbestanden ───────────────────

test("LK-11 PIN — sha256 van de auth-kernbestanden (bewust bijwerken; nieuwe waarde zelf berekenen)", () => {
  // B4 (#335 T2): fonds-sessie.ts, app/auth/callback/route.ts en app/login/layout.tsx
  // bewust opnieuw gepind na guard L3 / L4. supabase-server.ts, redirect-veilig.ts
  // ongewijzigd. B5: app/login/page.tsx (server-pagina) en LoginForm.tsx gepind.
  const pins: Record<string, string> = {
    "core/lib/fonds-sessie.ts": "6a5385ceb9daac7e28d19a83f1a76fc952f5004d2dff243470f92f08e39c57ec",
    "app/auth/callback/route.ts": "d94d3c6d7589c20c9e51866fa36e540aed29f66624de0b486a0cf603f236cf57",
    "core/lib/supabase-server.ts": "ff104b6a4bb390ee3563b901dd461fc6e82f2086cb80923816f8ec381a698872",
    "app/login/layout.tsx": "99e115569a2ef4e835331a0a55d474a07dac24e42bc926b215206392b93ac4ae",
    "app/login/page.tsx": "62e135ae3215872e09a046bb6a438a1db596ab56e0f4c3e33e2b0fa119600fbe",
    "core/lib/redirect-veilig.ts": "e8986ce5c29d7b564ba8e75f0edc6c0913d350daf637d70c61397d2b7b7b97e4",
    "app/login/_components/LoginForm.tsx": "ab14b4e2ec11cc11394a1ab638437d9e2376fbff515e03df3611c9b63c798b53",
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
