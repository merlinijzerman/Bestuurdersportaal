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
    hostGuard: "geen",
    rateLimit: "nog-niet-beoordeeld",
    audit: { handeling: "procedures.heropenen" },
    schema: z.object({
      motivering: z.unknown().optional(),
      reden_type: z.unknown().optional(),
    }).passthrough(),
  },
  async (ctx, req: NextRequest, params) => {
    try {
      const { id } = params as { id: string };
      const supabase = ctx.supabase;
      const body = (await req.json().catch(() => ({}))) as {
        motivering?: string;
        reden_type?: string;
      };
      const motivering = body.motivering?.trim();
      if (!motivering || motivering.length < 10) {
        return NextResponse.json(
          { error: "Heropenen vereist een motivering van minimaal 10 tekens" },
          { status: 400 }
        );
      }
      if (
        body.reden_type !== "ten_onrechte_beeindigd" &&
        body.reden_type !== "hervat_na_gewijzigde_omstandigheden"
      ) {
        return NextResponse.json(
          { error: "Kies een geldige reden om dit proces te heropenen" },
          { status: 400 }
        );
      }
      const { data, error } = await supabase.rpc("fn_procedure_heropenen", {
        p_procedure_id: id,
        p_reden: motivering,
        p_reden_type: body.reden_type,
      });
      if (error) {
        const code = (error as { code?: string }).code;
        console.error("Procedure heropenen fout:", error);
        if (code === "42501") return NextResponse.json({ error: error.message }, { status: 403 });
        if (code === "PC002" || code === "PC004" || code === "23514") {
          return NextResponse.json({ error: error.message }, { status: 409 });
        }
        return NextResponse.json({ error: "Heropenen mislukt" }, { status: 500 });
      }
      return NextResponse.json(data ?? { ok: true });
    } catch (e) {
      console.error("Fout in POST …/heropenen (procedure):", e);
      return NextResponse.json({ error: "Serverfout" }, { status: 500 });
    }
  }
);
