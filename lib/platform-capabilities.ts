// ============================================================================
//  Platform-capabilitymodel (Increment P0 — TO v1.1 §4.1/§4.3, B14).
// ----------------------------------------------------------------------------
//  BEWUST GESCHEIDEN van lib/capabilities.ts (tenant). Dit is de bron-van-
//  waarheid voor PLATFORM-autorisatie; de DB-tabel platform_capabilities is
//  slechts een geseede referentie (FK-integriteit). Een CI-/sanitycheck faalt
//  als code-union en seed divergeren (TO §12 test 17).
//
//  Least privilege: de effectieve capabilities van een identiteit komen uit
//  platform_identity_capabilities (per-identiteit). PLATFORM_ROL_CAPABILITIES is
//  een HULPMIDDEL bij toekenning (scheiding van machten, FO §5.4), geen grove rol.
//
//  Geen platform.* in de tenant-mapping en omgekeerd: de tenant-requireCapability
//  kent geen platform.* (TO §10).
// ============================================================================

/** De 12 platform-capabilities. Gesplitst tegen te brede bundeling (TO §4.1):
 *  tenants.manage / identities.manage / capabilities.grant / capabilities.revoke
 *  zijn aparte caps, zodat "fondsen beheren" niet "rechten uitdelen" impliceert.
 *  contact.manage staat los: het beheert UITSLUITEND de niet-tenant contact-
 *  inbox van de publieke voorkant (geen platform-privilege-escalatie). */
export type PlatformCapability =
  | "platform.generic.library.manage"
  | "platform.config.manage"
  | "platform.tenants.manage"          // fondsen aanmaken/(de)activeren
  | "platform.identities.manage"       // platform-identiteiten aanmaken/blokkeren
  | "platform.capabilities.grant"      // capabilities TOEKENNEN (extra zwaar — §4.3)
  | "platform.capabilities.revoke"     // capabilities INTREKKEN
  | "platform.observability.read"
  | "platform.logs.read"
  | "platform.security.operate"
  | "platform.support.operate"
  | "platform.compliance.read"
  | "platform.contact.manage";         // publieke contact-inbox inzien/opvolgen

/** Volledige, geordende lijst — gespiegeld door de DB-seed (TO §12 test 17). */
export const PLATFORM_CAPABILITIES: readonly PlatformCapability[] = [
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
] as const;

/** Zware capabilities: toekennen vereist altijd vier-ogen (vier_ogen_door
 *  ≠ toegekend_door). TO §2.2/§4.3. */
export const ZWARE_CAPABILITIES: ReadonlySet<PlatformCapability> = new Set([
  "platform.logs.read",
  "platform.support.operate",
  "platform.security.operate",
  "platform.tenants.manage",
  "platform.identities.manage",
  "platform.capabilities.grant",
  "platform.capabilities.revoke",
]);

/** Functieprofielen (scheiding van machten, FO §5.4) — hulpmiddel bij
 *  toekenning, GEEN grove autorisatierol. Het brede v1.0-support-profiel is
 *  gesplitst in drie smalle profielen. platform.capabilities.grant/revoke zit
 *  in GEEN profiel: per-identiteit, vier-ogen, extra zwaar (§4.3). */
export const PLATFORM_ROL_CAPABILITIES: Record<string, PlatformCapability[]> = {
  platformbeheer: [
    "platform.generic.library.manage",
    "platform.config.manage",
    "platform.tenants.manage",
    "platform.observability.read",
    "platform.compliance.read",
  ],
  platform_identity_admin: ["platform.identities.manage"],
  platform_support_viewer: [
    "platform.observability.read",
    "platform.support.operate",
    "platform.contact.manage",
  ],
  platform_security_op: ["platform.observability.read", "platform.security.operate"],
  platform_audit_reader: ["platform.observability.read", "platform.logs.read"],
};

/** Pure check: bevat de set effectieve capabilities de gevraagde cap?
 *  Testbaar zonder DB. De effectieve set wordt door lib/platform-auth.ts uit
 *  platform_identity_capabilities geladen (actieve grants). */
export function heeftCapability(
  effectief: readonly PlatformCapability[] | null | undefined,
  cap: PlatformCapability
): boolean {
  if (!effectief) return false;
  return effectief.includes(cap);
}

/** Vereist een toekenning van deze capability vier-ogen? */
export function isZwareCapability(cap: PlatformCapability): boolean {
  return ZWARE_CAPABILITIES.has(cap);
}
