import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

const TOEGESTANE_CATEGORIEEN = ["beeldvorming", "oordeelsvorming", "besluitvorming", "informatie"];

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
      vergadering_id?: string;
      titel?: string;
      beschrijving?: string;
      categorie?: string;
      tijdsduur_minuten?: number;
      verantwoordelijke?: string;
    };
    const {
      vergadering_id,
      titel,
      beschrijving,
      categorie,
      tijdsduur_minuten,
      verantwoordelijke,
    } = body;

    if (!vergadering_id || !titel) {
      return NextResponse.json(
        { error: "vergadering_id en titel zijn verplicht" },
        { status: 400 }
      );
    }

    if (categorie && !TOEGESTANE_CATEGORIEEN.includes(categorie)) {
      return NextResponse.json({ error: "Ongeldige categorie" }, { status: 400 });
    }

    // Bepaal volgorde: max + 1
    const { data: bestaande } = await supabase
      .from("agendapunten")
      .select("volgorde")
      .eq("vergadering_id", vergadering_id)
      .order("volgorde", { ascending: false })
      .limit(1);

    const volgordeRow = bestaande?.[0];
    const volgorde = volgordeRow ? (volgordeRow.volgorde as number) + 1 : 1;

    const { data, error } = await supabase
      .from("agendapunten")
      .insert({
        vergadering_id,
        titel,
        beschrijving: beschrijving || null,
        categorie: categorie || "informatie",
        tijdsduur_minuten: tijdsduur_minuten || null,
        verantwoordelijke: verantwoordelijke || null,
        volgorde,
      })
      .select()
      .single();

    if (error) {
      console.error("Agendapunt aanmaken fout:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ agendapunt: data });
  } catch (e) {
    console.error("Fout in /api/agendapunten:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
