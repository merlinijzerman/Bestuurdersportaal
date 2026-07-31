// ============================================================================
//  withPlatform — de ENIGE toegangspoort voor platformhandelingen (TO §4.2/§4.3).
// ----------------------------------------------------------------------------
//  Elke service-role-handeling loopt hier doorheen (invariant a). De wrapper:
//   1. maakt ALTIJD eerst de correlatie_id (invariant b);
//   2. weigert sessieloos/inactief → security-log + 403;
//   3. doet een LIVE MFA/AAL2-hercheck (niet de boolean) → 403 mfa_required;
//   4. checkt de capability → 403 capability_denied;
//   5. schrijft het attempt-event FAIL-CLOSED (503 als onschrijfbaar) (invariant d);
//   6. voert de businessactie uit in een GESCHEIDEN transactie (eigen client);
//   7. garandeert het result-event (succes/fout) — invariant c.
//
//  Anti-privilege-escalatie (§4.3) zit in de pure guards valideerGrant/
//  valideerRevoke (DB-CHECKs dekken self-grant/self-approval; deze guards dekken
//  de actor-capability-afhankelijke regels). Ze worden door de P3-grant/revoke-
//  acties geconsumeerd; in P0 leveren ze de afdwingbare, testbare kern.
// ============================================================================

import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPlatformSupabase } from "@/platform/lib/supabase-platform";
import {
  huidigePlatformIdentiteit,
  heeftActueleMFA,
  type PlatformIdentiteit,
} from "@/platform/lib/platform-auth";
import {
  heeftCapability,
  type PlatformCapability,
} from "@/platform/lib/platform-capabilities";
import {
  logAttempt,
  logResultGegarandeerd,
  logSecurity,
} from "@/platform/lib/platform-audit";

export class PlatformError extends Error {
  constructor(
    public status: 403 | 503 | 500,
    public foutcode: string,
    message?: string
  ) {
    super(message ?? foutcode);
    this.name = "PlatformError";
  }
}

export type WithPlatformOpts = {
  capability: PlatformCapability;
  handeling: string;
  doelFondsId?: string | null;
  doelObject?: string | null;
  reden?: string | null;
  bronIp?: string | null;
  verwachteScope?: unknown;
};

export type PlatformActieResultaat<T> = {
  resultaat: T;
  /** Feitelijk effect t.b.v. het result-event (aantallen/typen, geen inhoud). */
  effect?: unknown;
};

/** Voert `fn` uit achter capability- + twee-fasen-auditcontrole. `fn` krijgt de
 *  service-role-client (RLS-bypass) en de actor-identiteit. Gooit PlatformError
 *  (403/503) bij weigering; propageert businessfouten ná het result-event. */
export async function withPlatform<T>(
  opts: WithPlatformOpts,
  fn: (svc: SupabaseClient, ctx: { identiteit: PlatformIdentiteit; correlatieId: string }) => Promise<PlatformActieResultaat<T>>
): Promise<T> {
  const correlatieId = randomUUID(); // invariant b: vóór de eerste logregel

  const identiteit = await huidigePlatformIdentiteit();

  // 1) Ongeauthenticeerd / inactief → security-log (identity onbekend) + 403.
  if (!identiteit || !identiteit.actief) {
    await logSecurity({
      correlatieId,
      capability: opts.capability,
      handeling: opts.handeling,
      doelObject: opts.doelObject ?? null,
      reden: opts.reden ?? null,
      bronIp: opts.bronIp ?? null,
      foutcode: "no_session_or_inactive",
    });
    throw new PlatformError(403, "no_session_or_inactive");
  }

  // 2) Live MFA/AAL2-hercheck (niet de mfa_enrolled-boolean).
  if (!(await heeftActueleMFA())) {
    await logGeweigerd(correlatieId, identiteit, opts, "mfa_required");
    throw new PlatformError(403, "mfa_required");
  }

  // 3) Capabilitycheck (least privilege, uit de actieve grants).
  if (!heeftCapability(identiteit.capabilities, opts.capability)) {
    await logGeweigerd(correlatieId, identiteit, opts, "capability_denied");
    throw new PlatformError(403, "capability_denied");
  }

  // 4) Attempt MOET geschreven zijn vóór uitvoering (fail-closed → 503).
  try {
    await logAttempt({
      correlatieId,
      identityId: identiteit.id,
      capability: opts.capability,
      handeling: opts.handeling,
      doelFondsId: opts.doelFondsId ?? null,
      doelObject: opts.doelObject ?? null,
      reden: opts.reden ?? null,
      bronIp: opts.bronIp ?? null,
      verwachteScope: opts.verwachteScope ?? null,
    });
  } catch {
    throw new PlatformError(503, "audit_unavailable");
  }

  // 5) Businessactie in een GESCHEIDEN transactie (eigen service-role-client).
  try {
    const svc = createPlatformSupabase();
    const res = await fn(svc, { identiteit, correlatieId });
    await logResultGegarandeerd({
      correlatieId,
      identityId: identiteit.id,
      capability: opts.capability,
      handeling: opts.handeling,
      doelFondsId: opts.doelFondsId ?? null,
      doelObject: opts.doelObject ?? null,
      reden: opts.reden ?? null,
      uitkomst: "succes",
      effect: res.effect ?? null,
    });
    return res.resultaat;
  } catch (e) {
    const foutcode = e instanceof PlatformError ? e.foutcode : "business_error";
    await logResultGegarandeerd({
      correlatieId,
      identityId: identiteit.id,
      capability: opts.capability,
      handeling: opts.handeling,
      doelFondsId: opts.doelFondsId ?? null,
      doelObject: opts.doelObject ?? null,
      reden: opts.reden ?? null,
      uitkomst: "fout",
      foutcode,
    });
    throw e;
  }
}

/** Opties voor een geaudit LEESPAD. Bewust smaller dan WithPlatformOpts: bij
 *  lezen verandert er niets, dus `verwachteScope` heeft geen betekenis — maar
 *  `doelFondsId` wél, zodat cross-tenant inzage herleidbaar is. */
export type WithPlatformReadOpts = {
  capability: PlatformCapability;
  handeling: string;
  doelFondsId?: string | null;
  doelObject?: string | null;
  bronIp?: string | null;
};

/**
 * Geaudit LEESPAD met de service-role-client.
 *
 * H-15 (review 2026-07-30). `platform/lib/supabase-platform.ts` stelt als
 * invariant (a) dat de service-role-client uitsluitend achter de capability- en
 * auditwrapper wordt aangeroepen. Voor de SCHRIJFkant klopte dat — alle server
 * actions lopen door `withPlatform`. De LEESkant niet: negen pagina's en één
 * API-route maakten rechtstreeks een client aan. Daardoor liet het inzien van
 * álle contactgegevens (naam, e-mail, telefoon, vrije tekst), van alle
 * tenantgebruikers per fonds en van de organisatieprofielen van álle fondsen
 * géén enkel spoor na. Forensisch was niet vast te stellen dát het gebeurde, en
 * de AVG-verantwoordingsplicht (wie zag welke persoonsgegevens) was niet in te
 * vullen. Bovendien ontbrak in die pagina's de `actief`-check en de live
 * AAL2-hercheck; die zaten alleen in de layout.
 *
 * Verschil met `withPlatform`: géén attempt-event, en de audit is BEST-EFFORT
 * in plaats van fail-closed. Een leespad mag niet in een 503 eindigen omdat de
 * auditlog even niet schrijfbaar is — dat maakt de back-office onbruikbaar
 * terwijl er niets muteert. Elke geslaagde inzage levert wél een result-event
 * met het feitelijke effect (aantallen/scope, nooit inhoud).
 *
 * Gooit `PlatformError` (403) bij weigering, net als `withPlatform`.
 */
export async function withPlatformRead<T>(
  opts: WithPlatformReadOpts,
  fn: (
    svc: SupabaseClient,
    ctx: { identiteit: PlatformIdentiteit; correlatieId: string }
  ) => Promise<{ resultaat: T; effect?: unknown }>
): Promise<T> {
  const correlatieId = randomUUID();
  const auditOpts: WithPlatformOpts = {
    capability: opts.capability,
    handeling: opts.handeling,
    doelFondsId: opts.doelFondsId ?? null,
    doelObject: opts.doelObject ?? null,
    bronIp: opts.bronIp ?? null,
  };

  const identiteit = await huidigePlatformIdentiteit();
  if (!identiteit || !identiteit.actief) {
    await logSecurity({
      correlatieId,
      capability: opts.capability,
      handeling: opts.handeling,
      doelObject: opts.doelObject ?? null,
      reden: null,
      bronIp: opts.bronIp ?? null,
      foutcode: "no_session_or_inactive",
    });
    throw new PlatformError(403, "no_session_or_inactive");
  }

  if (!(await heeftActueleMFA())) {
    await logGeweigerd(correlatieId, identiteit, auditOpts, "mfa_required");
    throw new PlatformError(403, "mfa_required");
  }

  if (!heeftCapability(identiteit.capabilities, opts.capability)) {
    await logGeweigerd(correlatieId, identiteit, auditOpts, "capability_denied");
    throw new PlatformError(403, "capability_denied");
  }

  try {
    const svc = createPlatformSupabase();
    const res = await fn(svc, { identiteit, correlatieId });
    await logResultGegarandeerd({
      correlatieId,
      identityId: identiteit.id,
      capability: opts.capability,
      handeling: opts.handeling,
      doelFondsId: opts.doelFondsId ?? null,
      doelObject: opts.doelObject ?? null,
      reden: null,
      uitkomst: "succes",
      effect: res.effect ?? null,
    });
    return res.resultaat;
  } catch (e) {
    await logResultGegarandeerd({
      correlatieId,
      identityId: identiteit.id,
      capability: opts.capability,
      handeling: opts.handeling,
      doelFondsId: opts.doelFondsId ?? null,
      doelObject: opts.doelObject ?? null,
      reden: null,
      uitkomst: "fout",
      foutcode: e instanceof PlatformError ? e.foutcode : "lees_error",
    });
    throw e;
  }
}

async function logGeweigerd(
  correlatieId: string,
  identiteit: PlatformIdentiteit,
  opts: WithPlatformOpts,
  foutcode: string
): Promise<void> {
  // attempt + result voor een geweigerde handeling. Best-effort: een logfout
  // mag een 403 niet in een 503 veranderen (de handeling gaat sowieso niet door).
  try {
    await logAttempt({
      correlatieId,
      identityId: identiteit.id,
      capability: opts.capability,
      handeling: opts.handeling,
      doelFondsId: opts.doelFondsId ?? null,
      doelObject: opts.doelObject ?? null,
      reden: opts.reden ?? null,
      bronIp: opts.bronIp ?? null,
      verwachteScope: opts.verwachteScope ?? null,
    });
  } catch {
    /* best-effort */
  }
  await logResultGegarandeerd({
    correlatieId,
    identityId: identiteit.id,
    capability: opts.capability,
    handeling: opts.handeling,
    doelFondsId: opts.doelFondsId ?? null,
    doelObject: opts.doelObject ?? null,
    reden: opts.reden ?? null,
    uitkomst: "geweigerd",
    foutcode,
  });
}

// ── Anti-privilege-escalatie — pure guards (§4.3) ──────────────────────────
// De beslislogica leeft in lib/platform-grant-regels.ts (puur, server-only-vrij
// → los testbaar). Hier alleen re-export, zodat aanroepers één importpad houden.
export {
  valideerGrant,
  valideerRevoke,
  type GrantInput,
  type RevokeInput,
  type GuardUitkomst,
} from "@/platform/lib/platform-grant-regels";
