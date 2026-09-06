// ============================================================================
//  core/lib/microsoft-login-binding-core.ts — PURE kern van het bindingsmodel
//  (Microsoft-login fase 1B, #335, besluit 0211). Geen I/O, geen server-imports.
// ----------------------------------------------------------------------------
//  De database is de autoriteit voor het toestandsmodel (gatewayfuncties in
//  login_private dwingen elke overgang af). Deze kern spiegelt dat model zodat
//  de server-side gateway en latere T2-routes dezelfde vocabulaire delen en
//  overgangen vóór een databaseronde kunnen weigeren (defence-in-depth, nooit
//  de primaire controle).
// ============================================================================

import { createHash } from "node:crypto";

/** Toestandsmodel: pending → active → revoking → revoked | failed. */
export const BINDING_STATUSSEN = ["pending", "active", "revoking", "revoked", "failed"] as const;
export type BindingStatus = (typeof BINDING_STATUSSEN)[number];

/** Toegestane overgangen; eindtoestanden hebben geen uitgaande overgang. */
export const BINDING_OVERGANGEN: Readonly<Record<BindingStatus, readonly BindingStatus[]>> = {
  pending: ["active", "failed"],
  active: ["revoking"],
  revoking: ["revoked"],
  revoked: [],
  failed: [],
};

/** Statussen die de unieke "levende" slots (per identiteit, per account) bezetten. */
export const LEVENDE_STATUSSEN: readonly BindingStatus[] = ["pending", "active", "revoking"];

export function isBindingStatus(v: unknown): v is BindingStatus {
  return typeof v === "string" && (BINDING_STATUSSEN as readonly string[]).includes(v);
}

export function magOvergang(van: BindingStatus, naar: BindingStatus): boolean {
  return BINDING_OVERGANGEN[van].includes(naar);
}

export function isLevend(status: BindingStatus): boolean {
  return LEVENDE_STATUSSEN.includes(status);
}

/** Vaste foutcategorieën van de gateway (inhoudsvrij; nooit claims of e-mail). */
export const LOGIN_GATEWAY_FOUTCATEGORIEEN = [
  "config_ontbreekt",
  "fonds_mismatch",
  "binding_conflict",
  "ongeldige_overgang",
  "onbekende_binding",
  "pending_verlopen",
  "gateway_db_onbereikbaar",
  "gateway_fout",
] as const;
export type LoginGatewayFoutcategorie = (typeof LOGIN_GATEWAY_FOUTCATEGORIEEN)[number];

/**
 * Vertaalt een databasefout naar een vaste categorie. De gatewayfuncties geven
 * de categorie als `message` terug; alles wat daarbuiten valt wordt `gateway_fout`
 * (verbindingsproblemen: `gateway_db_onbereikbaar`). Er lekt nooit een ruwe
 * databasemelding naar de aanroeper.
 */
export function gatewayFoutcategorie(fout: unknown): LoginGatewayFoutcategorie {
  const bericht = fout instanceof Error ? fout.message : typeof fout === "string" ? fout : "";
  const code = (fout as { code?: unknown } | null)?.code;
  if (bericht === "fonds_mismatch" || bericht === "binding_conflict" || bericht === "ongeldige_overgang" || bericht === "onbekende_binding") {
    return bericht;
  }
  if (typeof code === "string" && /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|57P|08)/.test(code)) return "gateway_db_onbereikbaar";
  if (/niet geconfigureerd|ongeldig|geen PostgreSQL|zonder TLS/.test(bericht)) return "config_ontbreekt";
  return "gateway_fout";
}

/** Inhoudsvrije identiteitsreferentie voor audit: sha256(tid:oid), gelijk aan de DB-berekening. */
export function identiteitHash(tid: string, oid: string): string {
  return createHash("sha256").update(`${tid}:${oid}`).digest("hex");
}

/** Vormcontrole op Microsoft-identifiers (GUID-vorm voor tid/oid; sub is een opaque, niet-lege string). */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isGeldigeIdentiteitsvorm(x: { tid: string; oid: string; sub: string }): boolean {
  return GUID.test(x.tid) && GUID.test(x.oid) && typeof x.sub === "string" && x.sub.length > 0 && x.sub.length <= 256;
}
