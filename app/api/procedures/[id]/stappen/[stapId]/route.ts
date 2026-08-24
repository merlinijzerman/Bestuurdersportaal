import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { notifyUser } from "@/core/lib/notifications";
import { z } from "zod";
import {
  herberekenActiveerbaarheid,
  alleStappenAfgerond,
  type StapActivatieState,
} from "@/core/lib/procedure-activatie";

export const PATCH = withFondsRoute({ capability: "procedures.manage", schema: z.object({ "status": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id, stapId } = params as { id: string; stapId: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as { status?: "actief" | "afgerond" };
    if (body.status !== "afgerond" && body.status !== "actief") {
      return NextResponse.json(
        { error: "Ongeldige status" },
        { status: 400 }
      );
    }

    // Haal de stap op
    const { data: stap } = await supabase
      .from("procedure_stappen")
      .select("naam, status, procedure_id, volgorde, vereist_besluit")
      .eq("id", stapId)
      .eq("procedure_id", id)
      .single();
    if (!stap) {
      return NextResponse.json(
        { error: "Stap niet gevonden" },
        { status: 404 }
      );
    }

    if (body.status === "afgerond") {
      // D6: alleen een actieve of heropende stap kan worden afgerond. Een
      // geblokkeerde (of legacy 'open') stap direct afronden zou de
      // afhankelijkheidsgate server-side omzeilen — de CHECK-superset dwingt
      // legale overgangen niet af, dus dat gebeurt hier.
      if (stap.status !== "actief" && stap.status !== "heropend") {
        return NextResponse.json(
          { error: "Alleen een actieve of heropende stap kan worden afgerond" },
          { status: 400 }
        );
      }
      // Voor 'afgerond': controleer dat alle checklist-items voldaan zijn
      // en dat eventueel vereist besluit is vastgelegd
      const { data: checklistRijen } = await supabase
        .from("procedure_checklist")
        .select("voldaan, bewijs_vereist, actief")
        .eq("stap_id", stapId);
      // D7: soft-gedeactiveerde checklist-items tellen niet mee voor afronden.
      const checklist = (checklistRijen || []).filter(
        (c: { actief?: boolean | null }) => c.actief !== false
      );
      const allesVoldaan = checklist.every(
        (c: { voldaan: boolean }) => c.voldaan
      );
      if (!allesVoldaan) {
        return NextResponse.json(
          { error: "Niet alle checklist-items zijn voldaan" },
          { status: 400 }
        );
      }
      const heeftBewijsVereisten = checklist.some(
        (c: { bewijs_vereist: boolean }) => c.bewijs_vereist
      );
      if (heeftBewijsVereisten) {
        const { count } = await supabase
          .from("procedure_bewijs")
          .select("id", { count: "exact", head: true })
          .eq("stap_id", stapId);
        if (!count || count === 0) {
          return NextResponse.json(
            { error: "Bewijsstukken vereist maar niet aanwezig" },
            { status: 400 }
          );
        }
      }
      if (stap.vereist_besluit) {
        const { count } = await supabase
          .from("procedure_besluiten")
          .select("id", { count: "exact", head: true })
          .eq("stap_id", stapId);
        if (!count || count === 0) {
          return NextResponse.json(
            { error: "Stap vereist een formeel besluit dat nog niet is vastgelegd" },
            { status: 400 }
          );
        }
      }

      // Stap zelf op afgerond
      const { error: updateFout } = await supabase
        .from("procedure_stappen")
        .update({
          status: "afgerond",
          voltooid_op: new Date().toISOString(),
          voltooid_door: ctx.gebruikerId,
        })
        .eq("id", stapId);
      if (updateFout) {
        console.error("Stap voltooien fout:", updateFout);
        return NextResponse.json(
          { error: "Stap voltooien mislukt" },
          { status: 500 }
        );
      }

      await supabase.from("procedure_log").insert({
        procedure_id: id,
        event_type: "stap_voltooid",
        actor_id: ctx.gebruikerId,
        actor_naam: ctx.naam || null,
        payload: { stap: stap.naam },
      });

      // ── D6: activeerbaarheid herberekenen — of procedure afronden ──
      // Laad alle stappen ná het afronden van deze stap. `stap` is hierboven
      // al op 'afgerond' gezet, dus de query reflecteert de nieuwe toestand.
      const { data: alleStappenRows } = await supabase
        .from("procedure_stappen")
        .select("id, volgorde, naam, status, blokkerende_afhankelijkheden")
        .eq("procedure_id", id);
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
        // Alle stappen afgerond — procedure is klaar.
        await supabase
          .from("procedures")
          .update({
            status: "afgerond",
            afgerond_op: new Date().toISOString(),
          })
          .eq("id", id);

        // ── Iteratie 3-A: notificatie naar de procedure-starter ──
        const { data: proc } = await supabase
          .from("procedures")
          .select("titel, gestart_door, fonds_id")
          .eq("id", id)
          .maybeSingle();
        if (proc?.gestart_door && proc.fonds_id) {
          await notifyUser(
            supabase,
            "procedure_afgerond",
            proc.gestart_door,
            proc.fonds_id,
            {
              type: "procedure_afgerond",
              procedure_titel: proc.titel ?? "Procedure",
              afgerond_door_naam: ctx.naam || ctx.email || "Een collega",
            },
            {
              gerelateerd_aan_type: "procedure",
              gerelateerd_aan_id: id,
              // BESLUIT (W4): `|| undefined`, waarde-identiek via
          // `opts.actor_naam ?? null` in notifyUser. Zie inbreng.
          actor_naam: ctx.naam || undefined,
            }
          );
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
            procedure_id: id,
            event_type: "stap_gestart",
            actor_id: ctx.gebruikerId,
            // BESLUIT (W4): `|| undefined`, waarde-identiek via
          // `opts.actor_naam ?? null` in notifyUser. Zie inbreng.
          actor_naam: ctx.naam || undefined,
            payload: { stap: doel.naam },
          });
        }
      } else {
        // Legacy sequentieel pad: activeer de eerstvolgende 'open' stap op
        // volgorde (gedrag van vóór engine v2, voor lopende procedures).
        const volgende = alleStappen
          .filter((s) => s.status === "open" && s.volgorde > stap.volgorde)
          .sort((a, b) => a.volgorde - b.volgorde)[0];
        if (volgende) {
          await supabase
            .from("procedure_stappen")
            .update({ status: "actief" })
            .eq("id", volgende.id);
          await supabase.from("procedure_log").insert({
            procedure_id: id,
            event_type: "stap_gestart",
            actor_id: ctx.gebruikerId,
            // BESLUIT (W4): `|| undefined`, waarde-identiek via
          // `opts.actor_naam ?? null` in notifyUser. Zie inbreng.
          actor_naam: ctx.naam || undefined,
            payload: { stap: volgende.naam },
          });
        }
      }

      return NextResponse.json({ ok: true });
    }

    // status='actief' — handmatig activeren (gebruikt bij latere edits)
    const { error: updateFout } = await supabase
      .from("procedure_stappen")
      .update({ status: "actief" })
      .eq("id", stapId);
    if (updateFout) {
      console.error("Stap activeren fout:", updateFout);
      return NextResponse.json({ error: "Stap activeren mislukt" }, { status: 500 });
    }
    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "stap_gestart",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam || null,
      payload: { stap: stap.naam },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Fout in PATCH /api/procedures/[id]/stappen/[stapId]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
