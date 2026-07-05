# RAG-review — stand van zaken en verbeterinventarisatie

> Datum: 2026-07-05 · Reviewbasis: code + migraties (bron van waarheid), getoetst aan `RAG-VERBETERING-ONTWERP.md` en `02 Architectuur/ai-en-rag-architectuur.md`.
> Karakter: onafhankelijke review van de huidige pipeline + geprioriteerde verbeterinventarisatie. Feiten, inschattingen en aannames zijn expliciet gescheiden.

## 1. Wat er nu staat (feitelijk, uit de code)

De pipeline is opgebouwd uit de volgende lagen:

| Laag | Implementatie | Bestand(en) |
|---|---|---|
| Extractie | PDF per pagina, DOCX, XLSX per tabblad; OCR-fallback | `lib/document-extractie.ts`, `lib/ocr.ts` |
| Chunking | Structuurbewust (artikel/§/definitie/besluit/tabel/kop), ~800 tekens, overlap ~100, chunks nooit over structuur- of paginagrens | `lib/chunking.ts` (R1.1) |
| Contextuele verrijking | Haiku-gegenereerde context-prefix per chunk in aparte kolom; FTS én embedding over identieke verrijkte tekst | `lib/chunk-ingest.ts` (R1.2) |
| Embeddings | Mistral `mistral-embed` (1024 dim), batching + retry/backoff, HNSW-index (cosine) | `lib/embeddings.ts`, `2026_06_07_fase_c_embeddings.sql` |
| Retrieval | Hybride FTS (Dutch, `websearch_to_tsquery`, `ts_rank_cd`) + vector, gefuseerd via RRF (k=60), `SECURITY INVOKER` → RLS-tenant-isolatie; fallback-cascade FTS-plain → ILIKE | `lib/rag.ts`, `zoek_chunks(_hybride)`-RPC's |
| Retrieval-filters | Modus (actueel/historisch/besluitvorming/alles), peildatum, document-/bronstatus, bronsoort, procesinstantie — vóór ranking in de RPC (Increment G) | `2026_06_20g_retrieval_modusfamilie.sql` |
| Selectie | Over-fetch ~3×, max per document, Jaccard-dedup, bronsoort-weging, uitsluiting zwakke generieke bronnen | `lib/rag-select.ts`, `lib/weeg-bronsoort.ts` |
| Query-verwerking | History-aware reformulatie (heuristiek + Haiku-rewrite) | `lib/query-reformulatie.ts` |
| Documentscope | Targeted / full-document / map-reduce (tokengedreven strategiekeuze, max 12 batches) | `app/api/chat/route.ts`, `lib/vraagtype.ts` |
| Grounding & prompts | Strikte per-modus systeemprompts, [Bron N]-citaties per claim, anti-hallucinatieregels voor algemene kennis | `app/api/chat/route.ts` |
| Audit | `retrieval_meta` (methode, chunks, filters, fallback-reden, reformulatie, citaatvalidatie, bron-intent, profielsturing) insert-only in `governance_log` | `app/api/chat/route.ts` |

**Oordeel op hoofdlijnen:** dit is een boven-gemiddeld volwassen RAG-implementatie voor een MVP. Hybride retrieval met RRF, structuurbewuste chunking, contextuele prefixes, metadata-filters vóór ranking en een auditspoor per retrieval zijn stuk voor stuk keuzes die veel productieteams pas veel later maken. De architectuurdiscipline (pure, sanity-geteste selectielogica; RLS-first; omkeerbare re-index met versiestempels) is een sterk fundament.

## 2. Bevindingen — waar betrouwbaarheid en kracht nu begrensd worden

Gerangschikt op impact. Per bevinding: wat, waarom het ertoe doet, en waar het zit.

### B1 — Er is geen retrieval-evalset; kwaliteit is niet meetbaar en regressies zijn onzichtbaar (hoog)
Het ontwerpdocument benoemt dit zelf als openstaand risico. Er bestaat wél een geaccordeerde meetset voor de bronkeuze-classificatie (`lib/bronkeuze-meetset.ts`, 40 vragen), maar niets equivalents voor retrieval zelf: geen gouden set vraag→verwachte passages, geen recall@k / MRR, geen groundedness-meting. Elke wijziging (chunkgrootte, prefix-prompt, embeddingmodel, RRF-parameters) is nu een blinde wijziging. Dit is de grootste enkele hefboom: zonder meetlat is elke andere verbetering hieronder niet objectief te valideren.

### B2 — Geen reranker: RRF is de laatste kwaliteitspoort (hoog)
De kandidatenset (over-fetch ~30, RRF over 2×40 kandidaten) gaat na dedup/weging direct de prompt in. RRF fuseert ranglijsten maar beoordeelt niet of een chunk de vráág beantwoordt. Een cross-encoder-rerankstap (bijv. Cohere Rerank, Voyage rerank, of bge-reranker zelf-gehost) op de top-30 kandidaten is in de praktijk de goedkoopste grote kwaliteitssprong in precisie@k — juist bij juridisch/bestuurlijk jargon waar lexicale en vector-ranking beide ruis geven.

### B3 — Geen relevantie-ondergrens: zwakke treffers worden als bronnen gepresenteerd (hoog, betrouwbaarheid)
`zoekViaFTS` en de hybride route geven altijd de top-N terug, hoe zwak ook. De ILIKE-fallback (poging 3: substring-match op het langste woord) kan chunks opleveren die inhoudelijk niets met de vraag te maken hebben — die verschijnen vervolgens als [Bron N] met de suggestie van onderbouwing. RRF-scores zijn niet gekalibreerd, maar een minimale drempel (of: bij `methode: ilike` expliciet melden dat de treffers zwak zijn, of de strikte documentenmodus laten zeggen "onvoldoende relevante passages gevonden") voorkomt schijn-grounding. Dit raakt direct de kernbelofte van het portaal.

### B4 — Citaatvalidatie controleert alleen het bereik, niet de dekking (middel-hoog)
De post-hoc check telt of [Bron N] binnen 1..bronnen.length valt (`route.ts` ~r1147). Een antwoord dat [Bron 2] citeert voor een claim die niet in bron 2 staat, passeert ongemerkt. Een steekproefsgewijze of automatische faithfulness-check (LLM-as-judge of NLI op claim↔chunk) — desnoods alleen als audit-signaal in `retrieval_meta`, analoog aan de bestaande `citaties`-telling — maakt het auditspoor inhoudelijk in plaats van syntactisch.

### B5 — Klein contextbudget: ~10 chunks × ~800 tekens ≈ 2.000 tokens bron-context (middel)
`CHUNK_BUDGET = 10` met chunks van ~200 tokens is krap voor meervoudige bestuurlijke vragen (vergelijk: het contextvenster kan een veelvoud aan). Kleine chunks zijn goed voor retrieval-precisie, maar de prompt-context hoeft niet dezelfde eenheid te zijn: "small-to-big" / parent-retrieval (retrieven op chunk, aanleveren van de omliggende structuur-unit) is hier bijna gratis te bouwen — `structuur_type`/`structuur_label` en `chunk_index` staan al op elke chunk.

### B6 — Reformulatie-heuristiek triggert te breed (middel, latency/kosten)
`heeftReformulatieNodig` vuurt op elk voorkomen van o.a. "het", "ze", "zo", "dit" — woorden die in vrijwel elke normale Nederlandse zin staan. Met historie wordt dus bijna elke vervolgvraag door de Haiku-rewrite gehaald (extra call ≈ 0,5–1,5 s latency vóór retrieval). De `gereformuleerd`-vlag in `retrieval_meta` maakt de werkelijke ratio meetbaar; vermoedelijk kan de heuristiek fors preciezer (bijv. alleen zinsinitiële anafora + korte vragen).

### B7 — Eén-woord-Dutch-FTS-zwakte en jargon-mismatch (middel)
`websearch_to_tsquery('dutch', …)` stemt af op Nederlandse morfologie, maar pensioenjargon kent afkorting↔voluit-paren ("Wtp"/"Wet toekomst pensioenen", "abtn", "SPR", "VO/BO") en samenstellingen waar FTS niet op matcht. De vector-arm vangt veel op, maar een klein synoniemen-/expansiewoordenboek (query-expansie vóór de FTS-arm, of een `pg_trgm`-arm) is goedkoop en gericht. De contextprefixes helpen hier al — meet eerst (B1) of dit nog een echt gat is.

### B8 — Tenant-isolatie steunt volledig op RLS zonder geautomatiseerde verificatie (middel, security)
De keuze zelf is goed (SECURITY INVOKER, geen service-role in het vraagpad). Maar het ontwerpdocument zegt "te verifiëren: gebruiker fonds A kan via de RPC geen chunks van fonds B ophalen" en ik vind geen geautomatiseerde test die dit afdekt. Eén integratietest (twee testfondsen, RPC-aanroep cross-tenant) maakt van een aanname een garantie — dit is bestuurlijk/compliance-relevant bij elke schemawijziging aan de RPC's.

### B9 — Operationele afhankelijkheden zonder bewaking (laag-middel)
Mistral-embedding-uitval degradeert stil naar FTS-only (netjes gelogd in `fallback_reason`), maar niemand ziét dat tenzij iemand de log leest. De data staat er al; er ontbreekt alleen signalering/dashboard: fallback-ratio, ilike-ratio, dangling-citaties, `markeringen.ontbrekend_signaal`. Zelfde geldt voor de per-request query op `fonds_instellingen` (hybride-schakelaar) die elke chatbeurt een extra roundtrip kost — cachebaar.

### B10 — Kleinere punten
- `maakChunks` filtert chunks < 50 tekens weg; voor structuur-units is dat gerepareerd, maar in pure tekst-documenten kunnen korte maar betekenisvolle regels (bedragen, data) nog wegvallen.
- Tabellen die groter zijn dan de chunkgrootte worden op wóórdgrenzen geknipt — midden in een rij. Rij-bewust splitsen (op `\n`) behoudt de tabelsemantiek.
- De embedding van de zoekvraag gebruikt de kale (geherformuleerde) vraag, chunks zijn embed met prefix. Dat is de bedoelde asymmetrie, maar het effect is nooit gemeten (→ B1).
- `_fondsId`-parameter in `zoekRelevanteChunksMetMeta` is dood — bewust (RLS), maar verwarrend voor lezers; hernoemen of verwijderen.

## 3. Verbeterinventarisatie — geprioriteerd

### Spoor 1 · Meten en bewaken (eerst — randvoorwaarde voor al het andere)
1. **Retrieval-evalset (B1).** 30–60 vragen met verwachte bron-passages, uit reële bestuurdersvragen + de bestaande bronkeuze-meetset als vertrekpunt. Metrics: recall@10, MRR, en per antwoord een groundedness-score. Runner naast de bestaande sanity-tests; draaien bij elke pipeline-wijziging. *Inspanning: 2–4 dagen incl. labelen. Grootste hefboom.*
2. **Kwaliteitsdashboard op `retrieval_meta` (B9).** Fallback-ratio, ilike-ratio, dangling-citaties, reformulatie-ratio, 0-treffer-ratio. Alles staat al in de log; dit is uitlezen + drempelalarm. *Inspanning: 1–2 dagen.*
3. **Cross-tenant RLS-integratietest (B8).** *Inspanning: < 1 dag. Compliance-waarde hoog.*

### Spoor 2 · Betrouwbaarheid van het antwoord (quick wins)
4. **Relevantie-ondergrens + eerlijke degradatie (B3).** Minimumscore-gate per methode; bij alleen-ILIKE-treffers het model expliciet laten melden dat de bronbasis zwak is (of in strikte modus: geen antwoord). Auditvlag `zwakke_bronbasis`. *Inspanning: 1–2 dagen.*
5. **Faithfulness-check op citaties (B4).** Async LLM-judge per antwoord (of steekproef): "wordt claim X gedekt door chunk Y?" → score in `retrieval_meta`. Geen blokkade, wél zichtbaarheid — past bij de bestaande audit-filosofie. *Inspanning: 2–3 dagen.*
6. **Reformulatie-heuristiek aanscherpen (B6)** op basis van de gemeten ratio. *Inspanning: < 1 dag.*

### Spoor 3 · Retrieval-kracht (structureel, mét evalset valideren)
7. **Cross-encoder-reranking (B2).** Over-fetch verhogen naar ~40, rerank, top-10 de prompt in. Managed (Cohere/Voyage) is een dag werk; weeg dataresidentie/verwerkersovereenkomst mee — bij bezwaar: zelf-gehoste bge-reranker. *Verwachte impact: grootste precisiesprong.*
8. **Parent-retrieval / small-to-big (B5).** Retrieven op chunk, aanleveren van de volledige structuur-unit (artikel/paragraaf) met budgetplafond. Alle metadata is er al. *Inspanning: 2–3 dagen; verhoogt antwoordkwaliteit bij "wat zegt artikel X"-vragen direct.*
9. **Query-expansie voor jargon (B7).** Klein beheerd synoniemenwoordenboek (Wtp/abtn/SPR e.d.) in de FTS-arm; eventueel multi-query (2–3 varianten parallel, RRF fuseert al). *Inspanning: 1–2 dagen.*
10. **Embeddingmodel-benchmark.** `mistral-embed` is degelijk maar niet top voor Nederlands juridisch; benchmark tegen bijv. voyage-3(-large) of text-embedding-3-large op de eigen evalset. De re-index-machinerie (versiestempels, backfill, `embedding_model` per chunk) maakt migratie al veilig. *Alleen doen als de evalset een gat toont.*

### Spoor 4 · Bewust nog niet doen
- **GraphRAG / knowledge-graph, agentic multi-hop retrieval, fine-tuned embeddings:** disproportioneel voor het huidige volume en de MVP-fase; heroverwegen bij structurele multi-hop-vraagpatronen in de logs.
- **Externe vectordatabase:** geen aanleiding; pgvector + RLS in één database is juist een security-voordeel van de huidige opzet.

## 4. Aanbevolen volgorde

Eerst meetbaarheid (1–3), dan de betrouwbaarheids-quick-wins (4–6), dan pas retrieval-kracht (7–10) — elke stap uit spoor 3 zonder evalset is niet aantoonbaar een verbetering. Sporen 1+2 samen zijn ruwweg anderhalve week werk en adresseren de grootste risico's voor bestuurlijk vertrouwen: schijn-grounding en onzichtbare degradatie.

## 5. Aannames en openstaande vragen

- **Aanname:** productievolume blijft voorlopig tientallen–honderden documenten per fonds; prioritering verschuift bij duizenden documenten (dan wegen reranking-latency en HNSW-tuning zwaarder). *Valideren.*
- **Aanname:** de handmatige kwaliteitstoetsing door gebruikers (genoemd in het ontwerpdoc) heeft geen gestructureerde bevindingenlijst opgeleverd die als seed voor de evalset kan dienen. *Als die er wél is: gebruiken.*
- **Open:** gelden er dataresidentie-/verwerkerseisen die een managed reranker (Cohere/Voyage) uitsluiten? Bepalend voor keuze bij punt 7.
- **Open:** is er al een productie-incident of gebruikersklacht over retrieval-kwaliteit geweest? Dat zou de prioritering binnen spoor 3 concreet sturen.
