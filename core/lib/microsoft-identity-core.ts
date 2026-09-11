export type MicrosoftIdTokenClaims = Record<string, unknown>;

export function microsoftIdentiteitGeldig(
  claims: MicrosoftIdTokenClaims,
  verwacht: { tenantId: string; clientId: string; nonce: string; homeAccountId?: string },
): boolean {
  const tid = typeof claims.tid === "string" ? claims.tid : "";
  const aud = typeof claims.aud === "string" ? claims.aud : "";
  const nonce = typeof claims.nonce === "string" ? claims.nonce : "";
  const issuer = typeof claims.iss === "string" ? claims.iss : "";
  const tenantId = verwacht.tenantId.toLowerCase();
  return tid.toLowerCase() === tenantId
    && aud === verwacht.clientId
    && nonce === verwacht.nonce
    && issuer.toLowerCase() === `https://login.microsoftonline.com/${tenantId}/v2.0`
    && Boolean(verwacht.homeAccountId);
}
