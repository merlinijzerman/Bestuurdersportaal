// ============================================================================
//  Sanity-tests voor het platform-capabilitymodel (Increment P0).
//
//  Toetst de pure autorisatie-/anti-escalatie-logica en de code↔seed-
//  consistentie (TO §12 test 17, codekant). De DB-FK-kant (onbekende cap in
//  grant onmogelijk) wordt door scripts/platform_checks.sql geverifieerd.
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx lib/platform-capabilities.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import {
  PLATFORM_CAPABILITIES,
  PLATFORM_ROL_CAPABILITIES,
  ZWARE_CAPABILITIES,
  heeftCapability,
  isZwareCapability,
  type PlatformCapability,
} from "./platform-capabilities";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("platform-capability sanity-tests:");

test("union telt exact 15 capabilities", () => {
  assert.equal(PLATFORM_CAPABILITIES.length, 15);
  assert.equal(new Set(PLATFORM_CAPABILITIES).size, 15, "geen duplicaten");
});

test("elke capability begint met 'platform.'", () => {
  for (const cap of PLATFORM_CAPABILITIES) {
    assert.ok(cap.startsWith("platform."), `${cap} mist platform.-prefix`);
  }
});

// TO §4.1: bewuste rolsplitsing — fondsbeheer impliceert NIET rechten uitdelen.
test("platformbeheer beheert fondsen maar mag GEEN capabilities toekennen", () => {
  const caps = PLATFORM_ROL_CAPABILITIES.platformbeheer;
  assert.ok(caps.includes("platform.tenants.manage"));
  assert.ok(!caps.includes("platform.capabilities.grant"));
  assert.ok(!caps.includes("platform.identities.manage"));
});

test("grant/revoke zit in GEEN enkel functieprofiel (§4.3)", () => {
  for (const [profiel, caps] of Object.entries(PLATFORM_ROL_CAPABILITIES)) {
    assert.ok(!caps.includes("platform.capabilities.grant"), `${profiel} bevat grant`);
    assert.ok(!caps.includes("platform.capabilities.revoke"), `${profiel} bevat revoke`);
  }
});

test("alle profiel-caps zijn geldige union-leden", () => {
  const geldig = new Set<string>(PLATFORM_CAPABILITIES);
  for (const [profiel, caps] of Object.entries(PLATFORM_ROL_CAPABILITIES)) {
    for (const cap of caps) {
      assert.ok(geldig.has(cap), `${profiel}: ${cap} is geen union-lid`);
    }
  }
});

test("zware caps zijn een deelverzameling van de union", () => {
  const geldig = new Set<string>(PLATFORM_CAPABILITIES);
  for (const cap of ZWARE_CAPABILITIES) {
    assert.ok(geldig.has(cap), `${cap} is geen union-lid`);
  }
});

test("isZwareCapability klopt voor grant en niet voor observability.read", () => {
  assert.equal(isZwareCapability("platform.capabilities.grant"), true);
  assert.equal(isZwareCapability("platform.observability.read"), false);
});

test("heeftCapability: lege/null effectieve set = geen toegang", () => {
  assert.equal(heeftCapability(null, "platform.config.manage"), false);
  assert.equal(heeftCapability([], "platform.config.manage"), false);
});

test("heeftCapability: alleen expliciet toegekende cap geldt (least privilege)", () => {
  const eff: PlatformCapability[] = ["platform.observability.read"];
  assert.equal(heeftCapability(eff, "platform.observability.read"), true);
  assert.equal(heeftCapability(eff, "platform.logs.read"), false);
});

// ── Code↔seed-consistentie: spiegel exact de seed in de migratie. ──────────
// Wijzigt de union, dan MOET deze lijst (en de DB-seed) meebewegen, anders
// faalt test 17. Houd alfabetisch los van volgorde via set-vergelijking.
const SEED_IN_MIGRATIE = [
  "platform.generic.library.manage",
  "platform.config.manage",
  "platform.tenants.manage",
  "platform.identities.manage",
  "platform.capabilities.grant",
  "platform.capabilities.revoke",
  "platform.observability.read",
  "platform.logs.read",
  "platform.security.operate",
  "platform.support.operate",
  "platform.compliance.read",
  "platform.contact.manage",
  "platform.aqlab.operate",
  "platform.aqlab.review",
  "platform.aqlab.govern",
] as const;

test("code-union en migratie-seed zijn identiek (TO §12 test 17)", () => {
  const union = new Set<string>(PLATFORM_CAPABILITIES);
  const seed = new Set<string>(SEED_IN_MIGRATIE);
  assert.equal(seed.size, union.size, "aantal verschilt");
  for (const cap of union) assert.ok(seed.has(cap), `seed mist ${cap}`);
  for (const cap of seed) assert.ok(union.has(cap as PlatformCapability), `union mist ${cap}`);
});

console.log(`\n${n} sanity-tests geslaagd.`);
