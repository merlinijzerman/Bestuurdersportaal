import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { z } from "zod";

type Sb = { from: (tabel: string) => any };

async function geldigeStap(supabase: Sb, procedureId: string, stapId: string) {
  const { data } = await supabase
    .from("procedure_stappen")
    .select("procedure_id")
    .eq("id", stapId)
    .maybeSingle();
  return (data as { procedure_id?: string } | null)?.procedure_id === procedureId;
}

export const GET = withFondsRoute(
  { hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: "geen", capability: "procedures.view", schema: "geen-body" },
  async (ctx, _req: NextRequest, params) => {
    const { id, stapId } = params as { id: string; stapId: string };
    if (!(await geldigeStap(ctx.supabase, id, stapId))) {
      return NextResponse.json({ error: "Stap hoort niet bij deze procedure" }, { status: 400 });
    }
    const { data, error } = await ctx.supabase
      .from("procedure_stap_notitie")
      .select("id, tekst, auteur, auteur_naam, aangemaakt_op, bewerkt_op")
      .eq("stap_id", stapId)
      .order("aangemaakt_op", { ascending: false });
    if (error) return NextResponse.json({ error: "Aantekeningen laden mislukt" }, { status: 500 });
    return NextResponse.json({ notities: data ?? [] });
  }
);

export const POST = withFondsRoute(
  { hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "procedures.stappen.notities.aanmaken" }, capability: "procedures.manage", schema: z.object({ tekst: z.unknown().optional() }).passthrough() },
  async (ctx, req: NextRequest, params) => {
    const { id, stapId } = params as { id: string; stapId: string };
    const body = (await req.json()) as { tekst?: string };
    const tekst = body.tekst?.trim();
    if (!tekst) return NextResponse.json({ error: "Tekst is verplicht" }, { status: 400 });
    if (!(await geldigeStap(ctx.supabase, id, stapId))) {
      return NextResponse.json({ error: "Stap hoort niet bij deze procedure" }, { status: 400 });
    }
    const { data, error } = await ctx.supabase
      .from("procedure_stap_notitie")
      .insert({
        fonds_id: ctx.fondsId,
        procedure_id: id,
        stap_id: stapId,
        tekst,
        auteur: ctx.gebruikerId,
        auteur_naam: ctx.naam ?? "",
      })
      .select("id, tekst, auteur, auteur_naam, aangemaakt_op, bewerkt_op")
      .single();
    if (error || !data) {
      console.error("Aantekening toevoegen mislukt", error);
      return NextResponse.json({ error: "Aantekening toevoegen mislukt" }, { status: 500 });
    }
    return NextResponse.json({ notitie: data });
  }
);
