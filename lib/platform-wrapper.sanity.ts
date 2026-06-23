// ============================================================================
//  Sanity-tests voor de anti-privilege-escalatie-guards (TO §4.3, tests 14a-e).
//
//  withPlatform zelf hangt aan sessie/DB en is niet pure-TS testbaar; de
//  beslis-LOGICA voor grant/revoke is geïsoleerd in valideerGrant/valideerRevoke
//  en wordt hier 1-op-1 tegen de regels getoetst. De DB-CHECK-kant (self-grant
//  14a / self-approval 14b op constraintniveau) verifieert scripts/platform_checks.sql.
//
//  Uitvoeren: npx tsx lib/platform-wrapper.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import {
  valideerGrant,
  valideerRevoke,
  type GuardUitkomst,
} from "./platform-grant-regels";
import type { PlatformCapability } from "./platform-capabilities";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}
function weigert(u: GuardUitkomst, foutcode: string) {
  assert.equal(u.ok, false);
  if (!u.ok) assert.equal(u.foutcode, foutcode);
}

const GRANTER: PlatformCapability[] = ["platform.capabilities.grant"];
const REVOKER: PlatformCapability[] = ["platform.capabilities.revoke"];

console.log("platform-wrapper anti-escalatie sanity-tests:");

// 14a — self-grant (ook DB-CHECK).
test("14a self-grant geweigerd", () => {
  weigert(
    valideerGrant({
      actorId: "A",
      actorCapabilities: GRANTER,
      doelIdentityId: "A",
      capability: "platform.observability.read",
      vierOgenDoor: "B",
    }),
    "self_grant"
  );
});

// 14c — toekennen zonder capabilities.grant, ook mét andere zware caps.
test("14c grant zonder capabilities.grant geweigerd (ook met tenants.manage)", () => {
  weigert(
    valideerGrant({
      actorId: "A",
      actorCapabilities: ["platform.tenants.manage", "platform.identities.manage"],
      doelIdentityId: "B",
      capability: "platform.observability.read",
      vierOgenDoor: "C",
    }),
    "capability_denied"
  );
});

// Vier-ogen voor zware caps: ontbrekend of = actor → geweigerd.
test("zware cap zonder vier-ogen geweigerd", () => {
  weigert(
    valideerGrant({
      actorId: "A",
      actorCapabilities: GRANTER,
      doelIdentityId: "B",
      capability: "platform.tenants.manage",
      vierOgenDoor: null,
    }),
    "vier_ogen_vereist"
  );
});

test("zware cap met vier_ogen_door = actor (self-approval) geweigerd", () => {
  weigert(
    valideerGrant({
      actorId: "A",
      actorCapabilities: GRANTER,
      doelIdentityId: "B",
      capability: "platform.tenants.manage",
      vierOgenDoor: "A",
    }),
    "vier_ogen_vereist"
  );
});

// 14d — grant-van-grant vereist break-glass.
test("14d toekennen van capabilities.grant zonder break-glass geweigerd", () => {
  weigert(
    valideerGrant({
      actorId: "A",
      actorCapabilities: GRANTER,
      doelIdentityId: "B",
      capability: "platform.capabilities.grant",
      vierOgenDoor: "C",
    }),
    "break_glass_vereist"
  );
});

test("14d toekennen van capabilities.grant MET break-glass + vier-ogen toegestaan", () => {
  const u = valideerGrant({
    actorId: "A",
    actorCapabilities: GRANTER,
    doelIdentityId: "B",
    capability: "platform.capabilities.grant",
    vierOgenDoor: "C",
    breakGlass: true,
  });
  assert.equal(u.ok, true);
});

test("geldige zware grant met correcte vier-ogen toegestaan", () => {
  const u = valideerGrant({
    actorId: "A",
    actorCapabilities: GRANTER,
    doelIdentityId: "B",
    capability: "platform.logs.read",
    vierOgenDoor: "C",
  });
  assert.equal(u.ok, true);
});

test("lichte cap (observability.read) zonder vier-ogen toegestaan", () => {
  const u = valideerGrant({
    actorId: "A",
    actorCapabilities: GRANTER,
    doelIdentityId: "B",
    capability: "platform.observability.read",
    vierOgenDoor: null,
  });
  assert.equal(u.ok, true);
});

// 14e — zelf-intrekking van een eigen zware cap.
test("14e zelf-intrekking eigen zware cap zonder tweede beheerder geweigerd", () => {
  weigert(
    valideerRevoke({
      actorId: "A",
      actorCapabilities: REVOKER,
      doelIdentityId: "A",
      capability: "platform.capabilities.grant",
    }),
    "tweede_beheerder_vereist"
  );
});

test("14e zelf-intrekking eigen zware cap MET tweede beheerder toegestaan", () => {
  const u = valideerRevoke({
    actorId: "A",
    actorCapabilities: REVOKER,
    doelIdentityId: "A",
    capability: "platform.capabilities.grant",
    tweedeBeheerderBevestigd: true,
  });
  assert.equal(u.ok, true);
});

test("revoke zonder capabilities.revoke geweigerd", () => {
  weigert(
    valideerRevoke({
      actorId: "A",
      actorCapabilities: ["platform.capabilities.grant"],
      doelIdentityId: "B",
      capability: "platform.observability.read",
    }),
    "capability_denied"
  );
});

test("intrekken van andermans cap met revoke-recht toegestaan", () => {
  const u = valideerRevoke({
    actorId: "A",
    actorCapabilities: REVOKER,
    doelIdentityId: "B",
    capability: "platform.tenants.manage",
  });
  assert.equal(u.ok, true);
});

console.log(`\n${n} sanity-tests geslaagd.`);
