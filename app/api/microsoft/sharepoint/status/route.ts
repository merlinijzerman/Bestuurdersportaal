import { NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftSharePointActief } from "@/core/lib/microsoft-connector";
import { sharepointStatus } from "@/core/lib/microsoft-sharepoint";
import { rolHeeftCapability } from "@/core/lib/capabilities-map";
export const dynamic = "force-dynamic";
export const GET = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: "geen", capability: "profile.view.own", schema: "geen-body" }, async (ctx) => {
  if (!ctx.fondsId || !(await microsoftSharePointActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ beschikbaar: false }, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ beschikbaar: true, magBeheren: rolHeeftCapability(ctx.rol, "fonds.config.manage"), ...(await sharepointStatus({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId })) }, { headers: { "Cache-Control": "no-store" } });
});
