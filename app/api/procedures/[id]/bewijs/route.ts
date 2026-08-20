import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import {
  leesVereisteVerwijzing,
  resolveRequirementBinding,
} from "@/core/lib/bewijs-binding";

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
      stap_id?: string;
      titel?: string;
      beschrijving?: string | null;
      document_id?: string | null;
      documenttype?: string | null; // 1D-4: tag, sinds de binding alleen suggestie
      // Bewijsbinding: de vereiste die dit stuk vervult, als triple. De
      // sleutel wordt server-side afgeleid en geverifieerd.
      vereiste?: unknown;
    };
    const stapId = body.stap_id;
    const titel = body.titel?.trim();
    if (!stapId) {
      return NextResponse.json({ error: "stap_id is verplicht" }, { status: 400 });
    }
    if (!titel) {
      return NextResponse.json({ error: "Titel is verplicht" }, { status: 400 });
    }

    // Verifieer dat de stap bij deze procedure hoort
    const { data: stap } = await supabase
      .from("procedure_stappen")
      .select("naam, procedure_id, volgorde")
      .eq("id", stapId)
      .single();
    if (!stap || stap.procedure_id !== id) {
      return NextResponse.json(
        { error: "Stap hoort niet bij deze procedure" },
        { status: 400 }
      );
    }

    // Bewijsbinding vaststellen (optioneel — een stuk mag ongebonden worden
    // opgevoerd, het vervult dan alleen geen vereiste).
    let bindingSleutel: string | null = null;
    let bindingLabel: string | null = null;
    if (body.vereiste !== undefined && body.vereiste !== null) {
      const verwijzing = leesVereisteVerwijzing(body.vereiste);
      if (verwijzing === "ongeldig" || verwijzing === null) {
        return NextResponse.json(
          { error: "Ongeldige vereiste-verwijzing" },
          { status: 400 }
        );
      }
      const binding = await resolveRequirementBinding(
        supabase,
        id,
        verwijzing,
        stap.volgorde
      );
      if (!binding.ok) {
        return NextResponse.json(
          { error: binding.fout },
          { status: binding.serverfout ? 500 : 400 }
        );
      }
      bindingSleutel = binding.sleutel;
      bindingLabel = binding.label;
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .single();

    const { data: bewijs, error } = await supabase
      .from("procedure_bewijs")
      .insert({
        stap_id: stapId,
        document_id: body.document_id || null,
        titel,
        beschrijving: body.beschrijving || null,
        documenttype: body.documenttype?.trim() || null,
        requirement_sleutel: bindingSleutel,
        toegevoegd_door: user.id,
        toegevoegd_door_naam: profiel?.naam || null,
      })
      .select()
      .single();

    if (error || !bewijs) {
      console.error("Bewijs toevoegen fout:", error);
      return NextResponse.json(
        { error: "Toevoegen mislukt" },
        { status: 500 }
      );
    }

    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "bewijs_toegevoegd",
      actor_id: user.id,
      actor_naam: profiel?.naam || null,
      payload: {
        bewijs_id: bewijs.id,
        stap: stap.naam,
        titel,
        // Welke vereiste dit stuk vervult — bepalend voor readiness, dus
        // onderdeel van het auditspoor.
        requirement_sleutel: bindingSleutel,
        requirement_label: bindingLabel,
      },
    });

    return NextResponse.json({ bewijs });
  } catch (e) {
    console.error("Fout in POST /api/procedures/[id]/bewijs:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
