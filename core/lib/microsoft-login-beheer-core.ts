// ============================================================================
//  core/lib/microsoft-login-beheer-core.ts — PURE kern van het beheerpad van het
//  Microsoft-loginbeleid (fase 1C, #344 PR-B; besluit 0212). Geen I/O.
// ----------------------------------------------------------------------------
//  Wat hier staat: de bodycontracten van de beheerroutes (zod), de vorm van de
//  beheerrespons (zonder tenant-id, zonder tid/oid/sub/e-mail), het opake
//  herkoppeltoken en de uitnodigingslink, en de vaste beheerteksten.
//
//  Het herkoppeltoken (0212 D4): 32 willekeurige bytes, base64url. Alleen de
//  sha256 gaat naar de database; het token zelf verlaat de server precies één
//  keer — in de respons aan de beheerder — en staat daarna nergens meer: niet in
//  de URL-PATH (fragment: `/koppelen#<token>`), niet in log, audit of HTML.
// ============================================================================

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  HERKOPPEL_TOKEN_BYTES,
  isHerkoppelTokenVorm,
  LOGIN_MODI,
  type BeleidFoutcategorie,
  type LoginModus,
  type Preflight,
} from "@/core/lib/microsoft-login-beleid-core";
import type { BreakglassRegel, DekkingsRegel } from "@/core/lib/microsoft-login-gateway";
import { HERKOPPEL_TOKEN_RE, KOPPEL_PAD } from "@/core/lib/microsoft-login-meldingen-core";

export { BEHEER_TEKSTEN, KOPPEL_PAD, tokenUitFragment, UITNODIGING_ONGELDIG_MELDING } from "@/core/lib/microsoft-login-meldingen-core";

// ── Bodycontracten (RouteSpecV1.schema) ─────────────────────────────────────

const uuid = z.string().uuid();

export const BELEID_PATCH_SCHEMA = z.object({ modus: z.enum(LOGIN_MODI) }).strict();
export const INTREKKING_SCHEMA = z.object({ doelUserId: uuid, afronden: z.boolean().optional() }).strict();
export const BREAKGLASS_REDENEN = ["entra_storing", "beheerherstel", "migratie"] as const;
export type BreakglassReden = (typeof BREAKGLASS_REDENEN)[number];
export const BREAKGLASS_SCHEMA = z
  .object({ doelUserId: uuid, reden: z.enum(BREAKGLASS_REDENEN), herzienOverDagen: z.number().int().min(7).max(365).optional() })
  .strict();
export const UITNODIGING_SCHEMA = z.object({ doelUserId: uuid }).strict();

/** Standaard herzieningstermijn van een break-glassaanwijzing (verloopbewaking, geen einddatum). */
export const BREAKGLASS_HERZIEN_OVER_DAGEN = 90;

// ── Beheerrespons ───────────────────────────────────────────────────────────

export type BeheerDekkingsRij = {
  readonly userId: string;
  readonly naam: string | null;
  readonly rol: string | null;
  readonly bindingStatus: DekkingsRegel["bindingStatus"];
  readonly laatstGebruiktOp: string | null;
  readonly breakGlass: boolean;
  readonly uitnodigingOpen: boolean;
  /** Afgeleid: telt dit account als gedekt voor `verplicht`? */
  readonly gedekt: boolean;
};

export type BeheerBreakglassRij = {
  readonly id: string;
  readonly userId: string;
  readonly naam: string | null;
  readonly redenCategorie: string;
  readonly uitgegevenOp: string;
  readonly herzienVoor: string;
  readonly herzieningVerlopen: boolean;
  readonly laatstGebruiktOp: string | null;
};

export type BeheerBeleidRespons = {
  readonly modus: LoginModus;
  /** Alleen óf er een tenant staat — nooit de tenant-id zelf (reviewafspraak PR-B). */
  readonly tenantGeconfigureerd: boolean;
  readonly preflight: Preflight;
  readonly magActiveren: boolean;
  readonly activeringWeigering: string | null;
  readonly dekking: readonly BeheerDekkingsRij[];
  readonly breakglass: readonly BeheerBreakglassRij[];
};

const iso = (d: Date | null) => (d === null ? null : d.toISOString());

/** Vormt de gatewayuitkomsten om tot de beheerrespons. Puur: geen I/O. */
export function bouwBeheerBeleidRespons(args: {
  modus: LoginModus;
  entraTenantId: string | null;
  preflight: Preflight;
  dekking: readonly DekkingsRegel[];
  breakglass: readonly BreakglassRegel[];
  magActiveren: (p: Preflight) => boolean;
  activeringWeigering: (c: BeleidFoutcategorie | null, ongedekt: number) => string;
}): BeheerBeleidRespons {
  const mag = args.magActiveren(args.preflight);
  return {
    modus: args.modus,
    tenantGeconfigureerd: typeof args.entraTenantId === "string" && args.entraTenantId.length > 0,
    preflight: args.preflight,
    magActiveren: mag,
    activeringWeigering: mag ? null : args.activeringWeigering(args.preflight.categorie, args.preflight.ongedekteAccounts),
    dekking: args.dekking.map((r) => ({
      userId: r.userId,
      naam: r.naam,
      rol: r.rol,
      bindingStatus: r.bindingStatus,
      laatstGebruiktOp: iso(r.laatstGebruiktOp),
      breakGlass: r.breakGlass,
      uitnodigingOpen: r.uitnodigingOpen,
      gedekt: r.bindingStatus === "active" || r.breakGlass,
    })),
    breakglass: args.breakglass.map((b) => ({
      id: b.id,
      userId: b.userId,
      naam: b.naam,
      redenCategorie: b.redenCategorie,
      uitgegevenOp: b.uitgegevenOp.toISOString(),
      herzienVoor: b.herzienVoor.toISOString(),
      herzieningVerlopen: b.herzieningVerlopen,
      laatstGebruiktOp: iso(b.laatstGebruiktOp),
    })),
  };
}

/** Sleutels die NOOIT in een beheerrespons mogen voorkomen (contracttest). */
export const VERBODEN_RESPONSSLEUTELS = ["entraTenantId", "entra_tenant_id", "tid", "oid", "sub", "email", "token_hash", "tokenHash"] as const;

// ── Herkoppeltoken en uitnodigingslink ──────────────────────────────────────

/** Opaak token: 32 bytes base64url (43 tekens). */
export function maakHerkoppelToken(random: (n: number) => Buffer = randomBytes): string {
  return random(HERKOPPEL_TOKEN_BYTES).toString("base64url");
}

/** De ENIGE afgeleide die de server bewaart. */
export function herkoppelTokenHash(token: string): string {
  if (!isHerkoppelTokenVorm(token)) throw new Error("Herkoppeltoken heeft niet de verwachte vorm.");
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Uitnodigingslink: het token staat UITSLUITEND in het URL-fragment. Een fragment
 * wordt door de browser niet naar de server gestuurd en komt dus niet in Vercel-/
 * proxylogs, referrers of analytics; de pagina leest het client-side, verwijdert
 * het direct uit de adresbalk en stuurt het alleen in de body van een POST.
 */
export function bouwUitnodigingsLink(origin: string, token: string): string {
  const o = new URL(origin);
  if (o.pathname !== "/" || o.search || o.hash || o.username || o.password) throw new Error("Origin is geen kale oorsprong.");
  if (!isHerkoppelTokenVorm(token)) throw new Error("Herkoppeltoken heeft niet de verwachte vorm.");
  return `${o.origin}${KOPPEL_PAD}#${token}`;
}

/** Activeringsbody van de publieke POST (app/auth/microsoft-login/uitnodiging). */
export const ACTIVERING_SCHEMA = z.object({ token: z.string().regex(HERKOPPEL_TOKEN_RE) }).strict();
