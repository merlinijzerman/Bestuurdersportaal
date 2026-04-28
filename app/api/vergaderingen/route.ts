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
      titel?: string;
      datum?: string;
      locatie?: string;
      status?: "gepland" | "in_voorbereiding" | "afgerond";
    };
    const { titel, datum, locatie, status } = body;

    if (!titel || !datum) {
      return NextResponse.json(
        { error: "Titel en datum zijn verplicht" },
        { status: 400 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("fonds_id")
      .eq("id", user.id)
      .single();

    if (!profiel?.fonds_id) {
      return NextResponse.json({ error: "Geen fonds gekoppeld" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("vergaderingen")
      .insert({
        fonds_id: profiel.fonds_id,
        titel,
        datum,
        locatie: locatie || null,
        status: status || "in_voorbereiding",
        aangemaakt_door: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error("Vergadering aanmaken fout:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ vergadering: data });
  } catch (e) {
    console.error("Fout in /api/vergaderingen:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
