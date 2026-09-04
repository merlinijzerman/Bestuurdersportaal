import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftSharePointActief } from "@/core/lib/microsoft-connector";
import { SHAREPOINT_MAX_ROOTMAP_DIEPTE, kiesSharePointBron, ontkoppelSharePointBron } from "@/core/lib/microsoft-sharepoint";
import { rolHeeftCapability } from "@/core/lib/capabilities-map";
export const dynamic = "force-dynamic";
const GRAPH_ID = /^[A-Za-z0-9!_.-]{1,512}$/;
const bronSchema = z.object({
  kandidaatId: z.string().uuid(),
  driveId: z.string().regex(GRAPH_ID),
  mapItemIds: z.array(z.string().regex(GRAPH_ID)).max(SHAREPOINT_MAX_ROOTMAP_DIEPTE).default([]),
  weergavenaam: z.string().trim().max(160).optional(),
});
export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "microsoft.sharepoint.bron-kiezen" }, capability: "fonds.config.manage", schema: bronSchema }, async (ctx, req: NextRequest) => {
  if (!rolHeeftCapability(ctx.rol, "fonds.config.manage")) return NextResponse.json({ error: "U heeft geen rechten voor deze actie." }, { status: 403 });
  if (!ctx.fondsId || !(await microsoftSharePointActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ error: "SharePoint is niet beschikbaar voor dit fonds." }, { status: 404 });
  const geparsed = bronSchema.safeParse(await req.json().catch(() => null));
  if (!geparsed.success) return NextResponse.json({ error: "Ongeldige bronselectie." }, { status: 400 });
  try { await kiesSharePointBron({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId }, geparsed.data); return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Deze bron kan niet worden gekozen." }, { status: 409 }); }
});
export const DELETE = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "microsoft.sharepoint.bron-ontkoppelen" }, capability: "fonds.config.manage", schema: "geen-body" }, async (ctx) => {
  if (!rolHeeftCapability(ctx.rol, "fonds.config.manage")) return NextResponse.json({ error: "U heeft geen rechten voor deze actie." }, { status: 403 });
  if (!ctx.fondsId || !(await microsoftSharePointActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ error: "SharePoint is niet beschikbaar voor dit fonds." }, { status: 404 });
  await ontkoppelSharePointBron({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});
