import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftSharePointActief } from "@/core/lib/microsoft-connector";
import { sharepointDrives } from "@/core/lib/microsoft-sharepoint";
import { rolHeeftCapability } from "@/core/lib/capabilities-map";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const GET = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: "geen", capability: "fonds.config.manage", schema: "geen-body" }, async (ctx, req: NextRequest) => {
  if (!rolHeeftCapability(ctx.rol, "fonds.config.manage")) return NextResponse.json({ error: "U heeft geen rechten voor deze actie." }, { status: 403 });
  if (!ctx.fondsId || !(await microsoftSharePointActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ error: "SharePoint is niet beschikbaar voor dit fonds." }, { status: 404 });
  const kandidaatId = req.nextUrl.searchParams.get("kandidaat") ?? "";
  if (!UUID.test(kandidaatId)) return NextResponse.json({ error: "Ongeldige kandidaat." }, { status: 400 });
  try { return NextResponse.json(await sharepointDrives({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId }, kandidaatId), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Documentbibliotheken kunnen niet worden opgehaald." }, { status: 409 }); }
});
