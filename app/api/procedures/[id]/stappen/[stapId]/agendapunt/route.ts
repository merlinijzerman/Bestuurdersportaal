import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

// POST: maak een agendapunt aan in een bestaande vergadering en koppel
// het aan deze procedure-stap. Vult titel/beschrijving uit de stap als
// die niet expliciet meegegeven worden.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stapId: string }> }
) {
  try {
    const { id, stapId } = await params;
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
    };
    const vergaderingId = body.vergadering_id;
    if (!vergaderingId) {
      return NextResponse.json(
        { error: "vergadering_id is verplicht" },
        { status: 400 }
      );
    }

    // Verifieer dat de stap bij deze procedure hoort en haal context op
    const { data: stap } = await supabase
      .from("procedure_stappen")
      .select("naam, beschrijving, vereist_besluit, procedure_id, procedures(titel)")
      .eq("id", stapId)
      .eq("procedure_id", id)
      .single();
    if (!stap) {
      return NextResponse.json(
        { error: "Stap niet gevonden" },
        { status: 404 }
      );
    }

    const procedureRel = stap.procedures as
      | { titel: string }
      | { titel: string }[]
      | null
      | undefined;
    const procedureRow = Array.isArray(procedureRel)
      ? procedureRel[0]
      : procedureRel;
    const procedureTitel = procedureRow?.titel ?? "";

    // Categorie: standaard 'oordeelsvorming', of 'besluitvorming' bij stappen die een besluit vereisen
    const categorie =
      body.categorie ||
      (stap.vereist_besluit ? "besluitvorming" : "oordeelsvorming");

    const titel =
      body.titel?.trim() ||
      `${stap.naam} — ${procedureTitel}`.slice(0, 200);
    const beschrijving =
      body.beschrijving?.trim() ||
      `Voortvloeiend uit procedure: ${procedureTitel}.\n\n${stap.beschrijving ?? ""}`.trim();

    // Bepaal volgorde
    const { data: bestaande } = await supabase
      .from("agendapunten")
      .select("volgorde")
      .eq("vergadering_id", vergaderingId)
      .order("volgorde", { ascending: false })
      .limit(1);
    const volgorde =
      bestaande && bestaande[0] ? (bestaande[0].volgorde as number) + 1 : 1;

    const { data: agendapunt, error } = await supabase
      .from("agendapunten")
      .insert({
        vergadering_id: vergaderingId,
        titel,
        beschrijving,
        categorie,
        procedure_stap_id: stapId,
        volgorde,
      })
      .select()
      .single();

    if (error || !agendapunt) {
      console.error("Agendapunt aanmaken fout:", error);
      return NextResponse.json(
        { error: error?.message || "Aanmaken mislukt" },
        { status: 500 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .single();

    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "agendapunt_gekoppeld",
      actor_id: user.id,
      actor_naam: profiel?.naam || null,
      payload: {
        stap: stap.naam,
        agendapunt_id: agendapunt.id,
        vergadering_id: vergaderingId,
      },
    });

    return NextResponse.json({ agendapunt });
  } catch (e) {
    console.error("Fout in POST agendapunt-koppeling:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
