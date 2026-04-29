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
      beschrijving?: string;
      verantwoordelijke?: string | null;
    };
    const beschrijving = body.beschrijving?.trim();
    if (!beschrijving) {
      return NextResponse.json(
        { error: "Beschrijving is verplicht" },
        { status: 400 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .single();

    // Bepaal volgorde: laatste + 1
    const { data: laatste } = await supabase
      .from("risico_maatregelen")
      .select("volgorde")
      .eq("risico_id", id)
      .order("volgorde", { ascending: false })
      .limit(1);

    const volgorde = laatste && laatste[0] ? (laatste[0].volgorde as number) + 1 : 1;

    const { data: maatregel, error } = await supabase
      .from("risico_maatregelen")
      .insert({
        risico_id: id,
        beschrijving,
        verantwoordelijke: body.verantwoordelijke || null,
        status: "open",
        volgorde,
        aangemaakt_door: user.id,
      })
      .select()
      .single();

    if (error || !maatregel) {
      console.error("Maatregel toevoegen fout:", error);
      return NextResponse.json(
        { error: error?.message || "Toevoegen mislukt" },
        { status: 500 }
      );
    }

    await supabase.from("risico_log").insert({
      risico_id: id,
      event_type: "maatregel_toegevoegd",
      actor_id: user.id,
      actor_naam: profiel?.naam || null,
      payload: { beschrijving, maatregel_id: maatregel.id },
    });

    return NextResponse.json({ maatregel });
  } catch (e) {
    console.error("Fout in POST /api/risicos/[id]/maatregelen:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
