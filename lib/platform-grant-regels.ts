// ============================================================================
//  Anti-privilege-escalatie — pure beslisregels voor grant/revoke (TO §4.3).
// ----------------------------------------------------------------------------
//  Bewust GESCHEIDEN van lib/platform-wrapper.ts: die module is `server-only`
//  (service-role + sessie), terwijl deze regels puur zijn (geen IO, geen
//  server-only). Zo zijn ze los uitvoerbaar in de sanity-test (npx tsx) zonder
//  de server-only-laag te laden. De wrapper re-exporteert ze, zodat aanroepende
//  code één importpad houdt.
//
//  DB-CHECKs dekken self-grant (14a) en self-approval (14b) op constraintniveau;
//  deze guards dekken de actor-capability-afhankelijke regels (14c/14d/14e) en de
//  vier-ogen-eis in code.
// ============================================================================

import {
  heeftCapability,
  isZwareCapability,
  type PlatformCapability,
} from "@/lib/platform-capabilities";

export type GuardUitkomst = { ok: true } | { ok: false; foutcode: string };

export type GrantInput = {
  actorId: string;
  actorCapabilities: readonly PlatformCapability[];
  doelIdentityId: string;
  capability: PlatformCapability;
  vierOgenDoor: string | null;
  /** break-glass of expliciete eigenaarstoestemming (FO §15.3). */
  breakGlass?: boolean;
};

/** Valideert een capability-TOEKENNING. DB-CHECKs dekken self-grant (14a) en
 *  self-approval (14b); deze guard dekt 14c/14d en de vier-ogen-eis in code. */
export function valideerGrant(i: GrantInput): GuardUitkomst {
  if (i.doelIdentityId === i.actorId) return { ok: false, foutcode: "self_grant" }; // 14a
  if (!heeftCapability(i.actorCapabilities, "platform.capabilities.grant"))
    return { ok: false, foutcode: "capability_denied" }; // 14c
  if (isZwareCapability(i.capability)) {
    if (!i.vierOgenDoor || i.vierOgenDoor === i.actorId)
      return { ok: false, foutcode: "vier_ogen_vereist" }; // vier-ogen (≠ toegekend_door)
  }
  if (i.capability === "platform.capabilities.grant" && i.breakGlass !== true)
    return { ok: false, foutcode: "break_glass_vereist" }; // 14d: grant-van-grant
  return { ok: true };
}

export type RevokeInput = {
  actorId: string;
  actorCapabilities: readonly PlatformCapability[];
  doelIdentityId: string;
  capability: PlatformCapability;
  /** bevestiging door een tweede beheerder bij zelf-intrekking van een zware cap. */
  tweedeBeheerderBevestigd?: boolean;
};

/** Valideert een capability-INTREKKING. Dekt 14c-analoog (revoke-recht) en 14e
 *  (zelf-intrekking van een eigen zware cap alleen onder gecontroleerde conditie). */
export function valideerRevoke(i: RevokeInput): GuardUitkomst {
  if (!heeftCapability(i.actorCapabilities, "platform.capabilities.revoke"))
    return { ok: false, foutcode: "capability_denied" };
  const zelfIntrekkingZwaar =
    i.doelIdentityId === i.actorId && isZwareCapability(i.capability);
  if (zelfIntrekkingZwaar && i.tweedeBeheerderBevestigd !== true)
    return { ok: false, foutcode: "tweede_beheerder_vereist" }; // 14e
  return { ok: true };
}
