import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { z } from "zod";

export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "risicos.id.sluiten.post" }, capability: "risicos.manage", schema: z.object({ "motivering": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as { motivering?: string };
    const motivering = body.motivering?.trim();
    if (!motivering) {
      return NextResponse.json(
        { error: "Motivering is verplicht" },
        { status: 400 }
      );
    }

    const { data: risico, error } = await supabase
      .from("risicos")
      .update({
        status: "gesloten",
        gesloten_op: new Date().toISOString(),
        gesloten_door: ctx.gebruikerId,
        sluit_motivering: motivering,
      })
      .eq("id", id)
      .select()
      .single();

    if (error || !risico) {
      console.error("Risico sluiten fout:", error);
      return NextResponse.json(
        { error: "Sluiten mislukt" },
        { status: 500 }
      );
    }

    await supabase.from("risico_log").insert({
      risico_id: id,
      event_type: "risico_gesloten",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam || null,
      payload: { motivering },
    });

    return NextResponse.json({ risico });
  } catch (e) {
    console.error("Fout in POST /api/risicos/[id]/sluiten:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
