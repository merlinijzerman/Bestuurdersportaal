import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/core/lib/capabilities";
import { startMicrosoftSearchSpikeToestemming } from "@/core/lib/microsoft-connector";
import { veiligeMicrosoftReturnUrl } from "@/core/lib/microsoft-config";
import { sharePointRetrievalSmokeToegestaan } from "@/core/lib/microsoft-sharepoint-retrieval-smoke-gate";
import { withFondsRoute } from "@/core/lib/route-wrapper";

export const dynamic = "force-dynamic";

function neutraalNietBeschikbaar() {
  return NextResponse.json({ error: "Deze test is niet beschikbaar." }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

/** Uitsluitend de tijdelijke PGB Preview-spike mag de brede delegated
 * Microsoft Search-scope interactief aanvragen. Normale connectorroutes
 * accepteren deze scope niet. */
export const GET = withFondsRoute({
  hostGuard: "afdwingen",
  rateLimit: "microsoft_sharepoint_retrieval_spike",
  audit: { handeling: "microsoft.sharepoint.retrieval-smoke.toestemming-uitbreiden" },
  capability: "login.beleid.manage",
  schema: "geen-body",
}, async (ctx, req: NextRequest) => {
  if (!ctx.fondsId
    || !(await requireCapability(ctx.gebruikerId, "login.beleid.manage"))
    || !(await sharePointRetrievalSmokeToegestaan(ctx.supabase, ctx.fondsId))) return neutraalNietBeschikbaar();

  try {
    const url = await startMicrosoftSearchSpikeToestemming(
      { fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId },
      veiligeMicrosoftReturnUrl(req.nextUrl.searchParams.get("returnTo")),
    );
    return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Microsoft Search-toestemming kan nu niet worden gestart." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
});
