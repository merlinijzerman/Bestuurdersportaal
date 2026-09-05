import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftSharePointActief, startSharePointToestemming } from "@/core/lib/microsoft-connector";
import { veiligeMicrosoftReturnUrl } from "@/core/lib/microsoft-config";
export const dynamic = "force-dynamic";
/** Iedere fondsgebruiker verleent zijn eigen SharePoint-toestemming: lijst en
 * preview lopen straks met de gedelegeerde rechten van die gebruiker zelf. */
export const GET = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "microsoft.sharepoint.toestemming-uitbreiden" }, capability: "profile.manage.own", schema: "geen-body" }, async (ctx, req: NextRequest) => {
  if (!ctx.fondsId || !(await microsoftSharePointActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ error: "SharePoint is niet beschikbaar voor dit fonds." }, { status: 404 });
  try { return NextResponse.redirect(await startSharePointToestemming({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId }, veiligeMicrosoftReturnUrl(req.nextUrl.searchParams.get("returnTo"))), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "SharePoint-toestemming kan nu niet worden gestart." }, { status: 503 }); }
});
