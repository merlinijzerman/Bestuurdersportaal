// ============================================================================
//  Contracttest Microsoft-login fase 1B — T2 (#335, besluit 0211; testmatrix
//  T2-C1…T2-C6 en de reviewbevindingen van PR #339).
// ----------------------------------------------------------------------------
//  Bron-inspectie (patroon microsoft-connector-contract.test.ts). De belangrijkste
//  grens is de BROWSERGRENS: een "use client"-component mag uit het login-domein
//  uitsluitend microsoft-login-meldingen-core importeren, en die module importeert
//  niets. PR #339 brak de productiebuild doordat MicrosoftLoginKaart via
//  error-core → binding-core `node:crypto` in de clientbundel trok. Deze suite
//  vlagt dat statisch, inclusief transitieve imports.
// ============================================================================
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const lees = (pad: string) => readFileSync(resolve(root, pad), "utf8");

function bestanden(dir: string, filter: (p: string) => boolean): string[] {
  const uit: string[] = [];
  for (const naam of readdirSync(dir)) {
    const p = join(dir, naam);
    if (statSync(p).isDirectory()) {
      if (naam === "node_modules" || naam.startsWith(".")) continue;
      uit.push(...bestanden(p, filter));
    } else if (filter(p)) uit.push(p);
  }
  return uit;
}

/** Lost een `@/core/...`- of relatieve import op naar een repo-relatief pad. */
function losOp(vanaf: string, spec: string): string | null {
  let basis: string;
  if (spec.startsWith("@/")) basis = resolve(root, spec.slice(2));
  else if (spec.startsWith(".")) basis = resolve(dirname(vanaf), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", ".mjs", "/index.ts"]) {
    if (existsSync(basis + ext) && statSync(basis + ext).isFile()) return relative(root, basis + ext).split("\\").join("/");
  }
  return null;
}

/** Broncode zonder commentaar (regel- en blokcommentaar), zodat een toelichting
 *  over `node:crypto` niet als import telt. */
function zonderCommentaar(bron: string): string {
  return bron.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** WAARDE-imports (type-only imports worden gewist door de compiler en zijn geen bundelafhankelijkheid). */
function imports(pad: string): string[] {
  const bron = zonderCommentaar(readFileSync(resolve(root, pad), "utf8"));
  return [...bron.matchAll(/^\s*(?:import|export)\s(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]!);
}

/** Alle transitieve repo-imports vanuit één bestand (alleen @/ en relatief). */
function transitieveImports(start: string): Set<string> {
  const gezien = new Set<string>();
  const stapel = [start];
  while (stapel.length) {
    const pad = stapel.pop()!;
    for (const spec of imports(pad)) {
      const doel = losOp(resolve(root, pad), spec);
      if (doel && !gezien.has(doel)) {
        gezien.add(doel);
        stapel.push(doel);
      }
    }
  }
  return gezien;
}

const LOGIN_MODULES = bestanden(resolve(root, "core/lib"), (p) => /microsoft-login[^/]*\.ts$/.test(p) && !/\.(sanity|test)\.ts$/.test(p)).map((p) => relative(root, p));
const LOGIN_ROUTES = [
  ...bestanden(resolve(root, "app/auth/microsoft-login"), (p) => p.endsWith("route.ts")),
  ...bestanden(resolve(root, "app/api/microsoft-login"), (p) => p.endsWith("route.ts")),
].map((p) => relative(root, p));
const CLIENT_COMPONENTS = bestanden(resolve(root, "app"), (p) => /\.tsx?$/.test(p))
  .map((p) => relative(root, p))
  .filter((p) => /^"use client";/m.test(lees(p)));

// ── Browsergrens (reviewbevinding PR #339) ──────────────────────────────────

test("T2 browsergrens — een \"use client\"-component importeert uit het login-domein alleen microsoft-login-meldingen-core, ook transitief", () => {
  const fouten: string[] = [];
  for (const comp of CLIENT_COMPONENTS) {
    for (const doel of transitieveImports(comp)) {
      if (/core\/lib\/microsoft-login/.test(doel) && doel !== "core/lib/microsoft-login-meldingen-core.ts") {
        fouten.push(`${comp} → ${doel}`);
      }
    }
  }
  assert.deepEqual(fouten, [], `clientcomponent trekt een Node-module uit het login-domein mee:\n${fouten.join("\n")}`);
});

test("T2 browsergrens — meldingen-core importeert niets en bevat geen node:*, process.env of server-only", () => {
  const bron = zonderCommentaar(lees("core/lib/microsoft-login-meldingen-core.ts"));
  assert.deepEqual(imports("core/lib/microsoft-login-meldingen-core.ts"), []);
  assert.doesNotMatch(bron, /node:|process\.env|server-only|require\(/);
});

test("T2 browsergrens — geen \"use client\"-bestand in het login-domein trekt transitief node:* of server-only mee (proven-red op de PR-#339-fout)", () => {
  const fouten: string[] = [];
  const loginClients = CLIENT_COMPONENTS.filter((c) => /microsoft-login|app\/login\//.test(c) || [...transitieveImports(c)].some((d) => /core\/lib\/microsoft-login/.test(d)));
  assert.ok(loginClients.length >= 2, "LoginForm en MicrosoftLoginKaart horen in scope te zitten");
  for (const comp of loginClients) {
    for (const doel of transitieveImports(comp)) {
      const bron = zonderCommentaar(lees(doel));
      if (/^\s*import\s(?!type\s)[^;]*?from\s+["']node:/m.test(bron) || /^import "server-only";/m.test(bron)) fouten.push(`${comp} → ${doel}`);
    }
  }
  assert.deepEqual(fouten, [], `\n${fouten.join("\n")}`);
  // Proven-red: de foute keten van PR #339 bestaat nog als SERVER-pad en zou hier vlaggen.
  const errorCore = transitieveImports("core/lib/microsoft-login-error-core.ts");
  assert.ok(errorCore.has("core/lib/microsoft-login-binding-core.ts"), "error-core → binding-core (node:crypto) is het serverpad dat de client niet mag zien");
});

// ── T2-C1: scopes en E2 ─────────────────────────────────────────────────────

test("T2-C1 — scopes exact openid profile; geen offline_access/email/Graph in het login-domein", () => {
  assert.match(lees("core/lib/microsoft-login-oidc-core.ts"), /MICROSOFT_LOGIN_SCOPES = \["openid", "profile"\] as const/);
  for (const m of [...LOGIN_MODULES, ...LOGIN_ROUTES]) {
    const bron = lees(m);
    assert.doesNotMatch(bron, /User\.Read|Sites\.|Calendars\.|Mail\./, m);
    // offline_access mag alleen als WEIGERING voorkomen (commentaar/toets), nooit als gevraagde scope.
    assert.doesNotMatch(bron, /scope[^\n]*offline_access/i, m);
  }
});

// ── T2-C2: gescheiden vertrouwensdomeinen ───────────────────────────────────

test("T2-C2 — login-domein importeert niets uit het Graph-connectordomein; geen graph.microsoft.com, geen service-role, geen MSAL", () => {
  for (const m of [...LOGIN_MODULES, ...LOGIN_ROUTES, "app/login/page.tsx", "app/login/_components/LoginForm.tsx"]) {
    const bron = lees(m);
    assert.doesNotMatch(bron, /from "[^"]*microsoft-(vault|connector|config|crypto|identity-core|config-core)"/, `${m} importeert uit het connectordomein`);
    assert.doesNotMatch(bron, /graph\.microsoft\.com|@azure\/msal-node|ConfidentialClientApplication/, m);
    assert.doesNotMatch(bron, /SUPABASE_SERVICE_ROLE_KEY|supabase-platform|service_role/i, m);
  }
  for (const m of ["core/lib/microsoft-login.ts", "core/lib/microsoft-login-config.ts", "core/lib/microsoft-login-oidc.ts", "core/lib/microsoft-login-sessieguard.ts"]) {
    assert.match(lees(m), /^import "server-only";/m, `${m} moet server-only zijn`);
  }
});

// ── T2-C3: discovery/JWKS alleen op de authority, RS256, exact één kid ──────

test("T2-C3 — OIDC-I/O alleen op de authority; RS256 met exact één kid; E2E-authority dubbel gegrendeld", () => {
  const oidc = lees("core/lib/microsoft-login-oidc.ts");
  assert.match(oidc, /isToegestaneEndpointUrl\(url, authority\)/);
  assert.match(oidc, /redirect: "error"/);
  const core = lees("core/lib/microsoft-login-oidc-core.ts");
  assert.match(core, /if \(delen\.header\.alg !== "RS256"\) return false;/);
  assert.match(core, /return passend\.length === 1 \? passend\[0\]! : null;/);
  assert.match(core, /SEED_DOELOMGEVING !== "local"/);
  assert.match(core, /NEXT_PUBLIC_SUPABASE_URL !== LOKALE_SUPABASE_URL/);
});

// ── T2-C4: niets lekt naar log, audit of URL ────────────────────────────────

test("T2-C4 — routes loggen alleen categorie/supportcode; no-store overal; geen token/claim/e-mail in log- of auditpaden", () => {
  for (const r of LOGIN_ROUTES) {
    const bron = lees(r);
    assert.match(bron, /Cache-Control": "no-store"/, `${r} zonder no-store`);
    for (const log of bron.matchAll(/console\.(warn|error|log)\(([^;]*)\);/g)) {
      assert.doesNotMatch(log[2]!, /idToken|accessToken|refresh|state\b|nonce|code\b|email|claims|\bsub\b|\boid\b|\btid\b/, `${r} logt gevoelige inhoud: ${log[0]}`);
    }
  }
  const orkestratie = lees("core/lib/microsoft-login-orkestratie-core.ts");
  assert.match(orkestratie, /identiteitHash: args\.identiteit \? identiteitHash\(/, "audit draagt sha256(tid:oid), niet de waarden");
  assert.doesNotMatch(orkestratie, /registreerGebeurtenis\(\{[^}]*(idToken|token:|email)/);
  // De URL naar de gebruiker draagt alleen de vaste foutwaarde en een supportcode.
  const start = lees("app/auth/microsoft-login/start/route.ts");
  const callback = lees("app/auth/microsoft-login/callback/route.ts");
  for (const bron of [start, callback]) {
    assert.match(bron, /searchParams\.set\(LOGIN_FOUT_PARAM, LOGIN_FOUT_WAARDE\)/);
    assert.doesNotMatch(bron, /searchParams\.set\("(reden|categorie|error_description)"/);
  }
});

// ── T2-C5: registers ────────────────────────────────────────────────────────

test("T2-C5 — beide app/auth-routes staan als oauth-route in het register; drie handelingen geregistreerd", () => {
  const register = JSON.parse(lees("tests/cross-tenant/route-mechanismen.expected.json")) as { uitzonderingen: Record<string, string>; bespokeReden: Record<string, string> };
  for (const r of ["app/auth/microsoft-login/start/route.ts", "app/auth/microsoft-login/callback/route.ts"]) {
    assert.equal(register.uitzonderingen[r], "oauth-route");
    assert.ok(register.bespokeReden[r]?.length, `${r} zonder reden`);
  }
  const audit = JSON.parse(lees("tests/cross-tenant/audit-handelingen.expected.json")) as { handelingen: Record<string, string> };
  assert.equal(audit.handelingen["microsoft-login.koppeling.start"], "GET microsoft-login/koppelen/start");
  assert.equal(audit.handelingen["microsoft-login.koppeling.ontkoppelen"], "DELETE microsoft-login/koppeling");
  assert.equal(audit.handelingen["microsoft-login.koppeling.herstellen"], "POST microsoft-login/koppeling");
});

// ── V9: atomische teller in de private gateway ──────────────────────────────

test("V9 — startlimiet telt atomisch in de private gateway met een HMAC van ip|host, niet in het Node-proces", () => {
  const start = lees("app/auth/microsoft-login/start/route.ts");
  assert.match(start, /telStartpoging\(\{/);
  assert.match(start, /startSleutel\(clientIpUitHeaders\(/);
  assert.doesNotMatch(start, /maakVensterLimiter|new Map\(/, "geen in-geheugen teller op de startroute");
  const core = lees("core/lib/microsoft-login-ratelimit-core.ts");
  assert.match(core, /createHmac\("sha256", sleutel\)/);
  assert.match(core, /MICROSOFT_LOGIN_START_LIMIET = \{ limiet: 20, vensterSeconden: 600 \} as const/);
  const gateway = lees("core/lib/microsoft-login-gateway.ts");
  assert.match(gateway, /login_private\.tel_startpoging\(\$1,\$2,\$3\)/);
  const migratie = lees("supabase/migrations/2026_09_07_microsoft_login_startlimiet.sql");
  assert.match(migratie, /on conflict \(sleutel, venster_start\) do update set aantal = s\.aantal \+ 1/);
  assert.match(migratie, /grant execute on function login_private\.tel_startpoging\(text, integer, integer\) to login_gateway/);
  assert.match(migratie, /revoke all on login_private\.start_pogingen from public, anon, authenticated, service_role, login_gateway/);
  assert.match(lees("scripts/cross-tenant-ci.sh"), /2026_09_07_microsoft_login_startlimiet\.sql/, "check-suite aangesloten in de gate");
});

// ── Ontkoppelen deterministisch (reviewbevinding PR #339) ───────────────────

test("ontkoppelen — server bepaalt of de sessie via Microsoft loopt; oauth-sessie wordt beëindigd (uitgelogd: true), wachtwoordsessie blijft", () => {
  const route = lees("app/api/microsoft-login/koppeling/route.ts");
  assert.match(route, /const viaMicrosoft = sessieIsOAuth\(await huidigAccessToken\(ctx\.supabase\)\);/);
  assert.match(route, /await beeindigSessie\(ctx\.supabase\);\s*return NextResponse\.json\(\{ ok: true, uitgelogd: true \}/);
  assert.match(route, /return NextResponse\.json\(\{ ok: true, uitgelogd: false \}/);
  assert.match(route, /sessieViaMicrosoft, \.\.\.status/);
  const kaart = lees("app/(dashboard)/profiel/_components/MicrosoftLoginKaart.tsx");
  assert.match(kaart, /if \(uitkomst\.uitgelogd\) \{\s*(\/\/[^\n]*\n\s*)*window\.location\.replace\("\/login"\);/);
  assert.match(kaart, /U bent nu met Microsoft ingelogd\. Ontkoppelen logt u direct uit\./);
});
