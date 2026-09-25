import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/core/lib/capabilities";
import { sharePointRetrievalSmokeToegestaan } from "@/core/lib/microsoft-sharepoint-retrieval-smoke-gate";
import {
  SHAREPOINT_RETRIEVAL_SMOKE_ROUTES,
  SHAREPOINT_RETRIEVAL_SMOKE_SCENARIOS,
  SHAREPOINT_RETRIEVAL_SEARCH_SCOPES,
  veiligeSmokeFoutcategorie,
  type SharePointRetrievalSmokeEvent,
} from "@/core/lib/microsoft-sharepoint-retrieval-smoke-core";
import { voerSharePointRetrievalPreviewSmokeUit } from "@/core/lib/microsoft-sharepoint-retrieval-smoke";
import * as vault from "@/core/lib/microsoft-vault";
import { withFondsRoute } from "@/core/lib/route-wrapper";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({
  scenario: z.enum(SHAREPOINT_RETRIEVAL_SMOKE_SCENARIOS),
  route: z.enum(SHAREPOINT_RETRIEVAL_SMOKE_ROUTES),
  ronde: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  searchScope: z.enum(SHAREPOINT_RETRIEVAL_SEARCH_SCOPES).optional(),
}).strict();

function neutraalNietBeschikbaar() {
  return NextResponse.json({ error: "Deze test is niet beschikbaar." }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

/** Preview-only uitvoerpoort. De browser kan alleen een vaste scenario-, route-
 * en rondecode kiezen; vragen, refs en Graph-identifiers zijn geen invoerveld. */
export const POST = withFondsRoute({
  hostGuard: "afdwingen",
  rateLimit: "microsoft_sharepoint_retrieval_spike",
  audit: { handeling: "microsoft.sharepoint.retrieval-smoke.uitvoeren" },
  capability: "login.beleid.manage",
  schema,
  label: "microsoft.sharepoint.retrieval-smoke",
}, async (ctx, req: NextRequest) => {
  if (!ctx.fondsId
    || !(await requireCapability(ctx.gebruikerId, "login.beleid.manage"))
    || !(await sharePointRetrievalSmokeToegestaan(ctx.supabase, ctx.fondsId))) return neutraalNietBeschikbaar();

  const invoer = schema.safeParse(await req.json().catch(() => null));
  if (!invoer.success) return NextResponse.json({ error: "Ongeldige invoer." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (invoer.data.scenario === "S00" && invoer.data.route !== "drive_search_extract") {
    return NextResponse.json({ error: "Ongeldige invoer." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (invoer.data.searchScope && (invoer.data.scenario !== "S02" || invoer.data.route !== "microsoft_search")) {
    return NextResponse.json({ error: "Ongeldige invoer." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const encoder = new TextEncoder();
  const afbreken = new AbortController();
  const signal = AbortSignal.any([req.signal, afbreken.signal]);
  let gesloten = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const stuur = (event: SharePointRetrievalSmokeEvent) => {
        if (gesloten || signal.aborted) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { gesloten = true; }
      };
      stuur({ type: "gestart", ...invoer.data });
      void voerSharePointRetrievalPreviewSmokeUit({
        fondsId: ctx.fondsId!,
        gebruikerId: ctx.gebruikerId,
        correlationId: ctx.requestId,
        signal,
      }, invoer.data, stuur).then((meting) => {
        stuur({ type: "voltooid", meting });
      }).catch(async (fout) => {
        const foutcategorie = veiligeSmokeFoutcategorie(fout);
        await vault.registreerSharePointGebeurtenis({
          fondsId: ctx.fondsId!,
          gebruikerId: ctx.gebruikerId,
          gebeurtenis: "microsoft.sharepoint.retrieval_spike.mislukt",
          correlationId: ctx.requestId,
          foutcategorie,
          details: { ronde: invoer.data.ronde, vraagcode: invoer.data.scenario, route: invoer.data.route, search_scope: invoer.data.searchScope ?? "niet_van_toepassing", resultaat: "mislukt" },
        }).catch(() => undefined);
        stuur({ type: "mislukt", foutcategorie });
      }).finally(() => {
        if (!gesloten) {
          gesloten = true;
          try { controller.close(); } catch { /* client was al weg */ }
        }
      });
    },
    cancel() {
      gesloten = true;
      afbreken.abort("client_disconnect");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
