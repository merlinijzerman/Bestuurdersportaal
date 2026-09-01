import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { z } from "zod";

export const PATCH = withFondsRoute(
  { hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "procedures.stappen.notities.wijzigen" }, capability: "procedures.manage", schema: z.object({ tekst: z.unknown().optional() }).passthrough() },
  async (ctx, req: NextRequest, params) => {
    const { id, stapId, notitieId } = params as { id: string; stapId: string; notitieId: string };
    const body = (await req.json()) as { tekst?: string };
    const tekst = body.tekst?.trim();
    if (!tekst) return NextResponse.json({ error: "Tekst is verplicht" }, { status: 400 });
    const { data, error } = await ctx.supabase
      .from("procedure_stap_notitie")
      .update({ tekst, bewerkt_op: new Date().toISOString() })
      .eq("id", notitieId)
      .eq("procedure_id", id)
      .eq("stap_id", stapId)
      .select("id, tekst, auteur, auteur_naam, aangemaakt_op, bewerkt_op")
      .maybeSingle();
    if (error) return NextResponse.json({ error: "Aantekening bewerken mislukt" }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Alleen de auteur kan deze aantekening bewerken" }, { status: 403 });
    return NextResponse.json({ notitie: data });
  }
);

export const DELETE = withFondsRoute(
  { hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "procedures.stappen.notities.verwijderen" }, capability: "procedures.manage", schema: "geen-body" },
  async (ctx, _req: NextRequest, params) => {
    const { id, stapId, notitieId } = params as { id: string; stapId: string; notitieId: string };
    const { data, error } = await ctx.supabase
      .from("procedure_stap_notitie")
      .delete()
      .eq("id", notitieId)
      .eq("procedure_id", id)
      .eq("stap_id", stapId)
      .select("id")
      .maybeSingle();
    if (error) return NextResponse.json({ error: "Aantekening verwijderen mislukt" }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Alleen de auteur kan deze aantekening verwijderen" }, { status: 403 });
    return NextResponse.json({ ok: true });
  }
);
