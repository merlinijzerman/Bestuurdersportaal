# RAG-verbetering — ontwerp

> Status: **Fase 1a + 1b opgeleverd** (2026-05-30). Fase 2/3 zijn ontworpen maar nog niet gebouwd.
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

### Fase 2 — structurele chunking + chunk-metadata

Chunken op documentstructuur (kopjes, tabellen, besluitpunten, bijlagen) en metadata per chunk (documenttype, titel, sectie, datum, `fonds_id`, optioneel `procedure_id`).

### Fase 3 — hybride search (pas na evaluatie)

`pgvector` náást FTS in dezelfde Supabase-database (RLS blijft gelden), gefuseerd via Reciprocal Rank Fusion. **Geen externe vector-database** zonder expliciete architectuurbeslissing — conform guardrail. Levert een vergelijking FTS-only / vector-only / hybride op kwaliteit, kosten, beheerbaarheid, privacy en uitlegbaarheid.

## RLS / security-impact

- Nieuwe functie is `SECURITY INVOKER`; RLS op `document_chunks` en `documenten` blijft de tenant-isolatie afdwingen. Te verifiëren: een gebruiker van fonds A kan via de RPC geen chunks van fonds B ophalen.
- Geen service-role-key; geen RLS-verzwakking.

## Audit-impact

`retrieval_meta` is additief en insert-only. Geen wijziging aan bestaande append-only-garanties.

## Datamodel / migratie-impact

Eén idempotente migratie `supabase/migrations/2026_05_30_rag_ranking.sql`: `create or replace function zoek_chunks(...)` + `alter table governance_log add column if not exists retrieval_meta jsonb`. Eerst in Supabase draaien, dán code-deploy. `schema.sql` als documentatie bijgewerkt.

## Test / verificatie

- `selecteerChunks` puur en deterministisch — sanity-test op dedup en max-per-document.
- `tsc --noEmit --skipLibCheck` groen.
- Handmatige toetsing online door gebruiker; `retrieval_meta` in `governance_log` als inzicht-instrument.

## Openstaande risico's

- Zonder vastgelegde evalset is een latere regressie niet objectief terug te meten (bewuste afweging voor dit MVP-stadium).
- `websearch_to_tsquery('dutch', ...)` kan bij heel korte of jargonloze vragen weinig opleveren; de fallback-cascade vangt dit op.
