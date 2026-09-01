import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { haalKandidaten } from "@/core/lib/vereiste-kandidaten";

// P2/#192 — kandidaten voor de kiezer-UI: bestaande artefacten die aan een
// vereiste gekoppeld kunnen worden. requirement_sleutel gaat als QUERYPARAMETER
// (niet als padsegment: hij bevat '|'). Leesroute → capability procedures.view.
export const GET = withFondsRoute(
  {
    capability: "procedures.view",
    schema: "geen-body",
    hostGuard: "geen",
    rateLimit: "nog-niet-beoordeeld",
    audit: "geen",
  },
  async (ctx, req: NextRequest, params) => {
    try {
      const { id } = params as { id: string };
      const sleutel = new URL(req.url).searchParams.get("requirement_sleutel");
      if (!sleutel) {
        return NextResponse.json(
          { error: "requirement_sleutel is verplicht (queryparameter)" },
          { status: 400 }
        );
      }
      const res = await haalKandidaten(ctx.supabase, id, sleutel);
      if (!res.ok) {
        return NextResponse.json({ error: res.fout }, { status: res.status });
      }
      return NextResponse.json({ type: res.type, kandidaten: res.kandidaten });
    } catch (e) {
      console.error("Fout in GET /api/procedures/[id]/vereisten/kandidaten:", e);
      return NextResponse.json({ error: "Serverfout" }, { status: 500 });
    }
  }
);
