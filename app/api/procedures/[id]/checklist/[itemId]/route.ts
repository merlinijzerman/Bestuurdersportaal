import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { ensureDecisionForProcedure } from "@/core/lib/decision";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id, itemId } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json()) as {
      voldaan?: boolean;
      opmerking?: string;
      // D7: soft-deactivate/heractivering van een checklist-item.
      actief?: boolean;
    };
    // Ofwel het bestaande voldaan-pad, ofwel het D7 actief-pad.
    if (typeof body.actief !== "boolean" && typeof body.voldaan !== "boolean") {
      return NextResponse.json(
        { error: "voldaan of actief (boolean) is verplicht" },
        { status: 400 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam, rol")
      .eq("id", user.id)
      .single();

    // Haal item + stap op voor logging
    const { data: item } = await supabase
      .from("procedure_checklist")
      .select("label, voldaan, bron, actief, stap_id, procedure_stappen(naam, procedure_id)")
      .eq("id", itemId)
      .single();
    if (!item) {
      return NextResponse.json(
        { error: "Checklist-item niet gevonden" },
        { status: 404 }
      );
    }

    const stapData = item.procedure_stappen as
      | { naam: string; procedure_id: string }
      | { naam: string; procedure_id: string }[]
      | null
      | undefined;
    const stap = Array.isArray(stapData) ? stapData[0] : stapData;
    if (!stap || stap.procedure_id !== id) {
      return NextResponse.json(
        { error: "Item hoort niet bij deze procedure" },
        { status: 400 }
      );
    }

    // ── D7: soft-deactivate/heractivering (governance-gelogd) ──
    // Voorbehouden aan voorzitter/beheerder; append-only (actief=false i.p.v.
    // verwijderen). De 'voldaan'-toggle hieronder blijft vrij voor elk lid.
    if (typeof body.actief === "boolean") {
      if (!["voorzitter", "beheerder"].includes(profiel?.rol ?? "")) {
        return NextResponse.json(
          {
            error:
              "Alleen voorzitter of beheerder kan een checklist-item (de)activeren",
          },
          { status: 403 }
        );
      }
      const { error: deFout } = await supabase
        .from("procedure_checklist")
        .update({ actief: body.actief })
        .eq("id", itemId);
      if (deFout) {
        console.error("Checklist (de)activeren fout:", deFout);
        return NextResponse.json({ error: "Wijzigen mislukt" }, { status: 500 });
      }
      const { decision_id } = await ensureDecisionForProcedure(supabase, id);
      const { error: evFout } = await supabase.from("governance_events").insert({
        decision_id,
        event_type: body.actief
          ? "checklistitem_geheractiveerd"
          : "checklistitem_gedeactiveerd",
        actor_id: user.id,
        actor_naam: profiel?.naam ?? null,
        object_type: "procedure_checklist",
        object_id: itemId,
        oude_waarde: { actief: item.actief, bron: item.bron },
        nieuwe_waarde: { actief: body.actief, label: item.label },
      });
      // Append-only: zonder audit-rij niet traceerbaar → fail closed.
      if (evFout) {
        console.error("Checklist (de)activatie niet gelogd:", evFout);
        return NextResponse.json({ error: "Wijziging niet gelogd" }, { status: 500 });
      }
      await supabase.from("procedure_log").insert({
        procedure_id: id,
        event_type: body.actief
          ? "checklistitem_geheractiveerd"
          : "checklistitem_gedeactiveerd",
        actor_id: user.id,
        actor_naam: profiel?.naam || null,
        payload: { stap: stap.naam, item: item.label },
      });
      return NextResponse.json({ ok: true });
    }

    // Vanaf hier het bestaande voldaan-pad (elk lid mag togglen).
    if (typeof body.voldaan !== "boolean") {
      return NextResponse.json(
        { error: "voldaan (boolean) is verplicht" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {
      voldaan: body.voldaan,
      voldaan_op: body.voldaan ? new Date().toISOString() : null,
      voldaan_door: body.voldaan ? user.id : null,
      voldaan_door_naam: body.voldaan ? profiel?.naam || null : null,
    };
    if (body.opmerking !== undefined) {
      updates.opmerking = body.opmerking || null;
    }

    const { error: updateFout } = await supabase
      .from("procedure_checklist")
      .update(updates)
      .eq("id", itemId);
    if (updateFout) {
      console.error("Checklist-item update fout:", updateFout);
      return NextResponse.json({ error: "Update mislukt" }, { status: 500 });
    }

    if (body.voldaan !== item.voldaan) {
      await supabase.from("procedure_log").insert({
        procedure_id: id,
        event_type: body.voldaan ? "checklistitem_voldaan" : "checklistitem_geopend",
        actor_id: user.id,
        actor_naam: profiel?.naam || null,
        payload: { stap: stap.naam, item: item.label },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Fout in PATCH /api/procedures/[id]/checklist/[itemId]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
