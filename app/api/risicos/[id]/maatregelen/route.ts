import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { z } from "zod";

export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "risicos.id.maatregelen.post" }, capability: "risicos.manage", schema: z.object({ "beschrijving": z.unknown().optional(), "verantwoordelijke": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as {
      beschrijving?: string;
      verantwoordelijke?: string | null;
    };
    const beschrijving = body.beschrijving?.trim();
    if (!beschrijving) {
      return NextResponse.json(
        { error: "Beschrijving is verplicht" },
        { status: 400 }
      );
    }

    // Bepaal volgorde: laatste + 1
    const { data: laatste } = await supabase
      .from("risico_maatregelen")
      .select("volgorde")
      .eq("risico_id", id)
      .order("volgorde", { ascending: false })
      .limit(1);

    const volgorde = laatste && laatste[0] ? (laatste[0].volgorde as number) + 1 : 1;

    const { data: maatregel, error } = await supabase
      .from("risico_maatregelen")
      .insert({
        risico_id: id,
        beschrijving,
        verantwoordelijke: body.verantwoordelijke || null,
        status: "open",
        volgorde,
        aangemaakt_door: ctx.gebruikerId,
      })
      .select()
      .single();

    if (error || !maatregel) {
      console.error("Maatregel toevoegen fout:", error);
      return NextResponse.json(
        { error: "Toevoegen mislukt" },
        { status: 500 }
      );
    }

    await supabase.from("risico_log").insert({
      risico_id: id,
      event_type: "maatregel_toegevoegd",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam || null,
      payload: { beschrijving, maatregel_id: maatregel.id },
    });

    return NextResponse.json({ maatregel });
  } catch (e) {
    console.error("Fout in POST /api/risicos/[id]/maatregelen:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
