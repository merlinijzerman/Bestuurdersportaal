"use server";

// ============================================================================
//  Server-actions — Capability-toekenning (Increment P3/B14, TO §4.3, FO §5.4).
// ----------------------------------------------------------------------------
//  Het toekenningspad voor PLATFORM-capabilities: een bevoegde beheerder kent
//  capabilities toe aan (of trekt ze in bij) bestaande platform-identiteiten.
//
//  Twee handelingen, ALLE achter withPlatform (twee-fasen-audit in
//  platform_event_log):
//    • capabilityToekennen  — actorcap platform.capabilities.grant.
//    • capabilityIntrekken  — actorcap platform.capabilities.revoke.
//
//  Anti-privilege-escalatie is GELAAGD:
//    • DB-CHECKs: self-grant (toegekend_door <> identity_id) en self-approval
//      (vier_ogen_door <> toegekend_door) op constraintniveau.
//    • Pure guards valideerGrant/valideerRevoke (lib/platform-grant-regels.ts):
//      actor-capability-regels, vier-ogen-eis, grant-van-grant break-glass.
//    • withPlatform: sessie/MFA/capability + fail-closed audit.
//
//  SCOPE deze iteratie (besluit Merlin 2026-06-24): UI kent UITSLUITEND NIET-ZWARE
//  capabilities toe (generic.library.manage, config.manage, observability.read,
//  compliance.read). Zware caps (incl. de vier-ogen-workflow) blijven via het
//  SQL-bootstrappad. De guards weigeren zware caps hier sowieso (vier_ogen_vereist
//  / break_glass_vereist); de UI biedt ze niet aan. Reden is hier VERPLICHT
//  (change control / governance), strenger dan de wrapper-default.
// ============================================================================

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withPlatform, PlatformError } from "@/platform/lib/platform-wrapper";
import {
  PLATFORM_CAPABILITIES,
  isZwareCapability,
  type PlatformCapability,
} from "@/platform/lib/platform-capabilities";
import { valideerGrant, valideerRevoke } from "@/platform/lib/platform-grant-regels";

const LIJST_PAD = "/platform/rechten";

export type RechtenResultaat =
  | { ok: true; bericht: string }
  | { ok: false; foutcode: string; melding: string };

// ── Hulp ─────────────────────────────────────────────────────────────────────
function platformMelding(foutcode: string): string {
  switch (foutcode) {
    case "no_session_or_inactive":
      return "Geen geldige platform-sessie. Log opnieuw in.";
    case "mfa_required":
      return "Sterke authenticatie (MFA) vereist voor deze handeling.";
    case "capability_denied":
      return "Je mist het recht om capabilities toe te kennen of in te trekken.";
    case "audit_unavailable":
      return "Auditlog tijdelijk niet beschikbaar — handeling geblokkeerd (fail-closed).";
    default:
      return "Handeling geweigerd.";
  }
}

/** Vertaalt de guard-foutcodes naar begrijpelijke meldingen. */
function guardMelding(foutcode: string): string {
  switch (foutcode) {
    case "self_grant":
      return "Je kunt jezelf geen capability toekennen (functiescheiding).";
    case "capability_denied":
      return "Je mist het recht om dit te doen.";
    case "vier_ogen_vereist":
      return "Dit is een zware capability en vereist vier-ogen. Toekennen loopt in deze versie via het SQL-bootstrappad, niet via deze UI.";
    case "break_glass_vereist":
      return "Het recht om capabilities toe te kennen wordt alleen via break-glass uitgedeeld, niet via deze UI.";
    case "tweede_beheerder_vereist":
      return "Zelf-intrekking van een zware capability vereist bevestiging door een tweede beheerder.";
    default:
      return "Handeling geweigerd door de autorisatieregels.";
  }
}

function naarFout(e: unknown, waar: string): RechtenResultaat {
  if (e instanceof PlatformError) {
    return { ok: false, foutcode: e.foutcode, melding: platformMelding(e.foutcode) };
  }
  console.error(`[P3] onverwachte fout bij ${waar}:`, e);
  return { ok: false, foutcode: "serverfout", melding: "Er ging iets mis. Probeer het opnieuw." };
}

const GELDIGE_CAPS = new Set<string>(PLATFORM_CAPABILITIES);
function isGeldigeCap(c: string): c is PlatformCapability {
  return GELDIGE_CAPS.has(c);
}

// ── 1. TOEKENNEN ────────────────────────────────────────────────────────────
export async function capabilityToekennen(input: {
  identityId: string;
  capability: string;
  reden?: string | null;
}): Promise<RechtenResultaat> {
  const reden = (input.reden ?? "").trim();
  if (!reden) {
    return { ok: false, foutcode: "reden_verplicht", melding: "Reden is verplicht bij het toekennen van een capability." };
  }
  if (!isGeldigeCap(input.capability)) {
    return { ok: false, foutcode: "ongeldige_cap", melding: "Onbekende capability." };
  }
  const capability = input.capability;
  try {
    return await withPlatform<RechtenResultaat>(
      {
        capability: "platform.capabilities.grant",
        handeling: "platform.capability.grant",
        doelObject: `identity:${input.identityId}:${capability}`,
        reden,
      },
      async (svc: SupabaseClient, ctx) => {
        // Defense in depth: de pure guard (anti-privilege-escalatie). vierOgenDoor
        // null → zware caps falen hier; de UI biedt ze niet aan.
        const guard = valideerGrant({
          actorId: ctx.identiteit.id,
          actorCapabilities: ctx.identiteit.capabilities,
          doelIdentityId: input.identityId,
          capability,
          vierOgenDoor: null,
        });
        if (!guard.ok) {
          return {
            resultaat: { ok: false, foutcode: guard.foutcode, melding: guardMelding(guard.foutcode) },
            effect: { afgewezen: guard.foutcode, capability, doel: input.identityId },
          };
        }

        // Doel-identiteit moet bestaan en actief zijn.
        const { data: doel } = await svc
          .from("platform_identities")
          .select("id, naam, actief")
          .eq("id", input.identityId)
          .maybeSingle();
        if (!doel) {
          return {
            resultaat: { ok: false, foutcode: "identiteit_onbekend", melding: "Platform-identiteit niet gevonden." },
            effect: { afgewezen: "identiteit_onbekend", doel: input.identityId },
          };
        }
        if (!(doel as { actief: boolean }).actief) {
          return {
            resultaat: { ok: false, foutcode: "identiteit_inactief", melding: "Identiteit is geblokkeerd; activeer deze eerst." },
            effect: { afgewezen: "identiteit_inactief", doel: input.identityId },
          };
        }

        const { error } = await svc.from("platform_identity_capabilities").insert({
          identity_id: input.identityId,
          capability,
          toegekend_door: ctx.identiteit.id,
          vier_ogen_door: null,
        });
        if (error) {
          // ux_pic_actief: één actieve grant per (identity, capability).
          if (error.code === "23505") {
            return {
              resultaat: { ok: false, foutcode: "reeds_toegekend", melding: "Deze identiteit heeft de capability al." },
              effect: { afgewezen: "reeds_toegekend", capability, doel: input.identityId },
            };
          }
          // chk_pic_geen_self_grant (DB) of FK.
          console.error(`[P3] grant insert mislukt:`, error.message);
          return {
            resultaat: { ok: false, foutcode: "insert_mislukt", melding: "Toekennen geweigerd door de database." },
            effect: { afgewezen: "insert_mislukt", capability, fout: error.message },
          };
        }

        revalidatePath(LIJST_PAD);
        return {
          resultaat: { ok: true, bericht: `Capability toegekend aan ${(doel as { naam: string }).naam}.` },
          effect: { capability, doel: input.identityId, zwaar: isZwareCapability(capability) },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "toekennen");
  }
}

// ── 2. INTREKKEN ────────────────────────────────────────────────────────────
export async function capabilityIntrekken(input: {
  identityId: string;
  capability: string;
  reden?: string | null;
}): Promise<RechtenResultaat> {
  const reden = (input.reden ?? "").trim();
  if (!reden) {
    return { ok: false, foutcode: "reden_verplicht", melding: "Reden is verplicht bij het intrekken van een capability." };
  }
  if (!isGeldigeCap(input.capability)) {
    return { ok: false, foutcode: "ongeldige_cap", melding: "Onbekende capability." };
  }
  const capability = input.capability;
  try {
    return await withPlatform<RechtenResultaat>(
      {
        capability: "platform.capabilities.revoke",
        handeling: "platform.capability.revoke",
        doelObject: `identity:${input.identityId}:${capability}`,
        reden,
      },
      async (svc: SupabaseClient, ctx) => {
        const guard = valideerRevoke({
          actorId: ctx.identiteit.id,
          actorCapabilities: ctx.identiteit.capabilities,
          doelIdentityId: input.identityId,
          capability,
          tweedeBeheerderBevestigd: false,
        });
        if (!guard.ok) {
          return {
            resultaat: { ok: false, foutcode: guard.foutcode, melding: guardMelding(guard.foutcode) },
            effect: { afgewezen: guard.foutcode, capability, doel: input.identityId },
          };
        }

        // Intrekken = append-only: ingetrokken_op zetten op de actieve grant.
        const { data: bijgewerkt, error } = await svc
          .from("platform_identity_capabilities")
          .update({ ingetrokken_op: new Date().toISOString() })
          .eq("identity_id", input.identityId)
          .eq("capability", capability)
          .is("ingetrokken_op", null)
          .select("id");
        if (error) {
          console.error(`[P3] revoke update mislukt:`, error.message);
          return {
            resultaat: { ok: false, foutcode: "update_mislukt", melding: "Intrekken geweigerd door de database." },
            effect: { afgewezen: "update_mislukt", capability, fout: error.message },
          };
        }
        if (!bijgewerkt || bijgewerkt.length === 0) {
          return {
            resultaat: { ok: false, foutcode: "geen_actieve_grant", melding: "Deze identiteit heeft deze capability niet (meer)." },
            effect: { afgewezen: "geen_actieve_grant", capability, doel: input.identityId },
          };
        }

        revalidatePath(LIJST_PAD);
        return {
          resultaat: { ok: true, bericht: "Capability ingetrokken." },
          effect: { capability, doel: input.identityId, ingetrokken: bijgewerkt.length },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "intrekken");
  }
}
