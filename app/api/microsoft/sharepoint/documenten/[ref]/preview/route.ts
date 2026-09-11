import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftSharePointActief } from "@/core/lib/microsoft-connector";
import { sharepointPreview } from "@/core/lib/microsoft-sharepoint";
import { sharepointFoutcategorie } from "@/core/lib/microsoft-sharepoint-graph-core";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const geenCache = { "Cache-Control": "no-store" } as const;
/** De preview-URL is een kortlevend toegangsbewijs: hij wordt per verzoek opgehaald na
 * een nieuwe server-side controle, alleen in deze no-store-respons teruggegeven en
 * nergens opgeslagen, gelogd of geaudit. */
export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "microsoft.sharepoint.documenten.previewen" }, capability: "documents.view", schema: "geen-body" }, async (ctx, req: NextRequest) => {
  if (!ctx.fondsId || !(await microsoftSharePointActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ error: "SharePoint is niet beschikbaar voor dit fonds." }, { status: 404, headers: geenCache });
  const ref = req.nextUrl.pathname.split("/").at(-2) ?? "";
  if (!UUID.test(ref)) return NextResponse.json({ error: "Ongeldige documentreferentie." }, { status: 400, headers: geenCache });
  try {
    return NextResponse.json(await sharepointPreview({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId, correlationId: ctx.requestId }, ref.toLowerCase()), { headers: geenCache });
  } catch (fout) {
    const categorie = sharepointFoutcategorie(fout);
    if (categorie === "niet_gevonden") return NextResponse.json({ error: "Dit document bestaat niet meer in SharePoint of is niet voor u zichtbaar." }, { status: 404, headers: geenCache });
    if (categorie === "toestemming_of_token") return NextResponse.json({ error: "Uw SharePoint-toegang is niet (meer) geldig. Verleen opnieuw toestemming op uw profiel." }, { status: 403, headers: geenCache });
    if (categorie === "bron_niet_toegankelijk") return NextResponse.json({ error: "Dit document valt niet meer binnen de gekoppelde SharePoint-map." }, { status: 410, headers: geenCache });
    return NextResponse.json({ error: "Er is nu geen preview beschikbaar voor dit document." }, { status: 409, headers: geenCache });
  }
});
