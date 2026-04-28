import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function DELETE(
  _req: NextRequest,
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

    // RLS dwingt af dat alleen eigen inbreng verwijderd mag worden, maar we
    // controleren ook expliciet zodat we een nette foutmelding kunnen geven.
    const { data: bestaande } = await supabase
      .from("agendapunt_inbreng")
      .select("gebruiker_id")
      .eq("id", id)
      .single();

    if (!bestaande) {
      return NextResponse.json({ error: "Inbreng niet gevonden" }, { status: 404 });
    }
    if (bestaande.gebruiker_id !== user.id) {
      return NextResponse.json(
        { error: "Alleen eigen inbreng mag worden verwijderd" },
        { status: 403 }
      );
    }

    const { error } = await supabase.from("agendapunt_inbreng").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Fout in DELETE /api/inbreng/[id]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
