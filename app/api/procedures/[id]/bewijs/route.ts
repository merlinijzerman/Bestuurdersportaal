import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { z } from "zod";
import {
  leesVereisteVerwijzing,
  resolveRequirementBinding,
} from "@/core/lib/bewijs-binding";

export const POST = withFondsRoute({ capability: "procedures.manage", schema: z.object({ "beschrijving": z.unknown().optional(), "document_id": z.unknown().optional(), "documenttype": z.unknown().optional(), "stap_id": z.unknown().optional(), "titel": z.unknown().optional(), "vereiste": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as {
      stap_id?: string;
      titel?: string;
      beschrijving?: string | null;
      document_id?: string | null;
      documenttype?: string | null; // 1D-4: tag, sinds de binding alleen suggestie
      // De client stuurt de vereiste als triple; de sleutel wordt server-side
      // afgeleid en tegen de procedure geverifieerd.
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

    let bindingSleutel: string | null = null;
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
    }

    const { data: bewijs, error } = await supabase
      .from("procedure_bewijs")
      .insert({
        stap_id: stapId,
        document_id: body.document_id || null,
        titel,
        beschrijving: body.beschrijving || null,
        documenttype: body.documenttype?.trim() || null,
        requirement_sleutel: bindingSleutel,
        toegevoegd_door: ctx.gebruikerId,
        toegevoegd_door_naam: ctx.naam || null,
      })
      .select()
      .single();

    if (error?.code === "23505") {
      return NextResponse.json(
        { error: "Aan dit vereiste is al een bewijsstuk gekoppeld" },
        { status: 409 }
      );
    }
    if (error?.code === "23514") {
      return NextResponse.json(
        { error: "Ongeldige of niet-eenduidige vereiste-binding" },
        { status: 400 }
      );
    }
    if (error || !bewijs) {
      console.error("Bewijs toevoegen fout:", error);
      return NextResponse.json(
        { error: "Toevoegen mislukt" },
        { status: 500 }
      );
    }

    return NextResponse.json({ bewijs });
  } catch (e) {
    console.error("Fout in POST /api/procedures/[id]/bewijs:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
