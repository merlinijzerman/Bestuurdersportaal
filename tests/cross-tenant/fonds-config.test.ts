// ============================================================================
//  §15-matrix — T8 config-/manifestlaag, app-laag (pure functies + bron-inspectie).
// ----------------------------------------------------------------------------
//  Drie invarianten van de differentiatie-als-data-laag zonder DB:
//    (1) BESCHIKBAARHEID-kernregel (lib/module-registry): manifest ⊕ default,
//        kern-infrastructuur altijd beschikbaar.
//    (2) CSS-INJECTIE-veiligheid (lib/fonds-config-core): theming is een allowlist;
//        ongeldige/onbekende tokens worden geweigerd, nooit in de CSS geëmit.
//    (3) BESCHIKBAARHEID ≠ AUTORISATIE server-side: hoog-risico module-entrypoints
//        roepen de server-guard weigerAlsModuleUit() aan (bron-inspectie).
//  De DB-kant (cross-tenant RLS + rolgate + append-only) staat in de SQL-suite
//  supabase/checks/2026_07_09_t8_config_cross_tenant.sql.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/fonds-config.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beschikbareModuleKeys } from "../../core/lib/module-registry";
import {
  valideerThemingTokens,
  bouwThemingCss,
  isGeldigeRgbTriple,
  flagAlsBoolean,
} from "../../core/lib/fonds-config-core";

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, "..", "..", ...p), "utf8");

// ── (1) Beschikbaarheid-kernregel ───────────────────────────────────────────

test("T8 — geen manifest → alle default-actieve modules beschikbaar (Horizon-gedrag)", () => {
  const set = beschikbareModuleKeys(null);
  // Steekproef uit elke sectie; alle bestaande modules staan default AAN.
  for (const k of ["home", "stuurinformatie", "klantbeeld", "ai", "risicomatrix", "beheer"] as const) {
    assert.ok(set.has(k), `module ${k} zou default beschikbaar moeten zijn`);
  }
});

test("T8 — manifest zet een module UIT → niet meer beschikbaar", () => {
  const set = beschikbareModuleKeys(new Map([["risicomatrix", false]]));
  assert.equal(set.has("risicomatrix"), false, "uitgezette module mag niet beschikbaar zijn");
  assert.ok(set.has("ai"), "andere modules blijven beschikbaar");
});

test("T8 — kern-infrastructuur (beheer/home/governance) blijft beschikbaar ook als het manifest 'uit' zegt", () => {
  const set = beschikbareModuleKeys(
    new Map([["beheer", false], ["home", false], ["governance", false]])
  );
  for (const k of ["beheer", "home", "governance"] as const) {
    assert.ok(set.has(k), `kern-module ${k} mag zich niet laten uitzetten (self-lockout-preventie)`);
  }
});

test("T8 — onbekende module_key in het manifest wordt genegeerd", () => {
  const set = beschikbareModuleKeys(new Map([["verzonnen_module", true]]));
  assert.equal([...set].includes("verzonnen_module" as never), false);
});

// ── (2) CSS-injectie-veiligheid van de theming-allowlist ────────────────────

test("T8 — valideerThemingTokens accepteert geldige RGB-triples", () => {
  const { tokens, genegeerd } = valideerThemingTokens({ "accent-rgb": "35 78 112" });
  assert.equal(tokens["accent-rgb"], "35 78 112");
  assert.equal(genegeerd.length, 0);
});

test("T8 — CSS-injectiepoging in een tokenwaarde wordt geweigerd (niet in tokens, wel genegeerd)", () => {
  const kwaad = { "accent-rgb": "1 2 3;} body{display:none}" };
  const { tokens, genegeerd } = valideerThemingTokens(kwaad);
  assert.equal("accent-rgb" in tokens, false, "kwaadaardige waarde mag niet worden overgenomen");
  assert.ok(genegeerd.includes("accent-rgb"));
});

test("T8 — onbekende tokensleutel wordt genegeerd (allowlist gesloten)", () => {
  const { tokens, genegeerd } = valideerThemingTokens({ "verzonnen-token": "x" });
  assert.equal(Object.keys(tokens).length, 0);
  assert.ok(genegeerd.includes("verzonnen-token"));
});

test("T8 — bouwThemingCss emit uitsluitend allowlisted CSS-vars, zonder injectie", () => {
  const { tokens } = valideerThemingTokens({
    "accent-rgb": "35 78 112",
    "logo-letter": "PH", // geen CSS-var (branding), mag niet in de CSS belanden
  });
  const css = bouwThemingCss(tokens);
  assert.ok(css.includes("--accent-rgb:35 78 112"));
  assert.ok(css.includes("--accent:rgb(35 78 112)"));
  assert.equal(css.includes("logo-letter"), false, "niet-CSS-tokens horen niet in de CSS");
  // Geen sluithaak-injectie: precies één opening en één afsluiting.
  assert.equal((css.match(/\{/g) || []).length, 1);
  assert.equal((css.match(/\}/g) || []).length, 1);
});

test("T8 — isGeldigeRgbTriple weigert buiten-bereik en niet-numeriek", () => {
  assert.ok(isGeldigeRgbTriple("0 0 0"));
  assert.ok(isGeldigeRgbTriple("255 255 255"));
  assert.equal(isGeldigeRgbTriple("256 0 0"), false);
  assert.equal(isGeldigeRgbTriple("1 2"), false);
  assert.equal(isGeldigeRgbTriple("rgb(1,2,3)"), false);
});

test("T8 — flagAlsBoolean coerceert jsonb-flagwaarden deterministisch", () => {
  assert.equal(flagAlsBoolean(true), true);
  assert.equal(flagAlsBoolean("true"), true);
  assert.equal(flagAlsBoolean("on"), true);
  assert.equal(flagAlsBoolean(false), false);
  assert.equal(flagAlsBoolean("nee"), false);
  assert.equal(flagAlsBoolean(undefined), false);
});

// ── (3) Beschikbaarheid ≠ autorisatie: server-guard op hoog-risico entrypoints ─

const GUARD_ROUTES: ReadonlyArray<[string, string, string]> = [
  ["AI-chat", join("app", "api", "chat", "route.ts"), '"ai"'],
  ["risicomatrix", join("app", "api", "risicos", "route.ts"), '"risicomatrix"'],
];

for (const [naam, pad, moduleArg] of GUARD_ROUTES) {
  test(`T8 — ${naam}-entrypoint past server-side de module-beschikbaarheidsguard toe`, () => {
    const bron = lees(pad);
    assert.ok(
      bron.includes("weigerAlsModuleUit"),
      `${naam}: verwacht een aanroep van weigerAlsModuleUit (server-side beschikbaarheidscheck)`
    );
    assert.ok(
      bron.includes(moduleArg),
      `${naam}: de guard moet op module ${moduleArg} zijn gericht`
    );
  });
}
