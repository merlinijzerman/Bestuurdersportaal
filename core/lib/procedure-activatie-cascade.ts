// Gedeelde activatie-cascade na het afronden van een stap (P3/PR-C, #168).
// ---------------------------------------------------------------------------
// Geëxtraheerd uit app/api/procedures/[id]/stappen/[stapId]/route.ts (PATCH),
// GEDRAGSBEHOUDEND, zodat zowel de normale afronding als het afronden-met-
// afwijking dezelfde downstream-activering delen.
//
// Deze cascade is AFGELEIDE toestand (besluit 0192, atomariteitsregel): zij hoort
// NIET in de afrond-transactie. Faalt zij ná een geslaagde kern, dan is er niets
// onwaars vastgelegd — er is alleen iets nog niet heractiveerd. Daarom: nooit stil
// inslikken. Bij een fout schrijft de helper een LUIDE procedure_log-regel
// (`activatie_achterstand`, met verwijzing naar de stap) en meldt zij dat terug,
// zodat de route de aanroeper kan waarschuwen en een periodieke controle de
// achterstand kan opsporen. De herberekening is idempotent en zonder speciale
// rechten opnieuw aanroepbaar.

import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyUser } from "./notifications";
import {
  herberekenActiveerbaarheid,
  alleStappenAfgerond,
  type StapActivatieState,
} from "./procedure-activatie";

type Sb = SupabaseClient;

export async function pasActivatieCascadeToe(
  supabase: Sb,
  procedureId: string,
  afgerondeStap: { volgorde: number; naam: string },
  actor: { gebruikerId: string; naam: string | null; email?: string | null }
): Promise<{ ok: boolean; fout?: string }> {
  try {
    // Laad alle stappen ná het afronden van deze stap. De afgeronde stap staat al
    // op 'afgerond', dus de query reflecteert de nieuwe toestand.
    const { data: alleStappenRows } = await supabase
      .from("procedure_stappen")
      .select("id, volgorde, naam, status, blokkerende_afhankelijkheden")
      .eq("procedure_id", procedureId);
    const alleStappen = (alleStappenRows ?? []) as Array<{
      id: string;
      volgorde: number;
      naam: string;
      status: StapActivatieState["status"];
      blokkerende_afhankelijkheden: number[] | null;
    }>;
    const activatieState: StapActivatieState[] = alleStappen.map((s) => ({
      volgorde: s.volgorde,
      status: s.status,
      blokkerende_afhankelijkheden: s.blokkerende_afhankelijkheden ?? [],
    }));

    if (alleStappenAfgerond(activatieState)) {
      // Alle stappen afgerond — procedure is klaar. Idempotent (voorwaarde 2, 0192):
      // is de procedure AL afgerond (bv. bij achterstand-herstel dat de cascade
      // opnieuw draait), dan niet nogmaals afronden en — belangrijker — niet
      // nogmaals notificeren. Daarom de status vóór de update lezen.
      const { data: proc } = await supabase
        .from("procedures")
        .select("titel, gestart_door, fonds_id, status")
        .eq("id", procedureId)
        .maybeSingle();
      if (proc && proc.status !== "afgerond") {
        await supabase
          .from("procedures")
          .update({ status: "afgerond", afgerond_op: new Date().toISOString() })
          .eq("id", procedureId);

        // Iteratie 3-A: notificatie naar de procedure-starter (eenmalig).
        if (proc.gestart_door && proc.fonds_id) {
          await notifyUser(
          supabase,
          "procedure_afgerond",
          proc.gestart_door,
          proc.fonds_id,
          {
            type: "procedure_afgerond",
            procedure_titel: proc.titel ?? "Procedure",
            afgerond_door_naam: actor.naam || actor.email || "Een collega",
          },
          {
            gerelateerd_aan_type: "procedure",
            gerelateerd_aan_id: procedureId,
            actor_naam: actor.naam || undefined,
          }
          );
        }
      }
    } else if (activatieState.some((s) => s.status === "geblokkeerd")) {
      // Parallel model (engine v2): activeer elke stap die door dit afronden
      // activeerbaar is geworden. Geen "volgende op volgorde" meer.
      const teActiveren = herberekenActiveerbaarheid(activatieState);
      for (const volg of teActiveren) {
        const doel = alleStappen.find((s) => s.volgorde === volg);
        if (!doel) continue;
        await supabase
          .from("procedure_stappen")
          .update({ status: "actief" })
          .eq("id", doel.id);
        await supabase.from("procedure_log").insert({
          procedure_id: procedureId,
          event_type: "stap_gestart",
          actor_id: actor.gebruikerId,
          actor_naam: actor.naam || undefined,
          payload: { stap: doel.naam },
        });
      }
    } else {
      // Legacy sequentieel pad: activeer de eerstvolgende 'open' stap op volgorde.
      const volgende = alleStappen
        .filter((s) => s.status === "open" && s.volgorde > afgerondeStap.volgorde)
        .sort((a, b) => a.volgorde - b.volgorde)[0];
      if (volgende) {
        await supabase
          .from("procedure_stappen")
          .update({ status: "actief" })
          .eq("id", volgende.id);
        await supabase.from("procedure_log").insert({
          procedure_id: procedureId,
          event_type: "stap_gestart",
          actor_id: actor.gebruikerId,
          actor_naam: actor.naam || undefined,
          payload: { stap: volgende.naam },
        });
      }
    }
    return { ok: true };
  } catch (e) {
    // Luide achterstand: de kern is waar, de cascade niet gedraaid. Nooit stil.
    const fout = e instanceof Error ? e.message : String(e);
    try {
      await supabase.from("procedure_log").insert({
        procedure_id: procedureId,
        event_type: "activatie_achterstand",
        actor_id: actor.gebruikerId,
        actor_naam: actor.naam || undefined,
        payload: { stap: afgerondeStap.naam, volgorde: afgerondeStap.volgorde, fout },
      });
    } catch {
      // Laatste vangnet: als zelfs het loggen faalt, niet de afronding omvallen.
    }
    return { ok: false, fout };
  }
}
