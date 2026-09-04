import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftOutlookActief } from "@/core/lib/microsoft-connector";
import { kiesOutlookAgenda, outlookAgendaLijst } from "@/core/lib/microsoft-outlook";
import { rolHeeftCapability } from "@/core/lib/capabilities-map";
export const dynamic = "force-dynamic";
const spec = { hostGuard: "geen" as const, rateLimit: "nog-niet-beoordeeld" as const, capability: "fonds.config.manage" as const };
export const GET = withFondsRoute({ ...spec, audit: "geen", schema: "geen-body" }, async (ctx) => {
  if (!rolHeeftCapability(ctx.rol, "fonds.config.manage")) return NextResponse.json({ error: "U heeft geen rechten voor deze actie." }, { status: 403 });
  if (!ctx.fondsId || !(await microsoftOutlookActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ error: "Outlook is niet beschikbaar voor dit fonds." }, { status: 404 });
  try { return NextResponse.json(await outlookAgendaLijst({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId }), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Agenda's kunnen niet worden opgehaald." }, { status: 409 }); }
});
export const POST = withFondsRoute({ ...spec, audit: { handeling: "microsoft.outlook.agenda-kiezen" }, schema: z.object({ calendarId: z.string().min(1).max(2048) }) }, async (ctx, req: NextRequest) => {
  if (!rolHeeftCapability(ctx.rol, "fonds.config.manage")) return NextResponse.json({ error: "U heeft geen rechten voor deze actie." }, { status: 403 });
  if (!ctx.fondsId || !(await microsoftOutlookActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ error: "Outlook is niet beschikbaar voor dit fonds." }, { status: 404 });
  try { const { calendarId } = await req.json() as { calendarId: string }; await kiesOutlookAgenda({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId }, calendarId); return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Deze agenda kan niet worden gekozen." }, { status: 409 }); }
});
