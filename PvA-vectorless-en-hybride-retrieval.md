# Plan van aanpak — Vectorless en hybride retrieval in het bestuurdersportaal

| | |
|---|---|
| **Onderwerp** | Toevoegen van vectorless en hybride retrieval aan de AI-assistent van het bestuurdersportaal |
| **Opdrachtgever / doelgroep** | Productteam, architectuur, security & compliance, bestuur/MT |
| **Status** | Concept ter besluitvorming — v0.1 |
| **Datum** | 5 augustus 2026 |
| **Basis van de analyse** | De daadwerkelijke codebase (`mvp/core/lib/*`, `mvp/supabase/*`), objectenmodel- en architectuurdocumentatie, en de bestaande `RAG-REVIEW-2026-07-05.md` / `RAG-VERBETERING-ONTWERP.md` |
| **Afbakening** | Geen grootschalige implementatie. Analyse, ontwerp, varianten, PoC-voorstel, roadmap en besluitvoorstel. |

**Leeswijzer bij feitclassificatie.** Door het hele document markeer ik bevindingen consequent:

- **[FEIT-code]** — geverifieerd in broncode of SQL (bestand/functie/tabel genoemd);
- **[FEIT-doc]** — geverifieerd in projectdocumentatie;
- **[AANNAME]** — werkhypothese, expliciet ter validatie;
- **[ONTBREKEND]** — niet aangetroffen in de onderzochte bestanden;
- **[ADVIES]** — aanbeveling van dit plan.

Eén methodische kanttekening vooraf, geldig voor het hele document: de orkestratielaag `mvp/app/api/chat/route.ts` (waar retrieval, contextopbouw, modelcall en `governance_log`-insert samenkomen) is **niet** in de analyse-set meegenomen. Waar die laag load-bearing is, staat dat als [ONTBREKEND] en is de werking afgeleid uit de headless kern `generatie-kern.ts` (die volgens de documentatie byte-identiek is aan de route) en de architectuurdocumentatie. Dit is de belangrijkste openstaande verificatie vóór definitieve besluitvorming (zie hoofdstuk 19).

---

## 1. Managementsamenvatting

De centrale bevinding van dit onderzoek verandert de vraagstelling. De opdracht gaat uit van "naast de huidige vector-RAG ook vectorless retrieval toevoegen". De codebase laat echter zien dat een groot deel van wat doorgaans onder *vectorless retrieval* valt, **al aanwezig en productie-getest is**:

- **Lexicale/full-text retrieval** draait al, in het Nederlands, als fundament — niet als noodgreep. [FEIT-code: `document_chunks.zoek_vector` (tsvector, `to_tsvector('dutch', …)`), GIN-index `idx_chunks_zoek`, RPC `zoek_chunks` met `websearch_to_tsquery` + `ts_rank_cd`]
- **Hybride retrieval** (lexicaal + vector, gefuseerd met Reciprocal Rank Fusion, k=60) bestaat al. [FEIT-code: RPC `zoek_chunks_hybride`]
- **Metadatafiltering vóór ranking** (status, bronstatus, geldigheid, bibliotheek, procesinstantie, modusfamilie) bestaat al. [FEIT-code: `2026_06_20g_retrieval_modusfamilie.sql`, denorm-kolommen op `document_chunks`]
- **Deterministische vraagtypeclassificatie** die de retrievalmodus stuurt, bestaat al. [FEIT-code: `vraagtype.ts`, `retrievalModusVoorVraag`]
- **Reranking, jargon-/synoniemexpansie en parent-context (small-to-big)** bestaan al, achter feature flags. [FEIT-code: `rerank.ts`, `jargon-expansie.ts`, `parent-context.ts`]

De juiste vraag is daarom niet "moeten we vectorless retrieval bouwen?" maar **"hoe maken we de al aanwezige vectorless en hybride bouwstenen expliciet, adaptief, meetbaar, veilig en beheersbaar, en welke gerichte gaten vullen we?"**

**De echte, aantoonbare gaten** (elk onderbouwd in hoofdstuk 4) zijn:

1. **Geen retrieval-evalset / nulmeting.** Kwaliteit is niet meetbaar; elke wijziging is een blinde wijziging. Dit is de grootste enkele hefboom en de randvoorwaarde voor al het andere. [FEIT-doc: RAG-REVIEW B1]
2. **Geen expliciete retrievalrouter op de methode-as.** De routing kiest wél een *modus* (actueel/historisch/besluitvorming) en een *bronsoortprofiel*, maar nooit "vector versus lexicaal versus hiërarchisch", en de RRF-fusie is altijd 50/50 zonder gewichten. [FEIT-code: `vraagtype.ts`, `zoek_chunks_hybride`]
3. **Geen echte documenthiërarchie.** Chunks zijn plat met losse structuurlabels; er is geen document→hoofdstuk→paragraaf-boom. Hiërarchische navigatie en betrouwbare documentvergelijking zijn daardoor niet native mogelijk. [FEIT-code: `document_chunks`]
4. **Structuurverlies in de documentverwerking.** DOCX wordt als platte tekst geëxtraheerd (geen pagina's, geen kopstijlen); tabellen in tekstlaag-PDF's worden platgeslagen; voetnoten en bijlage-relaties ontbreken volledig. [FEIT-code: `document-extractie.ts`, `chunking.ts`]
5. **Actualiteits-/statusfilter is te omzeilen op niet-RPC-paden.** Full-document-, parent- en fallback-paden filteren fonds-documenten niet op status/geldigheid; een concept- of verlopen fonds-document kan als bron meekomen (binnen de tenant, geen cross-tenant lek). [FEIT-code: `rag.ts` `handhaafFondsdiscipline`]
6. **Autorisatie kent geen rol-/orgaandimensie op retrieval.** Elke ingelogde gebruiker van een fonds ziet de volledige fondsbibliotheek; er is geen aparte scope voor verantwoordingsorgaan, externe adviseurs, bestuursbureau of tijdelijke gebruikers. [FEIT-code: `capabilities.ts`; FEIT-doc: `rollen-rechten-objecten.md`]
7. **Retrievalkwaliteit en groundedness worden niet bewaakt.** De data staat in `retrieval_meta`, maar fallback-ratio, ilike-ratio, dangling-citaties en faithfulness zijn nog geen signaal. [FEIT-doc: RAG-REVIEW B4/B9]

**Advies in één alinea.** Behoud vector search onverkort — het is de motor voor *analyseren en duiden* en de recall-vangnet. Voeg geen losse "vectorless-modus" toe die de gebruiker moet kiezen, maar bouw de bestaande hybride pijplijn uit tot een **adaptieve hybride architectuur met een expliciete, primair deterministische retrievalrouter** die per vraag bepaalt of het accent op *vinden en bewijzen* (lexicaal/exact/metadata/hiërarchisch) of op *analyseren en duiden* (semantisch/vector) ligt, met gewogen fusie en een aparte, beschermde "bewijs-baan" voor exacte wettelijke en cijfermatige passages. Begin echter met de nulmeting (evalset) als go/no-go-poort, en trek de statusfilter-omzeiling en de hiërarchische datamodel-basis vroeg mee omdat die onder bestuurlijke herleidbaarheid en documentvergelijking liggen. De aanbevolen route is incrementeel: **Variant A (harden + default hybride) → Variant B (adaptieve router + fusieweging + faithfulness) → Variant C (hiërarchisch datamodel + structuurbehoud)**, met Variant B als doelniveau voor de hybride ambitie en de datamodel-basis van C vroeg gelegd.

De kleinste waardevolle eerste implementatie (hoofdstuk 18, beslispunt 6) is: **nulmeting + hybride standaard aan + een exacte-match/bewijs-baan + het dichten van de statusfilter-omzeiling**. Geschatte inspanning PoC/Fase 0–1: **20–35 mensdagen** (bandbreedte onderbouwd in hoofdstuk 16).

---

## 2. Aanleiding en doel

**Aanleiding.** Het bestuurdersportaal biedt een AI-assistent die bestuurlijke vragen beantwoordt op basis van bestuursstukken, vergaderstukken, notulen, beleidsdocumenten, reglementen, ABTN's, implementatie- en transitieplannen, besluiten en generieke kennisdocumenten. De huidige retrieval leunt op embeddings + vector search, aangevuld (zo blijkt uit de code) met Nederlandse full-text search. Het productteam wil onderzoeken of en hoe vectorless en hybride retrieval de assistent aantoonbaar beter, controleerbaarder en herleidbaarder maken — met behoud van pensioenfondsgovernance, vertrouwelijkheid en bestuurlijke herleidbaarheid.

**Functioneel onderscheid dat leidend is in dit plan.** De opdracht formuleert een scherp en bruikbaar onderscheid dat de hele architectuur ordent:

- **Vinden en bewijzen** — exacte, controleerbare, herleidbare informatie. Een bestuurder moet kunnen vertrouwen dat "de premie bedraagt maximaal 10%" letterlijk in een aanwijsbaar, geldig document op een aanwijsbare plek staat. Dit is bij uitstek het domein van lexicale/exacte/metadata/hiërarchische retrieval.
- **Analyseren en duiden** — semantische samenhang, interpretatie, vergelijking, bestuurlijke verdieping. "Welke zorgen zijn geuit over de uitvoerbaarheid?" vraagt om betekenisgelijkenis over verschillende formuleringen heen. Dit is het domein van vector/semantische retrieval.

Dit onderscheid is de rode draad: de doelarchitectuur moet per vraag het juiste accent kiezen, en de bewijs-vragen mogen nooit door semantisch-plausibele-maar-onjuiste passages worden verdrongen.

**Doel van dit plan.** Een onderbouwd besluit mogelijk maken over functionele meerwaarde, doelarchitectuur, technische wijzigingen, fasering, inspanning, risico's, testaanpak en productievoorwaarden. Het plan eindigt met een concreet besluitvoorstel (hoofdstuk 18 en 20).

---

## 3. Scope en definitie

### 3.1 Werkdefinitie "vectorless RAG" voor dit project

De term wordt in de markt uiteenlopend gebruikt. Voor dit project hanteren we een afgebakende, functionele definitie:

> **Vectorless retrieval** = elke vorm van documentophaling in dit portaal die **niet** op de semantische vector-embedding (`document_chunks.embedding`, HNSW-index) steunt, maar op exacte tekst, taalkundige (lexicale) matching, documentmetadata en documentstructuur. Het omvat: (1) lexicale/full-text retrieval, (2) exacte term-, phrase-, cijfer-, datum- en artikelnummer-matching, (3) fuzzy/trigram-matching, (4) metadatafiltering, (5) hiërarchische documentnavigatie, en (6) full-context retrieval van een begrensd dossier of document.

> **Hybride retrieval** = het gecombineerd inzetten en fuseren van vectorless- en vectorretrieval binnen één vraag.

> **Adaptieve (hybride) retrieval** = een architectuur waarin een router per vraag bepaalt welke methoden en gewichten worden ingezet, zodat de gebruiker niet zelf hoeft te kiezen tussen vector en vectorless.

Belangrijk voor de verwachtingen: in dit portaal is "vectorless" grotendeels **geen greenfield**. De lexicale laag en de metadatafilters bestaan al; "vectorless toevoegen" betekent hier vooral *versterken, expliciteren, adaptief maken en gericht aanvullen* (exact/phrase/fuzzy, hiërarchie, structuurbehoud).

### 3.2 In scope

Retrievalarchitectuur en -kwaliteit; datamodel en documentverwerking voor zover die retrieval raken; autorisatie/tenantisolatie op retrievalpaden; logging, monitoring en evaluatie van retrieval; PoC-opzet; fasering en backlog.

### 3.3 Buiten scope

Wijzigingen aan de bestuurlijke UI buiten het onderbouwingspaneel; het bredere platform-/beheerdomein behalve waar het retrieval raakt; live web-retrieval (bestaat al, achter env-vlag `WEB_RETRIEVAL_ACTIEF`, en wordt als bestaand gegeven behandeld); GraphRAG / knowledge-graph / agentic multi-hop (bewust niet, conform RAG-REVIEW spoor 4 — heroverwegen bij bewezen multi-hop-vraagpatronen).

### 3.4 Randvoorwaarden

Incrementele uitbreiding van de bestaande Supabase/pgvector-architectuur heeft de voorkeur boven nieuwe infrastructuur; geen externe vectordatabase (pgvector + RLS in één database is juist een security-voordeel); pensioenfondsgovernance, vertrouwelijkheid, AVG en bestuurlijke herleidbaarheid zijn harde kaders; onnodige architectuurcomplexiteit wordt vermeden; elke nieuwe retrievalvariant erft de tenantisolatie en de actualiteitsdiscipline.

---

## 4. Bevindingen huidige situatie

Dit hoofdstuk is de feitelijke nulmeting, gebaseerd op de code. Per onderdeel staan bestand/functie/tabel genoemd en is onderscheid gemaakt tussen feit, aanname en ontbrekende informatie.

### 4.1 Architectuur en stack

[FEIT-code/doc] Next.js op Vercel; Supabase/PostgreSQL met pgvector; Supabase Storage (bucket `documenten`); Row Level Security; multi-tenant met **fonds = tenant**; externe modellen: Mistral (`mistral-embed` embeddings, `mistral-ocr-latest` OCR), Anthropic Claude (Opus 4.8 generatie, Haiku 4.5 map/prefix/rerank, Sonnet 4.6 query-reformulatie).

### 4.2 Documentupload en -verwerking

[FEIT-code] Gedeeld ingest-pad voor alle vier de chunk-paden (tenant-upload, her-extract, platform-curatie, backfill): `chunk-ingest.ts`. Keten per document: origineel uit Storage → tekstextractie (+ OCR-fallback) → structuurbewuste chunking → context-prefix per chunk (Haiku) → embedding (Mistral) → chunks vervangen in `document_chunks` → afgeleide documentvelden bijwerken (`geindexeerd`, `paginas`, `ocr_toegepast`, `ocr_engine`). Vangrails: max 1500 chunks/document en 5000 rijen/xlsx-tabblad, anders HTTP 413 (`ingest-caps.ts`).

[FEIT-code] Ondersteunde types: **pdf, docx, pptx, xlsx** (`document-extractie.ts`, `ONDERSTEUNDE_TYPES`). Niet ondersteund: `.doc`/`.xls`/`.ppt` (oud binair), CSV, TXT, e-mail.

### 4.3 Tekstextractie en OCR

[FEIT-code] **PDF** via `unpdf` (pdf.js), met coördinaatgebaseerde heropbouw van tekst (spaties uit X-gaps, regel-/paragraafbreaks uit Y-sprongen, reparatie van woordafbreking aan regeleinde) — relatief geavanceerd. **DOCX** via `mammoth.extractRawText` → **platte tekst, `pagina=null`, één segment**; Word-kopstijlen, tabellen en lijststructuur gaan verloren. **XLSX** via SheetJS → markdown-tabellen met herhaalde kopregel en rijbereik in de bronvermelding. **PPTX** via JSZip → één segment per dia.

[FEIT-code] **OCR** = Mistral `mistral-ocr-latest`, alleen voor PDF, alleen bij < 50 betekenisvolle tekens/pagina, en het OCR-resultaat wordt alleen overgenomen als het méér tekst oplevert dan de tekstlaag. Vastlegging is beperkt tot `documenten.ocr_toegepast` (boolean) en `ocr_engine` (tekst). [ONTBREKEND] Er is **geen OCR-confidence/kwaliteitsscore** per pagina of document.

### 4.4 Chunking en structuurbehoud

[FEIT-code] Structuurbewuste chunking (`chunking.ts`): standaard 800 tekens, overlap ~100 (woordgebaseerd hersteld). Splitst achtereenvolgens op paragrafen → zinnen → woorden; chunks < 50 tekens worden weggegooid (behalve herkende structuur-units). Structuurdetectie herkent `StructuurType` = artikel | paragraaf | definitie | besluit | tabel | kop | tekst en labelt elke chunk met `structuur_type` + `structuur_label` (bv. "Artikel 12", "§3.2"). Chunks lopen nooit over een structuurgrens; tabellen worden nooit op zinsgrens geknipt.

[FEIT-code/ONTBREKEND] **Er is geen geneste hiërarchie.** `structuur_label` is een platte string per chunk; de relatie "§3.2 valt onder hoofdstuk 3 valt onder document" wordt niet vastgelegd. Er is geen `parent_chunk_id`, geen sectietabel, geen niveau/ordinaal. Parent-retrieval reconstrueert runtime één niveau (de omliggende unit), geen meerlaagse boom.

[FEIT-code] **Contextuele verrijking** (Anthropic-stijl contextual retrieval): per chunk genereert Haiku een korte situeringszin in de aparte kolom `context_prefix`; `tekst` blijft het enige weergaveveld (prefix-isolatie, reversibel naar NULL). Zowel de FTS-`zoek_vector` als de embedding worden over `context_prefix + tekst` berekend — semantisch en lexicaal zien dezelfde verrijkte inhoud.

### 4.5 Tabellen, voetnoten, bijlagen, notulen

[FEIT-code] Tabellen uit XLSX en uit OCR-markdown blijven als markdown behouden en doorzoekbaar. **Tabellen in tekstlaag-PDF's** worden echter als gewone tekst platgeslagen (kolomsamenhang verloren). [ONTBREKEND] **Voetnoten**: geen enkele verwerking. **Bijlagen**: `documenttype='bijlage'` bestaat als label, maar er is geen mechanisme dat een bijlage aan haar hoofddocument koppelt.

[FEIT-code] **Notulen** worden deterministisch (geen AI) op agendapunt-niveau gesegmenteerd; alleen na menselijke bevestiging (`bevestigd=true`) vervangen segmentchunks de whole-document-chunks, en alleen bij `documenten.status='vastgesteld'`. [ONTBREKEND] Er is **geen extractie van besluiten, actiepunten, risico's of argumenten** als aparte doorzoekbare entiteiten.

### 4.6 Embeddings en opslag

[FEIT-code] Model **`mistral-embed`, 1024 dimensies** (`embeddings.ts`); opgeslagen in `document_chunks.embedding vector(1024)` + `embedding_model`; **HNSW-index, cosine** (`idx_chunks_embedding`, `vector_cosine_ops`). Batching max 64 items / 24.000 tekens, retry/backoff. NULL-embeddings worden overgeslagen → die chunks blijven via FTS vindbaar (graceful degradation).

### 4.7 Retrieval, ranking, reranking

[FEIT-code] **Vector search** loopt via RPC `zoek_chunks_hybride` met cosine-operator `<=>`; kandidaten 40/arm; geen expliciete distance-threshold (alleen `embedding is not null`). **Full-text** loopt via `zoek_chunks` (`websearch_to_tsquery('dutch', …)`, `ts_rank_cd`). **Hybride** fuseert beide met **Reciprocal Rank Fusion, k=60**, via `full outer join` — **ongewogen, 50/50, geen score-normalisatie**.

[FEIT-code] **Fallback-cascade** (elke stap gelogd in `retrieval_meta.fallback_reason`): hybride → Dutch-FTS (`ts_rank_cd`) → verslapte OR-terugval (`fts-terugval.ts`) → plain FTS (`plainto`) → ILIKE op langste trefwoord.

[FEIT-code] **Hybride staat achter een vlag** (`HYBRID_SEARCH` + per-fonds `fonds_instellingen.hybride_zoeken`); default kan FTS-only zijn. [AANNAME] De effectieve default-waarde per omgeving is in de niet-gestagede route/env-config bepaald en moet worden geverifieerd. **Dit betekent dat hybride retrieval mogelijk nog niet standaard actief is** — een belangrijk aandachtspunt.

[FEIT-code] **Reranking** (`rerank.ts`, vlag `RERANK`): Haiku listwise over de verrijkte tekst, alleen op de sterke paden (hybride/Dutch-FTS/OR-terugval), fail-safe naar de RRF-volgorde. De rerankscore voedt een **relevantie-ondergrens** (default drempel 20); ilike-treffers zijn nooit citeerbaar.

[FEIT-code] **Query-verwerking vóór retrieval**: history-aware reformulatie (Sonnet 4.6, anafora-heuristiek); jargon-/synoniemexpansie (`jargon-expansie.ts`, ~29 gecureerde pensioengroepen, OR-append, **alleen op de FTS-arm**). [ONTBREKEND] Echte query-decomposition (semantisch opsplitsen) bestaat niet; wel documentniveau-strategie (targeted / full-document / map-reduce).

> **Update 2026-08-06 — reproduceerbare retrieval (besluit [`0139`](./decisions/0139-reproduceerbare-retrieval-determinisme.md), zie `RAG-VERBETERING-ONTWERP.md` §Fase 4).** De reformulatie was een gesamplede modelcall zonder `temperature` → dezelfde vraag kon een andere zoekvraag en dus een andere bronnenset opleveren. Nu: `temperature: 0` op de hele retrievalketen, een herziene reformulatie-conditie (niet meer op lengte/lidwoord vuren), een niet-destructief fusiepad (extra hybride poging met de originele vraag; één generiek mechanisme waarin de M1-FTS-terugval inhaakt), en een deterministische tiebreaker op `zoek_chunks_hybride` (de beoogde `hnsw.ef_search`-verhoging is uitgesteld: Supabase weigert de functie-SET, ERROR 42501). Dit is de meetbasis onder de recall- en antwoordlengte-opdrachten.

### 4.8 Vraagtypeclassificatie en routing — bestaat er al een router?

[FEIT-code] `vraagtype.ts` is **volledig deterministisch** (regex/trefwoorden, geen LLM). Assen: **antwoordmodus** (7 typen: feitelijk, bronoverzicht, historisch, duiding, besluitrijpheid, sparring, persoonlijke_voorbereiding); **vraagtype** (breed/specifiek → dekkingsstrategie); **bron-intent** (fonds/algemeen/gecombineerd, met zeker/onzeker). De sleutel is `retrievalModusVoorVraag(modus, vraag)` → `RetrievalModus` = actueel | historisch | besluitvorming | alles, wat de `p_modus` van de RPC's bepaalt.

**Conclusie (belangrijk):** er is een deterministische router, maar **alleen op de modus- en bronsoort-as, niet op de retrievalmethode-as**. De router stuurt *filtering* en *volgorde/weging*, nooit "vector vs. lexicaal", en de RRF-fusie blijft altijd 50/50. Een echte retrievalmethode-router ontbreekt — en is precies de logische, ontbrekende uitbreiding die netjes op deze pure heuristieken kan aanhaken.

### 4.9 Contextopbouw, bronverwijzing en generatie

[FEIT-code] Default `maxResults` ≈ 8 chunks (CHUNK_BUDGET 10); over-fetch `max(3×, 20)`; dedup op woord-Jaccard ≥ 0.85 + max-per-document; `maakContext` bouwt genummerde `<bron>`-blokken met titel/paragraaf/pagina, generiek expliciet gelabeld "[generiek/extern kader]". Parent-retrieval breidt de aangeleverde tekst uit tot ~4000 tekens/unit, ~25.000 totaal, met behoud van het citatie-anker op de treffer-chunk.

[FEIT-code] **Generatie**: `claude-opus-4-8` (env `AI_MODEL`); citatiedwang `[Bron N]` per claim; anti-injectie via onvoorspelbare sentinel en neutralisatie. **Citatievalidatie is syntactisch** (telt of `[Bron N]` binnen bereik valt), **niet semantisch** (controleert niet of de claim in bron N staat). Bronverwijzingen tonen document_id, titel, bron, pagina, paragraaf, fragment(citaat), status, datum, geldig_tot, bibliotheek, normgewicht. [ONTBREKEND] Geen versie-id op chunk-/documentniveau in de zichtbare bron; het citaatfragment wordt door de applicatie geconstrueerd (afkapmarkering "…" verplicht).

### 4.10 Datamodel (documenten, chunks, metadata)

[FEIT-code] Kern-tabellen: `documenten`, `document_chunks`, `notulen_segmenten`. Onderstaand de metadata-inventaris ten opzichte van de door de opdracht gevraagde velden.

| Veld | Bestaat? | Kolom / tabel |
|---|---|---|
| tenant_id / fonds | Ja | `documenten.fonds_id` (tenant = fonds) |
| document-ID | Ja | `documenten.id` (uuid) |
| bovenliggend document | Deels | chunk→document via `document_chunks.document_id`; document→bovenliggend document [ONTBREKEND] |
| documenttype | Ja | `documenten.documenttype` (+ denorm op chunk) |
| dossier | Ja | `documenten.procesinstantie_id` + `document_procesinstanties` (N:M) |
| vergadering | Ja | `documenten.vergadering_id` (+ denorm) |
| bestuursorgaan / commissie | Deels | `gremia` bestaat, maar **geen FK van document naar gremium** [ONTBREKEND als retrievaldimensie] |
| titel | Ja | `documenten.titel` |
| subtitel | Nee | [ONTBREKEND] |
| hoofdstuk | Nee | alleen `structuur_label` per chunk, geen hiërarchie [ONTBREKEND] |
| paragraaf | Ja | `document_chunks.paragraaf` + `structuur_label` |
| paginanummer | Ja | `document_chunks.pagina`; `documenten.paginas` (totaal) — **null voor DOCX** |
| tabelnummer | Nee | alleen `structuur_type='tabel'`, geen nummer [ONTBREKEND] |
| bijlage | Deels | `documenttype='bijlage'` als label; **geen relatie** [ONTBREKEND] |
| publicatie-/vergaderdatum | Ja | `documenten.gepubliceerd`, `documentdatum`; `vergaderingen.datum` |
| ingangs-/einddatum | Ja | `documenten.geldig_vanaf` / `geldig_tot` (+ denorm) |
| status | Ja | drielaags: `actief` / `status` (8 waarden) / `bronstatus` (4 waarden) |
| versie | Deels | `documenten.versie` (tekstlabel) + self-FK-lineage; **geen numeriek versiemodel / geen `document_versies`-tabel** |
| vertrouwelijkheidsclassificatie | Nee | [ONTBREKEND] — vertrouwelijkheid = fondsgrens via RLS |
| toegestane rollen | Nee | [ONTBREKEND] — geen per-document rol-ACL |
| OCR-kwaliteit | Nee | alleen `ocr_toegepast` / `ocr_engine`, geen score [ONTBREKEND] |
| bronlocatie | Ja | `documenten.opslag_pad`, `extern_url`, `bronorganisatie`, `bron` |
| zoekvector (tsvector) | Ja | `document_chunks.zoek_vector` (generated) |
| embedding | Ja | `document_chunks.embedding vector(1024)` |
| relaties vorige/volgende versie | Ja | `documenten.vervangt_document_id` / `vervangen_door_document_id` (self-FK) |

[FEIT-code] Relevante indexen: GIN `idx_chunks_zoek` (FTS), HNSW `idx_chunks_embedding` (vector), `idx_chunks_document`, `idx_chunks_bronsoort` (bibliotheek). [ONTBREKEND] De denorm-filtervelden op `document_chunks` (documentstatus, bronstatus, geldig_vanaf/tot, procesinstantie_id, datum) zijn — op bibliotheek/document na — **niet afzonderlijk geïndexeerd**; bij groei wordt gefilterde/vectorless retrieval traag.

### 4.11 Autorisatie en tenantisolatie

[FEIT-code] **Retrieval-RPC's draaien `SECURITY INVOKER`** → RLS wordt niet omzeild; tenantisolatie is de database, niet de applicatie. Retrieval draait als rol **`authenticated`** (sessie), **nooit service_role**. Extra defense-in-depth: expliciete `p_fonds_id`-filter in de RPC en app-guard `handhaafFondsdiscipline` op elk pad. [FEIT-doc: `T3-RLS-CONTROLEKADER.md`]

[FEIT-code] **RLS-SELECT-policies op `documenten`/`document_chunks` filteren alléén op tenant (`fonds_id`) + `bibliotheek='generiek'` + geauthenticeerd-zijn.** Status, bronstatus, geldigheid, rol staan **niet** in RLS — die worden in het RPC-predikaat en de app-guard afgedwongen. `document_chunks` heeft geen eigen `fonds_id`; de grens loopt via de join naar `documenten`.

[FEIT-code/ONTBREKEND] **Rol beïnvloedt retrieval niet.** Het rolmodel kent slechts `beheerder`, `voorzitter`, `bestuurder`; elke ingelogde gebruiker van een fonds ziet de **volledige** fondsbibliotheek + generiek. Er is **geen** rol voor verantwoordingsorgaan, externe adviseur, tijdelijke gebruiker of bestuursbureau, en **geen** bestuursorgaan-/commissiedimensie op documenten.

[FEIT-code] **Bekende risico's/aandachtspunten** (deels historisch, deels open):
- **Statusfilter-omzeiling op niet-RPC-paden** (`haalDocumentChunks`, `haalBevrorenChunks`, `parent-context`, PostgREST-fallback): de app-guard controleert status/geldigheid **alleen voor generieke** chunks; een fonds-document met status `concept`/`historisch`/verlopen kan op die paden als bron meekomen. Binnen de tenant (geen cross-tenant lek), maar wél een actualiteitslek. **[ADVIES: dichten vóór productie.]**
- **`p_fonds_id=null` → RLS is de enige tenantgrens** (by-design defense-in-depth, maar de caller moet de server-afgeleide `fondsId` consequent doorgeven — te verifiëren in de niet-gestagede route).
- **Drift-risico**: geen migratierunner; de `supabase_admin`-default-ACL kan nieuwe objecten opnieuw `anon`-grants geven; structurele gates (F/H) draaien nog niet in CI. Historische lekken K-02 (wees-policies → ongeauthenticeerd schrijven/corpus-poisoning) en M-02 (generiek leesbaar met anon-key) zijn inmiddels gedicht.

### 4.12 Logging, monitoring en evaluatie

[FEIT-code] **Logging**: één append-only insert per beurt in `governance_log` (`vraag`, `antwoord`, `bronnen` jsonb, `modus`, `model`, `retrieval_meta`). `retrieval_meta` is rijk: methode + fallback_reason, opgehaald/geselecteerd, chunk-ids + rang, bronversie-audit, filters, fondsdiscipline_gedropt, zoekvraag/gereformuleerd, citaties (totaal/ongeldig), rerank-scores, drempel-verdeling, jargon-expansie, parent, telemetrie (duur/tokens). **Privacy**: volledige vraag én antwoord én bronfragmenten worden plain-text opgeslagen; [ONTBREKEND] bewaartermijnen zijn niet gedefinieerd (open compliance-punt). Er is een META_INHOUD/META_BRON-scheiding (`governance_log_inhoud`).

[FEIT-doc] **Monitoring**: MVP had geen alerting/error-monitoring. P5 (03-08-2026, "code geïmplementeerd, migratie nog te draaien") voegt `app_errors` + 8 van 19 signalen toe (o.a. AI-latency p95, lege-antwoord-ratio, tokenverbruik, audit-volledigheid), dashboard `/platform/monitoring`. [ONTBREKEND/AANNAME] Retrieval-*kwaliteit* (fallback-ratio, ilike-ratio, dangling-citaties, 0-treffer-ratio) is nog geen expliciet signaal; alerting ontbreekt.

[FEIT-doc/ONTBREKEND] **Evaluatie**: er is **geen retrieval-evalset** (geen gouden set vraag→passages, geen recall@k/MRR/groundedness). Wel: AQL/AQLab-infrastructuur (headless `genereerAntwoord`, bevroren instellingen, A/B tussen providers), een bronkeuze-meetset (46 casus, alleen voor de *bronkeuze-classificatie*), sanity-suites en SQL-checks voor RLS/fondsdiscipline. Dit is volgens de eigen RAG-REVIEW (B1) de grootste enkele hefboom.

### 4.13 Samenvattende beoordeling van de huidige situatie

Dit is een bovengemiddeld volwassen RAG-implementatie voor een MVP: hybride retrieval met RRF, structuurbewuste chunking, contextuele prefixes, metadatafilters vóór ranking, reranking, jargon-expansie, parent-retrieval, RLS-first met SECURITY INVOKER, en een rijk auditspoor. De begrenzingen zitten niet in "vectorless ontbreekt", maar in **meetbaarheid, adaptiviteit van de routing, hiërarchie/structuurbehoud, en enkele governance-/security-hardeningpunten**.

**Wat kan blijven bestaan:** de hele lexicale laag (`zoek_vector`, `zoek_chunks`), de hybride RPC en RRF-basis, de metadatafilters en denorm-kolommen, de deterministische vraagtype-/modus-/bronsoortlogica, reranking, jargon-expansie, parent-context, de RLS-first-isolatie, het `retrieval_meta`-auditspoor, en de omkeerbare re-index-machinerie (versiestempels, `embedding_model` per chunk).

**Wat moet worden aangepast of aangevuld:** een expliciete methode-router met gewogen fusie; een aparte bewijs-baan voor exacte/wettelijke passages; exact-/phrase-/fuzzy-matching als eersteklas mogelijkheid; een echte documenthiërarchie + structuurbehoudende DOCX-extractie + tabellen/voetnoten/bijlagen; het dichten van de statusfilter-omzeiling; indexering van de denorm-filtervelden; retrievalkwaliteits-monitoring en faithfulness; en — als randvoorwaarde vooraf — een retrieval-evalset.

---

## 5. Functionele analyse (use-cases)

Per vraagtype: meest geschikte methode, eventuele combinatie, vereiste metadata/structuur, risico op gemiste informatie, en bronverwijzing. De vraagtypen sluiten aan op het onderscheid *vinden en bewijzen* versus *analyseren en duiden*.

### 5.1 Exacte vindvragen ("vinden en bewijzen")

*Voorbeelden: "Waar staat dat de jaarlijkse bijdrage maximaal 10% bedraagt?", "In welk document is de ondergrens van 2,5% vastgesteld?", "Welke besluiten zijn genomen op 14 mei 2026?", "Welke versie van het implementatieplan bevat criterium 7?", "Waar wordt artikel 150l van de Pensioenwet genoemd?"*

- **Meest geschikte methode:** lexicaal/exact. Full-text (`ts_rank_cd`) + **exacte phrase-/cijfer-/datum-/artikelnummer-matching** + metadatafiltering (datum, versie, status). Vector is hier ondergeschikt en soms schadelijk (semantische buren van "10%" zijn "9%"/"11%").
- **Combinatie:** primair lexicaal/exact, met vector als aanvullende recall-arm mét lager gewicht. Metadatafilter op datum/versie/status is vaak dwingend ("op 14 mei 2026" → filter `documentdatum`/`vergaderingen.datum`; "welke versie" → self-FK-lineage/`versie`).
- **Vereiste metadata/structuur:** betrouwbare `documentdatum`/`geldig_vanaf-tot`, `versie`/lineage, `paragraaf`/`pagina`, artikelnummer-herkenning (bestaat deels in `structuur_label`).
- **Risico op gemiste informatie:** cijfers/percentages/bedragen die door FTS-tokenisatie of chunk-grens verloren gaan; getallen in tabellen in tekstlaag-PDF's; DOCX zonder paginanummer. **[ADVIES: aparte numerieke/patroon-extractie + tabelbehoud.]**
- **Bronverwijzing:** exact, met document, versie, pagina/paragraaf en letterlijk citaatfragment; de bewijs-baan moet de exacte treffer bovenaan houden (niet laten verdringen door vectorruis).

### 5.2 Semantische vragen ("analyseren en duiden")

*Voorbeelden: "Welke zorgen zijn geuit over de uitvoerbaarheid?", "Welke risico's spelen bij deze beleidswijziging?", "Welke eerdere discussies zijn inhoudelijk vergelijkbaar?", "Welke argumenten zijn voor en tegen dit voorstel genoemd?"*

- **Meest geschikte methode:** vector/semantisch (motor voor duiding), aangevuld met lexicaal voor ankertermen.
- **Combinatie:** hybride met hoger vectorgewicht; reranking is hier cruciaal voor precisie.
- **Vereiste metadata/structuur:** minder strikt; wel scope (dossier/vergadering) en actualiteit. Baat bij notulen-/besluit-/risico-/argument-labeling (nu [ONTBREKEND]).
- **Risico op gemiste informatie:** semantisch-plausibele-maar-onjuiste passages; verspreide argumenten over meerdere stukken; gemiste synoniemen als vector-arm de jargon-expansie niet krijgt (die zit nu alleen op de FTS-arm).
- **Bronverwijzing:** meerdere bronnen per claim; expliciet melden dat het duiding betreft, niet een vastgesteld feit.

### 5.3 Samengestelde vragen (combinatie)

*Voorbeelden: "Wat is besloten, welke risico's zijn onderkend en welke acties staan nog open?", "Hoe is het beleid in de loop van de tijd gewijzigd?", "Wijkt het huidige voorstel af van eerdere besluitvorming?", "Zijn de onderbouwing en het uiteindelijke besluit met elkaar in overeenstemming?"*

- **Meest geschikte methode:** combinatie, vaak met **query-decomposition** (nu [ONTBREKEND]): het besluit-deel is een bewijs-vraag (lexicaal/besluitvorming-modus + Decision Object), het risico-/actie-deel is semantisch, het "in de loop van de tijd" vraagt om historische modus + versie-lineage.
- **Combinatie:** router splitst de deelvragen en fuseert; historische reconstructie leunt op `documentdatum`/lineage/`geldig_*`.
- **Vereiste metadata/structuur:** versie-lineage, status-tijdlijn, besluit-/actie-/risico-entiteiten (aan te vullen).
- **Risico op gemiste informatie:** deelvraag valt weg als er niet wordt gedecomponeerd; oude versies worden verward met de geldige.
- **Bronverwijzing:** per deelvraag herleidbaar, met datum/versie zichtbaar.

### 5.4 Dossier- en documentvragen (full-context / vergelijking)

*Voorbeelden: "Vat dit volledige vergaderdossier samen.", "Vergelijk twee versies van een beleidsdocument.", "Welke wijzigingen zijn tussen concept en definitieve versie aangebracht?", "Welke relevante informatie staat in tabellen, bijlagen of voetnoten?"*

- **Meest geschikte methode:** **full-context** (bestaat deels: full-document ≤ ~48k tokens, anders map-reduce) en **hiërarchische** navigatie; documentvergelijking vraagt om versie-lineage + sectie-uitlijning.
- **Combinatie:** scope-first (dossier/versies selecteren via metadata) → full-context of hoofdstuk-/sectiegewijze verwerking.
- **Vereiste metadata/structuur:** bijlage↔hoofddocument-relatie (nu [ONTBREKEND]), tabel-/voetnootbehoud (deels/[ONTBREKEND]), documenthiërarchie (nu [ONTBREKEND]), versie-lineage.
- **Risico op gemiste informatie:** bijlagen/voetnoten/tabellen worden gemist; full-context laadt te veel of te oude documenten in (kosten + governance); vergelijking is onbetrouwbaar zonder sectie-uitlijning.
- **Bronverwijzing:** per sectie/bijlage; bij vergelijking expliciet welke versie welke passage leverde.

### 5.5 Vragen zonder antwoord in de bronnen, en niet-geautoriseerde vragen

[FEIT-code] Beide worden al deels afgevangen: eerlijk non-antwoord bij geen (actuele) treffer, schaduwtelling van niet-vastgestelde stukken, en RLS/guard die niet-toegestane documenten buiten de retrieval houdt. **[ADVIES]** Deze horen als expliciete categorieën in de evalset (hoofdstuk 11), inclusief de eis dat een niet-geautoriseerde vraag géén enkel snippet lekt.

### 5.6 Samenvattende matrix

| Vraagtype | Primaire methode | Secundair | Kritieke metadata/structuur | Grootste risico |
|---|---|---|---|---|
| Exacte vindvraag | Lexicaal/exact + metadata | Vector (laag gewicht) | datum, versie, artikelnr, pagina | cijfers/tabellen gemist, verdringing door vector |
| Semantisch | Vector | Lexicaal (ankers) | scope, actualiteit | plausibel-maar-onjuist |
| Samengesteld | Router + decompositie | Alle | versie-lineage, status-tijdlijn | deelvraag valt weg |
| Dossier/vergelijking | Full-context + hiërarchie | Metadata-scope | hiërarchie, bijlage-relatie, versie | te veel/te oud ingeladen; onbetrouwbare vergelijking |
| Geen bron / niet-geautoriseerd | Metadata + guard | — | status, RLS, rol | schijn-grounding; autorisatielek |

---

## 6. Technische analyse: toepasbaarheid per vectorless-variant

Per variant: welk functioneel probleem het oplost, geschikte vraagtypen, beperkingen, technische impact, past het binnen Supabase, en aanvullende technologie nodig. Waar iets al bestaat, staat dat expliciet.

| Variant | Lost op | Geschikt voor | Belangrijkste beperking | Technische impact | Past in Supabase? | Aanvullende tech? |
|---|---|---|---|---|---|---|
| **PostgreSQL full-text search** | Lexicale recall in NL | Alle bewijs-vragen | NL-morfologie, jargon | **Bestaat al** (`zoek_vector`, `zoek_chunks`) | Ja (native) | Nee |
| **Exacte zoekopdrachten** | Letterlijke term/getal | Cijfers, bedragen, quotes | Tokenisatie splitst getallen/tekens | Laag–middel: `phraseto_tsquery`/exacte predicaten + `pg_trgm` | Ja | Nee |
| **Phrase search** | Woordvolgorde | Wettelijke formuleringen | Chunk-grens kan phrase splitsen | Laag: `phraseto_tsquery`/`websearch` met quotes | Ja | Nee |
| **Fuzzy search** | Typefouten, OCR-ruis, varianten | Namen, afkortingen | Ruis bij lage drempel | Laag–middel: `pg_trgm` (staat al aan) `similarity()`/`%` | Ja | Nee (extensie aanwezig) |
| **Synoniemen/terminologielijsten** | Jargon-mismatch (Wtp/ABTN/SPR) | Alle | Onderhoud lexicon; nu alleen FTS-arm | **Bestaat al** (`jargon-expansie.ts`); uitbreiden + ook op vector-arm | Ja | Nee |
| **Cijfers/percentages/bedragen** | Getalspecifieke vindbaarheid | Exacte vindvragen | FTS behandelt getallen zwak | Middel: numerieke normalisatie/extractie + apart index/veld | Ja | Nee |
| **Datums/artikelnummers** | Tijd-/verwijzingsvragen | Besluiten op datum, art. X | Datumformaten NL; artikelnr in tekst | Middel: extractie naar velden + `structuur_label` benutten | Ja | Nee |
| **Metadatafiltering** | Scope, actualiteit, versie | Alle | Denorm-velden nauwelijks geïndexeerd | **Bestaat al**; indexen toevoegen | Ja | Nee |
| **Hiërarchische navigatie** | Document→hoofdstuk→§ | Dossier/vergelijking/art.-vragen | Geen boom in datamodel | **Hoog**: sectietabel/parent_chunk_id + extractie | Ja | Nee |
| **Full-context retrieval** | Klein dossier volledig | Samenvatting/vergelijking | Kosten, contextlimiet, actualiteit | **Bestaat deels** (full-document/map-reduce); scope-/statusgates aanscherpen | Ja | Nee |
| **BM25 of vergelijkbare lexicale ranking** | Betere lexicale ranking dan `ts_rank` | Bewijs-vragen | `ts_rank_cd` ≈ BM25-achtig, geen echte BM25 in core PG | Middel: `ParadeDB`/`pg_search` (BM25) of ranking-tuning | Ja mits extensie; anders tuning | Mogelijk (`pg_search`) |
| **Query decomposition** | Samengestelde vragen | Samengesteld | Latency/kosten (LLM); testbaarheid | Middel: deterministische splitsing + evt. LLM | Ja (app-laag) | Nee |
| **LLM-gestuurde document-/hoofdstukselectie** | Grote/ambigue scope | Dossier-analyse | Ondoorzichtig, moeilijk testbaar | Middel–hoog: alleen als deterministische selectie tekortschiet | Ja (app-laag) | Nee |

**Kernboodschap van deze tabel:** vrijwel alles past **binnen de bestaande Supabase/pgvector-architectuur zonder nieuwe infrastructuur**. De enige kandidaat voor een extensie is een échte BM25 (`pg_search`/ParadeDB); [ADVIES] dat is optioneel en pas te overwegen als de evalset aantoont dat `ts_rank_cd` structureel tekortschiet — begin met ranking-tuning en gewogen fusie. De grootste technische impact zit niet in "vectorless", maar in **hiërarchie** (datamodel + extractie) en in **LLM-gestuurde selectie** (uitlegbaarheid) — beide bewust te beperken en deterministisch te houden waar het kan.

---

## 7. Oplossingsvarianten

Drie realistische varianten, oplopend in ambitie en impact. Ze zijn cumulatief bedoeld (B bouwt op A, C op B). Per variant volgt een vaste beoordeling.

### 7.1 Variant A — Beperkte uitbreiding (harden + hybride standaard)

**Inhoud.** Hybride retrieval standaard aanzetten (of per fonds bewust default aan); exacte/phrase/fuzzy-matching toevoegen als lexicale mogelijkheid (`phraseto_tsquery`, `pg_trgm` — extensie staat al aan); de jargon-expansie ook op de vector-arm laten meelopen; metadatafilters verbeteren en de denorm-filtervelden indexeren; de statusfilter-omzeiling op niet-RPC-paden dichten; eenvoudige resultaatsamenvoeging (bestaande RRF, ongewogen). Bestaande chunks blijven ongewijzigd.

- **Functionele mogelijkheden:** betere bewijs-vragen (exact/phrase), robuustere jargon-dekking, snellere gefilterde retrieval, wegnemen van het actualiteitslek.
- **Beperkingen:** geen adaptieve routing/weging; samengestelde en vergelijkingsvragen blijven zwak; geen hiërarchie.
- **Technische impact:** laag–middel. Vooral SQL (predicaten, indexen) + kleine app-wijzigingen (`rag.ts`, guard).
- **Impact database/datamodel:** enkele indexen op denorm-velden; geen nieuwe tabellen. Optioneel numerieke/patroon-velden.
- **Impact documentverwerking:** nihil (chunks blijven).
- **Impact beheer:** minimaal; feature-flag-defaults bijstellen.
- **Impact performance:** positief (indexen); fuzzy kan bij lage drempel duurder zijn.
- **Impact kosten:** verwaarloosbaar; geen extra modelcalls.
- **Leveranciersafhankelijkheid:** onveranderd (Mistral/Anthropic zoals nu).
- **Security/privacy:** verbetert (statuslek gedicht); geen nieuwe dataopslag.
- **Migratie-impact:** klein (indexmigraties, geen re-embed).
- **Testinspanning:** middel (uitbreiden checks + start evalset).
- **Implementatie-inspanning:** **8–15 mensdagen.**
- **Geschiktheid:** uitstekend voor de korte termijn; onvoldoende voor de volledige ambitie.

### 7.2 Variant B — Volwassen adaptieve hybride retrieval

**Inhoud.** Variant A + expliciete deterministische **retrievalmethode-router** (`methodeProfiel`), **gewogen/adaptieve fusie** per profiel, een beschermde **bewijs-baan**, optionele **query-decompositie** voor samengestelde vragen, reranking ook op de vectorless-sterke paden, **faithfulness-signaal** (LLM-judge als audit), en volledige **logging van de gekozen route** in `retrieval_meta`. Adaptieve contextselectie op basis van profiel.

- **Functionele mogelijkheden:** het juiste accent per vraag zonder gebruikerskeuze; bewijs-vragen beschermd tegen vectorverdringing; betere samengestelde vragen; inhoudelijk auditspoor (route + faithfulness).
- **Beperkingen:** meer routeringslogica om te testen; faithfulness kost extra (async) modelcalls; nog geen echte hiërarchie/vergelijking.
- **Technische impact:** middel. Uitbreiding `vraagtype.ts` + `zoek_chunks_hybride` (gewichten) + na-verwerking + logging.
- **Impact database/datamodel:** RPC-signatuur uitbreiden met gewichten/exact-arm; geen ingrijpende schemawijziging.
- **Impact documentverwerking:** beperkt (jargon ook op vector-arm; optioneel besluit-/risico-/actie-labeling voor notulen — kan later).
- **Impact beheer:** router-profielen en gewichten beheersbaar via config/flags; dashboard voor routeverdeling.
- **Impact performance:** neutraal–licht negatief (faithfulness async, buiten het kritieke pad houden).
- **Impact kosten:** beperkte stijging door faithfulness/optionele LLM-tiebreaker; te begrenzen met steekproef.
- **Leveranciersafhankelijkheid:** onveranderd; faithfulness kan op bestaande Haiku.
- **Security/privacy:** faithfulness-judge ziet alleen reeds-opgehaalde, geautoriseerde context; geen nieuwe datastroom naar buiten.
- **Migratie-impact:** klein–middel (RPC-wijziging + logging-uitbreiding, additief).
- **Testinspanning:** hoog (router-testset, fusie-regressie, faithfulness-validatie) — hier betaalt de evalset zich terug.
- **Implementatie-inspanning:** **15–30 mensdagen** bovenop A.
- **Geschiktheid:** dit is het **doelniveau** voor de hybride ambitie; korte én lange termijn.

### 7.3 Variant C — Hiërarchische documentretrieval

**Inhoud.** Variant B + een **echte documenthiërarchie** (sectietabel / `parent_chunk_id`, document→hoofdstuk→paragraaf), **structuurbehoudende DOCX-extractie** (mammoth-HTML/koppen), **tabel- en voetnootbehoud** + **bijlage↔hoofddocument-relatie**, **document-/hoofdstukselectie eerst → gerichte passage daarna**, **full-context voor begrensde dossiers** (aangescherpt), en **documentvergelijking** op basis van versie-lineage + sectie-uitlijning.

- **Functionele mogelijkheden:** betrouwbare "wat zegt hoofdstuk/artikel X", dossiersamenvatting, versievergelijking (concept vs. definitief), tabellen/bijlagen/voetnoten doorzoekbaar.
- **Beperkingen:** grootste bouw- en migratie-impact; vereist herindexering; extractiekwaliteit wordt bepalend.
- **Technische impact:** hoog. Nieuwe tabellen/relaties, extractie-refactor, hiërarchische retrievallogica.
- **Impact database/datamodel:** nieuwe sectie-/hiërarchie-structuur, versie-/bijlagerelaties, extra indexen.
- **Impact documentverwerking:** groot (DOCX-extractie, tabel/voetnoot/bijlage, sectieboomopbouw); volledige re-index van bestaande documenten.
- **Impact beheer:** meer metadata te beheren/corrigeren (hoofdstuk, bijlage-koppeling, versie).
- **Impact performance:** sectie-selectie kan retrieval juist versnellen (minder chunks), maar re-index is zwaar.
- **Impact kosten:** eenmalig herindexering (embedding + prefix-calls); structureel neutraal.
- **Leveranciersafhankelijkheid:** onveranderd; DOCX-extractie kan extra library vergen (binnen stack).
- **Security/privacy:** parent-/sectie-fetches moeten strikt binnen document/bibliotheekgrens blijven (guard verplicht).
- **Migratie-impact:** groot (schema + volledige re-index; omkeerbaar dankzij bestaande versiestempel-machinerie).
- **Testinspanning:** hoog (extractie-regressie, hiërarchie-correctheid, vergelijkingskwaliteit, cross-tenant per nieuw pad).
- **Implementatie-inspanning:** **25–45 mensdagen** bovenop B.
- **Geschiktheid:** hoge functionele waarde op de lange termijn; niet nodig voor de eerste waardevolle oplevering.

### 7.4 Onderbouwde voorkeursvariant

**Voorkeur: incrementeel A → B, met de datamodel-basis van C vroeg gelegd; C daarna gefaseerd.**

Motivatie: de meeste "vectorless" bouwstenen bestaan al, dus de grootste marginale waarde zit in (1) meetbaarheid (evalset, randvoorwaarde), (2) hybride standaard + bewijs-baan (A), en (3) adaptieve routing + gewogen fusie + faithfulness (B). Dat adresseert de kernbelofte "vinden en bewijzen versus analyseren en duiden" met beheersbare complexiteit en zonder herindexering. Variant C levert de hoogste functionele sprong (hiërarchie, vergelijking, tabellen/bijlagen) maar tegen de hoogste kosten/migratie; die is het meest waardevol nadat B meetbaar rendeert. **Wél** adviseren we de *datamodel-voorbereiding* voor hiërarchie en versie-lineage vroeg te ontwerpen (niet-brekende, additieve kolommen/tabellen), zodat C later zonder herontwerp kan landen. Dit respecteert de randvoorwaarde "incrementele uitbreiding, geen onnodige complexiteit".

---

## 8. Voorkeursarchitectuur — doelarchitectuur en retrievalrouter

### 8.1 Pijplijn (doelplaat)

De doelarchitectuur behoudt de bestaande stappen en voegt een expliciete router en gewogen fusie toe. De opdracht-onderdelen 1–13 zijn genummerd terug te vinden.

```
Vraag
 └─(1) Queryanalyse: vraagtype + antwoordmodus + bron-intent (deterministisch, bestaat)
        + NIEUW: methode-profiel (bewijs vs. duiding vs. vergelijking vs. reconstructie)
        + NIEUW: optionele query-decompositie voor samengestelde vragen
 └─(2) Scope- & autorisatiebepaling: server-afgeleide fondsId + rol/orgaan (NIEUW) + RLS
 └─(3) Metadatafiltering: modusfamilie, status, geldigheid, dossier, versie (bestaat; indexen NIEUW)
 └─ Parallel retrieveren binnen één RLS-scope:
     ├─(4) Lexicale retrieval: FTS + exact/phrase/fuzzy (deels bestaat; exact/fuzzy NIEUW)
     ├─(5) Vectorretrieval: pgvector cosine (bestaat)
     ├─(6) Hiërarchische retrieval: sectie/hoofdstuk-selectie → passage (NIEUW, Variant C)
     └─(7) Full-context retrieval: begrensd dossier volledig (bestaat deels)
 └─(8) Resultaatfusie: RRF → NIEUW gewogen/adaptief per methode-profiel; bewijs-baan beschermd
 └─(9) Reranking: Haiku listwise (bestaat; ook op vectorless-sterke paden uitbreiden)
 └─(10) Contextselectie: dedup, max-per-doc, parent-expansie, budget (bestaat)
 └─(11) Antwoordgeneratie: Opus 4.8, citatiedwang (bestaat)
 └─(12) Bronverwijzing: document/versie/pagina/§ + citaat (bestaat; versie-id NIEUW)
 └─(13) Logging & evaluatie: retrieval_meta + route + faithfulness (bestaat deels; NIEUW faithfulness/route-signaal)
```

### 8.2 De retrievalrouter — deterministisch waar het kan

De router bepaalt per vraag het **methode-profiel** en de **fusiegewichten**. Het ontwerpprincipe uit de opdracht is leidend: *voorkom dat de LLM-router een ondoorzichtige, moeilijk testbare afhankelijkheid wordt.*

**Deterministische kern (default, altijd eerst).** De bestaande pure heuristieken (`vraagtype.ts`) worden uitgebreid met een `methodeProfiel(vraag, modus)`-functie die één van de volgende profielen kiest, op basis van signalen die grotendeels al gedetecteerd worden:

| Methode-profiel | Deterministische signalen (voorbeelden) | Retrievalgedrag |
|---|---|---|
| **Exacte bewijsvoering** | cijfers/percentages/bedragen, datums, "artikel N", "waar staat", aanhalingstekens | Lexicaal+exact primair; vector laag gewicht; bewijs-baan beschermd; metadatafilter dwingend |
| **Semantische duiding** | "welke zorgen/risico's/argumenten", open bestuurlijke vraag | Vector primair; lexicaal ankers; reranking zwaar |
| **Documentvergelijking** | "vergelijk", "verschil tussen versies", "concept vs definitief" | Versie-lineage + sectie-uitlijning; full-context per versie |
| **Historische reconstructie** | "in de loop van de tijd", "hoe gewijzigd", historische modus | Historische modus + datum/lineage-ordening |
| **Analyse één dossier** | dossier-/vergaderingscope aanwezig | Scope-first → full-context of hoofdstukgewijs |
| **Analyse meerdere documenten** | brede vraag zonder scope | Hybride breed + reranking + diversiteit |
| **Gecombineerd** | samengestelde vraag (meerdere werkwoorden/clausules) | Query-decompositie → per deelvraag een profiel → fuseren |

**Wanneer eventueel LLM-classificatie.** Alleen als de deterministische router *onzeker* is (bv. geen enkel sterk signaal, of tegenstrijdige signalen) mag een lichte LLM-classificatie (Haiku) als tiebreaker worden ingezet — met de uitkomst **altijd gelogd in `retrieval_meta.route`** (profiel, gekozen door regel/LLM, signalen), zodat elke routekeuze reproduceerbaar en testbaar is. De router mag nooit stilzwijgend vector-vs-lexicaal kiezen zonder log. [ADVIES] Houd de LLM-tiebreaker achter een feature flag en meet met de evalset of hij überhaupt nodig is; begin deterministisch-only.

### 8.3 Gewogen en adaptieve fusie (uitbreiding op RRF)

[FEIT-code] Nu: `rrf = 1/(k+r_fts) + 1/(k+r_vec)`, 50/50. **[ADVIES]** Introduceer per methode-profiel gewichten: `rrf = w_lex·1/(k+r_lex) + w_vec·1/(k+r_vec) + w_exact·1/(k+r_exact)`, waarbij bv. het bewijsprofiel `w_lex/w_exact` verhoogt en `w_vec` verlaagt. De `fts_rang`/`vec_rang` worden al teruggegeven, dus de bouwstenen zijn aanwezig. Bewijs-baan: exacte treffers (phrase/getal/artikelnummer met hoge zekerheid) krijgen een gegarandeerde plek in de top-N vóór fusie, zodat een wettelijke passage niet door vectorruis wordt verdrongen (zie hoofdstuk 9).

### 8.4 Waarom de gebruiker niet hoeft te kiezen

De router en gewogen fusie realiseren precies de opdracht-eis: de gebruiker stelt gewoon zijn vraag; het systeem bepaalt het accent. De bestaande UI-affordances (bronkeuze fonds/algemeen, document-scope) blijven; er komt **geen** "vector/vectorless"-schakelaar voor de eindgebruiker. Beheerders kunnen wél per fonds via de bestaande feature-flag-resolver (`retrievalVlaggenVoorFonds`) onderdelen bijsturen.

---

## 9. Datamodel en documentverwerking

### 9.1 Datamodel: bestaand, ontbrekend, aanbevolen

De metadata-inventaris staat in §4.10. Hieronder de conclusies voor uitbreiding, met per veld: bestaat / ontbreekt / verplicht / automatisch afleidbaar / handmatig corrigeerbaar.

| Veld / structuur | Status | Aanbeveling |
|---|---|---|
| tenant/fonds, document-ID, documenttype, dossier, vergadering, titel, pagina, paragraaf, datums, status(3-laags), embedding, zoek_vector, versie-lineage | **Bestaat** | Behouden |
| **Documenthiërarchie** (hoofdstuk→§, `parent_chunk_id` / `document_secties`) | **Ontbreekt** | Toevoegen (Variant C); additief ontwerpen nu |
| **Subtitel, tabelnummer** | Ontbreekt | Automatisch afleiden bij extractie; handmatig corrigeerbaar |
| **Bijlage↔hoofddocument-relatie** | Ontbreekt | FK `bijlage_van_document_id` (Variant C) |
| **Bestuursorgaan/commissie op document** | Ontbreekt | FK naar `gremia` indien governance dit vereist (beslispunt) |
| **Vertrouwelijkheidsclassificatie / toegestane rollen** | Ontbreekt | Alleen bij rol-/orgaan-autorisatie (beslispunt hoofdstuk 18) |
| **OCR-kwaliteitsscore** | Ontbreekt | `ocr_confidence` per document/pagina; automatisch; retrieval kan laag-vertrouwen wegen/markeren |
| **Numeriek/genormaliseerd versiemodel** | Deels (self-FK + tekstlabel) | Overweeg `document_versies` of ordinaal versienummer voor set-based "laatste geldige versie" |
| **Indexen op denorm-filtervelden** (status, bronstatus, geldig_*, procesinstantie, datum) | Ontbreekt | B-tree/composite-indexen toevoegen (Variant A) |
| **Zoekvector op document-/sectieniveau** | Ontbreekt (alleen chunk) | Optioneel voor hiërarchisch gewogen FTS (Variant C) |

**Voorbeeld-migratievoorstel (indicatief, Variant A/C):**

```sql
-- Variant A: indexen voor gefilterde/vectorless retrieval
create index if not exists idx_chunks_status_geldig
  on public.document_chunks (documentstatus, bronstatus, geldig_vanaf, geldig_tot);
create index if not exists idx_chunks_procesinstantie
  on public.document_chunks (procesinstantie_id);
create index if not exists idx_chunks_documentdatum
  on public.document_chunks (documentdatum);
create index if not exists idx_documenten_fonds_status
  on public.documenten (fonds_id, status, actief);
-- fuzzy op tekst (pg_trgm staat aan)
create index if not exists idx_chunks_tekst_trgm
  on public.document_chunks using gin (tekst gin_trgm_ops);

-- Variant C: expliciete documenthiërarchie (additief, niet-brekend)
create table if not exists public.document_secties (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documenten(id) on delete cascade,
  parent_sectie_id uuid references public.document_secties(id) on delete cascade,
  niveau int not null,            -- 1=hoofdstuk, 2=paragraaf, ...
  ordinaal int not null,          -- volgorde binnen parent
  label text,                     -- "Hoofdstuk 3", "§3.2", "Artikel 12"
  titel text,
  pagina_van int, pagina_tot int
);
alter table public.document_chunks
  add column if not exists sectie_id uuid references public.document_secties(id);
alter table public.documenten
  add column if not exists bijlage_van_document_id uuid references public.documenten(id) on delete set null,
  add column if not exists ocr_confidence numeric;
```

### 9.2 Documentverwerking: geschiktheid en aanpassingen

[FEIT-code] Wat blijft: structuurdetectie in `chunking.ts` (bouwsteen voor hiërarchie), de rijke denorm-metadata + filtering, de FTS-`zoek_vector` naast de vectorindex, de omkeerbare re-index met versiestempels, en de prefix-isolatie (gunstig voor een puur vectorless pad).

**Aan te passen / aan te vullen:**

- **DOCX-structuurbehoud** — nu platte tekst zonder pagina/koppen. [ADVIES] `mammoth.convertToHtml` of docx→markdown gebruiken zodat kopstijlen/paragrafen/lijsten behouden blijven; dit voedt zowel hiërarchie als betere chunk-grenzen.
- **Tabellen in tekstlaag-PDF's** — nu platgeslagen. [ADVIES] echte tabelherkenning of terugval op OCR-markdown ook voor tekstlaag-PDF's met tabellen.
- **Voetnoten** — [ONTBREKEND]. [ADVIES] detecteren en aan hun ankerpunt koppelen (belangrijk voor juridisch/beleidsmatig redeneren).
- **Bijlagen** — [ONTBREKEND als relatie]. [ADVIES] bij upload/curatie een bijlage aan het hoofddocument koppelen (`bijlage_van_document_id`).
- **Besluiten/acties/risico's/argumenten** — [ONTBREKEND als entiteit]. [ADVIES] optionele extractielaag (deterministisch waar mogelijk, met menselijke bevestiging zoals bij notulen) die deze categorieën doorzoekbaar maakt.
- **OCR-kwaliteit** — nu alleen boolean. [ADVIES] confidence vastleggen en laag-vertrouwen-OCR in retrieval markeren/wegen.
- **Chunkgrens vs. embedding** — 800 tekens is embedding-getuned; voor unit-first/hiërarchische retrieval de structuur-unit als eenheid overwegen (grens bestaat al via `splitsInStructuurUnits`).

**Doelrepresentatie (geschikt voor alle retrievalvormen tegelijk).** Eén documentrepresentatie die dient voor vector search, full-text search, hiërarchische retrieval, exacte bronverwijzing én toekomstige vergelijking: (a) platte chunks met `zoek_vector` + `embedding` (bestaat), verrijkt met `context_prefix` (bestaat); (b) een sectieboom (`document_secties`) waaraan chunks hangen (`sectie_id`); (c) betrouwbare locatie-/versie-/statusmetadata per chunk (grotendeels bestaat, aanvullen); (d) behouden tabellen/voetnoten/bijlagen als eersteklas, gelabelde units. Dit is precies de basis die zowel Variant B als C bedienen zonder tweede corpus.

---

## 10. Autorisatie en tenantisolatie

Autorisatie mag nooit pas ná retrieval worden toegepast. Dit hoofdstuk borgt dat elke bestaande én nieuwe retrievalroute vóór de zoekactie tot uitsluitend toegestane documenten en passages beperkt is.

### 10.1 Huidige borging (vast te houden)

[FEIT-code] RLS-first met `SECURITY INVOKER`-RPC's; retrieval als `authenticated`, nooit service_role; `p_fonds_id`-filter + `handhaafFondsdiscipline` als defense-in-depth op elk pad. Dit is een sterk fundament en blijft de basis. De dimensies `tenant_id`, `fonds` en `expliciete documenttoegang` (`p_document_ids` + `valideerScope`) zijn goed geborgd.

### 10.2 Dimensie-voor-dimensie: waar afgedwongen, en de gaten

| Dimensie | Nu afgedwongen via | Gat / advies |
|---|---|---|
| tenant_id / fonds | RLS + RPC + guard | OK |
| gebruiker | RLS op `auth.uid()` (profiel/gesprekken) | Retrieval is fonds-breed leesbaar, niet per gebruiker — by-design |
| rol | app-capabilities (schrijf/beheer) | **Niet op retrieval.** [ADVIES] rol-scope toevoegen indien VO/adviseurs beperkter moeten zien |
| bestuursorgaan / commissie | — | **[ONTBREKEND].** [ADVIES] dimensie toevoegen op `documenten` indien governance dit eist |
| dossier / vergadering | RLS per fonds; scope-param | OK als scope; niet als hardgrens per gebruiker |
| documentcategorie | RPC-filter `p_bronsoort` | OK (metadata, geen autz) |
| documentstatus / bronstatus | RPC-predikaat + guard (**alleen generiek**) | **Gat**: fonds-docs op niet-RPC-paden — zie 8.3 |
| documentversie | `actief=true` + scope | OK; verfijnen met lineage |
| geldigheidsperiode | RPC-predikaat (modus actueel) | Gat op niet-RPC-paden — zie 8.3 |
| expliciete documenttoegang | `p_document_ids` + `valideerScope` | OK |

### 10.3 Prioritair te dichten vóór productie

1. **Statusfilter-omzeiling op niet-RPC-paden.** [FEIT-code] `haalDocumentChunks`, `haalBevrorenChunks`, `parent-context` en de PostgREST-fallback filteren fonds-documenten niet op status/geldigheid; alleen `actief=true`. [ADVIES] Breid `handhaafFondsdiscipline` uit met de actuele-bron-definitie óók voor fonds-documenten (of leid deze paden door de RPC met `p_modus`/`p_peildatum`). Dit is een governance-/herleidbaarheidsrisico (concept/verlopen stuk als bron), geen cross-tenant lek.
2. **`fondsId` altijd server-afgeleid.** [ONTBREKEND — te verifiëren in de route] Borg dat `fondsId` nooit uit de request-body komt en nooit leeg is bij ingelogde sessies, zodat de tweede laag (guard + `p_fonds_id`) altijd meewerkt naast RLS.
3. **Elke nieuwe retrievalvariant verplicht door de guard.** [ADVIES] Introduceer één gedeelde wrapper rond elke chunk-fetch (`retrieveMetIsolatie(...)`) die `handhaafFondsdiscipline` afdwingt; nieuwe lexicale/hiërarchische/full-context-paden mogen niet direct `.from()` doen zonder die wrapper.

### 10.4 Beperktere-toegang-gebruikers (VO, externe adviseurs, tijdelijk, bestuursbureau)

[FEIT-code/ONTBREKEND] Deze subgroepen zijn nu **niet** als autorisatiedimensie gemodelleerd; elke fondsgebruiker ziet de volledige fondsbibliotheek. **[ADVIES / beslispunt]** Als governance vereist dat bv. het verantwoordingsorgaan of een extern adviseur een *smallere* documentscope heeft, dan is dat een substantiële uitbreiding die **alle drie de lagen** raakt: (a) een extra dimensie op `documenten` (orgaan/commissie/categorie-ACL of vertrouwelijkheidsniveau), (b) uitbreiding van de RLS-SELECT-policies, en (c) uitbreiding van het RPC-predikaat + app-guard. Dit is een expliciet productbesluit (hoofdstuk 18) — het is geen automatisch onderdeel van "vectorless toevoegen", maar het wordt urgenter zodra nieuwe retrievalpaden bestaan die de scope verbreden.

### 10.5 Risico's specifiek voor de nieuwe retrievalroutes

- **Metadatafilters omzeild** — door van pad te wisselen (niet door parameters); mitigatie: gedeelde guard-wrapper + statusfilter voor fonds-docs (8.3).
- **Service role te breed** — niet op het retrievalpad (retrieval is `authenticated`); restrisico bij generieke-curatie (gedeelde laag). Mitigatie: vier-ogen/audit op generieke curatie (deels aanwezig via platform-wrapper).
- **Cross-tenant combineren** — niet mogelijk voor fonds-docs (RLS); enige gedeelde surface is `bibliotheek='generiek'` (bewust).
- **Caches lekken over tenants** — [ADVIES] elke nieuwe cache (bv. voor router-uitkomst, fonds-instellingen, sectiebomen) moet tenant-gescoped zijn; verifieer dat sleutelvorming altijd `fonds_id` bevat.
- **Logging slaat vertrouwelijke passages op** — `governance_log` doet dit al (plain-text); nieuwe routes mogen de logomvang niet vergroten zonder bewaartermijn/dataclassificatie (hoofdstuk 13).
- **Full-context laadt te veel in** — mitigatie: harde scope-/aantal-/status-caps op het full-context-pad (hoofdstuk 9 en 13).

### 10.6 Testbaarheid van isolatie

[FEIT-code] Er zijn cross-tenant SQL-checks voor de twee RPC's (`checks/2026_07_08_t4_...`). [ONTBREKEND] Niet-RPC-paden worden alleen in pure sanity-tests gedekt. [ADVIES] Breid de DB-checks onder échte RLS uit met per-pad cross-tenant tests, inclusief de nieuwe lexicale/hiërarchische/full-context-varianten, en activeer de structurele gates (F/H) in CI zodat een te-brede policy of een DEFINER/service-role-retrievalpad automatisch rood wordt.

---

## 11. Proof of concept

### 11.1 Doel en afbakening

Objectief aantonen of adaptieve hybride retrieval (Variant B-kern) meetbaar beter *vindt en bewijst* én *analyseert en duidt* dan de huidige situatie, zonder productie-brede uitrol. De PoC is bewust klein en meetgedreven; de meeste bouwstenen bestaan al, dus de PoC richt zich op **meten + router + bewijs-baan + statuslek dichten**.

### 11.2 Te bouwen componenten

- **Productiegeschikt (blijft):** (a) retrieval-evalset + runner (op de bestaande AQL/AQLab-infrastructuur); (b) indexen op denorm-filtervelden; (c) dichten van de statusfilter-omzeiling voor fonds-docs (guard-uitbreiding); (d) hybride standaard aan in de PoC-omgeving.
- **Tijdelijk/experimenteel (PoC-only, later hardenen):** (e) deterministische `methodeProfiel`-router + gewogen fusie achter een flag; (f) exacte/phrase/fuzzy-arm; (g) faithfulness-judge als audit-signaal; (h) een simpel routeverdelings-/kwaliteitsdashboard op `retrieval_meta`.

### 11.3 Benodigde dataset

Een representatieve set van: enkele vergaderstukken, notulen, één reglement, één ABTN, één implementatieplan, meerdere documentversies (concept vs. definitief), en documenten met tabellen en bijlagen — bij voorkeur uit één demo-/testfonds met synthetische of geanonimiseerde data (er bestaat al een demo-fonds-seed). Cruciaal: minstens één set met **versielineage** en één met **tabellen/bijlagen** om C-relevante vragen te kunnen toetsen (ook al implementeert de PoC C nog niet volledig — het meet de baseline-tekortkoming).

### 11.4 Vergelijking (armen)

1. Huidige vector-RAG (baseline, zoals nu in productie);
2. Uitsluitend vectorless/full-text retrieval;
3. Hybride retrieval (ongewogen RRF — huidige `zoek_chunks_hybride`);
4. **Adaptieve hybride** (router + gewogen fusie + bewijs-baan);
5. Waar haalbaar: full-context voor een begrensd dossier (bestaat deels).

### 11.5 Doorlooptijd

**Indicatief 3–5 weken** (1 engineer + deeltijd domeinexpert voor labelen/beoordelen), afhankelijk van de omvang van het labelen.

### 11.6 Succescriteria en go/no-go

| Uitkomst | Besluit |
|---|---|
| Arm 4 verbetert bewijs-vragen (juiste bron top-1/top-5, juiste pagina/§) aantoonbaar t.o.v. arm 1, **zonder** verlies op semantische vragen, en zonder autorisatie-/actualiteitsregressie | **Doorgaan** naar Fase 1/2 (productie-hardening) |
| Verbetering alleen op deelcategorieën, of gemengd beeld | **Aanpassen** (gewichten/profielen bijstellen, evalset uitbreiden) en herhalen |
| Geen meetbare verbetering, of onacceptabele latency/kosten/complexiteit | **Stoppen** met de router; alleen de goedkope harden-maatregelen (indexen, statuslek, hybride default) doorvoeren |

---

## 12. Test- en evaluatieaanpak

### 12.1 Structurele evaluatie- en regressietestset

**75–100 representatieve vragen**, met per vraag: verwacht(e) brondocument(en), verwachte versie, verwachte pagina/paragraaf, verwacht antwoordkarakter, en (voor autorisatie) de rol/context vanwaaruit gevraagd wordt. Verplichte categorieën:

exacte termen · cijfers · percentages · bedragen · datums · artikelnummers · juridische formuleringen · semantische vragen · synoniemen · afkortingen · historische vragen · versievergelijkingen · documentvergelijkingen · tabelvragen · bijlagevragen · vragen zonder antwoord in de bronnen · vragen waarvoor de gebruiker niet is geautoriseerd · vragen met conflicterende bronnen.

### 12.2 Meetwaarden

| Categorie | Meetwaarden |
|---|---|
| **Retrievalkwaliteit** | juiste bron top-1, top-5; juiste documentversie; juiste pagina/paragraaf; recall@k; MRR; gemiste relevante bronnen |
| **Antwoordkwaliteit** | volledigheid; feitelijke juistheid; ongegronde claims (faithfulness) |
| **Bronkwaliteit** | bronjuistheid; reproduceerbaarheid/herleidbaarheid van de verwijzing |
| **Autorisatie** | autorisatielekken (0-tolerantie); geen snippet-lek bij niet-geautoriseerde vraag |
| **Performance** | retrievaltijd; responstijd (p50/p95); stabiliteit bij herhaalde uitvoering |
| **Kosten** | modelkosten; embeddingkosten; indexeringskosten per vraag/document |

De scheiding retrieval- vs. antwoord- vs. bron- vs. autorisatie- vs. performance- vs. kostenkwaliteit is expliciet, zodat een regressie op de juiste laag wordt gelokaliseerd.

### 12.3 Aanpak

Evalset draaien bij **elke** pijplijnwijziging (router, gewichten, drempel, jargon-lexicon, embeddingmodel), naast de bestaande sanity-suites en SQL-checks. Autorisatie-checks onder échte RLS, per retrievalpad (ook de nieuwe). Faithfulness als LLM-judge (steekproef of volledig), gelogd als audit-signaal in `retrieval_meta`. Stabiliteit: elke vraag N× draaien en variantie meten (de AQL-infrastructuur bevriest modelinstellingen voor reproduceerbaarheid).

---

## 13. Logging, beheer en monitoring

### 13.1 Wat per vraag loggen

[FEIT-code] `retrieval_meta` legt al veel vast. **Aanvullen** met: het **methode-profiel en de routekeuze** (door regel of LLM-tiebreaker, met signalen), de **fusiegewichten**, de **bewijs-baan-treffers**, het **faithfulness-oordeel**, en per uitgesloten document de **reden van uitsluiting** (status/geldigheid/rol/scope). Zo is achteraf uit te leggen waarom een bron wél/niet is gevonden, waarom een versie is gebruikt, waarom een antwoord geen bron bevat, en welke route is gekozen.

### 13.2 Privacy en vertrouwelijkheid

[FEIT-code/ONTBREKEND] `governance_log` slaat nu volledige vraag, antwoord én bronfragmenten plain-text op; bewaartermijnen ontbreken. [ADVIES] (a) definieer bewaartermijnen en een opschoon-/archiveerbeleid; (b) benut de META_INHOUD/META_BRON-scheiding zodat vertrouwelijke passages niet onnodig in het brede auditspoor komen; (c) log geen nieuwe volledige passages zonder noodzaak — voor uitlegbaarheid volstaan chunk-ids + scores + redenen; (d) borg dat nieuwe caches tenant-gescoped zijn. Dit is een compliance-/AVG-punt dat vóór bredere uitrol geregeld moet zijn.

### 13.3 Beheer en uitlegbaarheid

[ADVIES] Bouw voort op het bestaande `/governance`- en `/platform/monitoring`-fundament een **retrieval-inspectiescherm** waarmee bevoegde beheerders per vraag kunnen zien: gekozen route + filters, gevonden/uitgesloten documenten met reden, gebruikte scores/versies, rerank- en faithfulness-uitkomst, en of documenten correct zijn geïndexeerd (FTS-vector + embedding actueel, metadata compleet). Dit maakt "waarom is deze bron (niet) gevonden?" beantwoordbaar zonder logs te lezen.

### 13.4 Monitoring (retrievalkwaliteit)

[FEIT-doc] P5 dekt operationele signalen (latency p95, lege-antwoord-ratio, tokens, audit-volledigheid). [ADVIES] Voeg retrieval-*kwaliteitssignalen* toe die al in `retrieval_meta` staan: fallback-ratio, ilike-ratio, 0-treffer-ratio, dangling-citatie-ratio, reformulatie-ratio, en (nieuw) faithfulness-ratio en routeverdeling — met drempelalarm. Dit adresseert RAG-REVIEW B9 (stille degradatie, bv. Mistral-uitval).

---

## 14. Kosten- en performance-impact

Kwalitatief, met kwantitatieve indicaties waar afleidbaar; aannames expliciet.

| Aspect | Verwacht effect | Toelichting |
|---|---|---|
| Databasebelasting | ↑ licht | Extra lexicale/exact/fuzzy-arm + gewogen fusie; grotendeels opgevangen door nieuwe indexen |
| Opslag | ↑ verwaarloosbaar (A/B), ↑ matig (C) | A/B: enkele kolommen/indexen. C: sectietabel + re-index |
| Full-text indexen | bestaat | GIN al aanwezig; trigram-index toevoegen (fuzzy) |
| Embeddings | onveranderd (A/B) | Geen re-embed nodig tenzij embeddingmodel-wissel of C (re-index) |
| Herindexering | eenmalig zwaar bij C | Omkeerbaar via bestaande versiestempel-machinerie |
| Documentverwerking | ↑ bij C | DOCX-structuur, tabel/voetnoot/bijlage, sectieboom |
| LLM-routering | ↑ klein/optioneel | Deterministisch = gratis; LLM-tiebreaker alleen bij twijfel, achter flag |
| Reranking | bestaat | Uitbreiden naar vectorless-sterke paden; marginale kosten |
| Faithfulness | ↑ per antwoord/steekproef | Haiku-judge async, buiten kritieke pad; begrensbaar met steekproef |
| Full-context verwerking | ↑ per dossiervraag | Harde scope-/aantal-/status-caps vereist |
| Responstijd | neutraal–licht ↑ | Router/fusie in-query; faithfulness async; indexen versnellen filtering |
| Schaalbaarheid per fonds | ↑ met indexen | Denorm-index maakt filter-vóór-ranking schaalbaar |
| Schaalbaarheid bij groei | aandachtspunt | HNSW-tuning + denorm-indexen bij duizenden documenten/fonds |

**Beoordeling van de opdrachtvragen:** vectorless retrieval leidt hier **niet** tot lagere embeddingkosten (embeddings blijven nodig voor duiding) en **niet** tot minder externe afhankelijkheden (Mistral/Anthropic blijven), maar wél tot **hogere databasebelasting** (op te vangen met indexen), **neutrale tot licht langere responstijden**, **extra complexiteit in documentverwerking** (vooral C) en **meer beheerinspanning** (metadata/hiërarchie). De winst zit in **kwaliteit, controleerbaarheid en herleidbaarheid**, niet in kostenbesparing. [AANNAME] Exacte cijfers vergen productie-gebruiksdata (volumes, vraagmix) die nu niet uit de code afleidbaar zijn.

---

## 15. Risicoanalyse

Waarschijnlijkheid (L/M/H) × impact (L/M/H), met beheersmaatregel, eigenaar en restrisico.

| # | Risico | W | I | Beheersmaatregel | Eigenaar | Restrisico |
|---|---|---|---|---|---|---|
| R1 | Onduidelijke definitie van "vectorless" leidt tot dubbel werk | M | M | Werkdefinitie (h.3) + erkennen wat al bestaat | Product | Laag |
| R2 | Lexicale zoekopdrachten missen synoniemen | M | M | Jargon-lexicon uitbreiden, ook op vector-arm; fuzzy | Eng | Laag |
| R3 | Vector vindt plausibel-maar-onjuiste passages | H | H | Bewijs-baan + gewogen fusie + reranking + faithfulness | Eng | Middel |
| R4 | Verkeerde documentversies gebruikt | M | H | Versie-lineage in filtering; statuslek dichten; versie in bron | Eng | Middel |
| R5 | Onvoldoende documentmetadata | M | M | Metadata verplichten/afleiden; review-queue (bestaat) | Beheer | Middel |
| R6 | Structuurverlies bij chunking (DOCX/tabellen) | H | M | DOCX-structuurextractie; tabel/voetnoot behouden | Eng | Middel |
| R7 | Autorisatielek via nieuw retrievalpad | L | H | Gedeelde guard-wrapper; per-pad cross-tenant tests; gates in CI | Security | Laag |
| R8 | Actualiteitslek (concept/verlopen fonds-doc) | M | H | Statusfilter ook voor fonds-docs op alle paden | Eng | Laag |
| R9 | Performanceproblemen bij groei | M | M | Denorm-indexen; HNSW-tuning; caps | Eng | Middel |
| R10 | Te veel complexiteit in routering | M | M | Deterministisch-first; incrementeel; meten | Product/Eng | Middel |
| R11 | Moeilijk uitlegbare LLM-routering | M | M | LLM alleen als tiebreaker, altijd gelogd, achter flag | Eng | Laag |
| R12 | Vendor lock-in | L | M | pgvector+PG in één DB; providers al abstraheerd (`llm-providers`) | Arch | Laag |
| R13 | Onvoldoende representatieve testset | H | H | Evalset als Fase 0-poort; domeinexpert labelt | Product | Middel |
| R14 | Onvoldoende beheerbaarheid | M | M | Retrieval-inspectiescherm; kwaliteitsdashboard | Beheer | Middel |
| R15 | Foutieve OCR | M | M | OCR-confidence vastleggen/wegen; review | Beheer | Middel |
| R16 | Niet-doorzoekbare tabellen | H | M | Tabelbehoud (XLSX/OCR bestaat; PDF-tekstlaag aanvullen) | Eng | Middel |
| R17 | Niet-reproduceerbare bronverwijzingen | M | H | Versie-id + afkapmarkering + chunk-id in audit | Eng | Middel |
| R18 | Groeiende PII-opslag zonder bewaartermijn | M | H | Bewaartermijn + dataclassificatie governance_log | Compliance | Middel |

---

## 16. Fasering en roadmap

Per fase: doel, activiteiten, technische en functionele deliverables, afhankelijkheden, risico's, rollen, indicatieve inspanning (bandbreedte), acceptatiecriteria en go/no-go.

### Fase 0 — Analyse en nulmeting *(randvoorwaarde)*
- **Doel:** retrievalkwaliteit meetbaar maken; bekende tekortkomingen en huidige kosten/performance vastleggen.
- **Activiteiten:** evalset (75–100 vragen) opstellen + labelen; runner op AQL; baseline meten; kwaliteitsdashboard op `retrieval_meta`.
- **Deliverables:** evalset + runner (technisch); nulmeting-rapport (functioneel).
- **Afhankelijkheden:** representatieve/geanonimiseerde data; domeinexpert.
- **Risico's:** R13. **Rollen:** product, engineer, domeinexpert.
- **Inspanning:** **5–10 mensdagen.**
- **Acceptatie:** reproduceerbare baseline op alle meetwaarden. **Go/no-go:** zonder baseline geen Fase 2+.

### Fase 1 — Full-text/exacte retrieval + harden
- **Doel:** bewijs-vragen versterken; hybride standaard; governance-lek dichten.
- **Activiteiten:** exact/phrase/fuzzy-arm; jargon ook op vector-arm; denorm-indexen; statusfilter-omzeiling dichten; hybride default aan; per-pad cross-tenant tests.
- **Deliverables:** uitgebreide lexicale retrieval + indexen (technisch); betere exacte vindbaarheid (functioneel).
- **Afhankelijkheden:** Fase 0. **Risico's:** R2, R8, R16. **Rollen:** engineer, security.
- **Inspanning:** **8–15 mensdagen.**
- **Acceptatie:** meetbare verbetering op bewijs-categorieën zonder regressie; statuslek aantoonbaar dicht. **Go/no-go:** groen op evalset + autorisatie.

### Fase 2 — Adaptieve hybride retrieval
- **Doel:** router + gewogen fusie + faithfulness + beheer.
- **Activiteiten:** `methodeProfiel`-router; gewogen/adaptieve fusie; bewijs-baan; optionele query-decompositie; reranking op vectorless-paden; faithfulness-judge; route-logging; routeverdelings-/kwaliteitsdashboard; uitgebreide regressietests.
- **Deliverables:** adaptieve pijplijn + inspectiescherm (technisch); "juiste accent per vraag" + inhoudelijk auditspoor (functioneel).
- **Afhankelijkheden:** Fase 1. **Risico's:** R3, R10, R11. **Rollen:** engineer, product.
- **Inspanning:** **15–30 mensdagen.**
- **Acceptatie:** arm 4 > baseline op bewijs én behoud op duiding; faithfulness zichtbaar; routekeuzes gelogd/uitlegbaar. **Go/no-go:** PoC-succescriteria gehaald.

### Fase 3 — Hiërarchische retrieval
- **Doel:** hiërarchie, structuurbehoud, vergelijking, full-context.
- **Activiteiten:** `document_secties` + `sectie_id`; DOCX-structuurextractie; tabel/voetnoot/bijlage; hoofdstuk-/sectieselectie → passage; versievergelijking; full-context aangescherpt; volledige re-index.
- **Deliverables:** hiërarchisch datamodel + retrieval + vergelijking (technisch); dossier-/vergelijkingsvragen (functioneel).
- **Afhankelijkheden:** Fase 2; datamodel-voorbereiding (vroeg gelegd). **Risico's:** R4, R6, R15, R17. **Rollen:** engineer, beheer.
- **Inspanning:** **25–45 mensdagen.**
- **Acceptatie:** betrouwbare hoofdstuk-/artikel- en vergelijkingsvragen; geen isolatie-/actualiteitsregressie. **Go/no-go:** evalset C-categorieën groen.

### Fase 4 — Productiehardening
- **Doel:** productieklaar maken.
- **Activiteiten:** securityreview; performance-/loadtests; tenantisolatietests (alle paden); beheerprocessen; monitoring + alerting; fallbackmechanismen; bewaartermijnen; releasecriteria.
- **Deliverables:** hardening-rapport + runbooks (technisch/functioneel).
- **Afhankelijkheden:** te hardenen fase. **Risico's:** R7, R9, R14, R18. **Rollen:** security, compliance, engineer.
- **Inspanning:** **10–20 mensdagen.**
- **Acceptatie:** securityreview akkoord; performance binnen norm; isolatie 100%; monitoring+alerting live; bewaartermijnen vastgesteld. **Go/no-go:** formeel productiebesluit.

---

## 17. Backlog

Eerste uitvoerbare backlog, met per item de kernvelden. Prioriteit: **[PoC]** must-have PoC · **[Prod]** must-have productie · **[Opt]** optimalisatie · **[Toekomst]** uitbreiding.

**B-01 · Retrieval-evalset + runner — [PoC]**
Doel: kwaliteit meetbaar maken. Functioneel: 75–100 gelabelde vragen over alle categorieën. Technisch: op AQL/AQLab; recall@k/MRR/faithfulness/autorisatie. Componenten: AQLab, `governance_log`/`retrieval_meta`. Afhankelijkheden: data + domeinexpert. Acceptatie: reproduceerbare baseline. Test: variantie bij N-herhaling. Security: geanonimiseerde data. Omvang: M. 

**B-02 · Statusfilter-omzeiling dichten (fonds-docs, alle paden) — [Prod]**
Doel: geen concept/verlopen fonds-doc als bron. Functioneel: alleen actuele bronnen buiten expliciete historische modus. Technisch: `handhaafFondsdiscipline` uitbreiden voor fonds-docs of paden via RPC. Componenten: `rag.ts`, `parent-context.ts`. Afhankelijkheden: geen. Acceptatie: check bewijst weren op elk pad. Test: per-pad DB-check onder RLS. Security: governance/actualiteit. Omvang: S–M.

**B-03 · Denorm-filtervelden indexeren — [Prod]**
Doel: schaalbare gefilterde/vectorless retrieval. Technisch: B-tree/composite + trigram-index. Componenten: migratie. Acceptatie: querytijd verbetert meetbaar. Test: EXPLAIN/latency. Omvang: S.

**B-04 · Hybride standaard aan + verifiëren default — [Prod]**
Doel: hybride als norm. Technisch: env/per-fonds default; verifiëren in route. Componenten: `rag.ts`, config. Acceptatie: hybride actief tenzij bewust uit. Test: evalset A/B. Omvang: S.

**B-05 · Exacte/phrase/fuzzy-arm — [PoC]**
Doel: bewijs-vragen. Technisch: `phraseto_tsquery` + `pg_trgm`; getallen/artikelnummers. Componenten: zoek-RPC's, `rag.ts`. Acceptatie: exacte categorieën verbeteren. Test: evalset exact/cijfer/datum. Omvang: M.

**B-06 · Jargon-expansie ook op vector-arm — [Opt]**
Doel: synoniemdekking bij duiding. Technisch: expansie toepassen op vectorquery. Componenten: `jargon-expansie.ts`, `rag.ts`. Acceptatie: synoniemcategorie verbetert. Omvang: S.

**B-07 · Deterministische methode-router (`methodeProfiel`) — [PoC]**
Doel: accent per vraag. Technisch: uitbreiding `vraagtype.ts`; profiel→gewichten; route gelogd. Componenten: `vraagtype.ts`, `rag.ts`, `retrieval_meta`. Acceptatie: routekeuzes reproduceerbaar/gelogd. Test: router-testset. Security: geen. Omvang: M.

**B-08 · Gewogen/adaptieve fusie + bewijs-baan — [PoC]**
Doel: wettelijke passage niet verdrongen. Technisch: gewichten in `zoek_chunks_hybride`; gegarandeerde top-N voor exacte treffers. Componenten: RPC, `rag.ts`. Acceptatie: bewijs-vragen top-1 stabiel. Test: evalset. Omvang: M.

**B-09 · Faithfulness-judge (audit) — [Prod]**
Doel: ongegronde claims zichtbaar. Technisch: Haiku-judge async; score in `retrieval_meta`. Componenten: na-verwerking, logging. Acceptatie: faithfulness-signaal per antwoord/steekproef. Test: evalset conflict/geen-bron. Omvang: M.

**B-10 · Retrieval-kwaliteitsdashboard + alerting — [Prod]**
Doel: stille degradatie zichtbaar. Technisch: signalen uit `retrieval_meta` + drempels. Componenten: `/platform/monitoring`. Acceptatie: fallback/ilike/0-treffer/faithfulness zichtbaar met alarm. Omvang: M.

**B-11 · Per-pad cross-tenant tests + gates in CI — [Prod]**
Doel: isolatie geborgd. Technisch: DB-checks onder RLS per (nieuw) pad; gates F/H in CI. Componenten: `supabase/checks`, CI. Acceptatie: te-brede policy/DEFINER-pad wordt rood. Security: kern. Omvang: M.

**B-12 · DOCX-structuurextractie + tabel/voetnoot/bijlage — [Toekomst/Prod-C]**
Doel: structuurbehoud. Technisch: mammoth-HTML/markdown; tabelherkenning; bijlage-FK. Componenten: `document-extractie.ts`, `chunking.ts`, migratie. Acceptatie: koppen/pagina's/tabellen behouden. Test: extractie-regressie. Omvang: L.

**B-13 · Documenthiërarchie (`document_secties`) + hiërarchische retrieval — [Toekomst]**
Doel: hoofdstuk-/sectieselectie + vergelijking. Technisch: sectieboom + `sectie_id` + re-index. Componenten: migratie, ingest, `rag.ts`. Acceptatie: "wat zegt hoofdstuk X" + vergelijking betrouwbaar. Omvang: L.

**B-14 · Rol-/orgaan-autorisatiedimensie — [Toekomst, beslispunt]**
Doel: smallere scope voor VO/adviseurs indien vereist. Technisch: dimensie op `documenten` + RLS + RPC + guard. Componenten: schema, RLS, `rag.ts`. Acceptatie: beperkte gebruiker ziet alleen toegestane docs. Security: kern. Omvang: L.

**B-15 · Bewaartermijn + dataclassificatie `governance_log` — [Prod]**
Doel: AVG-conforme logopslag. Technisch: retentiebeleid + opschoning; META_INHOUD-scheiding benutten. Componenten: schema, beheer. Acceptatie: termijnen vastgesteld en afgedwongen. Compliance: kern. Omvang: M.

---

## 18. Beslispunten

Het eindadvies beantwoordt de tien gevraagde beslisvragen als concreet voorstel.

1. **Moeten we vectorless retrieval toevoegen?** Ja, maar vooral *expliciteren, versterken en adaptief maken* van wat er al is (FTS, filters, routing) plus gerichte aanvullingen (exact/fuzzy, hiërarchie). Geen tweede, losstaand systeem.
2. **Welke functionele problemen lost dit aantoonbaar op?** Betrouwbaarder *vinden en bewijzen* (exacte cijfers/datums/artikelen, juiste versie/pagina), minder schijn-grounding, betere samengestelde/vergelijkende vragen, en uitlegbaarheid — mits de evalset dit meet.
3. **Welke vorm heeft de hoogste prioriteit?** (a) Meetbaarheid (evalset), (b) hybride standaard + exacte/bewijs-baan, (c) statuslek dichten. Daarna de adaptieve router.
4. **Moet vector search behouden blijven?** Ja, onverkort — het is de motor voor duiding en het recall-vangnet. Nooit vervangen, wel adaptief wegen.
5. **Aanbevolen hybride doelarchitectuur?** Adaptieve hybride met deterministische methode-router, gewogen fusie, beschermde bewijs-baan, reranking, faithfulness-audit en volledige route-logging (Variant B), met de datamodel-basis voor hiërarchie (Variant C) vroeg gelegd.
6. **Kleinste waardevolle eerste implementatie?** Fase 0 (evalset) + hybride standaard aan + exacte/bewijs-baan + statuslek dichten + denorm-indexen. **≈ 20–35 mensdagen.**
7. **Investering voor een PoC?** ≈ **3–5 weken** doorlooptijd; ≈ **15–30 mensdagen** engineering + deeltijd domeinexpert voor labelen/beoordelen.
8. **Welke resultaten vóór productie?** Meetbare verbetering op bewijs-categorieën zónder regressie op duiding; 100% autorisatie-isolatie op alle paden; statuslek dicht; faithfulness zichtbaar; monitoring+alerting en bewaartermijnen geregeld.
9. **Belangrijkste beveiligings-/governancerisico's?** Autorisatielek via nieuw pad (R7), actualiteitslek (R8), niet-reproduceerbare bronnen (R17), groeiende PII-opslag zonder bewaartermijn (R18), en — indien governance dat eist — het ontbreken van rol-/orgaanscope (B-14).
10. **Welke besluiten moet het productteam nemen?** (i) Akkoord op incrementeel A→B, C-basis vroeg; (ii) budget/capaciteit Fase 0 + PoC; (iii) besluit over rol-/orgaan-autorisatie (B-14) — nodig of niet; (iv) besluit over `governance_log`-bewaartermijnen (B-15); (v) eventuele extensie voor echte BM25 (`pg_search`) — nu uitgesteld tot de evalset dit rechtvaardigt.

---

## 19. Openstaande vragen

- **[Verificatie route-laag]** `app/api/chat/route.ts` is niet meegenomen. Te verifiëren: exacte orkestratievolgorde (reformulatie→expansie→router→retrieval), de effectieve default van `HYBRID_SEARCH` per omgeving, het exacte tokenbudget van de eindprompt, en dat `fondsId` altijd server-afgeleid en nooit leeg is.
- **[Governance]** Vereist governance een beperktere documentscope voor verantwoordingsorgaan/externe adviseurs/bestuursbureau/tijdelijke gebruikers? (bepaalt B-14).
- **[Compliance]** Welke bewaartermijnen/DPIA-eisen gelden voor `governance_log` (volledige vraag/antwoord/passages)?
- **[Data]** Zijn er productie-gebruiksdata (vraagmix, volumes per fonds) om kosten/performance te kwantificeren en de evalset representatief te maken?
- **[Kwaliteit]** Zijn er al gebruikersklachten/incidenten over retrievalkwaliteit die de prioritering binnen Fase 2/3 sturen?
- **[Leverancier]** Gelden dataresidentie-/verwerkerseisen die een managed reranker/embeddingmodel of `pg_search` beïnvloeden?
- **[Meetset]** Kan de bestaande bronkeuze-meetset (46 casus) als vertrekpunt voor de retrieval-evalset dienen?

---

## 20. Conclusie en advies

Het bestuurdersportaal beschikt al over een bovengemiddeld volwassen, hybride RAG-implementatie: Nederlandse full-text search naast pgvector, RRF-fusie, structuurbewuste chunking, contextuele prefixes, metadatafilters vóór ranking, reranking, jargon-expansie, parent-context, RLS-first-isolatie en een rijk auditspoor. "Vectorless retrieval toevoegen" is daarom grotendeels **een kwestie van expliciteren, adaptief maken, meetbaar maken en gericht aanvullen**, niet van een nieuw systeem bouwen.

**Advies.** Behoud vector search onverkort en voeg géén gebruikerskeuze tussen vector en vectorless toe. Bouw de bestaande pijplijn uit tot een **adaptieve hybride architectuur met een primair deterministische retrievalrouter** die per vraag het accent kiest tussen *vinden en bewijzen* en *analyseren en duiden*, met gewogen fusie en een beschermde bewijs-baan voor exacte wettelijke/cijfermatige passages. Doe dit incrementeel: eerst de **nulmeting/evalset** (randvoorwaarde), dan **harden + hybride standaard + exacte-baan + statuslek dichten** (Variant A), dan de **adaptieve router + gewogen fusie + faithfulness** (Variant B, het doelniveau), en leg de **datamodel-basis voor hiërarchie** (Variant C) vroeg zodat documenthiërarchie, structuurbehoud en versievergelijking later zonder herontwerp kunnen landen.

**Besluitvoorstel.** Ga akkoord met (1) het uitvoeren van Fase 0 (evalset/nulmeting) en de PoC (adaptieve hybride kern), samen ≈ 20–35 mensdagen; (2) het als productievoorwaarde meenemen van het dichten van de statusfilter-omzeiling, per-pad cross-tenant tests, retrievalkwaliteits-monitoring en `governance_log`-bewaartermijnen; en (3) twee expliciete productbesluiten: wel/niet een rol-/orgaan-autorisatiedimensie (B-14) en wel/niet een echte BM25-extensie (uitgesteld tot de evalset dit rechtvaardigt). De grootste, goedkoopste hefboom ligt in meetbaarheid en het beschermen van de bewijs-vragen; de grootste functionele sprong (hiërarchie/vergelijking) volgt daarna, meetgedreven.

