import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftOutlookActief, startOutlookToestemming } from "@/core/lib/microsoft-connector";
import { veiligeMicrosoftReturnUrl } from "@/core/lib/microsoft-config";
import { rolHeeftCapability } from "@/core/lib/capabilities-map";
export const dynamic = "force-dynamic";
export const GET = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "microsoft.outlook.toestemming-uitbreiden" }, capability: "fonds.config.manage", schema: "geen-body" }, async (ctx, req: NextRequest) => {
  if (!rolHeeftCapability(ctx.rol, "fonds.config.manage")) return NextResponse.json({ error: "U heeft geen rechten voor deze actie." }, { status: 403 });
  if (!ctx.fondsId || !(await microsoftOutlookActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ error: "Outlook is niet beschikbaar voor dit fonds." }, { status: 404 });
  try { return NextResponse.redirect(await startOutlookToestemming({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId }, veiligeMicrosoftReturnUrl(req.nextUrl.searchParams.get("returnTo"))), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Outlook-toestemming kan nu niet worden gestart." }, { status: 503 }); }
});
