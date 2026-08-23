import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";

export const POST = withFondsRoute({ capability: "procedures.manage" }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as {
      stap_id?: string;
      titel?: string;
      beschrijving?: string | null;
      document_id?: string | null;
      documenttype?: string | null; // 1D-4: tag voor readiness-match
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
      .select("naam, procedure_id")
      .eq("id", stapId)
      .single();
    if (!stap || stap.procedure_id !== id) {
      return NextResponse.json(
        { error: "Stap hoort niet bij deze procedure" },
        { status: 400 }
      );
    }

    const { data: bewijs, error } = await supabase
      .from("procedure_bewijs")
      .insert({
        stap_id: stapId,
        document_id: body.document_id || null,
        titel,
        beschrijving: body.beschrijving || null,
        documenttype: body.documenttype?.trim() || null,
        toegevoegd_door: ctx.gebruikerId,
        toegevoegd_door_naam: ctx.naam || null,
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
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam || null,
      payload: { stap: stap.naam, titel },
    });

    return NextResponse.json({ bewijs });
  } catch (e) {
    console.error("Fout in POST /api/procedures/[id]/bewijs:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
