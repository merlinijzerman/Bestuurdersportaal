import { NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftPilotActief, testKoppeling } from "@/core/lib/microsoft-connector";
export const dynamic = "force-dynamic";
export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "microsoft.koppeling.test" }, capability: "profile.manage.own", schema: "geen-body" }, async (ctx) => {
  if (!ctx.fondsId || !(await microsoftPilotActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ error: "Microsoft-koppeling is niet beschikbaar voor dit fonds." }, { status: 404 });
  try { await testKoppeling({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId }); return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "De verbinding kon niet worden getest. Koppel opnieuw om te herstellen." }, { status: 409, headers: { "Cache-Control": "no-store" } }); }
});
