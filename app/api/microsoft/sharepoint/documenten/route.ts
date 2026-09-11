import { NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftSharePointActief } from "@/core/lib/microsoft-connector";
import { sharepointDocumenten } from "@/core/lib/microsoft-sharepoint";
import { sharepointFoutcategorie } from "@/core/lib/microsoft-sharepoint-graph-core";
export const dynamic = "force-dynamic";
/** Live metadata-listing met het token van de ingelogde gebruiker; geen content-call,
 * geen bestandskopie. De browser krijgt alleen lokale referenties en presentatiemetadata. */
export const GET = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: "geen", capability: "documents.view", schema: "geen-body" }, async (ctx) => {
  if (!ctx.fondsId || !(await microsoftSharePointActief(ctx.supabase, ctx.fondsId))) return NextResponse.json({ beschikbaar: false }, { headers: { "Cache-Control": "no-store" } });
  try {
    return NextResponse.json({ beschikbaar: true, ...(await sharepointDocumenten({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId, correlationId: ctx.requestId })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (fout) {
    const categorie = sharepointFoutcategorie(fout);
    if (categorie === "bron_niet_geconfigureerd") return NextResponse.json({ beschikbaar: true, bron: null, documenten: [], mappen: [], afgekapt: false }, { headers: { "Cache-Control": "no-store" } });
    const melding = categorie === "toestemming_of_token" ? "Verleen eerst SharePoint-toestemming op uw profiel." : "SharePoint-documenten kunnen nu niet worden opgehaald.";
    return NextResponse.json({ beschikbaar: true, error: melding, foutcategorie: categorie }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
});
