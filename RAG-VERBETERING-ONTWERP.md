# RAG-verbetering — ontwerp

> Status: **Fase 1a + 1b opgeleverd** (2026-05-30), **Fase 3 hybride search live sinds 2026-06-07** (`2026_06_07_zoek_chunks_hybride.sql`, RRF), **Fase 2 structuurbewuste chunking + R1.2 contextuele retrieval opgeleverd 2026-06-24** ([`decisions/0025`](./decisions/0025-rag-structuur-contextueel-reindex.md)).
> Bron van waarheid blijft de code + migraties; dit document beschrijft *wat en waarom*.

## Aanleiding

De retrieval in `lib/rag.ts` gebruikt Postgres full-text search (`tsvector`, Dutch-config) — bewust gekozen boven vector-embeddings voor MVP-volume (zie `HANDOVER.md` § "RAG zonder vector embeddings"). Bij review kwamen twee concrete tekortkomingen naar voren die los staan van de architectuurkeuze:

1. **Geen relevantie-sortering.** `supabase-js .textSearch()` kan niet `ORDER BY ts_rank_cd(...)` doen — de order-parameter kan de tsquery niet aanroepen. De "top N" was daardoor feitelijk de eerste N rijen die de GIN-index teruggaf, niet de N meest relevante.
2. **Lege locatie-metadata.** De upload-route slaat chunks op met `pagina = null` en `paragraaf = null`, terwijl `maakContext`/`BronVerwijzing` die velden gebruiken voor "pag. X, §Y". De bronvermelding mist dus fijnmazige locatie.

Daarnaast geen zicht op *welke* chunks zijn opgehaald en welke uiteindelijk in de prompt belandden — relevant voor de auditability-filosofie van het portaal.

## Fasering

Meet-gedreven en gefaseerd; geen volledige embeddings-ombouw vooraf. De gebruiker toetst kwaliteit handmatig in de online omgeving (geen automatische evalset in deze iteratie).

### Fase 1a — relevantie-ranking + grounding + logging (deze release)

**Retrieval-ranking via DB-functie.** Een nieuwe, idempotente migratie introduceert een Postgres-functie `public.zoek_chunks(p_query text, p_limit int)`:

- `language sql stable security invoker` — cruciaal: door `SECURITY INVOKER` draait de functie als de aanroepende gebruiker, zodat de RLS-policies `fonds chunks` en `fonds documenten` onverkort gelden. Tenant-isolatie wordt **niet** omzeild. `set search_path = public, pg_temp` tegen search-path-injection.
- `websearch_to_tsquery('dutch', p_query)` i.p.v. `plainto_tsquery` — verdraagt frasen/operators en is robuust tegen leestekens.
- Sortering op `ts_rank_cd(zoek_vector, query) desc`, met `limit p_limit` (over-fetch, bijv. 20).
- Sluit gedeactiveerde documenten uit (`documenten.actief = true`).

Tenant-isolatie blijft volledig bij RLS (net als de huidige code, die `fondsId` ook niet in de query gebruikt). De functie filtert dus niet zelf op `fonds_id`; RLS doet dat.

**Selectie in applicatiecode.** `lib/rag.ts` haalt ~20 gerangschikte chunks op en knipt terug naar de uiteindelijke set via een **pure, testbare** functie `selecteerChunks`:

- Maximaal N chunks per document (default 3) — voorkomt dat één PDF de hele context vult.
- Dedup van bijna-identieke chunks (woord-Jaccard boven drempel) — overlap tussen aangrenzende chunks zorgt anders voor dubbele context.
- Behoudt de rang-volgorde; deterministisch (sanity-getest).

De bestaande fallback-cascade (FTS zonder Dutch-config → ILIKE) blijft als vangnet voor het geval de RPC niets oplevert.

**Logging.** Een nieuwe `governance_log.retrieval_meta jsonb`-kolom legt per AI-vraag vast: de gebruikte zoekmethode, aantal opgehaald vóór selectie, aantal na selectie, en per gebruikte chunk `{id, document_id, rang}`. Dit wordt **bij de bestaande insert** gevuld — append-only blijft intact, geen UPDATE/DELETE op logrijen. Voor de voorbereidingsmodule gebeurt dit via het bestaande `bronnen_meta`-veld.

**Grounding.** De strikte modus (`SP_DOCUMENTEN_REGELS`) baseert antwoorden al uitsluitend op gevonden bronnen; dit is geverifieerd, niet herschreven (de toon-systeemprompt blijft ongemoeid).

### Fase 1b — pagina-/paragraaf-metadata (opgeleverd 2026-05-30)

Twee delen, beide gebouwd.

**Deel 1 — pagina-bewuste extractie + chunking.** `extractTekst` (`lib/document-extractie.ts`) geeft nu naast de platte `tekst` ook `segmenten: TekstSegment[]` terug: voor PDF één segment per pagina (`pagina = paginanummer`), voor DOCX één segment (`pagina = null`), voor XLSX één segment per tabblad (`paragraaf = "Tabblad: <naam>"`). De nieuwe pure functie `maakChunksUitSegmenten` (`lib/chunking.ts`) chunkt per segment en tagt elke chunk met `pagina`/`paragraaf`; een chunk loopt nooit over een segmentgrens. De upload-route slaat die velden nu op i.p.v. `null`. De chunk-helpers zijn uit `lib/rag.ts` verplaatst naar het Supabase-vrije `lib/chunking.ts` (en daar opnieuw geëxporteerd), zodat ze zuiver te sanity-testen zijn.

**Deel 2 — her-extract endpoint.** `POST /api/documents/[id]/her-extract` haalt het origineel uit Storage, draait `extractTekst` opnieuw, vervangt de chunks en zet `geindexeerd`/`paginas` bij. Alleen voor documenten met `opslag_pad`. Server-side beperkt tot voorzitter/beheerder; tenant-isolatie en chunk-delete/-insert lopen via RLS (`fonds chunks`). Hiermee profiteren bestaande documenten van de pagina-metadata zonder opnieuw te uploaden.

Bewust nog niet in 1b: detectie van "§3.2"/"Art. 12"-koppen — dat is structuur-chunking en hoort bij Fase 2.

### Fase 2 — structurele chunking + chunk-metadata (R1.1, opgeleverd 2026-06-24)

Gebouwd. `lib/chunking.ts` splitst nu eerst per segment in **structuur-units** (`splitsInStructuurUnits` + `detecteerGrens`): kop, §, artikel, definitie, besluit en (markdown-)tabel zijn grenzen, en een chunk loopt **nooit** over zo'n grens. Elke chunk krijgt naast `pagina`/`paragraaf` ook `structuur_type` en `structuur_label` mee (nullable kolommen op `document_chunks`). De sanity-tests in `lib/chunking.sanity.ts` borgen dat lopende tekst één 'tekst'-unit blijft, artikelen niet samenvloeien, definities samenhangend/gescheiden terugkomen en een markdown-tabel ondeelbaar blijft.

### R1.2 — contextuele retrieval (Optie A, opgeleverd 2026-06-24)

Per fragment genereert `lib/chunk-ingest.ts` (`genereerPrefix`, model Haiku) één korte Nederlandse context-zin op basis van een **begrensd "structuur-venster"** (documenttitel + `structuur_type`/`structuur_label` van het bovenliggende onderdeel + het fragment, getrunceerd op `PREFIX_INPUT_MAX`). Die zin staat in de **aparte kolom `context_prefix`** en wordt **nooit getoond**: bronvermelding/citaat lezen onverkort `tekst`. De cruciale invariant — embedding én FTS over **dezelfde verrijkte tekst** — wordt afgedwongen doordat `verrijkTekst(prefix, tekst)` exact `${prefix} ${tekst}` (één spatie) produceert, identiek aan de generated kolom `zoek_vector = to_tsvector('dutch', coalesce(context_prefix || ' ', '') || tekst)`. Zo zien de BM25-arm en de vector-arm van de RRF-fusie dezelfde tekst; bij `context_prefix = NULL` vallen beide terug op kale `tekst`.

**Gedeelde, herhaalbare en omkeerbare re-index.** `lib/reindex.ts` (`herindexeerDocument`) is client-agnostisch en bedient alle vier de chunk-producerende paden: upload, her-extract, de generieke pipeline (service-role) en de nieuwe backfill. Per document: origineel uit Storage → her-extractie (met OCR-fallback) → `bouwChunkRecords` (structuur + prefix + verrijkte embedding) → bestaande chunks vervangen. **`tekst` wordt nooit aangeraakt** (omkeerbaar/snapshot-integer); elke chunk krijgt `prefix_model` + `indexering_versie` als versie-stempel. Een document zonder bruikbaar origineel (geen origineel, niet-ondersteund type, of geen tekst ná OCR) wordt gestempeld `indexering_versie = 'r1-overgeslagen'` zodat de backfill terminerend blijft en één onverwerkbaar document de rij niet blokkeert. De backfill verwerkt **één document per aanroep** (tegen de Vercel-timeout); de UI loopt door tot de server `klaar` meldt.

**Twee backfill-ingangen, gescheiden langs de tenant-grens:**
- **Fonds:** `POST /api/documents/reindex-backfill` op de anon-key + RLS, alleen voorzitter/beheerder, gescoped op `bibliotheek='fonds'`. Batch-knop "Bibliotheek her-indexeren" in beheer, met kostenbevestiging vooraf.
- **Generiek:** server-action `curatieHerindexeren` uitsluitend achter `withPlatform` (service-role), gescoped op `bibliotheek='generiek'` — nodig omdat tenants op generieke chunks read-only zijn (RLS). Batch-knop in de generieke bibliotheek, idem kostenbevestiging.

### Fase 3 — hybride search (live sinds 2026-06-07)

Gebouwd vóór dit increment: `pgvector` náást FTS in dezelfde Supabase-database (RLS blijft gelden), gefuseerd via Reciprocal Rank Fusion (`zoek_chunks_hybride`, k=60, `security invoker`). **Geen externe vector-database**. De R1.1/R1.2-verrijking versterkt beide armen van deze fusie zonder het RRF-algoritme zelf te wijzigen.

### Fase 4 — reproduceerbare retrieval (determinisme-eis, besluit 0139, 2026-08-06)

**Eis:** dezelfde vraag in dezelfde gespreksdraad levert dezelfde zoekvraag en dezelfde bronnenset. Aanleiding: eenzelfde vraag gaf binnen één draad twee verschillende bronnensets, doordat de history-aware reformulatie een gesamplede modelcall zónder `temperature` was (zie [`decisions/0139`](./decisions/0139-reproduceerbare-retrieval-determinisme.md)).

- **Reformulatie-conditie (`heeftReformulatieNodig`).** Reformuleer wanneer een vraag *werkelijk* niet zelfstandig te begrijpen is — niet wanneer hij kort is of een lidwoord bevat. De `<= 5`-woordenregel is geschrapt; `het` is uit `VERWIJSWOORDEN`; de aanwijzende voornaamwoorden `dat/die/dit/deze` worden **positioneel** beoordeeld (determinator vóór een zelfstandig naamwoord → géén reformulatie; alleenstaand of vóór een functiewoord/werkwoord → wél). Meetset in `query-reformulatie.sanity.ts` (valse-reformulatie 5/6 → 0/6, alle echte anafora behouden).
- **Niet-destructief fusiepad (M-R3).** Bij een geherformuleerde vraag draait de hybride retrieval een **extra poging met de originele vraag** en fuseert de kandidatensets (union op chunk-id, beste RRF-rang wint). Eén generiek "extra retrievalpoging"-mechanisme (`fuseerHybridePogingen` + `gedeeldeHybrideParams`, harde bovengrens `MAX_HYBRIDE_POGINGEN = 3`), waarin de M1-FTS-terugval uit `WERKOPDRACHT-RETRIEVAL-RECALL.md` als derde poging inhaakt. Elke poging deelt `p_fonds_id`/modus/filters per constructie identiek — fondsdiscipline blijft hard. Verworpen alternatief: gesplitste armen (origineel→FTS, herschreven→vector).
- **Determinisme-eis op de RPC.** `temperature: 0` op elke modelcall in de retrievalketen (reformulatie, rerank, context-prefix); deterministische tiebreaker `, dc.id` op de drie sorteringen in `zoek_chunks_hybride`. Arm-herkomst (`fts_rang`/`vec_rang`) en poging-herkomst in `retrieval_meta`. **`hnsw.ef_search = 100` op de functie-`SET`-clausule is uitgesteld**: Supabase weigert dit voor de migratie-rol (`ERROR 42501`); ef_search blijft 40 (apart openstaand punt, zie 0139).

Dit is de **meetbasis** onder `WERKOPDRACHT-RETRIEVAL-RECALL.md` en `WERKOPDRACHT-ANTWOORDLENGTE.md`: zolang dezelfde vraag verschillende zoekvragen kan opleveren, meten hun acceptatiecriteria ruis.

### Fase 5 — representatie-constraintlaag (Epic bronselectie T1, 2026-08-12)

**Probleem:** de selectie was één gepoolde ranking met een vaste afkap. Onder een "generiek" geclassificeerde vraag drukt de bronsoort-weging fondsdocumenten categorisch naar achteren, waarna ze onder `maxResults` vallen (partnerbegrip-casus: 7 generieke citaties, 0 fondsbronnen). Er was geen mechanisme dat een minimumrepresentatie per bibliotheek/bron garandeert; de classificatie was zélf de beoogde oplossing.

- **Constraint-laag (`selecteerMetConstraints`, `core/lib/rag-select.ts`).** Puur & deterministisch, geen Supabase. Reserveert in rangvolgorde slots tot de minima per bibliotheek/bron gehaald zijn (dedup + `maxPerSource` gelden binnen die reservering), vult daarna het resterende budget op globale rang, en behoudt de inkomende volgorde in de uitvoer. **Faalt nooit:** een onhaalbaar minimum → door met wat er is. Bij nulminima **bit-identiek** aan `selecteerChunks` (geborgd in sanity), zodat de flag-uit-toestand non-regressief is.
- **Constraint-object** `{ fondsMin, generiekMin, perSourceMin, maxPerSource, maxTotal }`, afgeleid uit het `bronsoortprofiel` (`constraintsVoorProfiel`, `core/lib/weeg-bronsoort.ts`): `generiek`/undefined → `fondsMin 0` · `fonds` → `fondsMin 1` · `gecombineerd` → `fondsMin 1 + generiekMin 1` · `vergelijking` → `perSourceMin q` (voorbereid, toepassing in T5).
- **Expliciete bewerkingsvolgorde** (code + comment in `weegEnSelecteer`): `filters → weging (bronsoort) → [gereserveerd: regime-demotie, T4] → representatie-constraints → dedup → budget-afkap`. De T4-plek is bewust vrijgehouden.
- **Feature-flag `REPRESENTATIE_CONSTRAINTS`** (env + per-fonds via `fonds_feature_flags`), **default uit = huidig gedrag**. Geresolveerd in het bestaande R1.3–R1.6-vlaggenspoor (`retrievalVlaggenVoorFonds` → `RetrievalOpties` → `naVerwerking`), dus de chat-route bedraadt automatisch mee.
- **Scope-afbakening.** Classifier-verfijning (contrastpatroon → `gecombineerd`) is **T2** — gepaird: de partnerbegrip-casus classificeert nu nog als `generiek`, dus pas met T1 + T2 samen is die end-to-end opgelost. Regime-weging → **T4**. Vergelijkmodus + alignment op `perSourceMin` → **T5**.
- **Auditlog-uitbreiding `retrieval_meta` (T3, opgeleverd 2026-08-12).** De selectie was in `retrieval_meta` niet herleidbaar: alleen de geselecteerde chunks werden gelogd, niet de kandidatenset vóór selectie of waaróm een bron afviel — "opgehaald maar gedemoveerd" was niet te onderscheiden van "nooit opgehaald". T3 voegt twee **additieve** sleutels toe, gevuld in de weeg+select-stap (`weegEnSelecteer`/`naVerwerking`): **`selectie`** (basis-niveau, telemetrie): `intent`/`regime`, de effectieve `constraints` (ook bij flag-uit, alle minima 0), `geselecteerd_per_bibliotheek` en `afgevallen_telling` per reden. **`selectie_kandidaten`** (bron-niveau, bronidentiteit): per kandidaat `document_id`/`bibliotheek`/`rang`/`status` + afvalreden. **Reden-taxonomie:** `weging` (door bronsoort-demotie buiten budget — bepaald via een contrafeitelijke selectie op de pré-weging volgorde, geen overclaim), `zwak_generiek` (§8.3 #6-uitsluiting vóór selectie), en `quotum`/`dedup`/`budget` exact uit de pure selectie-kern (trace-varianten `selecteerChunksMetTrace`/`selecteerMetConstraintsMetTrace`; de bestaande functies delegeren, dus gedrag bewezen ongewijzigd). De allowlist is gespiegeld in `core/lib/audit-meta.ts` (`selectie`→basis, `selectie_kandidaten`→bron) én in SQL (`meta_projectie`, migratie `2026_08_12_t3_retrieval_meta_selectie.sql`). Visualisatie in `/governance` is bewust **out of scope** (aparte UI-story).
- **Nulmeting (meetset-first).** `BRONKEUZE_NULMETING_T1` in `core/lib/bronkeuze-meetset.ts` — 14 "begrip × wettelijke toets"-vragen (incl. partnerbegrip), bewust in een **apart export** dat de classificatie-runner níét als pass/fail evalueert (het zijn nulmeting-doellabels, geen geaccordeerde uitkomsten). Her-accordering door compliance vóór productie is openstaand. Zie [`decisions/0159`](./decisions/0159-representatie-constraintlaag-bronselectie.md).

## RLS / security-impact

- Nieuwe functie is `SECURITY INVOKER`; RLS op `document_chunks` en `documenten` blijft de tenant-isolatie afdwingen. Te verifiëren: een gebruiker van fonds A kan via de RPC geen chunks van fonds B ophalen.
- Geen service-role-key; geen RLS-verzwakking.

## Audit-impact

`retrieval_meta` is additief en insert-only. Geen wijziging aan bestaande append-only-garanties. **T3 (2026-08-12):** de sleutels `selectie` (basis) en `selectie_kandidaten` (bron) zijn toegevoegd aan de lees-allowlist in `core/lib/audit-meta.ts` en aan de SQL-spiegel `meta_projectie` (idempotente migratie `2026_08_12_t3_retrieval_meta_selectie.sql`, `create or replace function`, signatuur ongewijzigd — eerst in Supabase draaien, dán code-deploy). De niveau-scheiding (telemetrie zichtbaar met `governance_audit_read`, kandidaten-bronidentiteit alleen met `governance_audit_read_sources`) is vastgepind in `audit-meta.sanity.ts`.

**R1.1/R1.2:** `reindex_runs` is **provenance, géén append-only/hash-spoor** — bewuste keuze (index-bouw, geen governance-besluit). Het bestaande append-only auditspoor blijft onaangeroerd; de generieke re-index is bovendien volledig geaudit via `withPlatform` (twee-fasen `attempt`/`result`). De prefix is een AI-call die nooit gebruikersgerichte output produceert (alleen index), dus de chat-AI-interactielogging-eis is hier niet van toepassing; per-fragment `prefix_model` + run-`prompt_versie` (`PREFIX_PROMPT_VERSIE`) is proportioneel. Bekende restschuld (zie [`decisions/0025`](./decisions/0025-rag-structuur-contextueel-reindex.md)): de exacte `SP_PREFIX`-prompttekst wordt niet gehasht in `reindex_runs`, en `embedding_model` staat per chunk maar niet op run-niveau.

## Datamodel / migratie-impact

Eén idempotente migratie `supabase/migrations/2026_05_30_rag_ranking.sql`: `create or replace function zoek_chunks(...)` + `alter table governance_log add column if not exists retrieval_meta jsonb`. Eerst in Supabase draaien, dán code-deploy. `schema.sql` als documentatie bijgewerkt.

**R1.1/R1.2:** [`2026_06_24_rag_structuur_contextueel.sql`](./supabase/migrations/2026_06_24_rag_structuur_contextueel.sql) (+ `_ROLLBACK`) voegt nullable kolommen `structuur_type`, `structuur_label`, `context_prefix`, `prefix_model`, `indexering_versie` toe op `document_chunks`, herbouwt de generated `zoek_vector` als `to_tsvector('dutch', coalesce(context_prefix || ' ', '') || tekst)`, en maakt de `reindex_runs`-provenancetabel met RLS per `fonds_id`. Migratie-eerst, dán code-deploy. `schema.sql` als documentatie bijgewerkt.

**Fase 4 (besluit 0139):** [`2026_08_06_r_retrieval_determinisme_tiebreaker_efsearch.sql`](./supabase/migrations/2026_08_06_r_retrieval_determinisme_tiebreaker_efsearch.sql) (+ `_ROLLBACK`) hercreëert `zoek_chunks_hybride` met een deterministische tiebreaker (`, dc.id`) op de drie sorteringen. (`set hnsw.ef_search = 100` op de functie was beoogd maar wordt door Supabase geweigerd — `ERROR 42501` — en is uitgesteld; ef_search blijft 40.) **Signatuur ongewijzigd**; alleen de body. `security invoker` behouden, de volledige T4/T10 + Increment G-filterset in beide armen letterlijk overgenomen. `drop function` reset de ACL → de migratie herstelt het r7-patroon expliciet (`revoke … from public, anon` + `grant execute … to authenticated, service_role`; bevinding H-18). Handmatig in de SQL-editor te draaien; verificatie via `pg_proc` (tiebreaker + `proconfig`) en de structurele gates in het bestand zelf.

## Kostenraming (R1.2 re-index)

Ruwe orde-grootte — **te verifiëren tegen de actuele tarieven**; de operator ziet vóór de batch een bevestiging en `reindex_runs` legt het werkelijke aantal verwerkte documenten/chunks vast. Per fragment kost de re-index **één Haiku-prefix-call** (input ≈ structuur-venster + systeemprompt, in de orde van enkele honderden tokens; output ≤ ~40 tokens, want één zin van ≤25 woorden) **plus één Mistral-embedding** over de verrijkte tekst. De kosten schalen lineair met het totaal aantal chunks in de bibliotheek (typisch enkele tot tientallen chunks per document). Voor de demo-omvang (tientallen documenten) is dat een eenmalige, lage kostenpost; bij opschaling naar duizenden grote documenten loont het de Haiku-call selectiever in te zetten of te cachen. Embeddings zijn per token aanzienlijk goedkoper dan de Haiku-call en domineren de kosten niet.

## Test / verificatie

- `selecteerChunks` puur en deterministisch — sanity-test op dedup en max-per-document.
- `tsc --noEmit --skipLibCheck` groen.
- Handmatige toetsing online door gebruiker; `retrieval_meta` in `governance_log` als inzicht-instrument.
- **R1.1:** `lib/chunking.sanity.ts` (9 tests groen) borgt de structuur-grenzen — geen samenvloeiing van artikelen, samenhangende/gescheiden definities, ondeelbare markdown-tabel, en geen regressie op lopende tekst. Subagent-reviews (RLS / audit-evidence / code / ontwerp-sync) gedraaid; de code-review-blocker (niet-terminerende backfill bij `mislukt`) is opgelost via het `r1-overgeslagen`-stempel + een stop-bij-`mislukt` in beide client-lussen.
- **Fase 5 (T1):** `rag-select.sanity.ts` uitgebreid met quota-cases (`gecombineerd` forceert ≥1 fonds + ≥1 generiek, `fonds` ≥1 fonds, `generiek` forceert géén fonds, onhaalbaar minimum faalt niet, `perSourceMin` reserveert per bron, `maxPerSource` gerespecteerd, volgorde-behoud) én de non-regressie-borg **nulminima ≡ `selecteerChunks`**; `weeg-bronsoort.sanity.ts` met de afleiding per profiel. Volledige `npm run sanity` groen; `tsc --noEmit --skipLibCheck` exit 0.

## Openstaande risico's

- Zonder vastgelegde evalset is een latere regressie niet objectief terug te meten (bewuste afweging voor dit MVP-stadium).
- `websearch_to_tsquery('dutch', ...)` kan bij heel korte of jargonloze vragen weinig opleveren; de fallback-cascade vangt dit op.
