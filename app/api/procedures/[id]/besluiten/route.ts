import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json()) as {
      stap_id?: string | null;
      formulering?: string;
      motivering?: string | null;
      datum?: string;
      vergadering_id?: string | null;
      agendapunt_id?: string | null;
    };
    const formulering = body.formulering?.trim();
    const datum = body.datum;
    if (!formulering) {
      return NextResponse.json(
        { error: "Formulering is verplicht" },
        { status: 400 }
      );
    }
    if (!datum) {
      return NextResponse.json(
        { error: "Datum is verplicht" },
        { status: 400 }
      );
    }

    // Verifieer procedure
    const { data: proc } = await supabase
      .from("procedures")
      .select("id")
      .eq("id", id)
      .single();
    if (!proc) {
      return NextResponse.json(
        { error: "Procedure niet gevonden" },
        { status: 404 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .single();

    const { data: besluit, error } = await supabase
      .from("procedure_besluiten")
      .insert({
        procedure_id: id,
        stap_id: body.stap_id || null,
        vergadering_id: body.vergadering_id || null,
        agendapunt_id: body.agendapunt_id || null,
        formulering,
        motivering: body.motivering || null,
        datum,
        vastgelegd_door: user.id,
        vastgelegd_door_naam: profiel?.naam || null,
      })
      .select()
      .single();

    if (error || !besluit) {
      return NextResponse.json(
        { error: error?.message || "Vastleggen mislukt" },
        { status: 500 }
      );
    }

    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "besluit_vastgelegd",
      actor_id: user.id,
      actor_naam: profiel?.naam || null,
      payload: { formulering, datum },
    });

    return NextResponse.json({ besluit });
  } catch (e) {
    console.error("Fout in POST /api/procedures/[id]/besluiten:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
