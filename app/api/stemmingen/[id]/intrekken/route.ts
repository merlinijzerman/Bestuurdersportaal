import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { notifyUser } from "@/lib/notifications";

const REDEN_MIN = 10;

// ============================================================
//  POST /api/stemmingen/[id]/intrekken — trek een open stemronde in.
//
//  Rechten: starter (geopend_door) / voorzitter / beheerder.
//  Verplichte reden (min 10 tekens). Notificeert starter + alle stemmers.
// ============================================================
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: stemmingId } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    let body: { reden?: string } = {};
    try {
      body = (await req.json()) as { reden?: string };
    } catch {
      body = {};
    }
    const reden = (body.reden ?? "").trim();
    if (reden.length < REDEN_MIN) {
      return NextResponse.json(
        { error: `Reden verplicht (minimaal ${REDEN_MIN} tekens)` },
        { status: 400 }
      );
    }

    const { data: stemming } = await supabase
      .from("stemmingen")
      .select("id, status, fonds_id, agendapunt_id, vraag, geopend_door")
      .eq("id", stemmingId)
      .maybeSingle();
    if (!stemming) {
      return NextResponse.json({ error: "Stemming niet gevonden" }, { status: 404 });
    }
    const st = stemming as {
      id: string;
      status: string;
      fonds_id: string;
      agendapunt_id: string;
      vraag: string;
      geopend_door: string;
    };

    if (st.status !== "open") {
      return NextResponse.json(
        { error: "Alleen een open stemronde kan worden ingetrokken" },
        { status: 400 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("rol")
      .eq("id", user.id)
      .maybeSingle();
    const rol = (profiel as { rol?: string } | null)?.rol;
    const isPrivileged = rol === "voorzitter" || rol === "beheerder";
    if (st.geopend_door !== user.id && !isPrivileged) {
      return NextResponse.json(
        { error: "Alleen de starter, voorzitter of beheerder mag de stemronde intrekken" },
        { status: 403 }
      );
    }

    const { data: ingetrokken, error: updFout } = await supabase
      .from("stemmingen")
      .update({
        status: "ingetrokken",
        ingetrokken_reden: reden,
        gesloten_op: new Date().toISOString(),
        gesloten_door: user.id,
      })
      .eq("id", stemmingId)
      .select()
      .single();
    if (updFout) {
      console.error("Stemming intrekken fout:", updFout);
      return NextResponse.json({ error: "Intrekken mislukt" }, { status: 500 });
    }

    // Notificatie: starter + alle stemmers
    const { data: agendapunt } = await supabase
      .from("agendapunten")
      .select("vergadering_id")
      .eq("id", st.agendapunt_id)
      .maybeSingle();
    const vergaderingId =
      (agendapunt as { vergadering_id?: string } | null)?.vergadering_id ?? "";

    const { data: stemmenRaw } = await supabase
      .from("stem_uitbrengingen")
      .select("stemgerechtigde_id")
      .eq("stemming_id", stemmingId);
    const ontvangers = new Set<string>();
    ontvangers.add(st.geopend_door);
    for (const r of (stemmenRaw || []) as { stemgerechtigde_id: string }[]) {
      ontvangers.add(r.stemgerechtigde_id);
    }

    await Promise.all(
      Array.from(ontvangers).map((ontvangerId) =>
        notifyUser(
          supabase,
          "stemronde_ingetrokken",
          ontvangerId,
          st.fonds_id,
          {
            type: "stemronde_ingetrokken",
            agendapunt_titel: st.vraag.slice(0, 120),
            ingetrokken_reden: reden,
            actor_naam: "Een collega",
            vergadering_id: vergaderingId,
          },
          {
            gerelateerd_aan_type: "agendapunt",
            gerelateerd_aan_id: st.agendapunt_id,
            actor_id: user.id,
          }
        )
      )
    );

    return NextResponse.json({ stemming: ingetrokken });
  } catch (e) {
    console.error("Fout in POST /api/stemmingen/[id]/intrekken:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
