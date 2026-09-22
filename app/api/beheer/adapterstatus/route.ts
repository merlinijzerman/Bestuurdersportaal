import { NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { aggregeerAdapterMeta } from "@/core/lib/retrieval/adaptermeta-beheer";
import { requireCapability } from "@/core/lib/capabilities";

export const dynamic = "force-dynamic";

/**
 * #434 T4-F — beheerstand over de DUURZAME adapterdiagnostiek.
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
    // De declaratie in de wrapper is een belofte; deze regel is de weigering.
    if (!(await requireCapability(ctx.gebruikerId, "fonds.config.manage"))) {
      return NextResponse.json(
        { error: "Onvoldoende rechten." },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (!ctx.fondsId) {
      return NextResponse.json({ adapters: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    // Expliciet op fonds_id filteren NAAST de RLS: defense-in-depth is hier
    // goedkoop, en een leespad dat alleen op RLS leunt is één policywijziging
    // verwijderd van een lek.
    const { data, error } = await ctx.supabase
      .from("governance_log")
      .select("retrieval_meta")
      .eq("fonds_id", ctx.fondsId)
      .not("retrieval_meta", "is", null)
      .order("aangemaakt_op", { ascending: false })
      .limit(500);

    if (error) {
      return NextResponse.json(
        { error: "De adapterstand kon niet worden gelezen." },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    const adapters = aggregeerAdapterMeta((data ?? []).map((r) => r.retrieval_meta));
    return NextResponse.json({ adapters }, { headers: { "Cache-Control": "no-store" } });
  }
);
