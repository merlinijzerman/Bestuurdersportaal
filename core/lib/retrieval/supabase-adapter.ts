// ============================================================================
//  #322 F4-T2-1 — De Supabase-RAG-adapter.
// ----------------------------------------------------------------------------
//  Een DUNNE laag om `zoekRelevanteChunksMetMeta` — bewust geen semantische
//  herbouw. Zij vertaalt het contract naar de bestaande zeven parameters, stopt
//  de keten na het rangschikken (`stopNaRangschikking`, beslissing D1: rerank en
//  drempel horen bij adapterspecifieke kandidatenrangschikking) en geeft
//  KANDIDATEN terug. Selectie, dedup, citaties en het auditspoor zijn werk van
//  de orkestratie (besluit 0213 punt 5).
//
//  De adapter kiest NOOIT een provider, model of endpoint. De reranker komt als
//  smalle geïnjecteerde dienst binnen (`rerankdienst`), precies zoals D1 eist;
//  welk model daarachter zit is een zaak van de AI-gateway en de fondsconfig.
// ============================================================================
import { zoekRelevanteChunksMetMeta, type DocumentChunk, type RetrievalMeta, type RetrievalOpties } from "../rag";
import type {
  AdapterCapabilities,
  AdapterUitkomst,
  Bronresultaat,
  Bronsoort,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalQuery,
} from "./contract";

/** De smalle rerankdienst uit D1: injectie, geen modelkeuze in de adapter. */
export interface Rerankdienst {
  gateway?: RetrievalOpties["gateway"];
  client?: RetrievalOpties["rerankClient"];
}

/** Vlaggen die de aanroeper (route) al per fonds heeft geresolveerd. */
export type Adaptervlaggen = Omit<RetrievalOpties, "gateway" | "rerankClient" | "stopNaRangschikking">;

/**
 * De selectie-afgeleide velden. De adapter vult ze met de KANDIDATENSET; de
 * orkestratie bouwt ze opnieuw op de werkelijke selectie. Ze horen dus niet in
 * de diagnostiek die ongewijzigd het auditspoor in gaat.
 */
const SELECTIE_AFGELEID = ["geselecteerd", "chunks", "bronversie_audit", "opgehaald", "methode"] as const;

function bronsoortVan(chunk: DocumentChunk): Bronsoort {
  return chunk.documenten.bibliotheek === "generiek" ? "generiek" : "fonds";
}

/**
 * Eén chunk als contractresultaat. `chunk` blijft meereizen zolang de
 * Supabase-adapter de enige productieadapter is: selectie, parent-retrieval en
 * citaatvorming werken daar nog rechtstreeks op, en PR-A moet aantoonbaar nul
 * gedragsverschil opleveren.
 */
function naarBronresultaat(chunk: DocumentChunk, positie: number): Bronresultaat {
  const d = chunk.documenten;
  return {
    ref: chunk.id,
    bronsoort: bronsoortVan(chunk),
    titel: d.titel,
    documentIdentiteit: { documentId: chunk.document_id, bibliotheek: d.bibliotheek ?? null, bron: d.bron ?? null },
    // R1: de volledige hash is de versie-identiteit. Die staat pas in T2-3 op de
    // rij; tot dan draagt dit pad expliciet de ZWAKKE legacyfallback, zodat aan
    // het resultaat zelf te zien is dat er nog geen exacte versie is.
    versie: { soort: "status-datum", waarde: d.documentdatum ?? null, gecontroleerdOp: new Date().toISOString() },
    locator: { pagina: chunk.pagina, paragraaf: chunk.paragraaf, chunkIndex: chunk.chunk_index },
    passage: chunk.tekst,
    status: {
      documentstatus: d.documentstatus ?? null,
      bronstatus: d.bronstatus ?? null,
      geldigTot: d.geldig_tot ?? null,
      actueel: (d.documentstatus ?? null) === "van_kracht",
    },
    rang: { positie, score: chunk.rang ?? null, fts: chunk.fts_rang ?? null, vec: chunk.vec_rang ?? null },
    chunk,
  };
}

export function maakSupabaseAdapter(vlaggen: Adaptervlaggen, rerank: Rerankdienst = {}): RetrievalAdapter {
  return {
    naam: "supabase-rag",

    capabilities(): AdapterCapabilities {
      return {
        bronsoorten: ["fonds", "generiek", "notulen"],
        strategieen: ["gericht", "volledig", "vergelijk", "bevroren"],
        ondersteundeFilters: [
          "modus",
          "peildatum",
          "bronsoort",
          "bronstatus",
          "documentstatus",
          "procesinstantie_ids",
          "bronsoortprofiel",
          "primairRegime",
          "toonZwakkeGeneriek",
        ],
        // T2-3 brengt de volledige hash (R1); tot dan draagt elk resultaat de
        // zwakke `status-datum`-fallback en is dit bewust `false`.
        versiebewijs: false,
        // RLS is hier het bewijs; de adapter kan er geen per-resultaat
        // `toegangscontrole` voor leveren, dus claimt hij het ook niet.
        permissionProof: false,
        preview: false,
        // PR-B voert `AbortSignal` en de deadline door de hele keten.
        cancellation: false,
        timeout: false,
      };
    },

    async zoek(ctx: RetrievalContext, query: RetrievalQuery): Promise<AdapterUitkomst> {
      const t0 = Date.now();
      const { chunks, meta } = await zoekRelevanteChunksMetMeta(
        query.zoekvraag,
        ctx.fondsId,
        query.maxKandidaten,
        query.hybrideAan,
        query.documentIds,
        query.filters,
        {
          ...vlaggen,
          gateway: rerank.gateway,
          rerankClient: rerank.client,
          origineleVraag: query.origineleVraag,
          stopNaRangschikking: true,
        }
      );

      const diagnostiek: Partial<RetrievalMeta> = { ...meta };
      for (const veld of SELECTIE_AFGELEID) delete (diagnostiek as Record<string, unknown>)[veld];

      return {
        kandidaten: chunks.map(naarBronresultaat),
        methode: meta.methode,
        provider: "supabase",
        latencyMs: Date.now() - t0,
        opgehaald: meta.opgehaald,
        diagnostiek,
      };
    },
  };
}
