import { NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftOutlookActief } from "@/core/lib/microsoft-connector";
import { synchroniseerOutlookAgenda } from "@/core/lib/microsoft-outlook";
import { rolHeeftCapability } from "@/core/lib/capabilities-map";
export const dynamic = "force-dynamic";
export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "microsoft.outlook.synchroniseren" }, capability: "fonds.config.manage", schema: "geen-body" }, async (ctx) => {
  if (!rolHeeftCapability(ctx.rol, "fonds.config.manage")) return NextResponse.json({ error: "U heeft geen rechten voor deze actie." }, { status: 403 });
  if (!ctx.fondsId || !(await microsoftOutlookActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ error: "Outlook is niet beschikbaar voor dit fonds." }, { status: 404 });
  try { return NextResponse.json({ ok: true, ...(await synchroniseerOutlookAgenda({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId, correlationId: ctx.requestId })) }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Synchronisatie is niet voltooid. De vorige cursor blijft behouden." }, { status: 409, headers: { "Cache-Control": "no-store" } }); }
});
