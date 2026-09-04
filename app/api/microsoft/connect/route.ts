import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftPilotActief, startKoppeling } from "@/core/lib/microsoft-connector";
import { veiligeMicrosoftReturnUrl } from "@/core/lib/microsoft-config";
export const dynamic = "force-dynamic";
export const GET = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "microsoft.koppeling.start" }, capability: "profile.manage.own", schema: "geen-body" }, async (ctx, req: NextRequest) => {
  if (!ctx.fondsId || !(await microsoftPilotActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ error: "Microsoft-koppeling is niet beschikbaar voor dit fonds." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  try { return NextResponse.redirect(await startKoppeling({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId }, veiligeMicrosoftReturnUrl(req.nextUrl.searchParams.get("returnTo"))), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Microsoft-koppeling kan nu niet worden gestart." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
});
