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
      stap_id?: string | null;
      formulering?: string;
      motivering?: string | null;
      datum?: string;
      vergadering_id?: string | null;
      agendapunt_id?: string | null;
      verworpen_alternatieven?: string[]; // 1D-3
    };
    const formulering = body.formulering?.trim();
    const datum = body.datum;
    if (!formulering) {
      return NextResponse.json(
        { error: "Formulering is verplicht" },
        { status: 400 }
      );
    }
    if (!datum) {
      return NextResponse.json(
        { error: "Datum is verplicht" },
        { status: 400 }
      );
    }

    // Verifieer procedure + haal evt. decision_id op voor backref.
    const { data: proc } = await supabase
      .from("procedures")
      .select("id, decision_id")
      .eq("id", id)
      .single();
    if (!proc) {
      return NextResponse.json(
        { error: "Procedure niet gevonden" },
        { status: 404 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .single();

    // Verworpen alternatieven: filter lege strings + trim.
    const alternatieven = Array.isArray(body.verworpen_alternatieven)
      ? body.verworpen_alternatieven
          .map((a) => (typeof a === "string" ? a.trim() : ""))
          .filter((a) => a.length > 0)
      : [];

    const { data: besluit, error } = await supabase
      .from("procedure_besluiten")
      .insert({
        procedure_id: id,
        decision_id: proc.decision_id ?? null,
        stap_id: body.stap_id || null,
        vergadering_id: body.vergadering_id || null,
        agendapunt_id: body.agendapunt_id || null,
        formulering,
        motivering: body.motivering || null,
        datum,
        verworpen_alternatieven: alternatieven,
        vastgelegd_door: user.id,
        vastgelegd_door_naam: profiel?.naam || null,
      })
      .select()
      .single();

    if (error || !besluit) {
      console.error("Besluit vastleggen fout:", error);
      return NextResponse.json(
        { error: "Vastleggen mislukt" },
        { status: 500 }
      );
    }

    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "besluit_vastgelegd",
      actor_id: user.id,
      actor_naam: profiel?.naam || null,
      payload: { formulering, datum },
    });

    // 1D-3: ook in governance_events loggen op Decision Object niveau,
    // zodat het auditdossier de besluit-vastlegging meeneemt. We
    // includeren de formulering bewust omdat het besluit zelf
    // openbaar moet zijn binnen het dossier (anders dan dissent).
    if (proc.decision_id) {
      await supabase.from("governance_events").insert({
        decision_id: proc.decision_id,
        event_type: "besluit_vastgelegd",
        actor_id: user.id,
        actor_naam: profiel?.naam || null,
        object_type: "besluit",
        object_id: besluit.id,
        nieuwe_waarde: {
          formulering,
          datum,
          verworpen_alternatieven: alternatieven,
          stap_id: body.stap_id || null,
        },
      });
    }

    return NextResponse.json({ besluit });
  } catch (e) {
    console.error("Fout in POST /api/procedures/[id]/besluiten:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
