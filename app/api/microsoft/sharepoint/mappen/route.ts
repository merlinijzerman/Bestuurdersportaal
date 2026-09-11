import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftSharePointActief } from "@/core/lib/microsoft-connector";
import { SHAREPOINT_MAX_ROOTMAP_DIEPTE, sharepointMappen } from "@/core/lib/microsoft-sharepoint";
import { rolHeeftCapability } from "@/core/lib/capabilities-map";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRAPH_ID = /^[A-Za-z0-9!_.-]{1,512}$/;
export const GET = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: "geen", capability: "fonds.config.manage", schema: "geen-body" }, async (ctx, req: NextRequest) => {
  if (!rolHeeftCapability(ctx.rol, "fonds.config.manage")) return NextResponse.json({ error: "U heeft geen rechten voor deze actie." }, { status: 403 });
  if (!ctx.fondsId || !(await microsoftSharePointActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ error: "SharePoint is niet beschikbaar voor dit fonds." }, { status: 404 });
  const kandidaatId = req.nextUrl.searchParams.get("kandidaat") ?? "";
  const driveId = req.nextUrl.searchParams.get("drive") ?? "";
  const mapItemIds = req.nextUrl.searchParams.getAll("map");
  if (!UUID.test(kandidaatId) || !GRAPH_ID.test(driveId) || mapItemIds.length > SHAREPOINT_MAX_ROOTMAP_DIEPTE || !mapItemIds.every((x) => GRAPH_ID.test(x))) {
    return NextResponse.json({ error: "Ongeldige mapselectie." }, { status: 400 });
  }
  try { return NextResponse.json(await sharepointMappen({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId }, { kandidaatId, driveId, mapItemIds }), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Mappen kunnen niet worden opgehaald." }, { status: 409 }); }
});
