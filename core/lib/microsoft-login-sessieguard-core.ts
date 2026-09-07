// ============================================================================
//  core/lib/microsoft-login-sessieguard-core.ts — PURE beslislaag van guard L3
//  (fase 1B, #335 T2; ontwerp §3.2 L3, §6.11).
// ----------------------------------------------------------------------------
//  De hook (L1, T1) is de primaire afdwinging. Deze guard is SECUNDAIR: hij
//  beëindigt een `oauth`-portaalsessie zonder `active` binding direct in de app,
//  binnen het intrekkingsvenster van de al uitgegeven access-token (≤ 600 s).
//
//  Twee regels die deze module puur en byte-neutraal voor het wachtwoordpad
//  houden:
//    1. Alleen bij `amr ∋ oauth` wordt de gateway geraadpleegd. Wachtwoord-,
//       magic-link- en TOTP-sessies passeren zonder enige aanroep.
//    2. Het access-token wordt hier alleen GEDECODEERD (niet geverifieerd) om te
//       beslissen óf de gateway moet worden geraadpleegd; GoTrue heeft het token
//       al geverifieerd in `auth.getUser()`. De gateway is de bron; deze module
//       vertrouwt geen claim als autorisatie.
// ============================================================================

import type { BindingStatus } from "@/core/lib/microsoft-login-binding-core";

/** amr-methodes uit een access-token; leeg bij een onleesbaar token (fail-closed
 *  voor de beslissing "is dit oauth?" is hier NIET gewenst — een onleesbaar token
 *  is al door getUser geweigerd; leeg betekent "geen oauth", dus geen gateway-call). */
export function amrUitAccessToken(accessToken: string | null | undefined): string[] {
  if (!accessToken) return [];
  const delen = accessToken.split(".");
  if (delen.length !== 3) return [];
  try {
    const payload = JSON.parse(Buffer.from(delen[1]!, "base64url").toString("utf8")) as { amr?: unknown };
    if (!Array.isArray(payload.amr)) return [];
    return payload.amr
      .map((e) => (typeof e === "string" ? e : (e as { method?: unknown } | null)?.method))
      .filter((m): m is string => typeof m === "string");
  } catch {
    return [];
  }
}

export function sessieIsOAuth(accessToken: string | null | undefined): boolean {
  return amrUitAccessToken(accessToken).includes("oauth");
}

export type GuardOordeel =
  | { toegestaan: true; reden: "geen-oauth" | "actieve-binding" }
  | { toegestaan: false; reden: "geen-binding" | "binding-niet-actief" | "gateway-fout" };

/**
 * Zou-beslissing. `binding` is de levende binding uit de gateway (of null);
 * `gatewayFout` = de gateway kon niet worden geraadpleegd → FAIL-CLOSED voor
 * oauth-sessies (nooit fail-open: de sessie zou anders de hook omzeilen tot exp).
 */
export function beoordeelBindingGuard(args: {
  isOAuth: boolean;
  binding: { status: BindingStatus } | null;
  gatewayFout?: boolean;
}): GuardOordeel {
  if (!args.isOAuth) return { toegestaan: true, reden: "geen-oauth" };
  if (args.gatewayFout) return { toegestaan: false, reden: "gateway-fout" };
  if (!args.binding) return { toegestaan: false, reden: "geen-binding" };
  if (args.binding.status !== "active") return { toegestaan: false, reden: "binding-niet-actief" };
  return { toegestaan: true, reden: "actieve-binding" };
}
