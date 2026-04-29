import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

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

    const body = (await req.json()) as { voldaan?: boolean; opmerking?: string };
    if (typeof body.voldaan !== "boolean") {
      return NextResponse.json(
        { error: "voldaan (boolean) is verplicht" },
        { status: 400 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .single();

    // Haal item + stap op voor logging
    const { data: item } = await supabase
      .from("procedure_checklist")
      .select("label, voldaan, stap_id, procedure_stappen(naam, procedure_id)")
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
      return NextResponse.json({ error: updateFout.message }, { status: 500 });
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
