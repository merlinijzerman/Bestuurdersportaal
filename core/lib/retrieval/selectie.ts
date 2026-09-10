// ============================================================================
//  #322 F4-T2-1 — Selectie, dedup en verrijking: het werk van de ORKESTRATIE.
// ----------------------------------------------------------------------------
//  Verplaatst uit `core/lib/rag.ts`, functioneel ongewijzigd. Besluit 0213
//  punt 5 en ontwerp §4.2 beleggen selectie, deduplicatie, citaatvorming en
//  contextbegrenzing bij de orkestratie; de adapter levert alleen kandidaten en
//  hun rangschikking (rerank + drempel blijven daar, beslissing D1).
//
//  EEN NUANCE, EXPLICIET. De bronsoort-weging en de regime-demotie zijn strikt
//  genomen rangschikking, maar zitten in `weegEnSelecteer` onlosmakelijk in
//  dezelfde stap als dedup en budget-afkap — ze delen de contrafeitelijke
//  selectie die de afvalreden "weging" van "budget" onderscheidt. Ze verhuizen
//  daarom mee. Ze losknippen zou een semantische herbouw zijn, en PR-A moet
//  aantoonbaar nul gedragsverschil opleveren.
//
//  `rag.ts` importeert dit tijdelijk terug zodat C5 (zoeken), C6 (vergelijk) en
//  C7 (AQLab) in PR-A ongewijzigd blijven draaien. T2-2 haalt die terugimport weg.
// ============================================================================
import type { DocumentChunk, RetrievalFilters, RetrievalMeta } from "../rag";
import { weegBronsoort, constraintsVoorProfiel } from "../weeg-bronsoort";
import { weegRegime } from "../weeg-regime";
import {
  selecteerMetConstraintsMetTrace,
  selecteerChunksMetTrace,
  type RepresentatieConstraints,
} from "../rag-select";
import { verrijkMetParents } from "../parent-context";
import { isStandaardZichtbaarInRag } from "../generiek-curatie";

// Verplaatst uit rag.ts: de enige aanroeper was weegEnSelecteer hieronder.
function filterZwakkeGeneriek(
  chunks: DocumentChunk[],
  filters?: RetrievalFilters
): DocumentChunk[] {
  if (filters?.toonZwakkeGeneriek) return chunks;
  return chunks.filter(
    (c) =>
      c.documenten.bibliotheek !== "generiek" ||
      isStandaardZichtbaarInRag(c.documenten.normgewicht)
  );
}

export type SelectieAfvalReden =
  | "weging"
  | "zwak_generiek"
  | "quotum"
  | "dedup"
  | "budget";

/** Selectie-diagnostiek voor retrieval_meta (T3). `selectie` is basis-niveau
 *  (telemetrie, geen identiteit); `selectie_kandidaten` draagt bronidentiteit. */
export interface SelectieDiagnostiek {
  selectie: NonNullable<RetrievalMeta["selectie"]>;
  selectie_kandidaten: NonNullable<RetrievalMeta["selectie_kandidaten"]>;
}

function isGeneriek(c: DocumentChunk): boolean {
  return c.documenten.bibliotheek === "generiek";
}

function weegEnSelecteer(
  gerangschikt: DocumentChunk[],
  filters: RetrievalFilters | undefined,
  maxResults: number,
  maxPerDoc: number,
  constraintsAan: boolean,
  regimeAan: boolean
): { chunks: DocumentChunk[]; diagnostiek: SelectieDiagnostiek } {
  const profiel = filters?.bronsoortprofiel;
  const libVan = (c: DocumentChunk) => c.documenten.bibliotheek;

  // filters — §8.3 #6: zwakke generieke chunks vallen vóór de selectie af.
  const zichtbaar = filterZwakkeGeneriek(gerangschikt, filters);
  const zichtbaarSet = new Set(zichtbaar);

  // weging (bronsoort) — herordent alleen; behoudt de relevantievolgorde binnen groep.
  const bronGewogen = profiel
    ? weegBronsoort(zichtbaar, libVan, profiel)
    : zichtbaar;

  // T4 regime-demotie — de gereserveerde plek: ná de bronsoort-weging, vóór de
  // representatie-constraints. Demoveert chunks met een NIET-geldend (tegengesteld)
  // regime naar onderaan; `beide`/`algemeen`/NULL nooit. Geen harde uitsluiting.
  // weegRegime is een no-op als het fonds geen specifiek regime heeft, dus met
  // REGIME_WEGING uit óf een leeg/cross-cutting fondsregime is dit gedrag-neutraal.
  const regimeDemoveert =
    regimeAan && (filters?.primairRegime === "pw" || filters?.primairRegime === "wvb");
  const gewogen = regimeDemoveert
    ? weegRegime(bronGewogen, (c) => c.documenten.wettelijk_regime, filters?.primairRegime)
    : bronGewogen;

  // representatie-constraints → dedup → budget-afkap. De effectieve constraints
  // worden ALTIJD gelogd, ook bij flag-uit (alle minima 0 = huidig gedrag).
  const constraints: RepresentatieConstraints = constraintsAan
    ? constraintsVoorProfiel(profiel, { maxTotal: maxResults, maxPerSource: maxPerDoc })
    : { fondsMin: 0, generiekMin: 0, perSourceMin: 0, maxPerSource: maxPerDoc, maxTotal: maxResults };

  const trace = constraintsAan
    ? selecteerMetConstraintsMetTrace(gewogen, constraints, libVan)
    : selecteerChunksMetTrace(gewogen, maxResults, maxPerDoc);
  const gekozenSet = new Set(trace.gekozen);
  const redenVanGewogen = new Map(gewogen.map((c, i) => [c, trace.redenen[i]] as const));

  // Contrafeitelijke selectie op de PRE-weging volgorde: zinvol zodra de weging
  // daadwerkelijk demoveert — bronsoort (fonds/generiek; 'gecombineerd' herordent
  // niet) óf regime. `zichtbaar` is de volgorde zónder beide weging-stappen, zodat
  // een chunk die enkel door de weging afvalt op reden "weging" landt (niet budget).
  let zonderWegingSet: Set<DocumentChunk> | null = null;
  if (profiel === "fonds" || profiel === "generiek" || regimeDemoveert) {
    const cf = constraintsAan
      ? selecteerMetConstraintsMetTrace(zichtbaar, constraints, libVan)
      : selecteerChunksMetTrace(zichtbaar, maxResults, maxPerDoc);
    zonderWegingSet = new Set(cf.gekozen);
  }

  // Kandidatenset vóór selectie = de volledige input van deze stap (incl. de
  // zwak_generiek-drops), zodat "opgehaald maar afgevallen" zichtbaar is.
  const telling: Record<SelectieAfvalReden, number> = {
    weging: 0,
    zwak_generiek: 0,
    quotum: 0,
    dedup: 0,
    budget: 0,
  };
  const perBib = { fonds: 0, generiek: 0 };

  const kandidaten = gerangschikt.map((c) => {
    const bibliotheek = c.documenten.bibliotheek;
    const rang = c.rang ?? null;
    if (gekozenSet.has(c)) {
      if (isGeneriek(c)) perBib.generiek++;
      else perBib.fonds++;
      return { document_id: c.document_id, bibliotheek, rang, status: "geselecteerd" as const };
    }
    let reden: SelectieAfvalReden;
    if (!zichtbaarSet.has(c)) {
      reden = "zwak_generiek";
    } else {
      const r = redenVanGewogen.get(c) ?? "budget";
      reden = r === "budget" && zonderWegingSet?.has(c) ? "weging" : r;
    }
    telling[reden]++;
    return { document_id: c.document_id, bibliotheek, rang, status: "afgevallen" as const, reden };
  });

  return {
    chunks: trace.gekozen,
    diagnostiek: {
      selectie: {
        intent: profiel ?? null,
        regime: filters?.modus ?? "alles",
        constraints,
        geselecteerd_per_bibliotheek: perBib,
        afgevallen_telling: telling,
      },
      selectie_kandidaten: kandidaten,
    },
  };
}

/**
 * De selectiehelft van de oude `naVerwerking`: weging+selectie, de
 * ilike-uitsluiting (B1) en parent-retrieval (D). Draait op de door de adapter
 * gerangschikte kandidaten.
 */
export async function selecteerEnVerrijk(
  kandidaten: DocumentChunk[],
  methode: RetrievalMeta["methode"],
  ctx: {
    filters: RetrievalFilters | undefined;
    maxResults: number;
    maxPerDoc: number;
    fondsFilter: string | null;
    peildatum: string;
    representatieConstraints: boolean;
    regimeWeging: boolean;
    relevantieDrempel: boolean;
    parentRetrieval: boolean;
  }
): Promise<{ chunks: DocumentChunk[]; extra: Partial<RetrievalMeta> }> {
  const extra: Partial<RetrievalMeta> = {};
  const opties = ctx;
  const filters = ctx.filters;
  const maxResults = ctx.maxResults;
  const maxPerDoc = ctx.maxPerDoc;
  const fondsFilter = ctx.fondsFilter;
  const peildatum = ctx.peildatum;

  // Bronsoort-weging (+ evt. representatie-constraints) + dedup + top-N; werkt op
  // de nieuwe volgorde. De constraint-laag staat achter opties.representatieConstraints.
  // T3 — de selectie-diagnostiek (constraints + kandidaten + drop-redenen) reflecteert
  // deze weeg+select-stap; hij wordt additief in retrieval_meta vastgelegd.
  const sel = weegEnSelecteer(
    kandidaten,
    filters,
    maxResults,
    maxPerDoc,
    opties.representatieConstraints,
    opties.regimeWeging
  );
  let geselecteerd = sel.chunks;
  extra.selectie = sel.diagnostiek.selectie;
  extra.selectie_kandidaten = sel.diagnostiek.selectie_kandidaten;

  // B1 — ilike-treffers zijn NOOIT citeerbaar: uit de prompt-set gehaald, alleen
  // als audit vastgelegd. Leeg resultaat valt op het bestaande geen-treffers-pad.
  if (opties.relevantieDrempel && methode === "ilike" && geselecteerd.length > 0) {
    extra.zwakke_bronbasis = true;
    extra.mogelijk_gerelateerd = geselecteerd.map((c) => ({
      document_id: c.document_id,
      titel: c.documenten.titel,
    }));
    geselecteerd = [];
  }

  // D — parent-retrieval (small-to-big): treffers uitbreiden met hun structuur-
  // unit. Fondsdiscipline draait binnen verrijkMetParents op de siblings.
  if (opties.parentRetrieval && geselecteerd.length > 0) {
    const p = await verrijkMetParents(geselecteerd, fondsFilter, peildatum);
    geselecteerd = p.chunks;
    extra.parent = p.meta;
  }

  return { chunks: geselecteerd, extra };
}
