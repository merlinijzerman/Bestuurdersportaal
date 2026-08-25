// tests/cross-tenant/route-mechanismen.test.ts
// -----------------------------------------------------------------------------
// W13 (#184) — het declaratie-MECHANISME per route bewaken, plus twee waarde-gates.
//
// Het EPIC-W-declaratiemodel (withFondsRoute/withMachineRoute) dekt 102 van de 114
// routes. De andere 12 lopen via een erkend alternatief mechanisme (organen-route,
// catalogusContext, withPlatformRead) of zijn bespoke (contact) — géén securitygat,
// maar wél buiten RouteSpec. Deze suite maakt dat register zelf-afdwingend:
//
//   1. mechanisme      — elke route zit in het primaire model of staat in het register;
//   2. geen drift      — geen stale register-entry (verdwenen of gemigreerd);
//   3. TE_BEPALEN      — geen route keert terug naar capability: "TE_BEPALEN" (W6 §6);
//   4. ontsnappings-   — geen enkele ontsnappingswaarde (schema:"geen-body",
//      waarde-drift       capability:"iedere-ingelogde", …) neemt toe t.o.v. de
//                         bevroren teller. Een volledig gedeclareerde-maar-lege route
//                         passeert (1) moeiteloos; deze gate is wat het model laat
//                         wérken i.p.v. alleen compleet zijn.
//
// Sluit automatisch aan in de required Cross-tenant-gate: scripts/cross-tenant-ci.sh
// draait `tests/cross-tenant/*.test.ts` via glob (de C-01-les vermeden).
// -----------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const hier = dirname(fileURLToPath(import.meta.url));
const ROOT = join(hier, "..", "..");
const API_DIR = join(ROOT, "app", "api");

const register = JSON.parse(
  readFileSync(join(hier, "route-mechanismen.expected.json"), "utf8")
) as {
  uitzonderingen: Record<string, string>;
  ontsnappingswaarden: Record<string, number>;
};

/** Alle route.ts onder app/api, als repo-relatieve paden (POSIX-scheiding). */
function routeBestanden(dir: string): string[] {
  const uit: string[] = [];
  for (const naam of readdirSync(dir)) {
    const pad = join(dir, naam);
    if (statSync(pad).isDirectory()) uit.push(...routeBestanden(pad));
    else if (naam === "route.ts") uit.push(relative(ROOT, pad).split("\\").join("/"));
  }
  return uit;
}

/** Het declaratie-mechanisme van een routebestand, uit de bron. Volgorde telt:
 *  het primaire model wint van een toevallig meegeïmporteerde helper. */
function mechanismeVan(bron: string): string {
  if (/= *withFondsRoute *\(/.test(bron)) return "withFondsRoute";
  if (/withMachineRoute *\(/.test(bron)) return "withMachineRoute";
  if (/organen-route/.test(bron)) return "organen-route";
  if (/catalogusContext/.test(bron)) return "catalogusContext";
  if (/platform-wrapper|withPlatformRead/.test(bron)) return "withPlatformRead";
  return "bespoke";
}

const alleRoutes = routeBestanden(API_DIR);
const bronVan = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Telt letterlijke voorkomens van `patroon` over alle route.ts. */
function tel(patroon: string): number {
  let n = 0;
  for (const rel of alleRoutes) {
    const bron = bronVan(rel);
    let i = 0;
    while ((i = bron.indexOf(patroon, i)) !== -1) {
      n++;
      i += patroon.length;
    }
  }
  return n;
}

// ── 1. Elke niet-primaire route staat in het register, met het juiste mechanisme ──
test("W13 — geen route buiten élk mechanisme én buiten het register", () => {
  const buitenModel: string[] = [];
  for (const rel of alleRoutes) {
    const m = mechanismeVan(bronVan(rel));
    if (m === "withFondsRoute" || m === "withMachineRoute") continue; // primair
    const geregistreerd = register.uitzonderingen[rel];
    if (!geregistreerd) {
      buitenModel.push(`${rel} (${m})`);
    } else {
      assert.equal(
        geregistreerd,
        m,
        `register: ${rel} staat als "${geregistreerd}" maar de code zegt "${m}"`
      );
    }
  }
  assert.deepEqual(
    buitenModel,
    [],
    `route(s) buiten élk erkend mechanisme én niet geregistreerd — declareer ze of registreer ze:\n  ${buitenModel.join("\n  ")}`
  );
});

// ── 2. Geen stale register-entry (append-only drift) ─────────────────────────────
test("W13 — geen stale uitzondering: elke entry bestaat nog én is nog niet-primair", () => {
  for (const [rel, verwacht] of Object.entries(register.uitzonderingen)) {
    assert.ok(existsSync(join(ROOT, rel)), `register verwijst naar een verdwenen route: ${rel}`);
    const nu = mechanismeVan(bronVan(rel));
    assert.ok(
      nu !== "withFondsRoute" && nu !== "withMachineRoute",
      `${rel} is naar het primaire model (${nu}) gemigreerd — haal hem uit het register`
    );
    assert.equal(nu, verwacht, `${rel}: register zegt "${verwacht}", code zegt "${nu}"`);
  }
});

// ── 3. TE_BEPALEN-gate (W6 §6) ───────────────────────────────────────────────────
test('W13 — nul resterende capability: "TE_BEPALEN"', () => {
  const n = tel('capability: "TE_BEPALEN"');
  assert.equal(n, 0, `${n} route(s) staan nog op capability: "TE_BEPALEN" — W7 moet ze invullen`);
});

// ── 4. Ontsnappingswaarde-drift: falen op TOENAME, niet op absoluut aantal ────────
test("W13 — geen ontsnappingswaarde neemt toe t.o.v. de bevroren teller", () => {
  const toegenomen: string[] = [];
  for (const [patroon, bevroren] of Object.entries(register.ontsnappingswaarden)) {
    const nu = tel(patroon);
    if (nu > bevroren) toegenomen.push(`  ${patroon}: ${nu} > bevroren ${bevroren}`);
  }
  assert.deepEqual(
    toegenomen,
    [],
    `ontsnappingswaarde(n) toegenomen — werk de teller in route-mechanismen.expected.json bij én motiveer waarom de nieuwe ontsnapping klopt:\n${toegenomen.join("\n")}`
  );
});
