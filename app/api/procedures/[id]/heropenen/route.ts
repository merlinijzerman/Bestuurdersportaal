import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { z } from "zod";

// POST /api/procedures/[id]/heropenen
//
// Heropent een BEËINDIGDE procedure (0194 E, P4 #169). Capability
// `procedures.heropenen` = voorzitter+bestuurder — dezelfde rolset als
// beëindigen, zodat het bestuursbureau niet via procedures.manage terugdraait
// wat het bestuur besloot. De RPC fn_procedure_heropenen doet rolgate +
// fondsgrens + verplichte motivering + append-only governance_event, atomair.
//
// LET OP — dit is heropenen van de PROCEDURE (object: procedures, uit 'beeindigd').
// Heropenen van een BESLUIT (besloten→heropend, §6.3) is een aparte overgang op
// decision_objects onder `decisions.manage` (tranche 7).
export const POST = withFondsRoute(
  {
    capability: "procedures.heropenen",
    schema: z.object({ motivering: z.unknown().optional() }).passthrough(),
    hostGuard: "geen",
    rateLimit: "nog-niet-beoordeeld",
    audit: { handeling: "procedures.heropenen" },
  },
  async (ctx, req: NextRequest, params) => {
    try {
      const { id } = params as { id: string };
      const supabase = ctx.supabase;
      const body = (await req.json().catch(() => ({}))) as { motivering?: string };
      const motivering = body.motivering?.trim();
      if (!motivering || motivering.length < 10) {
        return NextResponse.json(
          { error: "Heropenen vereist een motivering van minimaal 10 tekens" },
          { status: 400 }
        );
      }
      const { error } = await supabase.rpc("fn_procedure_heropenen", {
        p_procedure_id: id,
        p_reden: motivering,
      });
      if (error) {
        const code = (error as { code?: string }).code;
        console.error("Procedure heropenen fout:", error);
        if (code === "42501") return NextResponse.json({ error: error.message }, { status: 403 });
        if (code === "PC002") return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ error: "Heropenen mislukt" }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    } catch (e) {
      console.error("Fout in POST …/heropenen (procedure):", e);
      return NextResponse.json({ error: "Serverfout" }, { status: 500 });
    }
  }
);
