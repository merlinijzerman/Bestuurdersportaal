// ============================================================================
//  core/lib/microsoft-login-identity-core.ts — PURE claimvalidatie van het
//  Microsoft-ID-token voor de login-flow (fase 1B, #335 T2; ontwerp §2.6, §6.10).
// ----------------------------------------------------------------------------
//  De handtekening is vóór deze stap al geverifieerd (microsoft-login-oidc-core).
//  Hier worden UITSLUITEND de claims exact getoetst, fail-closed, en wordt de
//  bindingsidentiteit (tid, oid, sub) eruit gehaald. E-mail, preferred_username
//  en name worden niet gelezen en nooit teruggegeven. Bewust een eigen module
//  naast microsoft-identity-core.ts (Graph-connector): gescheiden vertrouwens-
//  domeinen, geen import over en weer.
// ============================================================================

import type { MicrosoftLoginFoutcategorie } from "@/core/lib/microsoft-login-error-core";
import { isGeldigeIdentiteitsvorm } from "@/core/lib/microsoft-login-binding-core";

/** Tenant-id van persoonlijke Microsoft-accounts (MSA); nooit toegestaan. */
export const MSA_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

export type MicrosoftLoginIdentiteit = { readonly tid: string; readonly oid: string; readonly sub: string };

export type IdTokenOordeel =
  | { ok: true; identiteit: MicrosoftLoginIdentiteit }
  | { ok: false; categorie: Extract<MicrosoftLoginFoutcategorie, `claim_${string}`> };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Exacte claimvalidatie (ontwerp §2.6 / besluit 0211 punt 5):
 *   iss   exact `https://login.microsoftonline.com/<tid>/v2.0` (of de expliciet
 *         meegegeven issuer — de lokale E2E-stub)
 *   aud   = App L client-id
 *   exp   > nu (seconden)
 *   ver   = "2.0"
 *   nonce = sha256-hex van onze nonce
 *   tid   = geconfigureerde tenant, ≠ MSA
 *   idp   afwezig of gelijk aan iss (geen gast/federatie)
 *   acct  AANWEZIG én 0 (lid; 1 = gast; ontbreken = weigeren)
 *   oid/sub niet leeg, GUID-vorm voor oid
 */
export function valideerIdToken(
  claims: Record<string, unknown>,
  verwacht: { tenantId: string; clientId: string; nonceHash: string; nuSeconden: number; issuer?: string },
): IdTokenOordeel {
  const tenantId = verwacht.tenantId.toLowerCase();
  const tid = str(claims.tid).toLowerCase();
  if (!tid || tid !== tenantId) return { ok: false, categorie: "claim_tid" };
  if (tid === MSA_TENANT_ID) return { ok: false, categorie: "claim_msa" };

  const iss = str(claims.iss);
  const verwachteIssuer = (verwacht.issuer ?? `https://login.microsoftonline.com/${tenantId}/v2.0`).toLowerCase();
  if (!iss || iss.toLowerCase() !== verwachteIssuer) return { ok: false, categorie: "claim_iss" };

  if (str(claims.aud) !== verwacht.clientId) return { ok: false, categorie: "claim_aud" };

  const exp = typeof claims.exp === "number" ? claims.exp : Number.NaN;
  if (!Number.isFinite(exp) || exp <= verwacht.nuSeconden) return { ok: false, categorie: "claim_exp" };

  if (str(claims.ver) !== "2.0") return { ok: false, categorie: "claim_ver" };

  if (!verwacht.nonceHash || str(claims.nonce) !== verwacht.nonceHash) return { ok: false, categorie: "claim_nonce" };

  if ("idp" in claims && claims.idp !== undefined && claims.idp !== null) {
    if (str(claims.idp).toLowerCase() !== iss.toLowerCase()) return { ok: false, categorie: "claim_idp" };
  }

  // acct: verplicht aanwezig én 0. Microsoft levert de claim als getal of als string.
  const acct = claims.acct;
  if (!(acct === 0 || acct === "0")) return { ok: false, categorie: "claim_acct" };

  const oid = str(claims.oid);
  const sub = str(claims.sub);
  if (!oid || !sub || !isGeldigeIdentiteitsvorm({ tid, oid, sub })) return { ok: false, categorie: "claim_oid_sub" };

  // RAUWE tokenwaarden teruggeven (geen normalisatie): de hook (T1) vergelijkt de
  // binding EXACT met identity_data.custom_claims.tid/oid zoals GoTrue ze uit
  // hetzelfde token bewaart. Een genormaliseerde binding zou dan niet matchen.
  return { ok: true, identiteit: { tid: str(claims.tid), oid, sub } };
}
