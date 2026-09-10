// ============================================================================
//  #322 F4-T2-1 — De orkestratie.
// ----------------------------------------------------------------------------
//  Alles wat GEEN adapterwerk is: selectie, deduplicatie, samenvoeging over
//  sporen, citaatvorming en het auditspoor (besluit 0213 punt 5, ontwerp §4.2).
//  De adapter levert uitsluitend kandidaten en hun rangschikking.
//
//  EEN DETAIL DAT BYTE-IDENTITEIT BEPAALT. C1 draait twee sporen — het primaire
//  (gescopet op het hoofddocument of de gekoppelde stukken) en het aanvullende
//  (de bibliotheek). Vóór T2-1 selecteerde ELK spoor apart, met zijn eigen
//  budget, en werden pas daarna de twee GESELECTEERDE sets samengevoegd. De
//  orkestratie doet dat hier bewust net zo: selectie per query, dan samenvoegen.
//  Zou zij één keer selecteren over de samengevoegde kandidatenset, dan
//  veranderde de promptset — en dat is precies wat PR-A niet mag doen.
// ============================================================================
import type { DocumentChunk, RetrievalMeta, BronVerwijzing } from "../rag";
import { bouwMeta } from "./meta";
import { selecteerEnVerrijk } from "./selectie";
import type {
  AdapterUitkomst,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalQuery,
  RetrievalUitkomst,
} from "./contract";

/** Grenzen en vlaggen die de selectie stuurt; per query geresolveerd. */
export interface SelectiegrenzenPerQuery {
  maxResults: number;
  maxPerDoc: number;
  representatieConstraints: boolean;
  regimeWeging: boolean;
  relevantieDrempel: boolean;
  parentRetrieval: boolean;
}

/**
 * Citaatvorming. De route levert alleen DATA (welke documenten primair zijn, de
 * peildatum, het herkomstlabel) — geen logica. Zo blijft de vorm van de bronkop
 * in één hand zonder dat routebegrippen als "agendapuntmodus" de retrievallaag
 * in lekken.
 */
export interface Citatieopties {
  primaireDocumentIds: Set<string>;
  peildatum: string;
  hoofddocumentLabel: string;
  /** `maakContext` uit rag.ts; geïnjecteerd zodat deze module DB-vrij blijft. */
  bouwContext: (
    chunks: DocumentChunk[],
    start: number,
    zaad: undefined,
    primaire: Set<string>,
    peildatum: string,
    label: string
  ) => { contextTekst: string; bronnen: BronVerwijzing[]; sentinel: string; geneutraliseerd: number };
}

/** Verrijkingen die ná selectie en vóór citaatvorming draaien (weergavevelden). */
export type Verrijker = (chunks: DocumentChunk[]) => Promise<DocumentChunk[]>;

export interface Orkestratieopdracht {
  adapter: RetrievalAdapter;
  /** Het primaire spoor staat vooraan: het krijgt de laagste bronnummers. */
  queries: { query: RetrievalQuery; grenzen: SelectiegrenzenPerQuery }[];
  fondsFilter: string | null;
  peildatum: string;
  verrijkers?: Verrijker[];
  citaties?: Citatieopties;
}

export interface Orkestratieresultaat extends RetrievalUitkomst {
  /** De geselecteerde chunks in promptvolgorde; consumenten in T2-1 werken hierop. */
  chunks: DocumentChunk[];
  contextTekst?: string;
  sentinel?: string;
  geneutraliseerd?: number;
}

export async function voerRetrievalUit(
  ctx: RetrievalContext,
  opdracht: Orkestratieopdracht
): Promise<Orkestratieresultaat> {
  const t0 = Date.now();
  const perAdapter: RetrievalUitkomst["perAdapter"] = [];

  // 1. Adapters bevragen. De sporen draaien parallel, net als vóór T2-1.
  const uitkomsten = await Promise.all(
    opdracht.queries.map(async ({ query }) => {
      const u = await opdracht.adapter.zoek(ctx, query);
      perAdapter.push({
        naam: opdracht.adapter.naam,
        query: query.naam,
        methode: u.methode,
        latencyMs: u.latencyMs,
        kandidaten: u.kandidaten.length,
        fout: u.fout,
      });
      return u;
    })
  );

  // 2. Selectie PER SPOOR — zie de kopnoot.
  const geselecteerdPerSpoor: DocumentChunk[][] = [];
  const extraPerSpoor: Partial<RetrievalMeta>[] = [];
  for (let i = 0; i < uitkomsten.length; i++) {
    const u = uitkomsten[i];
    const g = opdracht.queries[i].grenzen;
    const kandidaatChunks = u.kandidaten
      .map((k) => k.chunk)
      .filter((c): c is DocumentChunk => Boolean(c));
    const sel = await selecteerEnVerrijk(kandidaatChunks, u.methode as RetrievalMeta["methode"], {
      filters: opdracht.queries[i].query.filters,
      maxResults: g.maxResults,
      maxPerDoc: g.maxPerDoc,
      fondsFilter: opdracht.fondsFilter,
      peildatum: opdracht.peildatum,
      representatieConstraints: g.representatieConstraints,
      regimeWeging: g.regimeWeging,
      relevantieDrempel: g.relevantieDrempel,
      parentRetrieval: g.parentRetrieval,
    });
    geselecteerdPerSpoor.push(sel.chunks);
    extraPerSpoor.push(sel.extra);
  }

  // 3. Samenvoegen. Het primaire spoor vooraan; een document dat daar al in zit
  //    komt niet nóg eens uit het aanvullende spoor (één passage, één bronnummer).
  const primair = geselecteerdPerSpoor[0] ?? [];
  const primaireDocIds = new Set(primair.map((c) => c.document_id));
  const aanvullend = geselecteerdPerSpoor
    .slice(1)
    .flat()
    .filter((c) => !primaireDocIds.has(c.document_id));
  let chunks = [...primair, ...aanvullend];

  // 4. Auditspoor. De basis komt van het primaire spoor; de aanvullende chunks
  //    dragen alleen id/document_id/rang — dezelfde asymmetrie als vóór T2-1,
  //    want deze lijst voedt de bronset-hash van de bevroren reflectiebronset.
  const basis = uitkomsten[0];
  const basisMeta = bouwMeta(
    basis.methode as RetrievalMeta["methode"],
    basis.opgehaald,
    primair
  );
  const meta: RetrievalMeta = {
    ...basisMeta,
    ...(basis.diagnostiek ?? {}),
    ...extraPerSpoor[0],
    chunks: [
      ...basisMeta.chunks,
      ...aanvullend.map((c) => ({ id: c.id, document_id: c.document_id, rang: c.rang ?? null })),
    ],
    opgehaald: uitkomsten.reduce((s, u) => s + u.opgehaald, 0),
    geselecteerd: primair.length + aanvullend.length,
    ...(uitkomsten.length > 1
      ? {
          aanvullend: {
            chunks: aanvullend.length,
            documenten: new Set(aanvullend.map((c) => c.document_id)).size,
          },
        }
      : {}),
  };

  const alleKandidaten = uitkomsten.flatMap((u) => u.kandidaten);
  return {
    kandidaten: alleKandidaten,
    geselecteerd: alleKandidaten.filter((k) => k.chunk && chunks.includes(k.chunk)),
    bronverwijzingen: [],
    perAdapter,
    latencyMs: Date.now() - t0,
    fout: uitkomsten.find((u) => u.fout)?.fout,
    meta,
    chunks,
  };
}

/**
 * Tweede orkestratie-ingang: weergaveverrijking en citaatvorming.
 *
 * BEWUST GESCHEIDEN van `voerRetrievalUit`. De chatroute stuurt tussen beide
 * stappen een voortgangsevent en schrijft het scope-auditspoor; die volgorde zit
 * byte-voor-byte in de SSE-snapshots. Beide stappen zijn orkestratiewerk
 * (besluit 0213 punt 5) en leven dus hier — de route sequencet alleen, zij
 * bevat de logica niet.
 */
export async function verrijkEnCiteer(
  chunks: DocumentChunk[],
  opdracht: { verrijkers?: Verrijker[]; citaties: Citatieopties }
): Promise<{
  chunks: DocumentChunk[];
  contextTekst: string;
  bronverwijzingen: BronVerwijzing[];
  sentinel: string;
  geneutraliseerd: number;
}> {
  let uit = chunks;
  // Weergaveverrijking (notulenlabels, documenttype) draait ná de selectie: het
  // zijn doorgeefvelden die niets aan de keuze mogen veranderen.
  for (const verrijk of opdracht.verrijkers ?? []) uit = await verrijk(uit);
  const c = opdracht.citaties;
  const r = c.bouwContext(uit, 0, undefined, c.primaireDocumentIds, c.peildatum, c.hoofddocumentLabel);
  return {
    chunks: uit,
    contextTekst: r.contextTekst,
    bronverwijzingen: r.bronnen,
    sentinel: r.sentinel,
    geneutraliseerd: r.geneutraliseerd,
  };
}
