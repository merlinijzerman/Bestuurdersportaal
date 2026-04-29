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

    const body = (await req.json()) as { motivering?: string };
    const motivering = body.motivering?.trim();
    if (!motivering) {
      return NextResponse.json(
        { error: "Motivering is verplicht" },
        { status: 400 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .single();

    const { data: risico, error } = await supabase
      .from("risicos")
      .update({
        status: "gesloten",
        gesloten_op: new Date().toISOString(),
        gesloten_door: user.id,
        sluit_motivering: motivering,
      })
      .eq("id", id)
      .select()
      .single();

    if (error || !risico) {
      console.error("Risico sluiten fout:", error);
      return NextResponse.json(
        { error: error?.message || "Sluiten mislukt" },
        { status: 500 }
      );
    }

    await supabase.from("risico_log").insert({
      risico_id: id,
      event_type: "risico_gesloten",
      actor_id: user.id,
      actor_naam: profiel?.naam || null,
      payload: { motivering },
    });

    return NextResponse.json({ risico });
  } catch (e) {
    console.error("Fout in POST /api/risicos/[id]/sluiten:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
