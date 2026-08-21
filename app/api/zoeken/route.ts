// ============================================================================
//  GET /api/zoeken — Increment H (zoekmodule, UI op bestaande retrieval).
// ----------------------------------------------------------------------------
//  Volwaardige zoek-UI bovenop dezelfde retrieval-RPC's als de AI-assistent
//  (zoek_chunks / zoek_chunks_hybride, Increment G). GEEN migratie en GEEN nieuwe
//  retrieval-engine: dezelfde scope-vóór-ranking, dezelfde filters, dezelfde RLS
//  (SECURITY INVOKER → tenant-isolatie blijft gelden).
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
import {
  zoekRelevanteChunksMetMeta,
  type DocumentChunk,
  type RetrievalFilters,
} from "@/core/lib/rag";
import type { RetrievalModus } from "@/core/lib/vraagtype";

export const dynamic = "force-dynamic";

// Zoekmodus uit de UI → retrieval-modus (Increment G). 'besluitvorming' is hier
// bewust niet beschikbaar: dat is een AI-antwoordmodus, geen zoekfilter.
const MODUS_MAP: Record<string, RetrievalModus> = {
  alles: "alles",
  actueel: "actueel",
  historisch: "historisch",
};

interface Treffer {
  pagina: number | null;
  paragraaf: string | null;
  fragment: string;
}

interface ZoekResultaat {
  document_id: string;
  titel: string;
  bron: string;
  bibliotheek: string | null;
  procesinstantie_id: string | null;
  documentstatus: string | null;
  bronstatus: string | null;
  documentdatum: string | null;
  geldig_tot: string | null;
  bronorganisatie: string | null;
  normgewicht: string | null;
  extern_url: string | null;
  heeft_origineel: boolean;
  treffers: Treffer[];
}

export const GET = withFondsRoute({ hostGuard: true, label: "zoeken.GET" }, async (ctx, req: NextRequest) => {
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
    const q = (sp.get("q") ?? "").trim();
    if (q.length < 2) {
      return NextResponse.json(
        { resultaten: [], procesinstanties: [], meta: null, melding: "Voer minimaal 2 tekens in." },
        { status: 200 }
      );
    }

    const modus = MODUS_MAP[sp.get("modus") ?? "alles"] ?? "alles";
    const bronsoortParam = sp.get("bronsoort") ?? "alles";
    const procesinstantie = sp.get("procesinstantie");

    const filters: RetrievalFilters = { modus };
    if (bronsoortParam === "fonds") filters.bronsoort = ["fonds"];
    else if (bronsoortParam === "generiek") filters.bronsoort = ["generiek"];
    if (procesinstantie) filters.procesinstantie_ids = [procesinstantie];

    // Ruimere top-N dan de chat (een zoekpagina toont meer): 40 chunks.
    const { chunks, meta } = await zoekRelevanteChunksMetMeta(
      q,
      fondsId, // T4 — expliciete fondsfilter náást RLS (server-side geresolveerd)
      40,
      undefined,
      undefined,
      filters
    );

    // Aggregeer chunks per document (volgorde = relevantie van de eerste treffer).
    const perDoc = new Map<string, ZoekResultaat>();
    for (const c of chunks as DocumentChunk[]) {
      const d = c.documenten;
      let r = perDoc.get(c.document_id);
      if (!r) {
        r = {
          document_id: c.document_id,
          titel: d.titel,
          bron: d.bron,
          bibliotheek: d.bibliotheek ?? null,
          procesinstantie_id: d.procesinstantie_id ?? null,
          documentstatus: d.documentstatus ?? null,
          bronstatus: d.bronstatus ?? null,
          documentdatum: d.documentdatum ?? null,
          geldig_tot: d.geldig_tot ?? null,
          bronorganisatie: d.bronorganisatie ?? null,
          normgewicht: d.normgewicht ?? null,
          extern_url: d.extern_url ?? null,
          heeft_origineel: !!d.opslag_pad,
          treffers: [],
        };
        perDoc.set(c.document_id, r);
      }
      // Max. 3 treffers per document tonen — houdt de lijst leesbaar.
      if (r.treffers.length < 3) {
        r.treffers.push({
          pagina: c.pagina,
          paragraaf: c.paragraaf,
          fragment: c.tekst.length > 220 ? c.tekst.slice(0, 220) + "…" : c.tekst,
        });
      }
    }
    const resultaten = [...perDoc.values()];

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

    return NextResponse.json({
      resultaten,
      procesinstanties,
      meta: {
        methode: meta.methode,
        opgehaald: meta.opgehaald,
        geselecteerd: meta.geselecteerd,
        modus,
      },
    });
  } catch (e) {
    console.error("Fout in GET /api/zoeken:", e);
    return NextResponse.json({ error: "Serverfout bij zoeken." }, { status: 500 });
  }
});
