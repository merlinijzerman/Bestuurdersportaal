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
      stap_id?: string;
      titel?: string;
      beschrijving?: string | null;
      document_id?: string | null;
    };
    const stapId = body.stap_id;
    const titel = body.titel?.trim();
    if (!stapId) {
      return NextResponse.json({ error: "stap_id is verplicht" }, { status: 400 });
    }
    if (!titel) {
      return NextResponse.json({ error: "Titel is verplicht" }, { status: 400 });
    }

    // Verifieer dat de stap bij deze procedure hoort
    const { data: stap } = await supabase
      .from("procedure_stappen")
      .select("naam, procedure_id")
      .eq("id", stapId)
      .single();
    if (!stap || stap.procedure_id !== id) {
      return NextResponse.json(
        { error: "Stap hoort niet bij deze procedure" },
        { status: 400 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .single();

    const { data: bewijs, error } = await supabase
      .from("procedure_bewijs")
      .insert({
        stap_id: stapId,
        document_id: body.document_id || null,
        titel,
        beschrijving: body.beschrijving || null,
        toegevoegd_door: user.id,
        toegevoegd_door_naam: profiel?.naam || null,
      })
      .select()
      .single();

    if (error || !bewijs) {
      return NextResponse.json(
        { error: error?.message || "Toevoegen mislukt" },
        { status: 500 }
      );
    }

    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "bewijs_toegevoegd",
      actor_id: user.id,
      actor_naam: profiel?.naam || null,
      payload: { stap: stap.naam, titel },
    });

    return NextResponse.json({ bewijs });
  } catch (e) {
    console.error("Fout in POST /api/procedures/[id]/bewijs:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
