import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json()) as {
      agendapunt_id?: string;
      tekst?: string;
    };
    const { agendapunt_id, tekst } = body;

    if (!agendapunt_id || !tekst || tekst.trim().length === 0) {
      return NextResponse.json(
        { error: "agendapunt_id en tekst zijn verplicht" },
        { status: 400 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .single();

    const { data, error } = await supabase
      .from("agendapunt_inbreng")
      .insert({
        agendapunt_id,
        gebruiker_id: user.id,
        gebruiker_naam: profiel?.naam || user.email,
        tekst: tekst.trim(),
      })
      .select()
      .single();

    if (error) {
      console.error("Inbreng toevoegen fout:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ inbreng: data });
  } catch (e) {
    console.error("Fout in /api/inbreng:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
