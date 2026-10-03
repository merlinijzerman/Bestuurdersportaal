# Zoekpad-herontwerp — PR 0: lokaal meetonderzoek (R0 / R1 / R2)

**Datum:** 2026-10-03 · **Branch:** `codex/zoekpad-pr0-meting` · **Status:** meetrapport, geen besluit (concept-besluit: `decisions/0217-zoekpad-twee-fasen-CONCEPT.md`)

> Harde grenzen van deze PR: geen migratie, geen enkele query op Preview of Productie, geen wijziging aan het zoekpad in de app, geen keuze voor `SECURITY DEFINER`. Alle prototypes leven in het tijdelijke schema `pr0_proto` op een lokale wegwerpstack en worden met `…_opruimen.sql` verwijderd. Alle cijfers hieronder zijn **lokaal** gemeten; §12 zegt wat daarmee niet bewezen is.

## 1. Kern in tien regels

1. **R0 is traag door de planvorm, niet door RLS op zich.** `zoek_chunks` is een `LANGUAGE sql`-functie; Postgres plant het lichaam **zonder parameterwaarden** (`init_sql_fcache` → `pg_plan_query(…, boundParams = NULL)`), schat `rows=1` voor de chunkscan en kiest een nested loop die `documenten` **per chunkrij** opnieuw scant (19.771 × 111 rijen). Daardoor 57k buffers per FTS-aanroep op 25k chunks (6,9k zou de tabel zijn). De `cross join websearch_to_tsquery` maakt `@@` bovendien een join-filter in plaats van een scanvoorwaarde.
2. **De huidige vectorarm gebruikt de HNSW-index niet.** In `zoek_chunks_hybride` wordt de vectorarm een seq scan + exacte sort over alle zichtbare embeddings (TOAST: ~110k buffers), en de fusie een nested loop over `document_chunks` met 760k verworpen rijen. Totaal 245–390k buffers per aanroep — het productiegetal (~245k) is hiermee lokaal gereproduceerd.
3. **R1 (SECURITY INVOKER, id-begrensd)** brengt FTS naar ~5,4k buffers (fonds A) en 364 (documentscope), de vectorarm naar 1,2–2,4k via HNSW; RLS blijft de enige tenantgrens. Grens: `@@` is niet leakproof, dus onder RLS kan de GIN nooit meedoen — de kosten blijven O(heap-pagina's van zichtbare chunks).
4. **R2 (SECURITY DEFINER-prototype)** gebruikt de GIN: FTS strikt ~140 buffers / < 1 ms lokaal; met tenantzuivere armen zijn buffers, timing en scores van fonds A invariant onder 5.000 extra B-chunks (gemeten 0 vs 5.000).
5. **Lekmatrix (8 actoren × 7 scenario's × R0/R1/R2):** geen enkel id buiten de RLS-zichtbare ∩ gefilterde set voor de actoren die vandaag toegang hebben; alle negatieve controles (`p_lek`) rood. **Eén gemeten lek:** R2 met EXECUTE voor `portaal_beperkt` (rol zónder SELECT op `documenten`) geeft id's/scores terug — de beveiligingsgrens van R2 is de ACL, niet RLS (H-18).
6. **R2 is leeg voor `service_role`** (geen `auth.uid()`), terwijl de huidige RPC's EXECUTE aan `service_role` geven. Geen app-aanroeper gebruikt dat vandaag (§10), wel checks.
7. **Scores** (`ts_rank_cd`, RRF-rang) hangen niet af van rijen van een ander fonds — vastgelegd per id, 0 vs 5.000 B-chunks, voor R0, R1 en R2.
8. **Vector bij een gedeelde HNSW:** filtering gebeurt **ná** de indexscan; met `ef_search = 40` verliest fonds A kandidaten (recall@40 0,75 zonder B-rijen, lager met 5.000 B-rijen dicht bij de vraag); `hnsw.iterative_scan = relaxed_order` (pgvector ≥ 0.8.0, dus ook Productie 0.8.0) herstelt recall naar ≥ 0,975 voor ~1,5× de buffers. Geen fysieke scheiding nodig voor deze cijfers; geen belofte daarover.
9. **GUC-route:** `set_config('hnsw.*', …, true)` werkt als `authenticated` binnen een plpgsql-functie; `CREATE/ALTER FUNCTION … SET hnsw.ef_search` werkt lokaal voor de niet-superuser `postgres`. Of het gehost werkt (42501 in de T4-migratienotitie) is lokaal niet te bewijzen.
10. **Bijvangst (H7):** het `plain`-vangnet (`textSearch(…, { type: "plain" })`) wordt door PostgREST vertaald naar `plainto_tsquery($1)` **zonder** regconfig ⇒ `default_text_search_config = pg_catalog.english` tegen een `dutch`-tsvector ⇒ 0 treffers voor "pensioneren". Het vangnet is voor Nederlandse stammen effectief dood.

## 2. Opzet en grenzen

| Onderdeel | Lokaal | Productie (gegeven) |
|---|---|---|
| Postgres | 17.6 (Supabase-CLI 2.114.0, image `supabase/postgres:17.6.1.158`) | 17 |
| pgvector | 0.8.2 | 0.8.0 (Preview 0.8.2) |
| `postgres`-rol | géén superuser (zoals gehost); `supabase_admin` superuser alleen voor `auto_explain` | géén superuser |
| `default_text_search_config` | `pg_catalog.english` | niet gemeten (Supabase-default is `english`) |
| Policies `documenten`/`document_chunks` | #505-stand (InitPlan), 6 policies incl. ALL-policy | #505 op Preview; Productie na akkoord |
| `statement_timeout` tijdens meting | 120 s (meting), geen 8 s-afkap | 8 s (`authenticated`) |
| CPU | Apple Silicon, ongeknepen; plus `docker update --cpus 0.25` voor de staart | gedeelde Supabase-compute |

Meetmethode (`tests/karakterisering/zoekpad-pr0-meting.mjs`): per run één transactie — `set_config('request.jwt.claims', <claims>, true)`, `set local role <rol>`, `explain (analyze, buffers, format json) select … from <functie>(…)`, rollback. JWT-claimsets zijn byte-voor-byte die van `rls-505-meting.mjs` (0,9 kB en 1,5 kB, GoTrue/Entra-vorm, synthetisch). Interne plannen van de functies zijn met `auto_explain.log_nested_statements` opgevangen (superuser-verbinding, rol `authenticated` via `set local role`), zie `tests/karakterisering/uitvoer/zoekpad-pr0/plannen-*.txt`.

## 3. Fixture (`supabase/checks/2026_10_03_pr0_zoekpad_fixture.sql`)

111 documenten, **25.471 chunks**, `vector(1024)` met HNSW (`idx_chunks_embedding`) en GIN (`idx_chunks_zoek`), drie fondsen:

| Klasse | Documenten | Chunks | Bijzonderheden |
|---|---|---|---|
| generiek | 30 | 14.771 | Pensioenwet 968, MvT 2.738, 2× Besluit 313/312, 22 × 440; plus 4 niet-toelaatbaar: concept, `volgende_review` verlopen, bronstatus historisch, gearchiveerd |
| fonds A | 45 | 5.580 | reglement 300 (hoofdstuk 5 op p. 22–29), 37 × 120; plus 7 randgevallen: concept, gearchiveerd, `actief=false`, zonder scanbewijs, scanbewijs met verkeerde hash, `geldig_tot` verlopen, bronstatus historisch |
| fonds B | 24 (+10 bij `b5000`) | 3.120 (+5.000) | de 5.000 extra chunks bevatten álle vraagwoorden en liggen qua embedding dichter bij vectorvraag vq1 dan elke A-/generieke chunk |
| fonds C | 12 | 1.560 | |

Tekst: Nederlandse woordenschat (domein + de inhoudswoorden van de vragenset), 62 woorden per chunk, `context_prefix` en `structuur_label` als op Productie, versiebewijs (`bestand_hash`, `indexering_versie`) en hash-gebonden `scan_resultaat`. Embeddings hebben **structuur**: 40 onderwerpcentroïden, document → onderwerp (nummer mod 40), chunk = normalize(0,8·onderwerp + 0,6·ruis). Op uniform-random vectoren is HNSW-recall per definitie slecht (gemeten 4/40) en zegt een recallmeting niets; daarom deze vorm. Vragenset: de vier pilotvragen (`artikelspoor-500-keten.mjs`), de 10 regressievragen + C1 (`WERKOPDRACHT-RETRIEVAL-RECALL.md` §A) en 16 algemene, niet-juridische vragen (31 totaal). Varianten per vraag: strikt, verslapt (`bouwTerugvalFtsQuery`, G-12), frase, nul treffers, documentscope (reglement A + Pensioenwet), modus actueel (productiefilterblok: `actueel` + peildatum + bronsoort fonds+generiek), hybride primair, hybride verslapt, hybride met HNSW zonder/met iteratieve scan.

Opbouw duurt ~3 minuten (vectorgeneratie); het bestand **commit** (geen rollback), daarom bewust niet in `scripts/cross-tenant-ci.sh`: te zwaar, niet deterministisch in tijd, en het onderzoekt in plaats van bewaakt. Opruimen: `…_opruimen.sql`.

## 4. Routes en prototypes (`supabase/checks/2026_10_03_pr0_zoekpad_prototypes.sql`)

| Route | Functie | Vorm | Beveiligingsgrens |
|---|---|---|---|
| **R0** | `public.zoek_chunks`, `public.zoek_chunks_hybride` | huidig, `LANGUAGE sql`, SECURITY INVOKER | RLS |
| **R1** | `pr0_proto.r1_fts` (SQL), `r1_fts_plpgsql`, `r1_vec` (plpgsql, dynamische SQL), `r1_hybride` | SECURITY INVOKER; eerst toelaatbare document-id's uit `documenten` (`toelaatbare_documenten`, `ROWS 100`), dan `document_chunks` via `document_id = any(array(…))` (bitmap op `idx_chunks_document`), `@@` als filter; vectorarm `order by embedding <=> q limit k` met `hnsw.iterative_scan` via `set_config` | RLS (functiefilters additief) |
| **R1p** | `r1_fts_plpgsql` | als R1, plan via plpgsql-plancache (H5) | RLS |
| **R2** | `pr0_proto.r2_fts` (plpgsql, tsquery in variabele), `r2_vec`, `r2_hybride` | SECURITY DEFINER; fonds uitsluitend uit `auth.uid()` → `profielen`; zonder `sub` ⇒ niets; **tenantzuivere FTS-armen**: partiële GIN `idx_pr0_zoek_generiek … where bibliotheek = 'generiek'` + eigen-fonds-arm via `idx_chunks_document` | functiecode + EXECUTE-ACL (`revoke … from public, anon`; grant `authenticated`; voor de matrix óók `portaal_beperkt`/`service_role`) |
| **R2g** | `r2_fts(p_arm => 'gedeeld')` | als R2 maar één gedeelde GIN over alle chunks | idem |

Contractvorm fase 1 in alle prototypes: `id`, `document_id`, score(s) — geen tekst, geen metadata. Filters = exact het `zoek_chunks`-filterblok (actief, gearchiveerd, scope, modus actueel/peildatum, bronstatus, bronsoort, fonds, published-only generiek + review-verval) **plus** het WP3-scanbewijs (`bestand_hash ~ sha256 ∧ scan_resultaat.verdict = clean ∧ scan_resultaat.sha256 = bestand_hash`) — dat laatste doet `zoek_chunks` vandaag niet (app-side `filterOpScanbewijs`). `p_lek` schakelt per negatieve controle precies één voorwaarde uit.

Drie planlessen die tijdens het prototypen zijn gemeten en in de bestanden gedocumenteerd staan:

- een set-returning function zonder `ROWS` wordt op 1.000 rijen geschat → hash join met seq scan over alle chunks (110 ms) in plaats van bitmap op `idx_chunks_document` (14 ms);
- in een `LANGUAGE sql`-functie wordt een inline `websearch_to_tsquery('dutch', $1)` in het generieke plan **per rij** opnieuw geparset (70 ms → 9 ms met `cross join websearch_to_tsquery(…)`); in plpgsql hetzelfde via een variabele, die bovendien als Param de GIN-index bruikbaar houdt;
- een plpgsql `return query` cachet na vijf keer een generiek plan dat de planner-GUC's van de aanroep negeert; voor de vectorarm is daarom dynamische SQL (`execute … using`) nodig om `enable_*`/`hnsw.*` per aanroep te laten gelden.

<<TABELLEN>>

## 10. Aanroeper-inventaris `zoek_chunks` / `zoek_chunks_hybride` (geen rechtenvoorstel)

Huidige ACL (migratie `2026_08_12_t4_regime_borging.sql` §7, V3-allowlist regels 474–479): `revoke all … from public, anon; grant execute … to authenticated, service_role`.

| # | Aanroeper | Pad | Rol / client | Wat een rechten- of signatuurwijziging zou breken |
|---|---|---|---|---|
| 1 | `core/lib/rag.ts` `zoekViaFTS` → `supabase.rpc("zoek_chunks")` (strikt + G-12-terugval) | `app/api/chat/route.ts`, `app/api/zoeken/route.ts`, `app/api/vergelijk/route.ts` via `maakSupabaseAdapter` → `zoekRelevanteChunksMetMeta` | gebruikerssessie: `createServerSupabase()` (anon-key + cookie ⇒ PostgREST-rol `authenticated`) | elke verandering aan EXECUTE voor `authenticated` of aan de `returns table`-vorm (`rijNaarChunk`, `ZoekChunkRij`) |
| 2 | `core/lib/rag.ts` `maakHybrideRpc` → `supabase.rpc("zoek_chunks_hybride")` (primair, verslapt G-12, vergelijkmodus) | zelfde drie routes; `voerHybridePogingenUit` | gebruikerssessie (`authenticated`) | idem; `gedeeldeHybrideParams` legt het parameterblok vast (`p_limit`, `p_document_ids`, filters, `p_fonds_id`) |
| 3 | `core/lib/retrieval/artikeltoelating.ts` (#506) | id-begrensde select, **geen** RPC | `authenticated` | spiegelt het filterblok tekstueel; een nieuw filter in fase 1 moet hier mee |
| 4 | `app/api/chat/route.ts` `telNietActueleFondstreffers` e.a. | directe `document_chunks`-selects, geen RPC | `authenticated` | niet geraakt |
| 5 | `tests/karakterisering/artikelspoor-516-gedrag.mjs` | vervangt beide RPC's tijdelijk (57014-injectie), md5-controle op de definitie | `postgres` (lokaal) | elke tekstwijziging van de functies breekt de md5-pin |
| 6 | `tests/karakterisering/rls-505-meting.mjs`, `supabase/checks/2026_10_02_505_releasecheck_productie.sql` | meet `zoek_chunks`/`_hybride` als `authenticated` | `authenticated` (lokaal of `--linked` read-only) | signatuur |
| 7 | `supabase/checks/2026_10_02_505_rls_initplan_tenantpariteit.sql` | matrix 8 actoren incl. `service_role` en `portaal_beperkt` roept `zoek_chunks` aan | `authenticated`, `anon`, `service_role`, `portaal_beperkt` | een EXECUTE-wijziging voor `service_role` of `anon` verandert de verwachte matrix (en de VÓÓR/NA-pariteit) |
| 8 | `supabase/checks/2026_07_08_t4_retrieval_fondsdiscipline.sql`, `2026_06_20g_retrieval_filtering.sql`, `2026_07_10_t10_review_verval.sql`, `2026_09_29_500_artikelspoor.sql` (sectie M), `…_500_artikelspoor_performance.sql` (P2) | gedragsbewijs via `zoek_chunks` als `authenticated` | `authenticated` | signatuur/semantiek; staan allemaal in `scripts/cross-tenant-ci.sh` |
| 9 | `supabase/checks/allowlist-grants.tsv` (474–479), `440-*.generated.*`, `2026_09_23_440_driftinventarisatie*.sql`, `supabase/schema.sql` | catalogus-/grantpins | n.v.t. | elke grant- of signatuurwijziging: allowlist regenereren, drift-/fidelitypins herijken |
| 10 | `tests/cross-tenant/retrieval-census.test.ts` (telt `rpc("zoek_chunks…")` in `rag.ts`), `retrieval-afbreken.test.ts`, `retrieval-g12.test.ts`, `retrieval-500-fasetijden.test.ts` | app-laagtests op de aanroepvorm | n.v.t. | een nieuwe RPC-naam of extra aanroep verandert de census |
| 11 | `scripts/backfill-embeddings.mjs` | schrijft embeddings met service-role | `service_role` (`createPlatformSupabase`-achtig) | roept **geen** zoek-RPC aan |
| — | `ai_gateway`, `portaal_beperkt`, workers (`scanner/`, `app/api/internal/*`), M365/SharePoint-retrieval, `platform/` | — | — | **geen** aanroeper gevonden (`git grep` op `zoek_chunks`, `rpc(`, `document_chunks` in `app core platform scripts scanner tests`); `portaal_beperkt` heeft geen EXECUTE en geen SELECT op `documenten` (gemeten: 42501) |

Conclusie van de inventaris (geen voorstel): de enige productie-aanroepers lopen via de gebruikerssessie (`authenticated`); de `service_role`-grant wordt door geen app-code gebruikt, wel door de #505-matrix als meetpunt. Een route die `service_role` leeg laat (R2) breekt dus geen app-pad, maar wel de verwachting in check 7.

## 11. Hypothesen — uitkomst

De nummering H1–H9 is overgenomen uit de opdracht (het ontwerp zelf staat niet in deze repo); per hypothese staat de toets en de uitkomst.

| # | Hypothese | Toets | Uitkomst |
|---|---|---|---|
| H1 | De buffers van R0 komen door de planvorm (generiek plan, nested loop), niet door de RLS-predicaten | `auto_explain` van het functie-lichaam vs. hetzelfde lichaam met literals als `authenticated` | **Bevestigd.** Lichaam met literals: hash join, 6.976 buffers, 40 ms. Functie: generiek plan, `rows=1`, nested loop `documenten` per chunkrij, 57.726 buffers, 161 ms. Zelfde RLS, zelfde rijen. |
| H2 | De huidige vectorarm filtert ná de top-k (HNSW + post-filter) | `auto_explain` van `zoek_chunks_hybride` | **Weerlegd — en erger:** de vectorarm gebruikt de HNSW helemaal niet: seq scan + exacte sort over alle zichtbare embeddings (~110k buffers), daarna nested loop in de fusie (760k verworpen rijen). Hij filtert dus vóór de top-k, tegen volledige kosten. De `, dc.id`-tiebreaker (0139) is níet de oorzaak: PG17 zet een Incremental Sort op de HNSW-scan (gemeten op een kale query). |
| H3 | Onder SECURITY DEFINER kiest de planner de GIN | plan van `r2_fts` | **Bevestigd** (Bitmap Index Scan op `idx_chunks_zoek`/`idx_pr0_zoek_generiek`), mits de tsquery een Param is (plpgsql-variabele). Onder RLS (R1) nooit: `@@` is niet leakproof. |
| H4 | `hnsw.*` is op Supabase-achtige rechten instelbaar | als `authenticated`: `set local`; als niet-superuser `postgres`: `create function … set hnsw.ef_search`, `alter function … set`; `set_config` in STABLE plpgsql | **Lokaal bevestigd** op alle drie manieren (zie `hypothesen-b0.json`). Gehost niet bewezen (T4-notitie meldt 42501 voor `alter function … set hnsw.ef_search`). |
| H5 | `plan_cache_mode` beïnvloedt de plpgsql-variant | 8 runs `r1_fts_plpgsql` onder `auto`, `force_custom_plan`, `force_generic_plan` | Zie `hypothesen-b0.json` (ms en buffers per run). Daarnaast gemeten: het gecachete generieke plan negeert `enable_*`-knoppen van latere aanroepen (daarom dynamische SQL in de vectorarm), en de SQL-variant krijgt **altijd** een generiek plan. |
| H6 | Iteratieve HNSW-scan levert kandidaten ná de filters (vult aan tot k) | `r1_vec`/`r2_vec` ef 40 vs `iterative_scan = relaxed_order`, t.o.v. exacte KNN mét filters | **Bevestigd:** ef 40 geeft 28–30 van 40 (recall 0,70–0,75); iteratief geeft 40 van 40 (recall ≥ 0,975) voor ~1,5× buffers; ef 200 zonder iteratie haalt 1,0 voor ~2× buffers. |
| H7 | Het `plain`-vangnet gebruikt niet de `dutch`-configuratie | PostgREST-SQL uit `pg_stat_statements` (`zoek_vector=plfts.pensioneren`), `show default_text_search_config`, trefferstelling | **Bevestigd:** `plainto_tsquery($1)` zonder regconfig; default `pg_catalog.english`; 0 treffers voor "pensioneren" tegen `n` met `'dutch'` (cijfers in `hypothesen-b0.json`). |
| H8 | pgvector 0.8.0 (Productie) vs 0.8.2 (lokaal/Preview) verschillen niet voor de gemeten paden | changelog pgvector | **Bevestigd per changelog:** 0.8.0 introduceert de iteratieve scans en de betere kostenschatting bij filters; 0.8.1 (PG18 rc1, `binary_quantize`) en 0.8.2 (buffer-overflow bij parallelle HNSW-build, Windows, EXPLAIN-output PG18) raken de query-paden niet. Gedrag op 0.8.0 is niet lokaal gedraaid. |
| H9 | R1 blijft O(zichtbare chunks); R2 tenantzuiver is invariant onder rijen van een ander fonds | buffers/timing/scores fonds A bij 0 vs 5.000 B-chunks | Zie §8/§9: R1-buffers hangen af van de zichtbare set (niet van B); R2 tenantzuiver invariant; R2g (gedeelde GIN) en R0 bewegen mee met B-rijen. |

## 12. Wat lokaal níet te bewijzen is

- **Absolute tijden en de staart op Supabase-compute.** Lokaal is R0 strikt ~70 ms waar Productie 0,8–1,0 s meet; de geknepen container (0,25 vCPU) geeft een staart-indicatie, geen productiegetal. Buffers zijn de CPU-onafhankelijke maat en die zijn wél reproduceerbaar (R0 hybride ~245–390k lokaal ≈ ~245k productie).
- **Gehoste rechten voor `hnsw.*` op functieniveau** (42501-notitie in T4) en of `postgres` gehost `BYPASSRLS` heeft; lokaal is `postgres` eigenaar (bypasst RLS als eigenaar) en niet-superuser.
- **pgvector 0.8.0-gedrag** (Productie): alleen per changelog beoordeeld, niet gedraaid.
- **Productie-datadistributie**: de fixture benadert aantallen en statusmix, niet de echte tekst- en embeddingverdeling; recall@40-cijfers zijn relatief (t.o.v. exacte KNN op dezelfde data), niet absoluut.
- **De 8 s `statement_timeout`** is in de meting op 120 s gezet om verdelingen te kunnen meten; welke varianten op Productie in 57014 lopen, volgt niet uit dit rapport.
- **De ALL-policy-opsplitsing** (0216) is niet gemeten; beide prototypes lopen onder de huidige zes policies.
- **Fase 2 (de id-begrensde RLS-select)** is niet opnieuw gemeten; het #506-cijfer (p95 82 ms) geldt als gegeven.

## 13. Bestanden

- `supabase/checks/2026_10_03_pr0_zoekpad_fixture.sql`, `…_fixture_b_match.sql`, `…_prototypes.sql`, `…_fixture_opruimen.sql` — lokaal onderzoek, **niet** aangesloten op CI (zwaar, committend, onderzoekend; motivering §3).
- `tests/karakterisering/zoekpad-pr0-meting.mjs` — harnas (fasen `meting`, `plannen`, `lek`, `vector`, `invariantie`, `hypothesen`); `zoekpad-pr0-tabellen.mjs` — tabellen uit de JSON-uitvoer.
- `tests/karakterisering/uitvoer/zoekpad-pr0/` — samenvattingen, lekmatrices, vector-/invariantie-/hypothesen-JSON en `plannen-*.txt`; ruwe runs (`*.jsonl`) blijven lokaal (`.gitignore`).
- `decisions/0217-zoekpad-twee-fasen-CONCEPT.md` — opties, invarianten, restrisico's, open beslissingen.
