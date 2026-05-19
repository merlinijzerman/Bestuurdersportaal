import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

// ============================================================
//  POST /api/agendapunten/[id]/herstellen
//  Maakt een soft-deleted agendapunt weer actief.
//  Rechten: voorzitter + beheerder (niet de eigenaar zelf —
//  herstel hoort via overleg met de voorzitter).
//  Logt een 'agendapunt_hersteld'-event in agendapunt_log.
// ============================================================
export async function POST(
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

    const { data: agendapunt } = await supabase
      .from("agendapunten")
      .select("id, verwijderd_op")
      .eq("id", id)
      .maybeSingle();

    if (!agendapunt) {
      return NextResponse.json({ error: "Agendapunt niet gevonden" }, { status: 404 });
    }

    if (!(agendapunt as { verwijderd_op: string | null }).verwijderd_op) {
      return NextResponse.json(
        { error: "Agendapunt is niet verwijderd; herstellen niet van toepassing" },
        { status: 400 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("rol")
      .eq("id", user.id)
      .single();

    const rol = (profiel as { rol?: string } | null)?.rol;
    if (rol !== "voorzitter" && rol !== "beheerder") {
      return NextResponse.json(
        { error: "Alleen voorzitter of beheerder mag een agendapunt herstellen" },
        { status: 403 }
      );
    }

    const { data: updated, error: updFout } = await supabase
      .from("agendapunten")
      .update({
        verwijderd_op: null,
        verwijderd_door: null,
        verwijder_reden: null,
      })
      .eq("id", id)
      .select()
      .single();

    if (updFout) {
      console.error("Herstel agendapunt fout:", updFout);
      return NextResponse.json({ error: "Herstellen mislukt" }, { status: 500 });
    }

    await supabase.from("agendapunt_log").insert({
      agendapunt_id: id,
      event_type: "agendapunt_hersteld",
      actor_id: user.id,
      payload: {},
    });

    return NextResponse.json({ agendapunt: updated });
  } catch (e) {
    console.error("Fout in POST /api/agendapunten/[id]/herstellen:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
