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
  chunkAlsBronresultaat,
  verrijkNotulenChunks,
  verrijkDocumentmetadata,
  type DocumentChunk,
  type RetrievalMeta,
  type RetrievalOpties,
} from "../rag";
import { verrijkMetParents } from "../parent-context";
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

/**
 * De adapter plus een SMALLE, expliciet benoemde migratiebrug. De chatroute
 * consumeert stroomafwaarts nog `DocumentChunk` (bronset-hash,
 * besluitvormingsmodus, weergave); `chunksVoor()` haalt die vorm terug uit het
 * providerprivate register. Bewust hier en NIET in het contract, zodat precies
 * zichtbaar is wie de brug nog gebruikt. **T2-2/T2-4 laten die consumenten op
 * `Bronresultaat` werken en verwijderen deze brug.**
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
        // PR-B: het signaal bereikt elke RPC, de embedding-fetch, de
        // retry-backoff en de gateway; de deadline geldt over de hele keten.
        cancellation: true,
        timeout: true,
      };
    },

    async zoek(ctx: RetrievalContext, query: RetrievalQuery): Promise<AdapterUitkomst> {
      const t0 = Date.now();
      const { chunks, meta } = await zoekRelevanteChunksMetMeta(
        query.zoekvraag,
        ctx.fondsId,
        query.maxResultaten,
        query.hybrideAan,
        // ENIGE bron van waarheid voor de scope: de (spoor)context. De adapter
        // leest bewust NIET `query.documentScope` — twee leesplekken kunnen
        // uiteenlopen, en dan zoekt een spoor stil breder of smaller.
        ctx.scope?.documentIds,
        query.filters,
        {
          ...vlaggen,
          gateway: rerank.gateway,
          rerankClient: rerank.client,
          origineleVraag: query.origineleVraag,
          stopNaRangschikking: true,
          // PR-B — het samengestelde afbreek-/deadlinesignaal van de beurt.
          signal: ctx.signal,
        }
      );

      const diagnostiek: Partial<RetrievalMeta> = { ...meta };
      for (const veld of SELECTIE_AFGELEID) delete (diagnostiek as Record<string, unknown>)[veld];

      for (const c of chunks) chunkPerRef.set(c.id, c);

      return {
        kandidaten: chunks.map((c, i) => chunkAlsBronresultaat(c, i)),
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
    async verrijkSelectie(ctx: RetrievalContext, geselecteerd: Bronresultaat[], opties: { peildatum: string }) {
      if (!vlaggen.parentRetrieval) return { resultaten: geselecteerd };
      const chunks = geselecteerd
        .map((b) => chunkPerRef.get(b.ref))
        .filter((c): c is DocumentChunk => Boolean(c));
      if (chunks.length === 0) return { resultaten: geselecteerd };
      // De peildatum van HET SPOOR, nooit "vandaag": anders zou een historische
      // retrieval ongemerkt met de datum van nu worden verrijkt.
      const p = await verrijkMetParents(chunks, ctx.fondsId, opties.peildatum, { signal: ctx.signal });
      for (const c of p.chunks) chunkPerRef.set(c.id, c);
      return { resultaten: p.chunks.map((c, i) => chunkAlsBronresultaat(c, i)), meta: { parent: p.meta } };
    },

    /**
     * Providerspecifieke WEERGAVEMETADATA: notulenlabels en documenttype. De
     * adapter levert gegevens; de citaatopbouw — nummering, sentinel,
     * neutralisatie, BronVerwijzing — is exclusief van de orkestratie
     * (core/lib/retrieval/citatie.ts).
     */
    async verrijkWeergave(ctx: RetrievalContext, geselecteerd: Bronresultaat[]): Promise<Bronresultaat[]> {
      let chunks = geselecteerd
        .map((b) => chunkPerRef.get(b.ref))
        .filter((c): c is DocumentChunk => Boolean(c));
      if (chunks.length === 0) return geselecteerd;
      chunks = await verrijkNotulenChunks(chunks, ctx.signal);
      chunks = await verrijkDocumentmetadata(chunks, ctx.fondsId, ctx.signal);
      for (const c of chunks) chunkPerRef.set(c.id, c);
      return chunks.map((c, i) => chunkAlsBronresultaat(c, i));
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
