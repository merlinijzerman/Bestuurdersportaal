import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { ensureDecisionForProcedure } from "@/core/lib/decision";
import {
  afhankelijkeAfgerondeStappen,
  type StapActivatieState,
} from "@/core/lib/procedure-activatie";

// POST /api/procedures/[id]/stappen/[stapId]/heropenen
//
// Heropent een AFGERONDE stap (D6, iteratie/rework). Voorbehouden aan
// voorzitter/beheerder en alleen met verplichte motivering. Append-only
// gelogd als governance_event; de eerdere afronding blijft in het spoor
// (nieuwe versie van het oordeel, geen overschrijving). Afhankelijke,
// reeds afgeronde stappen worden NIET teruggezet maar gemarkeerd met
// `herbevestiging_nodig = true` (zichtbaar, niet-blokkerend signaal).
export const POST = withFondsRoute({ capability: "procedures.manage" }, async (ctx, req: NextRequest, params) => {
  try {
    const { id, stapId } = params as { id: string; stapId: string };
    const supabase = ctx.supabase;

    const body = (await req.json().catch(() => ({}))) as { motivering?: string };
    const motivering = body.motivering?.trim();
    if (!motivering) {
      return NextResponse.json(
        { error: "Heropenen vereist een motivering" },
        { status: 400 }
      );
    }

    // Capability: alleen voorzitter/beheerder mogen heropenen (vrijheidsniveau 2/3).
    // BESLUIT (W4): `!profiel ||` valt weg en `ctx.rol` krijgt `?? ""`.
    // Uitkomst-identiek: geen profielrij -> haalProfiel geeft null -> ctx.rol is
    // null -> "" -> 403; profielrij met rol null idem; rol gezet ongewijzigd.
    // Zelfde afweging als bij de twee documents-backfills.
    if (!["voorzitter", "beheerder"].includes(ctx.rol ?? "")) {
      return NextResponse.json(
        { error: "Alleen voorzitter of beheerder kan een stap heropenen" },
        { status: 403 }
      );
    }

    // Stap laden (RLS begrenst tot het eigen fonds).
    const { data: stap } = await supabase
      .from("procedure_stappen")
      .select("id, naam, status, procedure_id, volgorde")
      .eq("id", stapId)
      .eq("procedure_id", id)
      .single();
    if (!stap) {
      return NextResponse.json({ error: "Stap niet gevonden" }, { status: 404 });
    }
    if (stap.status !== "afgerond") {
      return NextResponse.json(
        { error: "Alleen een afgeronde stap kan worden heropend" },
        { status: 400 }
      );
    }

    // Stap → heropend.
    const { error: updateFout } = await supabase
      .from("procedure_stappen")
      .update({ status: "heropend", heropend_op: new Date().toISOString() })
      .eq("id", stapId);
    if (updateFout) {
      console.error("Stap heropenen fout:", updateFout);
      return NextResponse.json({ error: "Heropenen mislukt" }, { status: 500 });
    }

    // Afhankelijke, reeds afgeronde stappen markeren (niet terugzetten).
    const { data: alleRows } = await supabase
      .from("procedure_stappen")
      .select("id, volgorde, status, blokkerende_afhankelijkheden")
      .eq("procedure_id", id);
    const alle = (alleRows ?? []) as Array<{
      id: string;
      volgorde: number;
      status: StapActivatieState["status"];
      blokkerende_afhankelijkheden: number[] | null;
    }>;
    const teHerbevestigen = afhankelijkeAfgerondeStappen(
      alle.map((s) => ({
        volgorde: s.volgorde,
        status: s.status,
        blokkerende_afhankelijkheden: s.blokkerende_afhankelijkheden ?? [],
      })),
      stap.volgorde
    );
    if (teHerbevestigen.length > 0) {
      const ids = alle
        .filter((s) => teHerbevestigen.includes(s.volgorde))
        .map((s) => s.id);
      await supabase
        .from("procedure_stappen")
        .update({ herbevestiging_nodig: true })
        .in("id", ids);
    }

    // Append-only audit op het Decision Object (motivering verplicht).
    const { decision_id } = await ensureDecisionForProcedure(supabase, id);
    const { error: eventFout } = await supabase.from("governance_events").insert({
      decision_id,
      event_type: "stap_heropend",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam ?? null,
      object_type: "procedure_stap",
      object_id: stapId,
      oude_waarde: { status: "afgerond" },
      nieuwe_waarde: {
        status: "heropend",
        herbevestiging_gemarkeerd: teHerbevestigen,
      },
      reden: motivering,
    });
    if (eventFout) {
      console.error("Heropenen: governance_event niet geschreven:", eventFout);
      // Compensatie: draai de statuswijziging terug zodat de audit-garantie
      // klopt (geen mutatie zonder auditspoor). Best-effort — er is geen
      // transactie over route-heen.
      await supabase
        .from("procedure_stappen")
        .update({ status: "afgerond", heropend_op: null })
        .eq("id", stapId);
      if (teHerbevestigen.length > 0) {
        await supabase
          .from("procedure_stappen")
          .update({ herbevestiging_nodig: false })
          .eq("procedure_id", id)
          .in("volgorde", teHerbevestigen);
      }
      return NextResponse.json(
        { error: "Heropenen niet gelogd en teruggedraaid" },
        { status: 500 }
      );
    }

    // Was de procedure al afgerond, dan heropent dit haar (een stap is weer in
    // bewerking). Bij het opnieuw afronden van álle stappen zet de afrondroute
    // de procedure terug op 'afgerond'.
    await supabase
      .from("procedures")
      .update({ status: "heropend", afgerond_op: null })
      .eq("id", id)
      .eq("status", "afgerond");

    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "stap_heropend",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam ?? null,
      payload: { stap: stap.naam, motivering, herbevestiging: teHerbevestigen },
    });

    return NextResponse.json({ ok: true, herbevestiging_nodig: teHerbevestigen });
  } catch (e) {
    console.error("Fout in POST …/stappen/[stapId]/heropenen:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
