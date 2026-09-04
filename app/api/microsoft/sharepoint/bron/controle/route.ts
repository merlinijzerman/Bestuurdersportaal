import { NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftSharePointActief } from "@/core/lib/microsoft-connector";
import { controleerSharePointBron } from "@/core/lib/microsoft-sharepoint";
import { rolHeeftCapability } from "@/core/lib/capabilities-map";
export const dynamic = "force-dynamic";
export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "microsoft.sharepoint.bron-controleren" }, capability: "fonds.config.manage", schema: "geen-body" }, async (ctx) => {
  if (!rolHeeftCapability(ctx.rol, "fonds.config.manage")) return NextResponse.json({ error: "U heeft geen rechten voor deze actie." }, { status: 403 });
  if (!ctx.fondsId || !(await microsoftSharePointActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ error: "SharePoint is niet beschikbaar voor dit fonds." }, { status: 404 });
  try { await controleerSharePointBron({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId }); return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "De bron is nu niet bereikbaar. De status is bijgewerkt." }, { status: 409, headers: { "Cache-Control": "no-store" } }); }
});
