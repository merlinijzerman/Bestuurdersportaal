# Gemeenschappelijk retrievalcontract — fase 4 (#322), tranche T1

> **Status:** T1-ontwerp ter review (2026-09-04). Geen productiecode of database gewijzigd.
> T2 (implementatie) start pas na review van dit document, na merge van de fase-3-PR's
> (#323, #324) en na merge van de AI-gateway-cutover (#325).
> Bron van waarheid voor de huidige keten: `core/lib/rag.ts` en de migraties; dit document
> beschrijft wat er is en wat het contract moet dragen.

## 1. Waarom

Besluit 0208 maakt de bronlaag duaal: de eigen variant zoekt in de Supabase-RAG, de
Microsoftvariant zoekt later live in SharePoint. Zonder één providerneutraal contract lopen
bronselectie, rechten, citaties, foutgedrag en audit per bron uiteen. Fase 3 (#321) heeft de
SharePoint-identiteit al vastgelegd (lokale referentie, drive/item privé, eTag/cTag,
previewmogelijkheid, controlemoment); de AI-gateway (#311) heeft het generatiecontract. Dit
document legt de retrievalzijde daartussen vast.

## 2. Inventarisatie van de huidige keten

### 2.1 De kern

`zoekRelevanteChunksMetMeta(vraag, fondsId, maxResults, hybrideAan, documentIds, filters, opties)`
in `core/lib/rag.ts` is de facto het contract. Het pad: documentscope → expliciete fondsfilter
(server-side, body genegeerd) → jargonexpansie (vlag) → hybride RRF via `zoek_chunks_hybride` of
FTS via `zoek_chunks` (strikt, daarna verslapte OR-terugval, daarna PostgREST-fallback) →
`handhaafFondsdiscipline` (app-guard náást RLS en RPC) → zwakke-generiek-filter → bronsoort-
weging → regime-demotie → optionele reranker (Haiku via de gateway) en drempel → selectie
(max per document, Jaccard-dedup, representatieconstraints) → parent-context (vlag) →
`RetrievalMeta`. Beide RPC's zijn `security invoker`; RLS blijft leidend.

### 2.2 Productie-call-sites

| # | Call-site | Fonds/actor | Bronbereik | Filters | Limieten | Ranking | Fragment/citaat | Versie | Audit | Fout/timeout | PII |
|---|---|---|---|---|---|---|---|---|---|---|---|
| C1 | `app/api/chat/route.ts` (spoor A primair + aanvullend) | `ctx.fondsId`, body genegeerd | fonds + gepubliceerd generiek; scope op document/agendapunt | modus, peildatum, bronsoortprofiel, primairRegime; primair spoor zonder filters bij scope | 10 + 5, overfetch max(3×,20), max/doc | fondsvlaggen (rerank, drempel, jargon, parent, representatie) + gateway | `maakContext` → `[Bron N]`, sentinel, statuslabel, `BronVerwijzing` | `bronversie_audit` (status, datum) — geen eTag | `governance_log.retrieval_meta` via `schrijf_ai_interactie`, gesplitst basis/bron/inhoud | rerank fail-safe naar RRF; Mistral-uitval → FTS met `fallback_reason` | PII-gate vóór retrieval en web |
| C2 | idem, reflectiepad | idem | bevroren bronset op chunk-id | `documenten.actief`, fondsguard | 200 | geen | zelfde labeling | bronset-hash | `methode:"geen"` | — | — |
| C3 | idem, breed pad (`haalDocumentChunksMetDekking`) | idem | één of enkele documenten volledig | fondsguard | cap 5000, pagina 1000 | geen (documentvolgorde) | paginaverwijzingen | — | `scope.strategie`, `documentdekking` | afkapredenen expliciet | — |
| C4 | idem, web-arm | idem | whitelistdomeinen | PII-gate, whitelist | `WEB_MAX_USES` | provider | `bouwWebbronnen` | ophaaltijdstip | `web`-blok, domeinen | — | PII-gate |
| C5 | `app/api/zoeken/route.ts` | `ctx.fondsId` | fonds + generiek | modus, bronsoort, procesinstantie | 40, max 3 treffers/doc, fragment 220 | **geen fondsvlaggen** (env-defaults) | eigen `ZoekResultaat`, geen citation-id | geen | geen | rate-limit fail-closed; fouten generiek | geen PII-gate (zoekterm) |
| C6 | `core/lib/vergelijk-productie.ts` | `ctx.fondsId` | één document per zijde | **`filters = {}`** | 4 passages/zijde | **`parentRetrieval:true` hardcoded**, geen rerank/drempel | eigen `PassageLite`, pagina | geen | `fn_schrijf_vergelijking` | — | — |
| C7 | `platform/lib/aqlab/generate-adapter.ts` | platform, fonds = null | synthetische fixtures | — | fixturelengte | geen | `maakContext` (identiek aan C1) | — | AQLab-run | — | — |
| C8 | `platform/lib/semantische-extractie-job.ts` | job | volledige documentset | actief/geïndexeerd | alles, hash-incrementeel | geen | `semantic_units` met chunk-id | hash | `fn_schrijf_semantische_extractie` | — | — |

Buiten de kern om lezen ook `app/api/chat/route.ts` (chunkpresentie per document, drie plekken),
de ingest-/reindex-/backfillpaden en de generieke bibliotheek `document_chunks` rechtstreeks.
Dat staat bevroren in `tests/cross-tenant/retrieval-census.expected.json`.

### 2.3 Divergenties die het contract moet opheffen

1. **Vlaggen**: C5 en C6 slaan de fondsvlaggen over; `regimeWeging` (enige vlag met default aan)
   zit niet in `RetrievalVlaggen` en is per fonds niet stuurbaar.
2. **Filters**: C6 zoekt zonder peildatum, modus of regime en produceert toch citaten.
3. **Drie bronvormen**: `BronVerwijzing` (C1/C7), `ZoekResultaat.treffers` (C5), `PassageLite`
   (C6). Alleen de eerste draagt citation-id, sentinel en statuslabel.
4. **Versie-identiteit**: geen enkele call-site legt een exacte documentversie (eTag of hash)
   per geselecteerde passage vast; `bronversie_audit` kent alleen status en datum.
5. **Correlatie**: `ctx.requestId` gaat naar `handelingen_log`, maar niet in `retrieval_meta`;
   de gateway-log krijgt hem wél. De keten retrieval → gateway → governance is dus alleen via
   `gesprek_audit_id` te volgen.
6. **Directe tabeltoegang** op het antwoordpad (chatroute leest `document_chunks` voor
   chunkpresentie) buiten `rag.ts` om.
7. **Geen retrieval-golden**: tot T1 legden alleen vier SSE-snapshots het antwoord vast, niet de
   kandidatenset, volgorde, fragmenten en `retrieval_meta`.

### 2.4 Bestaande uitzonderingen (blijven buiten de adapter)

Websearch (C4, eigen whitelist- en PII-gate), generieke sectorbronnen (zelfde tabel, eigen
publicatieregels), volledige-documentanalyse (C3, geen ranking), vergelijking (C6),
synthetische AQLab-runs (C7) en de ingest-/reindex-/backfillpaden (schrijven, geen retrieval).
C3 en C6 lopen in T2 wél door de orkestratie (fonds-, status- en geldigheidsfilters), maar met
een eigen strategie (`volledig` respectievelijk `vergelijk`), geen ranking-adapter.

## 3. Karakterisatie (T1, geleverd)

- **Census-gate** `tests/cross-tenant/retrieval-census.test.ts` + register: elke directe
  aanroeper van de retrievalkern, per symbool, plus zoek-RPC's en `document_chunks`-lezers.
  Pint dat zoek-RPC's alleen in `rag.ts` leven en dat de chatroute de enige antwoordpadroute
  met directe tabeltoegang is. In T2 krimpt het register tot adapter en orkestratie.
- **Retrieval-golden in het W1-harnas** (`tests/karakterisering/`):
  - vier extra chunks onder het bestaande `document1` (geen nieuw document: de
    documentlijst-snapshots blijven ongemoeid; de teksten vermijden elk woord uit de
    #311-chatvragen zodat de bestaande SSE-snapshots ongewijzigd blijven);
  - zes `w322.zoeken.get.bestuurder.*`-scenario's: kandidatenset, volgorde, treffers per
    document, fragmentafkapping en `retrieval_meta` op het FTS-pad, inclusief lege sets voor
    modus `actueel` (document1 is concept), bronsoort `generiek` en een onbestaande term;
  - één `w322.chat.post.bestuurder.retrieval-meta`-scenario: dezelfde beurt als
    `w311 … sse-met-bron`, met als nawerk de deterministische projectie van
    `governance_log.retrieval_meta` (methode, aantallen, chunk-id's, pogingen, herkomst,
    bronversie-audit, citaties, selectie, filters; geen duur/tokens/ttft).
- **Bekende lacune**: het hybride pad (Mistral-embeddings) is lokaal niet gekarakteriseerd;
  zonder sleutel valt de keten deterministisch terug op FTS (`embedding_query_success:false`).
  Een embeddingstub naast de Anthropic-stub plus geëmbedde fixtures is voorwaarde voor een
  hybride golden en hoort bij T2 (of een T1b als de review dat wil).

## 4. Het contract (ontwerp T2)

Alle typen server-only, in `core/lib/retrieval/contract.ts`. Geen providertokens, endpoints,
ruwe Graph-/Search-responses of database-details in het publieke contract.

```ts
export type Bronsoort = "fonds" | "generiek" | "sharepoint" | "notulen" | "web";
export type Retrievalstrategie = "gericht" | "volledig" | "vergelijk" | "bevroren";

export interface RetrievalContext {           // server-side vastgesteld, nooit uit body
  fondsId: string;                            // uit sessie/profiel
  actor: { gebruikerId: string; rol: Rol };
  taaktype: Taaktype;                         // hergebruik van het gateway-contract
  bronbeleid: Bronbeleid;                     // welke bronsoorten dit fonds mag: uit fondsconfig
  scope?: { documentIds?: string[]; vergaderingId?: string; agendapuntId?: string; procesId?: string; bevrorenChunkIds?: string[] };
  correlationId: string;                      // = ctx.requestId; gaat door naar gateway en governance
  signal?: AbortSignal;
}
export interface RetrievalQuery {
  origineleVraag: string;
  zoekvraag: string;                          // gevalideerd/geherformuleerd; scope kan hij niet wijzigen
  filters: { modus; peildatum; bronsoort?; procesinstantieIds?; bronsoortprofiel?; primairRegime?; toonZwakkeGeneriek? };
  strategie: Retrievalstrategie;
  maxKandidaten: number; maxContextTekens: number;
}
export interface Bronresultaat {
  ref: string;                                // lokale, fondsgebonden referentie (chunk-id of sharepoint_documenten.id)
  bronsoort: Bronsoort;
  titel: string;
  documentIdentiteit: { documentId: string; bibliotheek?: string; bron?: string };
  versie: { soort: "etag" | "ctag" | "hash" | "status-datum" | "onbekend"; waarde: string | null; gecontroleerdOp: string };
  locator: { pagina?: number | null; paragraaf?: string | null; mappad?: string; chunkIndex?: number };
  passage: string;                            // geneutraliseerd, begrensd
  status: { documentstatus?; bronstatus?; geldigTot?; actueel: boolean };
  rang: { positie: number; score?: number | null; fts?: number | null; vec?: number | null; poging?: string };
  previewMogelijk?: boolean;                  // SharePoint: alleen na permission-check
}
export interface RetrievalUitkomst {
  kandidaten: Bronresultaat[];
  geselecteerd: Bronresultaat[];
  bronverwijzingen: BronVerwijzing[];         // bestaande vorm, ongewijzigd voor C1/C7
  methode: RetrievalMeta["methode"] | "sharepoint_live" | "geen";
  provider: "supabase" | "microsoft" | "geen";
  latencyMs: number;
  truncatie?: { reden: "kandidaten" | "tekens" | "tijd" | "annulering" };
  fout?: RetrievalFoutcategorie;
  meta: RetrievalMeta;                        // bestaande audit-vorm, byte-compatibel
}
export type RetrievalFoutcategorie =
  | "geen_resultaten" | "toestemming_geweigerd" | "buiten_scope" | "configuratiefout"
  | "timeout" | "rate_limit" | "providerfout" | "truncatie" | "annulering";
export interface AdapterCapabilities {
  bronsoorten: Bronsoort[];
  versiebewijs: boolean;                      // levert eTag/cTag/hash per resultaat
  permissionProof: boolean;                   // toetst gebruikersrechten per request
  preview: boolean;
  strategieen: Retrievalstrategie[];
}
export interface RetrievalAdapter {
  readonly naam: "supabase-rag" | "microsoft-sharepoint";
  capabilities(): AdapterCapabilities;
  zoek(ctx: RetrievalContext, query: RetrievalQuery): Promise<RetrievalUitkomst>;
}
```

### 4.1 Orkestratie (`core/lib/retrieval/orkestratie.ts`)

1. Fonds, bronbeleid en toegestane adapters worden server-side bepaald; de browser of het
   generatiemodel kiest nooit adapter, fonds, endpoint of document-id.
2. Rechten-, status-, geldigheids-, privacy- en scopefilters vóór selectie van modelcontext;
   de bestaande PII-gate en `handhaafFondsdiscipline` blijven op hun plek.
3. Geen cross-providerfallback. Een adapterfout wordt genormaliseerd en volgens fondsbeleid
   afgehandeld (nu: veilige fout of leeg resultaat, nooit een bredere bron).
4. Samenvoeging van bronsoorten deterministisch: adaptervolgorde uit bronbeleid, daarna
   rang, daarna `(documentId, chunkIndex, ref)` als stabiele tiebreaker; dedup op `ref`.
5. Begrenzing per call: kandidaten, tekens, looptijd (`AbortSignal.timeout`), concurrency 1
   per adapter.
6. De gateway ontvangt uitsluitend `geselecteerd` als begrensde passages; de adapter kiest
   nooit het generatiemodel.

### 4.2 Supabase-RAG-adapter

Dunne laag om `zoekRelevanteChunksMetMeta` zonder semantische herbouw: vertaalt
`RetrievalContext`/`RetrievalQuery` naar de bestaande zeven parameters en `RetrievalMeta` naar
`RetrievalUitkomst`. Vlaggen komen altijd uit `retrievalVlaggenVoorFonds` (C5 en C6 gaan dus
mee), `regimeWeging` wordt een fondsvlag met default aan. Versie: `hash` van
`(document_id, indexering_versie, bestand_hash)` waar beschikbaar, anders `status-datum`.
Acceptatie: de w322-goldens en de w311-SSE-snapshots byte-/structuuridentiek.

### 4.3 Microsoft-adaptergrens (stub, geen netwerk)

`microsoft-sharepoint`-adapter met `capabilities()` = `{versiebewijs: true, permissionProof:
true, preview: true, strategieen: ["gericht"]}`, die in T2 uitsluitend een teststub kent. Elk
resultaat draagt `ref` = `sharepoint_documenten.id` (fondsgebonden), `versie.soort = "etag"`
met eTag/cTag en `gecontroleerdOp` = het moment van de live permission-check met het token van
de gebruiker. De orkestratie weigert een resultaat zonder volledige identiteit, zonder versie of
zonder `permissionProof`, en mengt klant- en sectorbronnen alleen centraal.

### 4.4 Audit en observability

Inhoudsvrij per retrievalcall: fonds, actor, taaktype, adapter, methode, configuratieversie,
aantallen kandidaten/selectie, latency, foutcategorie, correlation-id. `correlationId` komt
in `retrieval_meta` (basisniveau, allowlist in `audit-meta.ts` en de SQL-projectie) zodat
retrieval, gateway-log en governance met één id te verbinden zijn. Bronidentiteit en versie
op bronniveau (`bronversie_audit` krijgt `versie`). Geen passages, zoekvragen met
persoonsgegevens, tokens of providerresponses in operationele logs.

## 5. T2-werkpakketten (na review)

| # | Pakket | Raakt | Gate |
|---|---|---|---|
| T2-1 | Contract + orkestratie + Supabase-adapter, C1 erdoorheen | chatroute, rag.ts (alleen wrapper) | w311/w322-goldens identiek |
| T2-2 | C5 en C6 door de orkestratie (vlaggen, filters, bronvorm) | zoeken, vergelijk | nieuwe goldens vóór en na; motivering waar gedrag bewust verandert (C6-filters) |
| T2-3 | Versie-identiteit in `bronversie_audit`, `correlationId` in `retrieval_meta` | audit-meta, SQL-projectie | audit-meta-sanity + karakterisering |
| T2-4 | Boundary: census krimpt tot adapter/orkestratie; chunkpresentie via adapter | chatroute | census-gate |
| T2-5 | Microsoft-stub + contracttests (capabilities, versie, cancellation, timeout, truncatie, alle foutcategorieën, cross-tenant met gemanipuleerde refs) | tests | xtenant |
| T2-6 | Docs: dreigingsmodel, ASVS, HANDOVER, rollback (codecontract: `git revert`, geen migratie) | docs | ontwerp-sync |

Migratie is in T2 niet nodig zolang het contract een codecontract blijft; alleen als
`correlationId` in de SQL-allowlist van `meta_basisniveau()` moet, komt er één kleine
forwardmigratie met check.

## 6. Reviewvragen

- R1 Versiebewijs voor Supabase-documenten: `hash(document_id, indexering_versie, bestand_hash)`
  of alleen `status-datum` tot een echte documentversie bestaat?
- R2 C6 (vergelijk) krijgt in T2 peildatum/modus/regime-filters: gewenste gedragswijziging of
  bewust behouden?
- R3 Hybride golden (embeddingstub) in T1b of pas in T2?
- R4 `correlationId` in `retrieval_meta`: forwardmigratie voor de SQL-allowlist accepteren?
