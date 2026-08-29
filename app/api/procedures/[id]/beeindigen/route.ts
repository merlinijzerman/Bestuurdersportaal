import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { ensureDecisionForProcedure } from "@/core/lib/decision";
import { z } from "zod";

// POST /api/procedures/[id]/beeindigen
//
// Beëindigt een procedure vóór het einde (§5.2, P4 #169). Capability
// `procedures.beeindigen` = voorzitter+bestuurder (besluit 0194 B). De RPC
// fn_procedure_beeindigen doet de inner rolgate + fondsgrens + verplichte
// motivering + het append-only governance_event (met actor-rol als
// momentopname), atomair. Dit is beëindigen van de PROCEDURE — niet te
// verwarren met heropenen-van-een-besluit (§6.3).
export const POST = withFondsRoute(
  {
    capability: "procedures.beeindigen",
    schema: z.object({ motivering: z.unknown().optional() }).passthrough(),
    hostGuard: "geen",
    rateLimit: "nog-niet-beoordeeld",
    audit: { handeling: "procedures.beeindigen" },
  },
  async (ctx, req: NextRequest, params) => {
    try {
      const { id } = params as { id: string };
      const supabase = ctx.supabase;
      const body = (await req.json().catch(() => ({}))) as { motivering?: string };
      const motivering = body.motivering?.trim();
      if (!motivering || motivering.length < 10) {
        return NextResponse.json(
          { error: "Beëindigen vereist een motivering van minimaal 10 tekens" },
          { status: 400 }
        );
      }
      // Garandeer een primair Decision Object; de RPC zoekt het fail-closed op.
      await ensureDecisionForProcedure(supabase, id);
      const { error } = await supabase.rpc("fn_procedure_beeindigen", {
        p_procedure_id: id,
        p_reden: motivering,
      });
      if (error) {
        const code = (error as { code?: string }).code;
        console.error("Procedure beëindigen fout:", error);
        if (code === "42501") return NextResponse.json({ error: error.message }, { status: 403 });
        if (code === "PC002") return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ error: "Beëindigen mislukt" }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    } catch (e) {
      console.error("Fout in POST …/beeindigen:", e);
      return NextResponse.json({ error: "Serverfout" }, { status: 500 });
    }
  }
);
