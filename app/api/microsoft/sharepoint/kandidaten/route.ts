import { NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftSharePointActief } from "@/core/lib/microsoft-connector";
import { sharepointKandidaten } from "@/core/lib/microsoft-sharepoint";
import { rolHeeftCapability } from "@/core/lib/capabilities-map";
export const dynamic = "force-dynamic";
export const GET = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: "geen", capability: "fonds.config.manage", schema: "geen-body" }, async (ctx) => {
  if (!rolHeeftCapability(ctx.rol, "fonds.config.manage")) return NextResponse.json({ error: "U heeft geen rechten voor deze actie." }, { status: 403 });
  if (!ctx.fondsId || !(await microsoftSharePointActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ error: "SharePoint is niet beschikbaar voor dit fonds." }, { status: 404 });
  try { return NextResponse.json(await sharepointKandidaten({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId }), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Kandidaatsites kunnen niet worden gecontroleerd. Verleen eerst SharePoint-toestemming." }, { status: 409 }); }
});
