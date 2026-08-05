import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { isBureauRol, BUREAU_WEIGERING } from "@/core/lib/bureau-gate";

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

    // T1 bureau-rol (§5.3). Zonder deze gate levert de select hieronder null
    // — de rij bestaat wél, maar is RLS-afgeschermd — en zou de gebruiker
    // "Inbreng niet gevonden" (404) zien. Dat is onjuist én in strijd met FR-6:
    // de interface hoort niet te verzwijgen dát er iets is afgeschermd.
    const { data: eigenProfiel } = await supabase
      .from("profielen")
      .select("rol")
      .eq("id", user.id)
      .maybeSingle();
    if (isBureauRol((eigenProfiel as { rol?: string | null } | null)?.rol)) {
      return NextResponse.json({ error: BUREAU_WEIGERING.inbreng }, { status: 403 });
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
      console.error("Inbreng verwijderen fout:", error);
      return NextResponse.json({ error: "Inbreng verwijderen mislukt" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Fout in DELETE /api/inbreng/[id]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
