import { NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftPilotActief, ontkoppelKoppeling } from "@/core/lib/microsoft-connector";
export const dynamic = "force-dynamic";
export const DELETE = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "microsoft.koppeling.ontkoppelen" }, capability: "profile.manage.own", schema: "geen-body" }, async (ctx) => {
  if (!ctx.fondsId || !(await microsoftPilotActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ error: "Microsoft-koppeling is niet beschikbaar voor dit fonds." }, { status: 404 });
  await ontkoppelKoppeling({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});
