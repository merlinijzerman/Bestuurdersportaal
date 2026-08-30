import { NextRequest, NextResponse } from "next/server";
import type { FondsContext } from "@/core/lib/route-wrapper";
import { ensureDecisionForProcedure } from "@/core/lib/decision";
import { pasActivatieCascadeToe } from "@/core/lib/procedure-activatie-cascade";
import { MIN_MOTIVERING_LENGTE } from "@/core/lib/afwijking";

// Losse testnaad voor de route-rolpoort. Dit bestand staat bewust naast
// route.ts: Next.js accepteert in een route-module alleen HTTP-exports.
export async function afrondenMetAfwijkingHandler(
  ctx: FondsContext,
  req: NextRequest,
  params: unknown
) {
  try {
    const { id, stapId } = params as { id: string; stapId: string };
    const supabase = ctx.supabase;

    if (!["voorzitter", "bestuurder"].includes(ctx.rol ?? "")) {
      return NextResponse.json(
        { error: "Alleen voorzitter of bestuurder kan een afwijking vastleggen" },
        { status: 403 }
      );
    }

    const body = (await req.json()) as { motivering?: string; bevestigd?: boolean };
    const motivering = body.motivering?.trim();
    if (!motivering || motivering.length < MIN_MOTIVERING_LENGTE) {
      return NextResponse.json(
        { error: `Een afwijking vereist een motivering van minimaal ${MIN_MOTIVERING_LENGTE} tekens` },
        { status: 400 }
      );
    }

    const { data: stap } = await supabase
      .from("procedure_stappen")
      .select("naam, volgorde, procedure_id")
      .eq("id", stapId)
      .eq("procedure_id", id)
      .single();
    if (!stap) {
      return NextResponse.json({ error: "Stap niet gevonden" }, { status: 404 });
    }

    await ensureDecisionForProcedure(supabase, id);

    const { error: rpcFout } = await supabase.rpc("fn_stap_afronden_met_afwijking", {
      p_stap_id: stapId,
      p_procedure_id: id,
      p_motivering: motivering,
      p_bevestigd: body.bevestigd ?? false,
    });
    if (rpcFout) {
      if (rpcFout.code === "PC001") {
        return NextResponse.json(
          {
            error: "Er staat een kritieke vereiste open; bevestig expliciet om af te ronden.",
            bevestiging_vereist: true,
          },
          { status: 409 }
        );
      }
      if (rpcFout.code === "42501") {
        return NextResponse.json(
          { error: "Niet bevoegd om een afwijking vast te leggen" },
          { status: 403 }
        );
      }
      if (rpcFout.code === "PC002") {
        return NextResponse.json({ error: rpcFout.message }, { status: 400 });
      }
      console.error("Afwijking vastleggen fout:", rpcFout);
      return NextResponse.json(
        { error: "Afronden met afwijking mislukt" },
        { status: 500 }
      );
    }

    const cascade = await pasActivatieCascadeToe(
      supabase,
      id,
      { volgorde: stap.volgorde, naam: stap.naam },
      { gebruikerId: ctx.gebruikerId, naam: ctx.naam, email: ctx.email }
    );

    return NextResponse.json({
      ok: true,
      ...(cascade.ok
        ? {}
        : {
            waarschuwing:
              "De stap is afgerond met afwijking; de vervolgactivering is nog niet voltooid en wordt hersteld.",
          }),
    });
  } catch (e) {
    console.error("Fout in POST …/afwijking:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
