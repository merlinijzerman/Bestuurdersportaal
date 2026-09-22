import { NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import {
  leesAdapterstand,
  type MetaBron,
} from "@/core/lib/retrieval/adapterstatus-lezer";
import { requireCapability } from "@/core/lib/capabilities";

export const dynamic = "force-dynamic";

/**
 * #434 T4-F — beheerstand over de DUURZAME adapterdiagnostiek.
 *
 * Deze route is bewust DUN. Autorisatievolgorde, fondsfilter, leeslimiet en
 * aggregatie staan in `core/lib/retrieval/adapterstatus-lezer.ts`, waar een test
 * ze werkelijk kan uitvoeren met een onbevoegde gebruiker en met een tweede
 * fonds in de dataset. Alles wat hier zou staan, zou alleen via broncode-inspectie
 * te toetsen zijn — en dat bewijst dat een regel STAAT, niet dat hij WERKT.
 *
 * Leest uitsluitend `governance_log.retrieval_meta` via de gewone RLS-client:
 * fonds- en tenantisolatie komen dus van de database en niet van deze route.
 * Geen service-role, geen ruimer leesrecht, geen live Microsoft-call — wat hier
 * staat is wat is vastgelegd, niet wat er nú het geval is.
 *
 * `fonds.config.manage` is de BESTAANDE beheercapability; er komt geen nieuwe
 * bij. Een nieuwe capability voor één weergave zou het rolmodel uitbreiden voor
 * iets wat er al in past.
 */
export const GET = withFondsRoute(
  {
    hostGuard: "afdwingen",
    rateLimit: "nog-niet-beoordeeld",
    audit: "geen",
    capability: "fonds.config.manage",
    schema: "geen-body",
  },
  async (ctx) => {
    // Wrapperpoort ÉN inline controle (patroon /api/microsoft-login/beheer).
    // De declaratie in de wrapper is een belofte; de poort in de lezer is de
    // weigering, en die draait vóór enige query.
    const uitkomst = await leesAdapterstand({
      gebruikerId: ctx.gebruikerId,
      fondsId: ctx.fondsId,
      magBeheren: (gebruikerId) => requireCapability(gebruikerId, "fonds.config.manage"),
      // Eén cast op de grens: de echte client draagt zijn eigen generieke
      // typen, het leespad kent alleen de schakels die het gebruikt.
      bron: ctx.supabase as unknown as MetaBron,
    });

    const body = uitkomst.status === 200 ? uitkomst.stand : { error: uitkomst.fout };
    return NextResponse.json(body, {
      status: uitkomst.status,
      headers: { "Cache-Control": "no-store" },
    });
  }
);
