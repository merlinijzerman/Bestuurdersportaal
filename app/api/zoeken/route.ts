// ============================================================================
//  GET /api/zoeken — Increment H (zoekmodule, UI op bestaande retrieval).
// ----------------------------------------------------------------------------
//  Volwaardige zoek-UI via het providerneutrale RetrievalAdapter-contract en de
//  centrale orkestratie (#369). De Supabase-adapter gebruikt dezelfde RPC's als
//  de AI-assistent; scope-vóór-ranking, filters en SECURITY INVOKER-RLS blijven.
//
//  Query-parameters:
//    q              — zoekterm (verplicht, ≥ 2 tekens)
//    modus          — 'alles' | 'actueel' | 'historisch'  (zoekmodus; default alles)
//    bronsoort      — 'alles' | 'fonds' | 'generiek'      (B12-bronsoortfilter)
//    procesinstantie— optioneel procedure-id (dossier) om op te filteren
//
//  De resultaten worden per DOCUMENT samengevoegd (meerdere chunktreffers →
//  meerdere "treffers" onder één document) en dragen de bronsoort-/status-labels.
//  De client groepeert documenten vervolgens op procesinstantie (dossier).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import { rateLimited } from "@/core/lib/api-errors";
import { type RetrievalFilters } from "@/core/lib/rag";
import type { RetrievalModus } from "@/core/lib/vraagtype";
import { bevatPersoonsgegevens } from "@/core/lib/pii-gate";
import { hybrideZoekenAan, retrievalVlaggenVoorFonds } from "@/core/lib/fonds-config";
import { maakSupabaseAdapter } from "@/core/lib/retrieval/supabase-adapter";
import { voerVolledigeRetrievalUit, foutcategorieVoor } from "@/core/lib/retrieval/orkestratie";
import { timeoutUitConfig } from "@/core/lib/retrieval/afbreken";
import type { Bronsoort } from "@/core/lib/retrieval/contract";
import {
  citaatOpdracht,
  bevatClientScopeSturing,
  geldigeUuid,
  groepeerZoekresultaten,
  maakZoekRespons,
  maakZoekSpoor,
} from "@/core/lib/retrieval/productiepaden-core";

export const dynamic = "force-dynamic";

// Zoekmodus uit de UI → retrieval-modus (Increment G). 'besluitvorming' is hier
// bewust niet beschikbaar: dat is een AI-antwoordmodus, geen zoekfilter.
const MODUS_MAP: Record<string, RetrievalModus> = {
  alles: "alles",
  actueel: "actueel",
  historisch: "historisch",
};

export const GET = withFondsRoute({ hostGuard: "afdwingen", rateLimit: "route-eigen", audit: "geen", capability: "zoeken.use", label: "zoeken.GET", schema: "geen-body" }, async (ctx, req: NextRequest) => {
  try {
    const supabase = ctx.supabase;

    // M-06 (review 2026-07-30): deze route doet per aanroep externe
    // modelcalls en had geen enkele limiet — onbeperkt herhaalbaar door een
    // geauthenticeerde gebruiker (kosten-DoS).
    // Fail-closed: bij een storing in de teller is doorlaten juist de duurste
    // optie (zie core/lib/rate-limit.ts).
    const limiet = await controleerLimiet(supabase, LIMIETEN.zoeken, { failClosed: true });
    if (!limiet.toegestaan) return rateLimited("zoeken", limiet.resetAt);

    // Increment T4 — resolveer het fonds SERVER-SIDE (uit profiel via RLS), zodat
    // de expliciete fondsfilter meegaat naar de retrieval. Fail-closed: zonder fonds
    // geen retrieval (een profiel zonder fonds mag niets zien). De query-string kan
    // dit niet beïnvloeden — er is geen fonds-parameter en RLS blijft leidend.
    const fondsId = ctx.fondsId;
    if (!fondsId) {
      return NextResponse.json(
        { error: "Geen fonds gekoppeld aan dit profiel." },
        { status: 403 }
      );
    }

    const sp = req.nextUrl.searchParams;
    if (bevatClientScopeSturing(sp.keys())) {
      return NextResponse.json({ error: "Ongeldige scope-invoer." }, { status: 400 });
    }
    const q = (sp.get("q") ?? "").trim();
    if (q.length < 2) {
      return NextResponse.json(
        { resultaten: [], procesinstanties: [], meta: null, melding: "Voer minimaal 2 tekens in." },
        { status: 200 }
      );
    }

    // #369 — de zoekterm kan naar een embedding- of rerankprovider gaan. De
    // PII-poort staat daarom vóór scope-resolutie, fondsvlaggen en de adapter:
    // een geweigerde term veroorzaakt aantoonbaar geen retrievalnetwerkcall.
    const pii = bevatPersoonsgegevens(q);
    if (pii.bevatPii) {
      return NextResponse.json(
        { error: "Zoeken met persoonsgegevens is niet toegestaan." },
        { status: 400 }
      );
    }

    const modus = MODUS_MAP[sp.get("modus") ?? "alles"] ?? "alles";
    const bronsoortParam = sp.get("bronsoort") ?? "alles";
    const procesinstantie = sp.get("procesinstantie");

    // De query-string mag de scope niet bepalen zonder servervalidatie. Een
    // ongeldige of fondsvreemde referentie eindigt als dezelfde lege zoekset als
    // voorheen, maar stopt nu vóór de adapter (dus vóór embedding/rerank/RPC).
    if (procesinstantie) {
      if (!geldigeUuid(procesinstantie)) {
        return NextResponse.json({ resultaten: [], procesinstanties: [], meta: null });
      }
      const { data: proces } = await supabase
        .from("procedures")
        .select("id")
        .eq("id", procesinstantie)
        .eq("fonds_id", fondsId)
        .maybeSingle();
      if (!proces) {
        return NextResponse.json({ resultaten: [], procesinstanties: [], meta: null });
      }
    }

    const filters: RetrievalFilters = { modus };
    if (bronsoortParam === "fonds") filters.bronsoort = ["fonds"];
    else if (bronsoortParam === "generiek") filters.bronsoort = ["generiek"];
    if (procesinstantie) filters.procesinstantie_ids = [procesinstantie];

    // #369 — dezelfde adapter en volledige orkestratie als de chat: centrale
    // selectie/dedup/toelating/citatie en één deadline over de hele keten.
    // Fonds, actor, bronbeleid en processcope komen uitsluitend uit de
    // servercontext en de hierboven gevalideerde referentie.
    const [hybrideAan, vlaggen] = await Promise.all([
      hybrideZoekenAan(fondsId),
      retrievalVlaggenVoorFonds(fondsId),
    ]);
    const retrieval = maakSupabaseAdapter(vlaggen);
    const voltooid = await voerVolledigeRetrievalUit(
      {
        fondsId,
        actor: { soort: "gebruiker", id: ctx.gebruikerId },
        taaktype: "rerank",
        bronbeleid: { bronsoorten: ["fonds", "generiek", "notulen"] as Bronsoort[] },
        scope: procesinstantie ? { procesId: procesinstantie } : undefined,
        correlationId: ctx.requestId,
        verzoekStartOp: ctx.verzoekStartOp,
        signal: req.signal,
      },
      {
        adapter: retrieval.adapter,
        timeoutMs: timeoutUitConfig(vlaggen.retrievalTimeoutMs),
        sporen: [maakZoekSpoor({ vraag: q, filters, hybrideAan, vlaggen })],
      },
      citaatOpdracht([])
    );
    const resultaten = groepeerZoekresultaten(voltooid.geselecteerd);

    // Resolveer procesinstantie-titels (dossiers) voor groepering + filter-UI.
    // RLS bepaalt zichtbaarheid; ontbreekt een titel, dan valt de client terug op
    // "Niet aan een dossier gekoppeld".
    const procesIds = [
      ...new Set(resultaten.map((r) => r.procesinstantie_id).filter((x): x is string => !!x)),
    ];
    let procesinstanties: { id: string; titel: string }[] = [];
    if (procesIds.length > 0) {
      const { data: procs } = await supabase
        .from("procedures")
        .select("id, titel")
        .in("id", procesIds);
      procesinstanties = (procs ?? []).map((p) => ({ id: p.id as string, titel: p.titel as string }));
    }

    return NextResponse.json(maakZoekRespons({
      resultaten,
      procesinstanties,
      methode: voltooid.meta.methode,
      opgehaald: voltooid.meta.opgehaald,
      geselecteerd: voltooid.meta.geselecteerd,
      modus,
      toelating: voltooid.meta.toelating,
    }));
  } catch (e) {
    const afbreking = foutcategorieVoor(e);
    if (afbreking === "annulering") {
      return new Response(null, { status: 499 });
    }
    if (afbreking === "timeout") {
      return NextResponse.json(
        { error: "Het zoeken duurde te lang. Probeer het opnieuw of zoek gerichter." },
        { status: 504 }
      );
    }
    console.error("Fout in GET /api/zoeken:", e);
    return NextResponse.json({ error: "Serverfout bij zoeken." }, { status: 500 });
  }
});
