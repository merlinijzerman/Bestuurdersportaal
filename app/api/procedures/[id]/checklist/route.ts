import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { ensureDecisionForProcedure } from "@/core/lib/decision";

// POST /api/procedures/[id]/checklist
//
// Voegt een HANDMATIG checklist-onderwerp toe aan een stap van een lopende
// procedure (D7). Voorbehouden aan voorzitter/beheerder; append-only gelogd.
// Het item krijgt bron='handmatig' zodat het te onderscheiden is van de
// meegesnapshotte template-items.
export const POST = withFondsRoute({ capability: "procedures.manage" }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as {
      stap_id?: string;
      label?: string;
      bewijs_vereist?: boolean;
    };
    const label = body.label?.trim();
    if (!body.stap_id || !label) {
      return NextResponse.json(
        { error: "stap_id en label zijn verplicht" },
        { status: 400 }
      );
    }

    // BESLUIT (W4): `!profiel ||` valt weg en `ctx.rol` krijgt `?? ""`.
    // Uitkomst-identiek: geen profielrij -> haalProfiel geeft null -> ctx.rol is
    // null -> "" -> 403; profielrij met rol null idem; rol gezet ongewijzigd.
    // Zelfde afweging als bij de twee documents-backfills.
    if (!["voorzitter", "beheerder"].includes(ctx.rol ?? "")) {
      return NextResponse.json(
        { error: "Alleen voorzitter of beheerder kan een checklist-item toevoegen" },
        { status: 403 }
      );
    }

    // Stap moet bij deze procedure horen (RLS begrenst tot eigen fonds).
    const { data: stap } = await supabase
      .from("procedure_stappen")
      .select("id, naam, procedure_id")
      .eq("id", body.stap_id)
      .single();
    if (!stap || stap.procedure_id !== id) {
      return NextResponse.json(
        { error: "Stap hoort niet bij deze procedure" },
        { status: 400 }
      );
    }

    // Volgende volgorde binnen de stap.
    const { data: bestaande } = await supabase
      .from("procedure_checklist")
      .select("volgorde")
      .eq("stap_id", body.stap_id)
      .order("volgorde", { ascending: false })
      .limit(1)
      .maybeSingle();
    const volgorde = (bestaande?.volgorde ?? 0) + 1;

    const { data: nieuw, error: insFout } = await supabase
      .from("procedure_checklist")
      .insert({
        stap_id: body.stap_id,
        volgorde,
        label,
        bewijs_vereist: body.bewijs_vereist ?? false,
        voldaan: false,
        bron: "handmatig",
        actief: true,
        aangemaakt_door: ctx.gebruikerId,
      })
      .select()
      .single();
    if (insFout || !nieuw) {
      console.error("Checklist-item toevoegen fout:", insFout);
      return NextResponse.json({ error: "Toevoegen mislukt" }, { status: 500 });
    }

    const { decision_id } = await ensureDecisionForProcedure(supabase, id);
    const { data: event, error: evFout } = await supabase
      .from("governance_events")
      .insert({
        decision_id,
        event_type: "checklistitem_toegevoegd",
        actor_id: ctx.gebruikerId,
        actor_naam: ctx.naam ?? null,
        object_type: "procedure_checklist",
        object_id: nieuw.id,
        nieuwe_waarde: { stap: stap.naam, label, bewijs_vereist: body.bewijs_vereist ?? false },
      })
      .select("id")
      .single();
    // Append-only: zonder audit-rij is de toevoeging niet traceerbaar → fail closed.
    if (evFout || !event) {
      console.error("Checklist-item-event niet geschreven:", evFout);
      return NextResponse.json({ error: "Toevoeging niet gelogd" }, { status: 500 });
    }
    await supabase
      .from("procedure_checklist")
      .update({ governance_event_id: event.id })
      .eq("id", nieuw.id);
    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "checklistitem_toegevoegd",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam || null,
      payload: { stap: stap.naam, item: label },
    });

    return NextResponse.json({ item: nieuw });
  } catch (e) {
    console.error("Fout in POST …/checklist:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
