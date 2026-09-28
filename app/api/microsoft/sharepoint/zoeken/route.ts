import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { rolHeeftCapability } from "@/core/lib/capabilities-map";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import { rateLimited } from "@/core/lib/api-errors";
import { microsoftSharePointActief } from "@/core/lib/microsoft-connector";
import { sharepointZoeken } from "@/core/lib/microsoft-sharepoint";
import { sharepointFoutcategorie } from "@/core/lib/microsoft-sharepoint-graph-core";
import { SHAREPOINT_ZOEK_TIMEOUT_MS, valideerZoekterm } from "@/core/lib/microsoft-sharepoint-zoeken-core";
export const dynamic = "force-dynamic";
const geenCache = { "Cache-Control": "no-store" } as const;

/** #463 fase A — metadatazoeken in de gekoppelde SharePoint-bron.
 *
 * Live enumeratie met het token van de ingelogde gebruiker (security trimming
 * van Microsoft), matching op naam/mappad/extensie en een tweede grenscontrole
 * per resultaat. Geen content-call, geen kopie, geen app-only terugval. De
 * browser krijgt alleen lokale referenties en presentatiemetadata.
 *
 * Autorisatie: `zoeken.use` ÉN `documents.view` (dezelfde leesbevoegdheid als
 * de SharePoint-lijst). De wrapper-declaratie kan maar één capability dragen
 * en is observerend tot ENFORCE_CAPABILITY; beide worden daarom hier inline
 * en altijd afgedwongen. Rate limit: eigen sleutel, fail-closed, route-eigen
 * zodat hij ook zonder ENFORCE_RATELIMIT geldt. */
export const GET = withFondsRoute({ hostGuard: "afdwingen", rateLimit: "route-eigen", audit: "geen", capability: "zoeken.use", label: "microsoft.sharepoint.zoeken", schema: "geen-body" }, async (ctx, req: NextRequest) => {
  if (!rolHeeftCapability(ctx.rol, "zoeken.use") || !rolHeeftCapability(ctx.rol, "documents.view")) {
    return NextResponse.json({ error: "U heeft geen rechten voor deze actie." }, { status: 403, headers: geenCache });
  }
  if (!ctx.fondsId || !(await microsoftSharePointActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ beschikbaar: false }, { headers: geenCache });

  const zoekterm = valideerZoekterm(req.nextUrl.searchParams.get("q"));
  if (!zoekterm.geldig) {
    const melding = zoekterm.reden === "te_kort" ? "Voer minimaal 2 tekens in." : "De zoekterm is te lang (maximaal 200 tekens).";
    return NextResponse.json({ error: melding }, { status: 400, headers: geenCache });
  }

  const limiet = await controleerLimiet(ctx.supabase, LIMIETEN.microsoft_sharepoint_zoeken, { failClosed: true });
  if (!limiet.toegestaan) return rateLimited("microsoft.sharepoint.zoeken", limiet.resetAt);

  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(SHAREPOINT_ZOEK_TIMEOUT_MS)]);
  try {
    return NextResponse.json({ beschikbaar: true, ...(await sharepointZoeken({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId, correlationId: ctx.requestId }, zoekterm.term, signal)) }, { headers: geenCache });
  } catch (fout) {
    const categorie = sharepointFoutcategorie(fout);
    if (categorie === "bron_niet_geconfigureerd") return NextResponse.json({ beschikbaar: true, bron: null, resultaten: [], totaal: 0, boomAfgekapt: false, resultatenAfgekapt: false }, { headers: geenCache });
    if (categorie === "toestemming_of_token") return NextResponse.json({ beschikbaar: true, error: "Verleen eerst SharePoint-toestemming op uw profiel.", foutcategorie: categorie }, { status: 409, headers: geenCache });
    if (categorie === "graph_timeout") return NextResponse.json({ beschikbaar: true, error: "SharePoint reageerde niet op tijd. Probeer het opnieuw.", foutcategorie: categorie }, { status: 504, headers: geenCache });
    return NextResponse.json({ beschikbaar: true, error: "Zoeken in SharePoint is nu niet gelukt.", foutcategorie: categorie }, { status: 409, headers: geenCache });
  }
});
