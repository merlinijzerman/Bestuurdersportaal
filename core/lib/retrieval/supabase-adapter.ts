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
import {
  zoekRelevanteChunksMetMeta,
  maakContext,
  verrijkNotulenChunks,
  verrijkDocumentmetadata,
  type DocumentChunk,
  type RetrievalMeta,
  type RetrievalOpties,
} from "../rag";
import { verrijkMetParents } from "../parent-context";
import type {
  CitaatOpdracht,
  CitaatResultaat,
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
 * Eén chunk als contractresultaat. De chunk zelf blijft PRIVAAT (zie
 * `chunkPerRef`): alles wat de selectie en de weging nodig hebben staat in
 * neutrale velden, zodat een bron zónder chunk hier net zo goed doorheen komt.
 */
function naarBronresultaat(chunk: DocumentChunk, positie: number): Bronresultaat {
  const d = chunk.documenten;
  return {
    ref: chunk.id,
    bronsoort: bronsoortVan(chunk),
    titel: d.titel,
    documentIdentiteit: { documentId: chunk.document_id, bibliotheek: d.bibliotheek ?? null, bron: d.bron ?? null, fondsId: d.fonds_id ?? null },
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
    // Bronbeleid-gegevens die de centrale weging nodig heeft.
    curatie: { normgewicht: d.normgewicht ?? null, wettelijkRegime: d.wettelijk_regime ?? null },
  };
}

/**
 * De adapter plus een SMALLE, expliciet benoemde migratiebrug. De chatroute
 * consumeert stroomafwaarts nog `DocumentChunk` (bronset-hash, besluitvorming-
 * modus, weergave); `chunksVoor()` haalt die vorm terug uit het providerprivate
 * register. Bewust hier en NIET in het contract: zo blijft `Bronresultaat`
 * providerneutraal en is precies zichtbaar wie de brug nog gebruikt.
 * T2-2/T2-4 laten die consumenten op `Bronresultaat` werken en verwijderen haar.
 */
export interface SupabaseRetrieval {
  adapter: RetrievalAdapter;
  chunksVoor(bronnen: Bronresultaat[]): DocumentChunk[];
}

export function maakSupabaseAdapter(vlaggen: Adaptervlaggen, rerank: Rerankdienst = {}): SupabaseRetrieval {
  // PROVIDERPRIVAAT. De chunk hoort niet in het contract — anders is de vorm van
  // deze database het contract, en komt een Microsoftresultaat er niet doorheen.
  // De adapter houdt de koppeling ref → chunk dus zelf bij en gebruikt haar
  // alleen in zijn eigen hooks.
  const chunkPerRef = new Map<string, DocumentChunk>();

  const adapter: RetrievalAdapter = {
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
        ctx.scope?.documentIds,
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

      for (const c of chunks) chunkPerRef.set(c.id, c);

      return {
        kandidaten: chunks.map(naarBronresultaat),
        methode: meta.methode,
        provider: "supabase",
        latencyMs: Date.now() - t0,
        opgehaald: meta.opgehaald,
        diagnostiek,
      };
    },
    /**
     * Parent-context (small-to-big): siblings uit `document_chunks`. Puur
     * Supabase-werk, dus een adapterhook — de orkestratie roept hem per spoor
     * aan, direct ná de selectie, op exact dezelfde plek als vóór T2-1.
     */
    async verrijkSelectie(ctx: RetrievalContext, geselecteerd: Bronresultaat[]) {
      if (!vlaggen.parentRetrieval) return { resultaten: geselecteerd };
      const chunks = geselecteerd
        .map((b) => chunkPerRef.get(b.ref))
        .filter((c): c is DocumentChunk => Boolean(c));
      if (chunks.length === 0) return { resultaten: geselecteerd };
      const p = await verrijkMetParents(chunks, ctx.fondsId, new Date().toISOString().slice(0, 10));
      for (const c of p.chunks) chunkPerRef.set(c.id, c);
      return { resultaten: p.chunks.map(naarBronresultaat), meta: { parent: p.meta } };
    },

    /**
     * Providercorrecte weergave. `maakContext` is diep chunk-vormig en blijft
     * daarom hier, ongewijzigd — dat is precies waarom de citaatrenderer een
     * adapterhook is en niet in de orkestratie staat. De orkestratie bepaalt
     * wél wát geciteerd wordt en in welke volgorde.
     */
    async citeer(
      ctx: RetrievalContext,
      geselecteerd: Bronresultaat[],
      opdracht: CitaatOpdracht
    ): Promise<CitaatResultaat> {
      let chunks = geselecteerd
        .map((b) => chunkPerRef.get(b.ref))
        .filter((c): c is DocumentChunk => Boolean(c));
      // Weergaveverrijking: notulenlabels en documenttype. Beide Supabase-
      // specifiek, dus adapterwerk; ze veranderen niets aan de selectie.
      chunks = await verrijkNotulenChunks(chunks);
      chunks = await verrijkDocumentmetadata(chunks, ctx.fondsId);
      for (const c of chunks) chunkPerRef.set(c.id, c);
      const r = maakContext(
        chunks,
        0,
        undefined,
        opdracht.primaireDocumentIds,
        opdracht.peildatum,
        opdracht.hoofddocumentLabel
      );
      return {
        resultaten: chunks.map(naarBronresultaat),
        contextTekst: r.contextTekst,
        bronverwijzingen: r.bronnen,
        sentinel: r.sentinel,
        geneutraliseerd: r.geneutraliseerd,
      };
    },
  };

  return {
    adapter,
    chunksVoor(bronnen: Bronresultaat[]): DocumentChunk[] {
      return bronnen
        .map((b) => chunkPerRef.get(b.ref))
        .filter((c): c is DocumentChunk => Boolean(c));
    },
  };
}
