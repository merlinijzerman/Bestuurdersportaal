"use server";

// ============================================================================
//  Server-action — Contactaanvraag opvolgen (status-wijziging).
// ----------------------------------------------------------------------------
//  De ENIGE mutatie op de contact-inbox vanaf de platform-back-office. Loopt
//  uitsluitend achter withPlatform (sessie/MFA/capability + twee-fasen-audit in
//  platform_event_log) met capability platform.contact.manage.
//
//  Append-only-lijn (migratie 2026_06_29_contact_aanvragen.sql): geen delete —
//  opvolging via status. Toegestane overgangen vrij binnen de drie statussen
//  (nieuw <-> in_behandeling <-> afgehandeld), zodat een per ongeluk afgehandelde
//  aanvraag heropend kan worden.
//
//  Audit-/opvolgvelden worden server-side gezet (nooit vanuit de client):
//   - opgevolgd_door = naam van de actor (wie pakte het op);
//   - afgehandeld_op = now() bij 'afgehandeld', anders null (heropenen wist hem).
//  Het auditspoor (wie/wanneer/welke handeling) ligt daarnaast vast in
//  platform_event_log via withPlatform.
// ============================================================================

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withPlatform, PlatformError } from "@/platform/lib/platform-wrapper";

const LIJST_PAD = "/platform/contact";

export type ContactStatus = "nieuw" | "in_behandeling" | "afgehandeld";
const GELDIGE_STATUS: ReadonlySet<string> = new Set([
  "nieuw",
  "in_behandeling",
  "afgehandeld",
]);

export type ContactActieResultaat =
  | { ok: true; bericht: string }
  | { ok: false; foutcode: string; melding: string };

function platformMelding(foutcode: string): string {
  switch (foutcode) {
    case "no_session_or_inactive":
      return "Geen geldige platform-sessie. Log opnieuw in.";
    case "mfa_required":
      return "Sterke authenticatie (MFA) vereist voor deze handeling.";
    case "capability_denied":
      return "Je mist het recht om contactaanvragen op te volgen.";
    case "audit_unavailable":
      return "Auditlog tijdelijk niet beschikbaar — handeling geblokkeerd (fail-closed).";
    default:
      return "Handeling geweigerd.";
  }
}

function naarFout(e: unknown, waar: string): ContactActieResultaat {
  if (e instanceof PlatformError) {
    return { ok: false, foutcode: e.foutcode, melding: platformMelding(e.foutcode) };
  }
  console.error(`[contact] onverwachte fout bij ${waar}:`, e);
  return {
    ok: false,
    foutcode: "serverfout",
    melding: "Er ging iets mis. Probeer het opnieuw.",
  };
}

const STATUS_LABEL: Record<ContactStatus, string> = {
  nieuw: "Nieuw",
  in_behandeling: "In behandeling",
  afgehandeld: "Afgehandeld",
};

/** Wijzig de status van één contactaanvraag. reden is optioneel maar wordt,
 *  indien meegegeven, in het auditspoor vastgelegd. */
export async function aanvraagStatusWijzigen(input: {
  aanvraagId: string;
  nieuweStatus: string;
  reden?: string | null;
}): Promise<ContactActieResultaat> {
  const id = (input.aanvraagId ?? "").trim();
  if (!id) {
    return { ok: false, foutcode: "id_verplicht", melding: "Geen aanvraag opgegeven." };
  }
  if (!GELDIGE_STATUS.has(input.nieuweStatus)) {
    return { ok: false, foutcode: "ongeldige_status", melding: "Onbekende status." };
  }
  const nieuweStatus = input.nieuweStatus as ContactStatus;
  const reden = (input.reden ?? "").trim() || null;

  try {
    return await withPlatform<ContactActieResultaat>(
      {
        capability: "platform.contact.manage",
        handeling: "platform.contact.status_wijzigen",
        doelObject: `contact_aanvraag:${id}`,
        reden,
      },
      async (svc: SupabaseClient, ctx) => {
        // Bestaat de aanvraag? (geeft nette melding i.p.v. stille no-op)
        const { data: bestaand } = await svc
          .from("contact_aanvragen")
          .select("id, status")
          .eq("id", id)
          .maybeSingle();
        if (!bestaand) {
          return {
            resultaat: {
              ok: false,
              foutcode: "aanvraag_onbekend",
              melding: "Contactaanvraag niet gevonden.",
            },
            effect: { afgewezen: "aanvraag_onbekend", aanvraag: id },
          };
        }

        const isAfgehandeld = nieuweStatus === "afgehandeld";
        const { data: bijgewerkt, error } = await svc
          .from("contact_aanvragen")
          .update({
            status: nieuweStatus,
            // Opvolger = naam van de actor; bij heropenen blijft de laatste
            // toucher zichtbaar. afgehandeld_op alleen gevuld bij afhandelen.
            opgevolgd_door: ctx.identiteit.naam,
            afgehandeld_op: isAfgehandeld ? new Date().toISOString() : null,
          })
          .eq("id", id)
          .select("id");
        if (error) {
          console.error(`[contact] status-update mislukt:`, error.message);
          return {
            resultaat: {
              ok: false,
              foutcode: "update_mislukt",
              melding: "Bijwerken geweigerd door de database.",
            },
            effect: { afgewezen: "update_mislukt", aanvraag: id, fout: error.message },
          };
        }
        if (!bijgewerkt || bijgewerkt.length === 0) {
          return {
            resultaat: {
              ok: false,
              foutcode: "geen_rij",
              melding: "Aanvraag kon niet worden bijgewerkt.",
            },
            effect: { afgewezen: "geen_rij", aanvraag: id },
          };
        }

        revalidatePath(LIJST_PAD);
        return {
          resultaat: {
            ok: true,
            bericht: `Status gewijzigd naar "${STATUS_LABEL[nieuweStatus]}".`,
          },
          effect: {
            aanvraag: id,
            van: (bestaand as { status: string }).status,
            naar: nieuweStatus,
          },
        };
      }
    );
  } catch (e) {
    return naarFout(e, "status_wijzigen");
  }
}
