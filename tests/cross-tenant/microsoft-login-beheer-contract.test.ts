// ============================================================================
//  Contracttest Microsoft-loginbeleid — PR-B (#344, besluit 0212): beheerroutes,
//  /koppelen-ingang en de uitnodigingslink. Bron-inspectie (patroon
//  microsoft-login-t2-contract.test.ts).
// ----------------------------------------------------------------------------
//  Reviewafspraken die hier hard staan:
//    • het herkoppeltoken staat NOOIT in een URL-pad, log, audit of HTML — alleen
//      in het fragment van de uitnodigingslink en in de body van één POST;
//    • /koppelen erft de algemene root-layout; die laadt analytics routebewust NIET op /koppelen; no-store en
//      no-referrer; activering is POST-only (GET/linkpreview verbruikt niets);
//    • GET beleid geeft geen tenant-id, alleen `tenantGeconfigureerd`;
//    • ongeldig, verlopen en al gebruikt delen één neutrale 403;
//    • de publieke POST heeft de atomische startlimiet;
//    • "afronden" is een aparte, bevestigde actie met bevestigingswoord.
// ============================================================================
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const lees = (pad: string) => readFileSync(resolve(root, pad), "utf8");
const zonderCommentaar = (bron: string) => bron.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function routes(dir: string): string[] {
  const uit: string[] = [];
  for (const naam of readdirSync(resolve(root, dir))) {
    const p = join(resolve(root, dir), naam);
    if (statSync(p).isDirectory()) uit.push(...routes(relative(root, p)));
    else if (naam === "route.ts") uit.push(relative(root, p).split("\\").join("/"));
  }
  return uit;
}

/** Alle .ts/.tsx-bronnen onder een map (voor "nergens anders"-controles). */
function alleBronnen(dir: string): string[] {
  const uit: string[] = [];
  for (const naam of readdirSync(resolve(root, dir))) {
    const p = join(resolve(root, dir), naam);
    if (statSync(p).isDirectory()) uit.push(...alleBronnen(relative(root, p)));
    else if (/\.tsx?$/.test(naam)) uit.push(relative(root, p).split("\\").join("/"));
  }
  return uit;
}

const BEHEER_ROUTES = routes("app/api/microsoft-login/beheer");
const ACTIVERING = "app/auth/microsoft-login/uitnodiging/route.ts";
const KOPPEL_PAGINA = "app/(herstel)/koppelen/page.tsx";
const KOPPEL_CLIENT = "app/(herstel)/koppelen/_components/KoppelActivering.tsx";
const HERSTEL_LAYOUT = "app/(herstel)/layout.tsx";
const BEHEER_UI = "app/(dashboard)/beheer/microsoft-login/_components/LoginBeleidBeheer.tsx";
const BEHEER_PAGINA = "app/(dashboard)/beheer/microsoft-login/page.tsx";

test("PR-B: zeven beheerhandlers, allemaal login.beleid.manage + hostGuard afdwingen + inline requireCapability + eigen handeling", () => {
  assert.equal(BEHEER_ROUTES.length, 5, BEHEER_ROUTES.join(", "));
  let handlers = 0;
  for (const r of BEHEER_ROUTES) {
    const bron = lees(r);
    const exports = [...bron.matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\s*=\s*withFondsRoute\(/g)];
    handlers += exports.length;
    assert.ok(exports.length > 0, r);
    const specs = bron.match(/capability: "([^"]+)"/g) ?? [];
    assert.equal(specs.length, exports.length, `${r}: elke handler declareert een capability`);
    for (const s of specs) assert.equal(s, 'capability: "login.beleid.manage"', r);
    assert.equal((bron.match(/hostGuard: "afdwingen"/g) ?? []).length, exports.length, `${r}: hostGuard afdwingen op elke handler`);
    assert.equal((bron.match(/requireCapability\(ctx\.gebruikerId, "login\.beleid\.manage"\)/g) ?? []).length, exports.length, `${r}: inline capability-gate per handler (W7-3, patroon /api/profiel)`);
    assert.doesNotMatch(bron, /rateLimit: "nog-niet-beoordeeld"|hostGuard: "geen"/, r);
    assert.match(bron, /Cache-Control": "no-store"/, r);
    // Mutaties dragen een handeling; alleen de GET is read-only.
    for (const e of exports) {
      const blok = bron.slice(e.index!, bron.indexOf("withFondsRoute(", e.index! + 1) === -1 ? undefined : bron.indexOf("export const", e.index! + 10));
      if (e[1] === "GET") assert.match(blok, /audit: "geen"/, `${r} GET`);
      else assert.match(blok, /audit: \{ handeling: "microsoft-login\.[a-z.-]+" \}/, `${r} ${e[1]}`);
    }
  }
  assert.equal(handlers, 7);
});

test("PR-B: GET beleid geeft geen tenant-id — alleen tenantGeconfigureerd; geen tid/oid/sub/e-mail in de respons", () => {
  const route = lees("app/api/microsoft-login/beheer/beleid/route.ts");
  assert.match(route, /bouwBeheerBeleidRespons\(/);
  assert.doesNotMatch(route, /entraTenantId: config\.entraTenantId,?\s*\}\s*,\s*\{ headers/, "de tenant-id wordt niet doorgegeven aan de respons");
  const core = zonderCommentaar(lees("core/lib/microsoft-login-beheer-core.ts"));
  assert.match(core, /readonly tenantGeconfigureerd: boolean;/);
  assert.doesNotMatch(core.slice(core.indexOf("export type BeheerBeleidRespons"), core.indexOf("const iso")), /entraTenantId|tid|oid|sub|email/);
  assert.match(core, /VERBODEN_RESPONSSLEUTELS = \["entraTenantId", "entra_tenant_id", "tid", "oid", "sub", "email", "token_hash", "tokenHash"\]/);
});

test("PR-B: het herkoppeltoken verlaat de server één keer en staat alleen in het FRAGMENT; nergens in pad, log of audit", () => {
  const core = zonderCommentaar(lees("core/lib/microsoft-login-beheer-core.ts"));
  assert.match(core, /return `\$\{o\.origin\}\$\{KOPPEL_PAD\}#\$\{token\}`;/, "link = origin + /koppelen + '#' + token");
  assert.match(lees("core/lib/microsoft-login-meldingen-core.ts"), /export const KOPPEL_PAD = "\/koppelen";/);
  const uitgifte = lees("app/api/microsoft-login/beheer/uitnodiging/route.ts");
  assert.match(uitgifte, /tokenHash: herkoppelTokenHash\(token\)/, "alleen de hash naar de gateway");
  for (const r of [uitgifte, lees(ACTIVERING)]) {
    for (const log of r.matchAll(/console\.(warn|error|log)\(([^;]*)\);/g)) {
      assert.doesNotMatch(log[2]!, /\btoken\b|link|body\.data|tokenHash/, `log lekt tokenmateriaal: ${log[0]}`);
    }
    assert.doesNotMatch(r, /registreerGebeurtenis\([^)]*token/, "audit draagt geen token");
  }
  // Geen route met het token in het pad.
  const alle = [...routes("app/auth"), ...routes("app/api/microsoft-login")];
  assert.ok(!alle.some((p) => /\[token\]|koppelen\/\[/.test(p)), "geen dynamisch tokensegment in een routepad");
});

test("PR-B: /koppelen — geneste layout onder de algemene root-layout; analytics routebewust uit; fragment client-side gelezen en gewist; token alleen in een POST-body", () => {
  // De herstel-layout is GEEN root-layout (app/layout.tsx bestaat): geen <html>/<body>,
  // geen eigen analytics, alleen metadata. Reviewbevinding: de vorige versie nestte een
  // tweede <html>/<body> en erfde stilzwijgend het <Analytics/> van de root-layout.
  const layout = zonderCommentaar(lees(HERSTEL_LAYOUT));
  assert.doesNotMatch(layout, /<html|<body/, "geen geneste <html>/<body> in een niet-root-layout");
  assert.doesNotMatch(layout, /@vercel\/analytics|<Analytics/, "geen analytics in de herstelflow");
  assert.match(layout, /referrer: "no-referrer"/);
  assert.match(layout, /robots: \{ index: false, follow: false \}/);
  // De algemene root-layout rendert analytics uitsluitend via de routebewuste wrapper.
  const root = zonderCommentaar(lees("app/layout.tsx"));
  assert.doesNotMatch(root, /@vercel\/analytics|<Analytics /, "root-layout importeert/rendert <Analytics/> niet rechtstreeks");
  assert.match(root, /import RouteBewusteAnalytics from "@\/core\/components\/RouteBewusteAnalytics"/);
  assert.match(root, /<RouteBewusteAnalytics \/>/);
  const wrapper = zonderCommentaar(lees("core/components/RouteBewusteAnalytics.tsx"));
  assert.match(wrapper, /^"use client";/);
  assert.match(wrapper, /usePathname\(\)/);
  assert.match(wrapper, /if \(analyticsUitgesloten\(pathname\)\) return null;/);
  assert.match(wrapper, /return <Analytics \/>;/);
  // Geen andere plek in de app rendert <Analytics/> buiten de wrapper om.
  const overige = alleBronnen("app").filter((p) => /<Analytics\s*\/>/.test(zonderCommentaar(lees(p))));
  assert.deepEqual(overige, [], "alleen de wrapper rendert <Analytics/>");
  assert.match(lees(KOPPEL_PAGINA), /<KoppelActivering \/>/);
  const client = lees(KOPPEL_CLIENT);
  assert.match(client, /^"use client";/);
  assert.match(client, /tokenUitFragment\(window\.location\.hash\)/);
  assert.match(client, /window\.history\.replaceState\(null, "", window\.location\.pathname \+ window\.location\.search\)/, "fragment direct wissen");
  assert.match(client, /method: "POST",\s*headers: \{ "content-type": "application\/json" \},\s*body: JSON\.stringify\(\{ token \}\)/);
  assert.match(client, /referrerPolicy: "no-referrer"/);
  assert.doesNotMatch(client, /\{token\}|>\s*\{token/, "het token wordt nooit gerenderd");
  assert.doesNotMatch(client, /useSearchParams|searchParams|\?token=/, "geen token in de query");
  // Alleen de browserveilige module uit het login-domein.
  for (const m of client.matchAll(/from "@\/core\/lib\/(microsoft-login[^"]*)"/g)) assert.equal(m[1], "microsoft-login-meldingen-core", m[0]);
  const config = lees("next.config.ts");
  assert.match(config, /source: "\/koppelen",[\s\S]{0,300}"Referrer-Policy", value: "no-referrer"/);
  assert.match(config, /source: "\/koppelen",[\s\S]{0,200}"Cache-Control", value: "no-store"/);
  // Het activeringsendpoint krijgt dezelfde headers via next.config (de globale
  // Referrer-Policy overschrijft anders de routeheader — gemeten in de E2E-run).
  assert.match(config, /source: "\/auth\/microsoft-login\/uitnodiging",[\s\S]{0,400}"Referrer-Policy", value: "no-referrer"/);
  assert.match(config, /source: "\/auth\/microsoft-login\/uitnodiging",[\s\S]{0,300}"Cache-Control", value: "no-store"/);
});

test("PR-B: activering is POST-only, canonieke host, atomische startlimiet, één neutrale 403 voor elke weigering", () => {
  const bron = lees(ACTIVERING);
  assert.match(bron, /export async function POST\(/);
  assert.doesNotMatch(bron, /export async function GET/);
  assert.match(bron, /canoniekeFondsHost\(req\.headers\.get\("host"\)/);
  assert.match(bron, /telStartpoging\(\{/);
  assert.match(bron, /ACTIVERING_SCHEMA\.safeParse\(await req\.json\(\)/);
  assert.match(bron, /activeerUitnodiging\(\{\s*tokenHash: herkoppelTokenHash\(body\.data\.token\)/);
  // Elke weigering (limiet, vorm, categorie, fout) is dezelfde functie `ongeldig()`.
  const weigeringen = bron.match(/return ongeldig\(\);/g) ?? [];
  assert.ok(weigeringen.length >= 5, `verwacht ≥5 neutrale weigeringen, gevonden ${weigeringen.length}`);
  assert.match(bron, /UITNODIGING_ONGELDIG_MELDING/);
  assert.doesNotMatch(bron, /categorie:\s*r\.categorie/, "de categorie gaat niet naar de client");
  assert.match(bron, /"Referrer-Policy": "no-referrer"/);
  const register = JSON.parse(lees("tests/cross-tenant/route-mechanismen.expected.json")) as { uitzonderingen: Record<string, string> };
  assert.equal(register.uitzonderingen[ACTIVERING], "oauth-route");
});

test("PR-B: beheerscherm — token één keer in client-state met kopieerknop; afronden is een aparte actie met bevestigingswoord; verplicht alleen na bevestiging mét preflight", () => {
  const ui = lees(BEHEER_UI);
  assert.match(ui, /^"use client";/);
  assert.match(ui, /useState<\{ userId: string; naam: string \| null; link: string; verlooptOp: string; gekopieerd: boolean \} \| null>\(null\)/, "link alleen in client-state");
  assert.match(ui, /navigator\.clipboard\.writeText\(uitnodiging\.link\)/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage/, "geen opslag van de link");
  assert.match(ui, /afronden\.woord !== BEHEER_TEKSTEN\.afrondenBevestigingswoord/, "bevestigingswoord verplicht");
  assert.match(ui, /Intrekking afronden…/);
  assert.doesNotMatch(ui, /type="checkbox"/, "afronden is geen checkbox naast de standaardactie");
  assert.match(ui, /afronden: true/);
  assert.match(ui, /if \(!beleid\.magActiveren\) \{/);
  assert.match(ui, /confirm\(BEHEER_TEKSTEN\.verplichtBevestiging\)/);
  assert.match(ui, /beleid\.tenantGeconfigureerd \? "geconfigureerd"/);
  assert.doesNotMatch(ui, /entraTenantId/);
  for (const m of ui.matchAll(/^import (?!type )[^;]*from "@\/core\/lib\/(microsoft-login[^"]*)"/gm)) assert.equal(m[1], "microsoft-login-meldingen-core", m[0]);
  const pagina = lees(BEHEER_PAGINA);
  assert.match(pagina, /requireCapability\(sessie\.userId, "login\.beleid\.manage"\)/);
  assert.match(pagina, /redirect\("\/beheer"\)/);
  assert.match(lees("app/(dashboard)/beheer/page.tsx"), /href="\/beheer\/microsoft-login"/);
  const teksten = lees("core/lib/microsoft-login-meldingen-core.ts");
  assert.match(teksten, /afrondenBevestiging:[\s\S]*?Microsoft-identiteit blijft in Supabase Auth achter/);
});

test("PR-B: registers — zes handelingen, activeringsroute in de LK-10-census, W7-telling 149", () => {
  const audit = JSON.parse(lees("tests/cross-tenant/audit-handelingen.expected.json")) as { handelingen: Record<string, string> };
  for (const [label, route] of [
    ["microsoft-login.beleid.wijzigen", "PATCH microsoft-login/beheer/beleid"],
    ["microsoft-login.beheer.intrekken", "POST microsoft-login/beheer/intrekking"],
    ["microsoft-login.breakglass.verlenen", "POST microsoft-login/beheer/breakglass"],
    ["microsoft-login.breakglass.intrekken", "DELETE microsoft-login/beheer/breakglass/[id]"],
    ["microsoft-login.uitnodiging.uitgeven", "POST microsoft-login/beheer/uitnodiging"],
    ["microsoft-login.uitnodiging.intrekken", "DELETE microsoft-login/beheer/uitnodiging"],
  ]) assert.equal(audit.handelingen[label!], route);
  assert.match(lees("tests/cross-tenant/login-keten-karakterisering.test.ts"), /"app\/auth\/microsoft-login\/uitnodiging\/route\.ts"/);
  assert.match(lees("tests/cross-tenant/w7-declaraties.test.ts"), /HANDLERS\.length, 149/);
});
