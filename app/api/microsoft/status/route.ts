import { NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftPilotActief, statusKoppeling } from "@/core/lib/microsoft-connector";
export const dynamic = "force-dynamic";
export const GET = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: "geen", capability: "profile.view.own", schema: "geen-body" }, async (ctx) => {
  if (!ctx.fondsId || !(await microsoftPilotActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ beschikbaar: false }, { headers: { "Cache-Control": "no-store" } });
  const x = await statusKoppeling({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId });
  return NextResponse.json({ beschikbaar: true, gekoppeld: x?.status === "gekoppeld", verbinding: x ? { status: x.status, weergavenaam: x.display_name, gebruikersnaam: x.masked_username, tenantReferentie: x.tenant_id.slice(0, 8), laatstGetestOp: x.laatst_getest_op } : null }, { headers: { "Cache-Control": "no-store" } });
});
