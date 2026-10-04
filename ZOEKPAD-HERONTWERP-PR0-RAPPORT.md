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

**Lokaal-alleen, fail-closed (reviewbesluit op PR #526).** De vier SQL-bestanden `supabase/checks/2026_10_03_pr0_zoekpad_{fixture,fixture_b_match,prototypes,fixture_opruimen}.sql` dragen bovenaan één byte-identiek guardblok dat vóór de eerste wijzigende opdracht (vóór `begin`/DDL/insert) met `raise exception` weigert tenzij álle drie gelden: (1) geen rij in `public.tenant_domains` met `host like '%bestuurdersportaal.com'` (dezelfde heuristiek als `scripts/drift/genereer.sh`) — en de rol is eigenaar van die tabel of heeft BYPASSRLS, anders zou deny-by-default-RLS de check stil leeg laten; (2) `inet_server_addr()` is null (unix-socket) of loopback/docker/privé (127.0.0.0/8, ::1, 172.16.0.0/12, 10.0.0.0/8, 192.168.0.0/16); (3) de GUC `pr0.lokaal_ok` is exact `'ja'` (psql: `-v pr0_lokaal_ok=ja`, in het bestand naar de GUC vertaald; het meetharnas zet hem zelf). Het blok weigert bovendien als `request.jwt.claims` gezet is (PostgREST-sessie). Reden: de bestanden schrijven/verwijderen fixtures, het prototype bevat bewust een lekvariant met extra EXECUTE-grant, en de weigering van het JS-harnas wordt bij rechtstreeks `psql`-gebruik omzeild. Negatieve test: `tests/karakterisering/zoekpad-pr0-guard.test.mjs` (per bestand: tenant-host-rij ⇒ stop vóór de eerste mutatie; zonder GUC ⇒ stop; met JWT-claims ⇒ stop; positieve controle op `_opruimen.sql`).

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

## 5. Meting — route × variant × JWT

Leeswijzer: per cel (route × JWT × variant) zijn de runs over de hele vragenset gepoold — 20 runs per pilotvraag en 2 per overige vraag (134 runs per cel) in de standen `b0`/`b5000`; in de geknepen container (`cpu025`, 0,25 vCPU, stand b5000-data) 20 per pilotvraag en 1 per regressievraag (91 runs per cel), alleen R0/R1/R2. `buffers` = gemiddelde shared hit+read per aanroep (CPU-onafhankelijk; de maat die naar Productie vertaalt). Tijden zijn `Execution Time` van `EXPLAIN ANALYZE` binnen de transactie, zonder PostgREST/netwerk.

Standen: `b0` = basisfixture (25.471 chunks); `b5000` = + 5.000 B-chunks die álle vraagwoorden bevatten en dicht bij vq1 liggen; `cpu025` = b5000-data met `docker update --cpus 0.25` op de databasecontainer (precedent #499).

Wat de tabellen laten zien:

- **R0** zit op 55–58k buffers (FTS) en 250–475k (hybride) ongeacht de vraag — ook bij nul treffers — omdat het plan de hele tabel aflegt; alleen documentscope (`p_document_ids`) brengt het naar ~10k. In de geknepen container (0,25 vCPU) komt R0 strikt op p50 0,59 s / p95 0,90 s / max 1,21 s, hybride op p50 3,9 s / p95 5,9 s / max 7,9 s en hybride-verslapt (G-12) op p50 8,1 s / p95 10,0 s / max 10,9 s — dus boven de 8 s `statement_timeout`. Dat is de productievorm (0,8–1,0 s warm, uitschieters 4–8,6 s) uit één fixture gereproduceerd. In dezelfde container: R1 strikt p50 87 ms / p95 189 ms / max 282 ms; R1 hybride (HNSW) p50 91 ms / p95 200 ms; R2 strikt p50 2,7 ms / p95 93 ms; R2 hybride p50 4,9 ms / p95 94 ms. De `verslapt`-variant blijft in álle routes zwaar (R1 p50 0,39 s / p95 0,89 s; R2 p50 0,59 s / p95 1,19 s): ts_rank_cd + top-N over ~15k rakende chunks, zie onder.
- **R1** zit op ≈ 5,4k buffers (fonds A: 67 toelaatbare documenten, 19.111 chunks = 75 % van de tabel) en 364 bij documentscope; de vectorarm via HNSW op 1,2–2,5k. Buffers van R1 bewegen níet mee met de 5.000 B-rijen (5416 → 5416): O(zichtbare chunks), niet O(tabel). Grens: de GIN is onbereikbaar onder RLS (`@@` niet leakproof); `nul treffers` kost evenveel als `strikt`.
- **R1p** (plpgsql) ≈ R1 (SQL) na de twee planfixes (`ROWS 100`, `cross join websearch_to_tsquery`); zonder die fixes was de SQL-variant 70–110 ms.
- **R2** (tenantzuiver) ≈ 0,4–1,5 ms / 140–800 buffers voor strikt/frase/actueel, 21–205 voor nul treffers, en de vectorarm 2–2,5k. `verslapt` (OR-keten van 8 termen) raakt ~15k generieke chunks en kost dan 5–6k buffers in álle routes — dat is `ts_rank_cd` + top-N over duizenden rijen, geen RLS-effect. Twee waarden per cel (bv. 383 vs 796 buffers voor strikt) komen door de plpgsql-plancache: na vijf aanroepen een generiek plan met een andere armkeuze; zie H5.
- **R2g** (één gedeelde GIN) is in `b0` even snel als R2, maar beweegt in `b5000` mee met de B-rijen (strikt 403 → 723 buffers, frase 652 → 1.425): de gedeelde index levert B-tuples die daarna worden weggefilterd. R2 tenantzuiver blijft op 801/821 (zelfde generieke plan als JWT 1,5 kB in `b0`).
- **JWT 0,9 vs 1,5 kB** maakt na #505 in geen enkele route verschil (InitPlan: één parse per statement).
- **hybride_iteratief** is in `b0` goedkoop (7,1k resp. 2,5k buffers) en in `b5000` 13,6k resp. 9k: de iteratieve scan moet langs de 5.000 B-kandidaten die dichter bij vq1 liggen. Zie §9.

#### Meting — stand `b0` (ms per aanroep; buffers = shared hit+read)


**JWT ≈ 0,9 kB**

| variant | R0 p50 / p95 / max / buffers | R1 p50 / p95 / max / buffers | R1p p50 / p95 / max / buffers | R2 p50 / p95 / max / buffers | R2g p50 / p95 / max / buffers |
|---|---|---|---|---|---|
| strikt | 73.4 / 157.3 / 374.4 / 57013 | 9.6 / 14.8 / 20.8 / 5416 | 8.4 / 12.5 / 16.7 / 5405 | 0.4 / 15.3 / 19.6 / 383 | 0.9 / 6.3 / 18.2 / 403 |
| verslapt | 108 / 183.4 / 215.2 / 57472 | 38.6 / 92.2 / 99.2 / 5881 | 34.6 / 92.2 / 105.9 / 5870 | 50.9 / 122.6 / 187.5 / 5775 | 35.2 / 94.9 / 105.3 / 6765 |
| frase | 70.6 / 84.5 / 96.5 / 56996 | 9.8 / 13.9 / 25.9 / 5405 | 8.8 / 10 / 13.3 / 5394 | 1.4 / 12.7 / 15.6 / 817 | 0.9 / 4.3 / 5.6 / 652 |
| nul | 70.4 / 88.6 / 118.7 / 56993 | 8.5 / 12.8 / 21.4 / 5402 | 7.9 / 11.4 / 25.1 / 5391 | 1 / 1.2 / 1.3 / 205 | 0.9 / 1 / 1.4 / 21 |
| scope | 10.5 / 13.7 / 16.1 / 9234 | 1 / 3.9 / 7.6 / 364 | 0.7 / 0.9 / 1.1 / 353 | 0.9 / 2.2 / 2.6 / 70 | 0.8 / 3.4 / 5.8 / 389 |
| actueel | 70.1 / 96.1 / 449.9 / 55446 | 8.9 / 13.5 / 26 / 5321 | 9.3 / 16.3 / 61.1 / 5310 | 1.4 / 14.1 / 18.3 / 790 | 0.9 / 5.7 / 8.5 / 403 |
| hybride | 353.5 / 542 / 803.1 / 251328 | 11.5 / 17 / 49.3 / 6619 | 11.4 / 20.8 / 38.2 / 6619 | 3.2 / 19.5 / 25.1 / 1980 | 2.4 / 8.5 / 12 / 1587 |
| hybride_verslapt | 613.1 / 981.1 / 1602.1 / 412248 | 37.6 / 99.1 / 179.2 / 7084 | 37.1 / 93.3 / 97.3 / 7084 | 51.3 / 115.9 / 137.7 / 6972 | 38 / 94.2 / 108.7 / 7949 |
| hybride_hnsw | – | 10.4 / 22.7 / 43.5 / 6624 | 10.8 / 31.8 / 132.4 / 6624 | 3 / 16.9 / 22.8 / 1980 | 2.4 / 7.8 / 11 / 1587 |
| hybride_iteratief | – | 11.1 / 15.6 / 24.6 / 7104 | 11.5 / 20.6 / 56.7 / 7104 | 3.3 / 16.4 / 20.5 / 2460 | 2.7 / 9.2 / 12.3 / 2067 |

**JWT ≈ 1,5 kB**

| variant | R0 p50 / p95 / max / buffers | R1 p50 / p95 / max / buffers | R1p p50 / p95 / max / buffers | R2 p50 / p95 / max / buffers | R2g p50 / p95 / max / buffers |
|---|---|---|---|---|---|
| strikt | 72.2 / 83.1 / 89.7 / 57006 | 8.4 / 11.5 / 19.5 / 5415 | 10.3 / 17.3 / 102.1 / 5404 | 1.5 / 15.7 / 22.8 / 796 | 0.9 / 5.7 / 8.5 / 403 |
| verslapt | 104.7 / 159.4 / 165.9 / 57472 | 36.3 / 92.1 / 97.7 / 5881 | 32 / 96 / 120 / 5870 | 49 / 115.3 / 123.1 / 5788 | 38.4 / 104.5 / 145.1 / 6765 |
| frase | 70.9 / 76.5 / 99.3 / 56996 | 8.9 / 11 / 13 / 5405 | 8.8 / 12.5 / 20 / 5394 | 1.4 / 12.9 / 15.6 / 817 | 0.9 / 4.7 / 6.1 / 652 |
| nul | 69.9 / 75.1 / 83.6 / 56993 | 7.7 / 9.8 / 16 / 5402 | 8.1 / 12.5 / 15.9 / 5391 | 1 / 1.1 / 1.2 / 205 | 0.9 / 1 / 1.1 / 21 |
| scope | 12.1 / 14.6 / 28.2 / 9234 | 0.9 / 1.1 / 1.2 / 364 | 0.7 / 0.9 / 1 / 353 | 0.9 / 2.2 / 2.5 / 70 | 0.9 / 3.4 / 5.3 / 389 |
| actueel | 70.8 / 85.9 / 184.9 / 55446 | 9.1 / 13 / 15 / 5321 | 7.9 / 11.2 / 13 / 5310 | 1.8 / 15.9 / 21.1 / 790 | 0.9 / 5.7 / 8.5 / 403 |
| hybride | 364.7 / 576.9 / 749.3 / 250969 | 10.8 / 17 / 29.5 / 6619 | 10.1 / 13.4 / 29.7 / 6619 | 3.3 / 17.2 / 24.8 / 1980 | 2.5 / 8.8 / 12.2 / 1587 |
| hybride_verslapt | 580.6 / 851.5 / 981.3 / 414385 | 37.3 / 94 / 112.2 / 7084 | 40.5 / 92.4 / 99.9 / 7084 | 48.6 / 113.7 / 120.1 / 6972 | 41.1 / 105.4 / 148 / 7949 |
| hybride_hnsw | – | 10.2 / 13.2 / 15.2 / 6624 | 10.7 / 13.8 / 25.1 / 6624 | 3.1 / 16 / 20.3 / 1980 | 3 / 13.6 / 35.1 / 1587 |
| hybride_iteratief | – | 11.7 / 21.7 / 48.3 / 7104 | 10.4 / 13.7 / 16.1 / 7104 | 3.5 / 17.1 / 25.3 / 2460 | 3.2 / 10.7 / 15.2 / 2067 |

**Per pilotvraag (JWT 0,9 kB), p50 / p95 ms**


_strikt_

| vraag | R0 | R1 | R1p | R2 | R2g |
|---|---|---|---|---|---|
| bedoeling | 71.9 / 75.2 | 9.4 / 10 | 9.6 / 11.1 | 0.5 / 1.8 | 0.9 / 1 |
| norm | 73.3 / 93.4 | 9.9 / 10.9 | 7.7 / 8.6 | 0.3 / 0.5 | 0.9 / 0.9 |
| gecombineerd | 70.6 / 80.1 | 10.7 / 15.9 | 8.2 / 9.2 | 0.3 / 0.4 | 1.5 / 2.9 |
| reglement | 76.1 / 275.3 | 9.6 / 19.7 | 7.4 / 8.4 | 0.3 / 0.4 | 0.9 / 1.1 |

_verslapt_

| vraag | R0 | R1 | R1p | R2 | R2g |
|---|---|---|---|---|---|
| bedoeling | 127.9 / 145.7 | 56.1 / 60.9 | 56.2 / 63.4 | 77.8 / 90.8 | 57.7 / 69 |
| norm | 120.7 / 196.8 | 45.6 / 49.6 | 38.5 / 43.1 | 53.5 / 64.2 | 43.9 / 53.2 |
| gecombineerd | 158.6 / 198.5 | 90.8 / 98.6 | 89.5 / 97.1 | 117.1 / 146.3 | 92 / 104.3 |
| reglement | 96.4 / 111.9 | 31.8 / 35.1 | 31.7 / 36 | 46.4 / 59.5 | 31.3 / 34.8 |

_hybride_

| vraag | R0 | R1 | R1p | R2 | R2g |
|---|---|---|---|---|---|
| bedoeling | 326.5 / 506.5 | 12.2 / 23.1 | 10.4 / 15.4 | 3.3 / 3.7 | 2.4 / 2.8 |
| norm | 409.9 / 537.1 | 11.9 / 15 | 11.4 / 19.4 | 2.9 / 4 | 2.5 / 3 |
| gecombineerd | 374.8 / 414.5 | 10.6 / 12.6 | 12.2 / 14.1 | 3.2 / 4.3 | 2.2 / 2.3 |
| reglement | 281.3 / 414.1 | 10.4 / 11.5 | 11.1 / 13.5 | 2.8 / 3.5 | 2.4 / 2.6 |

_hybride_iteratief_

| vraag | R0 | R1 | R1p | R2 | R2g |
|---|---|---|---|---|---|
| bedoeling | – | 11.1 / 20.5 | 13.2 / 49.3 | 3.5 / 3.7 | 2.7 / 3.4 |
| norm | – | 11.2 / 14.1 | 11.3 / 14.2 | 3.1 / 3.2 | 2.7 / 2.8 |
| gecombineerd | – | 13.1 / 15.9 | 10.8 / 16.6 | 3.4 / 3.5 | 2.4 / 2.5 |
| reglement | – | 10.9 / 11.6 | 10.7 / 11.5 | 3 / 3.1 | 2.6 / 2.9 |

#### Meting — stand `b5000` (ms per aanroep; buffers = shared hit+read)


**JWT ≈ 0,9 kB**

| variant | R0 p50 / p95 / max / buffers | R1 p50 / p95 / max / buffers | R1p p50 / p95 / max / buffers | R2 p50 / p95 / max / buffers | R2g p50 / p95 / max / buffers |
|---|---|---|---|---|---|
| strikt | 75 / 93.1 / 532.1 / 58263 | 8.2 / 10.8 / 18.2 / 5416 | 7.8 / 11.4 / 14.4 / 5405 | 1.5 / 14.1 / 18.5 / 801 | 0.9 / 8.6 / 30.5 / 723 |
| verslapt | 105.6 / 167.6 / 253.3 / 58722 | 35.7 / 92.3 / 116.8 / 5881 | 35 / 89.7 / 94.7 / 5870 | 48.1 / 120 / 149.1 / 5791 | 35.9 / 93 / 114 / 8018 |
| frase | 77.2 / 112.8 / 168.3 / 58246 | 8.7 / 11.7 / 25.8 / 5405 | 8.4 / 10.6 / 18.9 / 5394 | 1.8 / 12.9 / 15.8 / 821 | 2.4 / 7 / 8.9 / 1425 |
| nul | 74 / 90.5 / 106.5 / 58243 | 7.2 / 9.4 / 11.3 / 5402 | 7.1 / 8.7 / 10.8 / 5391 | 1.1 / 1.2 / 1.6 / 205 | 0.9 / 1 / 1.3 / 21 |
| scope | 12.8 / 15.7 / 23.3 / 10484 | 0.8 / 1.1 / 1.4 / 364 | 0.7 / 1 / 1.6 / 353 | 0.9 / 2.5 / 2.8 / 73 | 0.9 / 6.4 / 15.6 / 710 |
| actueel | 71.7 / 82.4 / 107.8 / 56696 | 8.1 / 14.9 / 27.7 / 5321 | 7.6 / 11 / 12.9 / 5310 | 1.4 / 13.8 / 18 / 794 | 0.9 / 6.7 / 10.1 / 723 |
| hybride | 414.7 / 667.8 / 1467.1 / 283626 | 10 / 13.6 / 45.2 / 6618 | 10.2 / 13.6 / 22.2 / 6618 | 3.2 / 17.1 / 24 / 1984 | 2.8 / 11.6 / 26.1 / 1906 |
| hybride_verslapt | 632.9 / 941.4 / 1424.4 / 463100 | 35 / 92.6 / 109.4 / 7083 | 35.1 / 91.9 / 105.7 / 7083 | 50.8 / 109.8 / 157.4 / 6974 | 38.5 / 96.9 / 113.3 / 9202 |
| hybride_hnsw | – | 9.8 / 13.7 / 15.5 / 6623 | 9.9 / 14.5 / 18.7 / 6623 | 3.1 / 16.3 / 20.7 / 1984 | 2.5 / 10.1 / 12.8 / 1906 |
| hybride_iteratief | – | 14.4 / 26.3 / 105.1 / 13593 | 11.9 / 26.5 / 81.5 / 13593 | 8.3 / 28.6 / 86 / 8954 | 6.3 / 22.6 / 110.7 / 8877 |

**JWT ≈ 1,5 kB**

| variant | R0 p50 / p95 / max / buffers | R1 p50 / p95 / max / buffers | R1p p50 / p95 / max / buffers | R2 p50 / p95 / max / buffers | R2g p50 / p95 / max / buffers |
|---|---|---|---|---|---|
| strikt | 73.8 / 86.7 / 113.6 / 58256 | 8 / 11.2 / 26.3 / 5415 | 8.5 / 15 / 38.3 / 5404 | 1.6 / 15.5 / 19.4 / 800 | 1 / 7.4 / 17.9 / 723 |
| verslapt | 106 / 161.3 / 410.7 / 58722 | 33.5 / 91.4 / 117.5 / 5881 | 34.5 / 90.9 / 134.7 / 5870 | 51.1 / 109.5 / 134.1 / 5791 | 37.8 / 87.2 / 95.8 / 8018 |
| frase | 74.7 / 84.9 / 126.5 / 58246 | 8.9 / 12.7 / 21.5 / 5405 | 8.2 / 10 / 19.3 / 5394 | 1.8 / 13.7 / 17.2 / 821 | 2.4 / 7.5 / 10.8 / 1425 |
| nul | 71.5 / 93.6 / 195 / 58243 | 7.6 / 9.7 / 12.9 / 5402 | 7 / 8.6 / 18 / 5391 | 1.1 / 1.2 / 1.6 / 205 | 0.9 / 1 / 1.2 / 21 |
| scope | 12.4 / 14.6 / 22.8 / 10484 | 0.8 / 1.1 / 1.2 / 364 | 0.7 / 1 / 1.4 / 353 | 1 / 3.1 / 7.7 / 73 | 0.9 / 4.2 / 5.8 / 710 |
| actueel | 70.2 / 82.7 / 92.2 / 56696 | 8 / 12.7 / 22.8 / 5321 | 7.5 / 10.7 / 12.8 / 5310 | 1.5 / 15.5 / 21.3 / 794 | 0.9 / 6.8 / 10.2 / 723 |
| hybride | 403.1 / 650.9 / 1122.3 / 278026 | 10 / 13.9 / 24.7 / 6618 | 10.1 / 14.2 / 34.6 / 6618 | 3.1 / 16.6 / 22.1 / 1984 | 2.5 / 10.6 / 22.7 / 1906 |
| hybride_verslapt | 668.1 / 1027.6 / 1088 / 470601 | 33.6 / 92.3 / 98.7 / 7083 | 37.2 / 92.3 / 101.7 / 7083 | 51.3 / 109.3 / 142.3 / 6974 | 44.6 / 98.1 / 110.8 / 9202 |
| hybride_hnsw | – | 9.9 / 12.6 / 15.3 / 6623 | 9.7 / 13.6 / 15.9 / 6623 | 3.3 / 17.6 / 20.9 / 1984 | 2.6 / 10.8 / 15 / 1906 |
| hybride_iteratief | – | 13.4 / 26.4 / 81.4 / 13593 | 12.1 / 26.6 / 81.6 / 13593 | 7.9 / 30.4 / 73.3 / 8954 | 4.5 / 20.6 / 66.9 / 8877 |

**Per pilotvraag (JWT 0,9 kB), p50 / p95 ms**


_strikt_

| vraag | R0 | R1 | R1p | R2 | R2g |
|---|---|---|---|---|---|
| bedoeling | 79.2 / 94.1 | 8.9 / 9.8 | 7.6 / 10.2 | 2.5 / 2.8 | 2.1 / 3.1 |
| norm | 75 / 84 | 8.5 / 10.1 | 7.9 / 9.1 | 1.3 / 1.4 | 0.9 / 1 |
| gecombineerd | 76.8 / 145.9 | 8.3 / 8.8 | 7.6 / 8 | 2 / 2.2 | 0.9 / 1 |
| reglement | 73.2 / 80.1 | 7.7 / 7.9 | 7.7 / 11.3 | 1.4 / 1.4 | 0.9 / 1 |

_verslapt_

| vraag | R0 | R1 | R1p | R2 | R2g |
|---|---|---|---|---|---|
| bedoeling | 124.5 / 208.3 | 55.1 / 64.2 | 54.4 / 61.1 | 73.1 / 97 | 57 / 65.4 |
| norm | 115.6 / 132.5 | 38.2 / 44 | 39.9 / 41.9 | 54.6 / 62.6 | 43.2 / 49.2 |
| gecombineerd | 155.2 / 171.5 | 90.2 / 111.4 | 88 / 94.1 | 116.8 / 134.5 | 87 / 106.7 |
| reglement | 98.9 / 108.6 | 31.4 / 36.3 | 30.7 / 35 | 44.9 / 47.5 | 34.7 / 35.9 |

_hybride_

| vraag | R0 | R1 | R1p | R2 | R2g |
|---|---|---|---|---|---|
| bedoeling | 399.6 / 597.4 | 9.8 / 16.2 | 10.7 / 12 | 3.9 / 4.2 | 5.3 / 9.2 |
| norm | 480.8 / 619.5 | 9.6 / 13.6 | 10 / 10.7 | 2.9 / 3.2 | 2.6 / 3 |
| gecombineerd | 412.6 / 619.7 | 10.9 / 13.2 | 9.9 / 16.9 | 3.3 / 3.6 | 2.6 / 3.2 |
| reglement | 419.9 / 630.6 | 9.8 / 11.3 | 9.8 / 11.1 | 2.8 / 3.3 | 2.9 / 3.4 |

_hybride_iteratief_

| vraag | R0 | R1 | R1p | R2 | R2g |
|---|---|---|---|---|---|
| bedoeling | – | 21.8 / 27.8 | 20.8 / 26.5 | 14.3 / 15.8 | 14.2 / 17.7 |
| norm | – | 11.8 / 16.6 | 10.3 / 11.6 | 3.2 / 3.7 | 2.8 / 4 |
| gecombineerd | – | 9.8 / 10.3 | 9.7 / 10.3 | 3.5 / 3.6 | 2.5 / 2.6 |
| reglement | – | 20.9 / 22.1 | 22.7 / 35.5 | 13.2 / 17.4 | 12.8 / 13.5 |

#### Meting — stand `cpu025` (ms per aanroep; buffers = shared hit+read)


**JWT ≈ 0,9 kB**

| variant | R0 p50 / p95 / max / buffers | R1 p50 / p95 / max / buffers | R2 p50 / p95 / max / buffers |
|---|---|---|---|
| strikt | 594.7 / 895 / 1205.6 / 58258 | 87.4 / 188.6 / 281.6 / 5408 | 2.7 / 93.4 / 184.9 / 690 |
| verslapt | 985.7 / 1593.4 / 1700.6 / 58770 | 393.9 / 892.7 / 1084.4 / 5929 | 589 / 1194.1 / 1395.7 / 5977 |
| frase | 604.6 / 895.6 / 999.4 / 58247 | 94.5 / 190.4 / 298.5 / 5406 | 3.1 / 101.5 / 172.7 / 685 |
| nul | 594.5 / 906 / 1201.4 / 58243 | 90.9 / 179 / 294 / 5402 | 1.4 / 3.2 / 66.6 / 205 |
| scope | 96.4 / 192.3 / 400.5 / 10484 | 1 / 1.4 / 55.1 / 364 | 1 / 44.8 / 66 / 67 |
| actueel | 592.9 / 808.5 / 1013.8 / 56688 | 84.7 / 110.5 / 194.8 / 5313 | 2 / 77.7 / 91.6 / 685 |
| hybride | 3906.8 / 5891.2 / 7903.3 / 267317 | 91.3 / 200.1 / 417.6 / 6613 | 4.9 / 93.7 / 295.8 / 1875 |
| hybride_verslapt | 8088.6 / 10004.9 / 10914.5 / 475178 | 390.1 / 983 / 1093.1 / 7134 | 589.5 / 1191.9 / 1389.3 / 7164 |
| hybride_hnsw | – | 92.6 / 181.5 / 193.9 / 6618 | 4.9 / 94.4 / 173.5 / 1874 |
| hybride_iteratief | – | 107.5 / 391.3 / 1877.8 / 14187 | 86.7 / 205.5 / 376.3 / 9443 |

**JWT ≈ 1,5 kB**

| variant | R0 p50 / p95 / max / buffers | R1 p50 / p95 / max / buffers | R2 p50 / p95 / max / buffers |
|---|---|---|---|
| strikt | 594.7 / 891.1 / 985.5 / 58248 | 87.6 / 173.3 / 190.2 / 5407 | 2.5 / 88.4 / 93.7 / 688 |
| verslapt | 995.5 / 1507.1 / 1707.6 / 58770 | 386.5 / 898.6 / 1207.3 / 5929 | 599.3 / 1277.2 / 1404.8 / 5977 |
| frase | 601.4 / 901.6 / 1010.2 / 58247 | 91.6 / 180.1 / 193.4 / 5406 | 3 / 99.5 / 202.4 / 685 |
| nul | 596.5 / 901.3 / 1104.1 / 58243 | 83.3 / 179.2 / 205.5 / 5402 | 1.4 / 3 / 83.5 / 205 |
| scope | 94.7 / 193.7 / 301.9 / 10484 | 1.1 / 2.2 / 70.5 / 364 | 1.1 / 3 / 56.3 / 67 |
| actueel | 591.9 / 883.2 / 995 / 56688 | 85.3 / 186.9 / 215.2 / 5313 | 2.6 / 84.5 / 113.9 / 685 |
| hybride | 4597.1 / 6881.8 / 7507.9 / 266884 | 93.4 / 198.2 / 310 / 6613 | 5.5 / 87.8 / 116.1 / 1874 |
| hybride_verslapt | 7608.9 / 10186 / 10784.2 / 481522 | 408.7 / 903.6 / 1106.7 / 7134 | 590.3 / 1293.6 / 1485 / 7164 |
| hybride_hnsw | – | 95.4 / 196.3 / 205 / 6618 | 4.6 / 94.9 / 190.3 / 1874 |
| hybride_iteratief | – | 110.1 / 380.2 / 405.7 / 14187 | 76.6 / 294.9 / 513.8 / 9443 |

**Per pilotvraag (JWT 0,9 kB), p50 / p95 ms**


_strikt_

| vraag | R0 | R1 | R2 |
|---|---|---|---|
| bedoeling | 594.7 / 885.8 | 88.4 / 195.2 | 4.2 / 81.9 |
| norm | 580.8 / 889.7 | 80.9 / 96.6 | 2.1 / 64 |
| gecombineerd | 592.3 / 909.8 | 84.4 / 94.6 | 2.8 / 57.7 |
| reglement | 587.4 / 885.6 | 84.7 / 98.9 | 2.3 / 64.9 |

_verslapt_

| vraag | R0 | R1 | R2 |
|---|---|---|---|
| bedoeling | 909 / 1316.5 | 400.6 / 592.1 | 595.2 / 993.6 |
| norm | 888.3 / 1292.9 | 388.1 / 591.4 | 484.2 / 797.2 |
| gecombineerd | 1272.3 / 1690.1 | 708.1 / 998.6 | 1019.9 / 1283 |
| reglement | 808.7 / 1176.6 | 298.2 / 401.7 | 478 / 611.4 |

_hybride_

| vraag | R0 | R1 | R2 |
|---|---|---|---|
| bedoeling | 3197.9 / 4996.6 | 89.1 / 189 | 7.3 / 80.3 |
| norm | 4582.3 / 6473.2 | 96.9 / 184.8 | 4.9 / 75.7 |
| gecombineerd | 3906.8 / 5094.6 | 85.3 / 178.3 | 3.7 / 79.3 |
| reglement | 3693.9 / 5193.4 | 82.6 / 97.7 | 3.7 / 66.1 |

_hybride_iteratief_

| vraag | R0 | R1 | R2 |
|---|---|---|---|
| bedoeling | – | 196.1 / 391.7 | 188.9 / 290.1 |
| norm | – | 92.8 / 177.3 | 4.8 / 75.3 |
| gecombineerd | – | 96.1 / 192.6 | 4.6 / 72.9 |
| reglement | – | 200.7 / 579.9 | 105.3 / 198 |

## 6. Plan-samenvattingen (volledige plannen: `tests/karakterisering/uitvoer/zoekpad-pr0/plannen-{b0,b5000}.txt`)

| Route / variant | Kern van het interne plan (rol `authenticated`, fonds A) |
|---|---|
| R0 `zoek_chunks` strikt | Generiek plan (`$1…$10` als Params, `rows=1`). `Seq Scan document_chunks` met de RLS-subplans (`hashed SubPlan` op `documenten` ×2: select-policy én ALL-policy) → `Nested Loop` met `Seq Scan documenten` **per chunkrij** (loops = 19.771; 444.780 rijen verworpen) → `@@` als **Join Filter** (18.123 verworpen) → `Sort` top-N. 57.726 buffers. |
| idem, lichaam met literals | `Hash Join` chunks ⋈ documenten, `@@` in de scanfilter, 6.976 buffers, 40 ms. Zelfde RLS. ⇒ H1. |
| R0 `zoek_chunks_hybride` | FTS-arm als boven (nested loop per chunkrij). Vectorarm: `Seq Scan document_chunks` + `Sort` op `embedding <=> $2` over 19.351 rijen (TOAST: ~110k buffers) — **geen** `idx_chunks_embedding`. Fusie: `Hash Full Join` → `Nested Loop` met `document_chunks` op `dc.id = coalesce(…)` (760.773 rijen verworpen, ~150k buffers) → `Nested Loop` met `documenten`. Totaal 251–321k buffers. ⇒ H2. |
| R1 `r1_fts` | `Function Scan websearch_to_tsquery` (1 rij) → `Nested Loop` → `Bitmap Heap Scan document_chunks` via `Bitmap Index Scan idx_chunks_document` (19.111 rijen = de toelaatbare documenten) met RLS-subplans en `@@` als filter → `Sort`. 5,4k buffers. Documentscope: 1.268 rijen, 353 buffers. |
| R1 `r1_vec` (hnsw) | `Index Scan idx_chunks_embedding` `Order By embedding <=> $1`, Filter: `document_id = ANY($2)` + RLS-subplans; `Rows Removed by Filter` = verloren kandidaten; `Incremental Sort` voor de `, c.id`-tiebreaker. 1,2–2,4k buffers. |
| R1 `r1_vec` (exact) | `Bitmap Heap Scan idx_chunks_document` → `Sort` over alle zichtbare embeddings: 133k buffers, ~70 ms. (= wat R0 vandaag doet, maar zonder de fusieloop.) |
| R2 `r2_fts` tenantzuiver | Arm generiek: `Bitmap Index Scan idx_pr0_zoek_generiek` (partiële GIN, `@@ $tsq`) → `Nested Loop Semi Join` met `docs`. Arm eigen fonds: `Bitmap Heap Scan` via `idx_chunks_document` (`= ANY`) met `@@` als filter. `Append` → `Sort` top-N. 140–800 buffers. |
| R2g `r2_fts` gedeeld | `Bitmap Index Scan idx_chunks_zoek` → `Hash Semi Join` met `docs`: B-tuples worden gelezen en weggefilterd (buffers bewegen mee met B-rijen). |
| R2 `r2_vec` | Als R1-vectorarm maar zonder RLS-subplans in de filter. |

## 7. Lek-/pariteitsmatrix (fase 1: id's en scores als gevoelige uitkomst)

Model: #505-check — acht actoren (`eigen_fonds_A`, `ander_fonds_B`, `zonder_profiel`, `authenticated_zonder_sub`, `anon`, `anon_met_sub_A`, `service_role`, `portaal_beperkt_A`), JWT 0,9 kB, zeven scenario's (pilot strikt, verslapt, actueel, documentscope, frase, bronsoort fonds-only, algemeen, hybride) met limiet 100.000 (setvergelijking). Per cel: `n/verwacht` waarbij **verwacht** = (de `documenten`-id's die de actor zélf onder RLS ziet — dus met álle effectieve policies, inclusief de ALL-policy) ∩ het filterblok ∩ scanbewijs (R1/R2; R0 kent geen scanbewijs) ∩ `p_fonds_id` (R0/R1), op chunkniveau met `@@` op de `dutch`-tsvector (hybride: elke chunk van een toegelaten document). `buiten_verwachting > 0` = **LEK**; `ontbrekend` = minder dan RLS zou toestaan (geen lek, wel een gedragsverschil).

Uitkomst in beide standen (b0, b5000; in `b0` was het scenario `algemeen` nog een vraag zonder treffers, in `b5000` is dat `dekkingsgraad premie` — vandaar 6 vs 7 gemeten lekcellen voor dezelfde oorzaak):

- **Geen enkel id buiten de verwachting** voor R0, R1 en R2 bij `eigen_fonds_A`, `ander_fonds_B`, `zonder_profiel` (alleen generiek), `authenticated_zonder_sub` (niets), `anon`/`anon_met_sub_A` (42501: geen EXECUTE). R1 en R2 zijn in alle scenario's **setgelijk** aan de verwachting (pariteit), R0 ook (zonder scanbewijs: 240 chunks van de twee scan-randgevallen zitten er bij R0 wél in — de app filtert ze vandaag na de RPC).
- **`service_role`**: R0/R1 geven de volledige (door `p_fonds_id` begrensde) set (BYPASSRLS); R2 geeft **niets** (geen `auth.uid()`): ontbrekend, geen lek.
- **`portaal_beperkt_A`**: R0/R1 ⇒ 42501 (geen EXECUTE resp. geen SELECT op `documenten`); R2 mét EXECUTE ⇒ **LEK**: 18.879 id's + scores van fonds A en generiek voor een rol die de tabel zelf niet mag lezen. Dit is geen fout in de filters maar de aard van `SECURITY DEFINER`: de grens is de ACL (H-18). De prototype-grant aan `portaal_beperkt` staat er bewust om dit te meten.
- **Negatieve controles** (`p_lek` schakelt één voorwaarde uit): fonds, scope, scan (240 buiten), review (300), actief (120), gearchiveerd (120), actueel (360), generiek_published (900), bronstatus (120), bronsoort (13.779) ⇒ **alle rood** voor R2 en R1 — met één gemeten uitzondering: `fonds` in R1 wordt níet rood omdat RLS op `documenten` de fondsgrens al trekt (defense in depth; in het JSON als `rls_dekt`).

#### Lek-/pariteitsmatrix — stand `b0` (lekken: 6)

| actor | route | pilot_strikt | verslapt | actueel | scope | frase | bronsoort_fonds | algemeen | hybride |
|---|---|---|---|---|---|---|---|---|---|
| eigen_fonds_A | R0 | 0/0 ✓ | 19119/19119 ✓ | 18759/18759 ✓ | 1268/1268 ✓ | 9/9 ✓ | 5340/5340 ✓ | 0/0 ✓ | 19351/19351 ✓ |
| eigen_fonds_A | R1 | 0/0 ✓ | 18879/18879 ✓ | 18519/18519 ✓ | 1268/1268 ✓ | 9/9 ✓ | 5100/5100 ✓ | 0/0 ✓ | 19111/19111 ✓ |
| eigen_fonds_A | R2 | 0/0 ✓ | 18879/18879 ✓ | 18519/18519 ✓ | 1268/1268 ✓ | 9/9 ✓ | 5100/5100 ✓ | 0/0 ✓ | 19111/19111 ✓ |
| ander_fonds_B | R0 | 0/0 ✓ | 16899/16899 ✓ | 16899/16899 ✓ | 968/968 ✓ | 9/9 ✓ | 3120/3120 ✓ | 0/0 ✓ | 17131/17131 ✓ |
| ander_fonds_B | R1 | 0/0 ✓ | 16899/16899 ✓ | 16899/16899 ✓ | 968/968 ✓ | 9/9 ✓ | 3120/3120 ✓ | 0/0 ✓ | 17131/17131 ✓ |
| ander_fonds_B | R2 | 0/0 ✓ | 16899/16899 ✓ | 16899/16899 ✓ | 968/968 ✓ | 9/9 ✓ | 3120/3120 ✓ | 0/0 ✓ | 17131/17131 ✓ |
| zonder_profiel | R0 | 0/0 ✓ | 13779/13779 ✓ | 13779/13779 ✓ | 968/968 ✓ | 9/9 ✓ | 0/0 ✓ | 0/0 ✓ | 14011/14011 ✓ |
| zonder_profiel | R1 | 0/0 ✓ | 13779/13779 ✓ | 13779/13779 ✓ | 968/968 ✓ | 9/9 ✓ | 0/0 ✓ | 0/0 ✓ | 14011/14011 ✓ |
| zonder_profiel | R2 | 0/0 ✓ | 13779/13779 ✓ | 13779/13779 ✓ | 968/968 ✓ | 9/9 ✓ | 0/0 ✓ | 0/0 ✓ | 14011/14011 ✓ |
| authenticated_zonder_sub | R0 | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ |
| authenticated_zonder_sub | R1 | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ |
| authenticated_zonder_sub | R2 | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ |
| anon | R0 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 |
| anon | R1 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 |
| anon | R2 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 |
| anon_met_sub_A | R0 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 |
| anon_met_sub_A | R1 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 |
| anon_met_sub_A | R2 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 |
| service_role | R0 | 0/0 ✓ | 19119/19119 ✓ | 18759/18759 ✓ | 1268/1268 ✓ | 9/9 ✓ | 5340/5340 ✓ | 0/0 ✓ | 19351/19351 ✓ |
| service_role | R1 | 0/0 ✓ | 18879/18879 ✓ | 18519/18519 ✓ | 1268/1268 ✓ | 9/9 ✓ | 5100/5100 ✓ | 0/0 ✓ | 19111/19111 ✓ |
| service_role | R2 | 0/0 ✓ | 0/23559 (−23559) | 0/23199 (−23199) | 0/1268 (−1268) | 0/9 (−9) | 0/9780 (−9780) | 0/0 ✓ | 0/23791 (−23791) |
| portaal_beperkt_A | R0 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 |
| portaal_beperkt_A | R1 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 |
| portaal_beperkt_A | R2 | 0/0 ✓ | 18879/0 **LEK 18879** | 18519/0 **LEK 18519** | 1268/0 **LEK 1268** | 9/0 **LEK 9** | 5100/0 **LEK 5100** | 0/0 ✓ | 19111/0 **LEK 19111** |

_Negatieve controles (p_lek) — stand `b0`_

| p_lek | scenario | R1 | R2 |
|---|---|---|---|
| fonds | verslapt | niet rood — RLS dekt | rood (4680 buiten) |
| scope | scope | rood (17611 buiten) | rood (17611 buiten) |
| scan | verslapt | rood (240 buiten) | rood (240 buiten) |
| review | verslapt | rood (300 buiten) | rood (300 buiten) |
| actief | verslapt | rood (120 buiten) | rood (120 buiten) |
| gearchiveerd | verslapt | rood (120 buiten) | rood (120 buiten) |
| actueel | actueel | rood (360 buiten) | rood (360 buiten) |
| generiek_published | verslapt | rood (900 buiten) | rood (900 buiten) |
| bronstatus | actueel | rood (120 buiten) | rood (120 buiten) |
| bronsoort | bronsoort_fonds | rood (13779 buiten) | rood (13779 buiten) |

Bevindingen: `LEK R2 portaal_beperkt_A verslapt: 18879 id's buiten de verwachting`; `LEK R2 portaal_beperkt_A actueel: 18519 id's buiten de verwachting`; `LEK R2 portaal_beperkt_A scope: 1268 id's buiten de verwachting`; `LEK R2 portaal_beperkt_A frase: 9 id's buiten de verwachting`; `LEK R2 portaal_beperkt_A bronsoort_fonds: 5100 id's buiten de verwachting`; `LEK R2 portaal_beperkt_A hybride: 19111 id's buiten de verwachting`

#### Lek-/pariteitsmatrix — stand `b5000` (lekken: 7)

| actor | route | pilot_strikt | verslapt | actueel | scope | frase | bronsoort_fonds | algemeen | hybride |
|---|---|---|---|---|---|---|---|---|---|
| eigen_fonds_A | R0 | 0/0 ✓ | 19119/19119 ✓ | 18759/18759 ✓ | 1268/1268 ✓ | 9/9 ✓ | 5340/5340 ✓ | 3180/3180 ✓ | 19351/19351 ✓ |
| eigen_fonds_A | R1 | 0/0 ✓ | 18879/18879 ✓ | 18519/18519 ✓ | 1268/1268 ✓ | 9/9 ✓ | 5100/5100 ✓ | 3147/3147 ✓ | 19111/19111 ✓ |
| eigen_fonds_A | R2 | 0/0 ✓ | 18879/18879 ✓ | 18519/18519 ✓ | 1268/1268 ✓ | 9/9 ✓ | 5100/5100 ✓ | 3147/3147 ✓ | 19111/19111 ✓ |
| ander_fonds_B | R0 | 5000/5000 ✓ | 21899/21899 ✓ | 21899/21899 ✓ | 968/968 ✓ | 5009/5009 ✓ | 8120/8120 ✓ | 7846/7846 ✓ | 22131/22131 ✓ |
| ander_fonds_B | R1 | 5000/5000 ✓ | 21899/21899 ✓ | 21899/21899 ✓ | 968/968 ✓ | 5009/5009 ✓ | 8120/8120 ✓ | 7846/7846 ✓ | 22131/22131 ✓ |
| ander_fonds_B | R2 | 5000/5000 ✓ | 21899/21899 ✓ | 21899/21899 ✓ | 968/968 ✓ | 5009/5009 ✓ | 8120/8120 ✓ | 7846/7846 ✓ | 22131/22131 ✓ |
| zonder_profiel | R0 | 0/0 ✓ | 13779/13779 ✓ | 13779/13779 ✓ | 968/968 ✓ | 9/9 ✓ | 0/0 ✓ | 2312/2312 ✓ | 14011/14011 ✓ |
| zonder_profiel | R1 | 0/0 ✓ | 13779/13779 ✓ | 13779/13779 ✓ | 968/968 ✓ | 9/9 ✓ | 0/0 ✓ | 2312/2312 ✓ | 14011/14011 ✓ |
| zonder_profiel | R2 | 0/0 ✓ | 13779/13779 ✓ | 13779/13779 ✓ | 968/968 ✓ | 9/9 ✓ | 0/0 ✓ | 2312/2312 ✓ | 14011/14011 ✓ |
| authenticated_zonder_sub | R0 | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ |
| authenticated_zonder_sub | R1 | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ |
| authenticated_zonder_sub | R2 | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ | 0/0 ✓ |
| anon | R0 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 |
| anon | R1 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 |
| anon | R2 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 |
| anon_met_sub_A | R0 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 |
| anon_met_sub_A | R1 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 |
| anon_met_sub_A | R2 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 |
| service_role | R0 | 0/0 ✓ | 19119/19119 ✓ | 18759/18759 ✓ | 1268/1268 ✓ | 9/9 ✓ | 5340/5340 ✓ | 3180/3180 ✓ | 19351/19351 ✓ |
| service_role | R1 | 0/0 ✓ | 18879/18879 ✓ | 18519/18519 ✓ | 1268/1268 ✓ | 9/9 ✓ | 5100/5100 ✓ | 3147/3147 ✓ | 19111/19111 ✓ |
| service_role | R2 | 0/5000 (−5000) | 0/28559 (−28559) | 0/28199 (−28199) | 0/1268 (−1268) | 0/5009 (−5009) | 0/14780 (−14780) | 0/8924 (−8924) | 0/28791 (−28791) |
| portaal_beperkt_A | R0 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 |
| portaal_beperkt_A | R1 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 | fout:42501 |
| portaal_beperkt_A | R2 | 0/0 ✓ | 18879/0 **LEK 18879** | 18519/0 **LEK 18519** | 1268/0 **LEK 1268** | 9/0 **LEK 9** | 5100/0 **LEK 5100** | 3147/0 **LEK 3147** | 19111/0 **LEK 19111** |

_Negatieve controles (p_lek) — stand `b5000`_

| p_lek | scenario | R1 | R2 |
|---|---|---|---|
| fonds | verslapt | niet rood — RLS dekt | rood (9680 buiten) |
| scope | scope | rood (17611 buiten) | rood (17611 buiten) |
| scan | verslapt | rood (240 buiten) | rood (240 buiten) |
| review | verslapt | rood (300 buiten) | rood (300 buiten) |
| actief | verslapt | rood (120 buiten) | rood (120 buiten) |
| gearchiveerd | verslapt | rood (120 buiten) | rood (120 buiten) |
| actueel | actueel | rood (360 buiten) | rood (360 buiten) |
| generiek_published | verslapt | rood (900 buiten) | rood (900 buiten) |
| bronstatus | actueel | rood (120 buiten) | rood (120 buiten) |
| bronsoort | bronsoort_fonds | rood (13779 buiten) | rood (13779 buiten) |

Bevindingen: `LEK R2 portaal_beperkt_A verslapt: 18879 id's buiten de verwachting`; `LEK R2 portaal_beperkt_A actueel: 18519 id's buiten de verwachting`; `LEK R2 portaal_beperkt_A scope: 1268 id's buiten de verwachting`; `LEK R2 portaal_beperkt_A frase: 9 id's buiten de verwachting`; `LEK R2 portaal_beperkt_A bronsoort_fonds: 5100 id's buiten de verwachting`; `LEK R2 portaal_beperkt_A algemeen: 3147 id's buiten de verwachting`; `LEK R2 portaal_beperkt_A hybride: 19111 id's buiten de verwachting`

## 8. Invariantie van fonds A onder rijen van fonds B (0 vs 5.000)

Per scenario en route zijn alle id's én scores van fonds A vastgelegd in `b0` en vergeleken met `b5000` (`invariantie-b5000-vs-b0.json`): **id-sets en scores identiek** voor R0, R1 en R2 in alle acht scenario's (incl. hybride RRF-rangen). `ts_rank_cd` gebruikt geen corpusstatistiek; de RRF-rang hangt alleen van de kandidatenset af en die is per constructie tenantgefilterd. Buffers/timing: R1 en R2 (tenantzuiver) invariant; R0 en R2g bewegen mee (tabel §5).

#### Invariantie fonds A — `b5000` t.o.v. `b0`

| scenario/route | id's b0 | id's nu | id's gelijk | scores gelijk |
|---|---|---|---|---|
| pilot_strikt/R0 | 0 | 0 | ja | ja |
| pilot_strikt/R1 | 0 | 0 | ja | ja |
| pilot_strikt/R2 | 0 | 0 | ja | ja |
| verslapt/R0 | 19119 | 19119 | ja | ja |
| verslapt/R1 | 18879 | 18879 | ja | ja |
| verslapt/R2 | 18879 | 18879 | ja | ja |
| actueel/R0 | 18759 | 18759 | ja | ja |
| actueel/R1 | 18519 | 18519 | ja | ja |
| actueel/R2 | 18519 | 18519 | ja | ja |
| scope/R0 | 1268 | 1268 | ja | ja |
| scope/R1 | 1268 | 1268 | ja | ja |
| scope/R2 | 1268 | 1268 | ja | ja |
| frase/R0 | 9 | 9 | ja | ja |
| frase/R1 | 9 | 9 | ja | ja |
| frase/R2 | 9 | 9 | ja | ja |
| bronsoort_fonds/R0 | 5340 | 5340 | ja | ja |
| bronsoort_fonds/R1 | 5100 | 5100 | ja | ja |
| bronsoort_fonds/R2 | 5100 | 5100 | ja | ja |
| algemeen/R0 | 0 | 0 | ja | ja |
| algemeen/R1 | 0 | 0 | ja | ja |
| algemeen/R2 | 0 | 0 | ja | ja |
| hybride/R0 | 19351 | 19351 | ja | ja |
| hybride/R1 | 19111 | 19111 | ja | ja |
| hybride/R2 | 19111 | 19111 | ja | ja |

## 9. Vector: gedeelde HNSW, filteren ná de indexscan, recall@40

Meting: per fonds (A, B), vectorvraag (vq1 = onderwerp van reglement A/Pensioenwet/B001/C001; vq2), met en zonder documentscope, route R1/R2: `exact` (bitmap op `idx_chunks_document` + sort, de referentie), `planner` (vrije keuze), `hnsw_ef40/100/200` (geforceerde HNSW-geordende scan, filter erna) en `iteratief_ef40` (`hnsw.iterative_scan = relaxed_order`, `max_scan_tuples = 40000`). recall@40 = |variant ∩ exact| / 40; `teruggegeven` < 40 betekent dat de post-filter kandidaten heeft weggegooid.

Bevindingen:

1. **Filtering gebeurt ná de indexscan** (plan: `Index Scan idx_chunks_embedding … Filter: document_id = ANY(…)`, `Rows Removed by Filter`). Met `ef_search = 40` levert de index 40 kandidaten over álle fondsen; wat niet door de filter komt, is weg.
2. **Verlies per fonds, zonder B-rijen (`b0`):** fonds A, hele zichtbare set: 30/40 teruggegeven, recall 0,75; met documentscope (2 documenten): 28/40, 0,70. `ef 100` ⇒ 0,975; `ef 200` ⇒ 1,0; `iteratief` ⇒ 40/40, 0,975 voor ~1,4× de buffers van ef 40.
3. **Met 5.000 B-chunks dicht bij vq1 (`b5000`):** fonds A krijgt **0 van 40** terug met ef 40, 100 én 200 (alle kandidaten zijn B); de iteratieve scan vult aan tot 40/40 met recall 1,0, maar kost 16,8k buffers / 12–15 ms (tegen 1,2k / 1,5 ms) omdat hij langs de 5.000 B-kandidaten moet. Voor fonds B zelf is dezelfde vraag juist goedkoop (recall 0,7 bij ef 40, 1,0 bij ef 100). Voor vq2 (ander onderwerp) is de iteratieve scan níet beter dan ef 200 (0,75 vs 0,95) en met documentscope duur en matig (47,9k buffers, 83 ms, recall 0,575): `relaxed_order` geeft volledigheid in aantal, geen garantie op de juiste 40.
4. **Kosten exacte KNN mét filters** (wat R0 vandaag doet): 133–155k buffers, 67–87 ms lokaal, ongeacht ef — en in de fusie van R0 nog eens de nested loop.
5. **Wat hieruit níet volgt:** een belofte over fysieke scheiding van indexen. De cijfers zeggen: (a) zonder iteratieve scan is een gedeelde HNSW voor een klein fonds naast een groot, qua onderwerp overlappend fonds een recall-risico tot 100 %; (b) `iterative_scan` (0.8.0+) repareert het aantal, niet altijd de kwaliteit, tegen 5–10× buffers in het slechte geval; (c) `ef_search` 100–200 is een goedkope tussenstap als het andere fonds niet domineert; (d) `max_scan_tuples` begrenst de schade. Opties, geen keuze: zie 0217.

#### Vector — stand `b0` (recall@40 t.o.v. exacte KNN mét filters; ms p50; buffers)

| fonds | vq | scope | route | variant | teruggegeven | recall@40 | p50 ms | buffers |
|---|---|---|---|---|---|---|---|---|
| A | vq1 | geen | R1 | exact | 40 | 1 | 67.8 | 133794 |
| A | vq1 | geen | R1 | planner | 30 | 0.75 | 1.4 | 1252 |
| A | vq1 | geen | R1 | hnsw_ef40 | 30 | 0.75 | 1.3 | 1257 |
| A | vq1 | geen | R1 | hnsw_ef100 | 40 | 0.975 | 2.3 | 1949 |
| A | vq1 | geen | R1 | hnsw_ef200 | 40 | 1 | 2.3 | 2398 |
| A | vq1 | geen | R1 | iteratief_ef40 | 40 | 0.975 | 1.6 | 1786 |
| A | vq1 | geen | R2 | exact | 40 | 1 | 68.6 | 133775 |
| A | vq1 | geen | R2 | planner | 30 | 0.75 | 1.5 | 1233 |
| A | vq1 | geen | R2 | hnsw_ef40 | 30 | 0.75 | 1.4 | 1233 |
| A | vq1 | geen | R2 | hnsw_ef100 | 40 | 0.975 | 1.7 | 1925 |
| A | vq1 | geen | R2 | hnsw_ef200 | 40 | 1 | 1.9 | 2374 |
| A | vq1 | geen | R2 | iteratief_ef40 | 40 | 0.975 | 1.6 | 1762 |
| A | vq1 | reglement+pw | R1 | exact | 40 | 1 | 4.2 | 8813 |
| A | vq1 | reglement+pw | R1 | planner | 40 | 1 | 4.1 | 8813 |
| A | vq1 | reglement+pw | R1 | hnsw_ef40 | 28 | 0.7 | 1 | 1241 |
| A | vq1 | reglement+pw | R1 | hnsw_ef100 | 40 | 0.975 | 1.2 | 1947 |
| A | vq1 | reglement+pw | R1 | hnsw_ef200 | 40 | 1 | 1.5 | 2396 |
| A | vq1 | reglement+pw | R1 | iteratief_ef40 | 40 | 0.975 | 1.2 | 1784 |
| A | vq1 | reglement+pw | R2 | exact | 40 | 1 | 4.4 | 8794 |
| A | vq1 | reglement+pw | R2 | planner | 40 | 1 | 4.4 | 8794 |
| A | vq1 | reglement+pw | R2 | hnsw_ef40 | 28 | 0.7 | 1.3 | 1217 |
| A | vq1 | reglement+pw | R2 | hnsw_ef100 | 40 | 0.975 | 1.6 | 1923 |
| A | vq1 | reglement+pw | R2 | hnsw_ef200 | 40 | 1 | 1.8 | 2372 |
| A | vq1 | reglement+pw | R2 | iteratief_ef40 | 40 | 0.975 | 1.6 | 1760 |
| A | vq2 | geen | R1 | exact | 40 | 1 | 78.5 | 133794 |
| A | vq2 | geen | R1 | planner | 38 | 0.7 | 1.8 | 1432 |
| A | vq2 | geen | R1 | hnsw_ef40 | 38 | 0.7 | 1.4 | 1437 |
| A | vq2 | geen | R1 | hnsw_ef100 | 40 | 0.85 | 1.7 | 2237 |
| A | vq2 | geen | R1 | hnsw_ef200 | 40 | 0.95 | 2 | 2914 |
| A | vq2 | geen | R1 | iteratief_ef40 | 40 | 0.75 | 1.6 | 2019 |
| A | vq2 | geen | R2 | exact | 40 | 1 | 65.3 | 133775 |
| A | vq2 | geen | R2 | planner | 38 | 0.7 | 1.5 | 1413 |
| A | vq2 | geen | R2 | hnsw_ef40 | 38 | 0.7 | 1.5 | 1413 |
| A | vq2 | geen | R2 | hnsw_ef100 | 40 | 0.85 | 1.8 | 2213 |
| A | vq2 | geen | R2 | hnsw_ef200 | 40 | 0.95 | 2.1 | 2890 |
| A | vq2 | geen | R2 | iteratief_ef40 | 40 | 0.75 | 1.7 | 1995 |
| A | vq2 | reglement+pw | R1 | exact | 40 | 1 | 6.8 | 8813 |
| A | vq2 | reglement+pw | R1 | planner | 40 | 1 | 5.8 | 8813 |
| A | vq2 | reglement+pw | R1 | hnsw_ef40 | 0 | 0 | 1.2 | 1161 |
| A | vq2 | reglement+pw | R1 | hnsw_ef100 | 0 | 0 | 1.5 | 1998 |
| A | vq2 | reglement+pw | R1 | hnsw_ef200 | 0 | 0 | 1.8 | 2773 |
| A | vq2 | reglement+pw | R1 | iteratief_ef40 | 40 | 0.575 | 80.1 | 47945 |
| A | vq2 | reglement+pw | R2 | exact | 40 | 1 | 5.2 | 8794 |
| A | vq2 | reglement+pw | R2 | planner | 40 | 1 | 5.1 | 8794 |
| A | vq2 | reglement+pw | R2 | hnsw_ef40 | 0 | 0 | 1.4 | 1155 |
| A | vq2 | reglement+pw | R2 | hnsw_ef100 | 0 | 0 | 1.8 | 1992 |
| A | vq2 | reglement+pw | R2 | hnsw_ef200 | 0 | 0 | 2.2 | 2767 |
| A | vq2 | reglement+pw | R2 | iteratief_ef40 | 40 | 0.575 | 85.9 | 47921 |
| B | vq1 | geen | R1 | exact | 40 | 1 | 67.4 | 120594 |
| B | vq1 | geen | R1 | planner | 16 | 0.4 | 1.3 | 1152 |
| B | vq1 | geen | R1 | hnsw_ef40 | 16 | 0.4 | 1.5 | 1154 |
| B | vq1 | geen | R1 | hnsw_ef100 | 40 | 0.975 | 1.7 | 1967 |
| B | vq1 | geen | R1 | hnsw_ef200 | 40 | 1 | 2 | 2414 |
| B | vq1 | geen | R1 | iteratief_ef40 | 40 | 0.975 | 1.7 | 2093 |
| B | vq1 | geen | R2 | exact | 40 | 1 | 61.4 | 120575 |
| B | vq1 | geen | R2 | planner | 16 | 0.4 | 1.4 | 1133 |
| B | vq1 | geen | R2 | hnsw_ef40 | 16 | 0.4 | 1.4 | 1133 |
| B | vq1 | geen | R2 | hnsw_ef100 | 40 | 0.975 | 1.8 | 1946 |
| B | vq1 | geen | R2 | hnsw_ef200 | 40 | 1 | 2.2 | 2393 |
| B | vq1 | geen | R2 | iteratief_ef40 | 40 | 0.975 | 1.9 | 2072 |
| B | vq1 | reglement+pw | R1 | exact | 40 | 1 | 3.3 | 6735 |
| B | vq1 | reglement+pw | R1 | planner | 40 | 1 | 3.3 | 6735 |
| B | vq1 | reglement+pw | R1 | hnsw_ef40 | 14 | 0.35 | 1 | 1142 |
| B | vq1 | reglement+pw | R1 | hnsw_ef100 | 40 | 0.95 | 1.5 | 1983 |
| B | vq1 | reglement+pw | R1 | hnsw_ef200 | 40 | 1 | 1.7 | 2429 |
| B | vq1 | reglement+pw | R1 | iteratief_ef40 | 40 | 0.95 | 1.5 | 2109 |
| B | vq1 | reglement+pw | R2 | exact | 40 | 1 | 3.6 | 6716 |
| B | vq1 | reglement+pw | R2 | planner | 40 | 1 | 7.7 | 6716 |
| B | vq1 | reglement+pw | R2 | hnsw_ef40 | 14 | 0.35 | 3.4 | 1121 |
| B | vq1 | reglement+pw | R2 | hnsw_ef100 | 40 | 0.95 | 4.3 | 1962 |
| B | vq1 | reglement+pw | R2 | hnsw_ef200 | 40 | 1 | 3 | 2408 |
| B | vq1 | reglement+pw | R2 | iteratief_ef40 | 40 | 0.95 | 2.5 | 2088 |
| B | vq2 | geen | R1 | exact | 40 | 1 | 69.4 | 120594 |
| B | vq2 | geen | R1 | planner | 38 | 0.7 | 1.4 | 1432 |
| B | vq2 | geen | R1 | hnsw_ef40 | 38 | 0.7 | 1.4 | 1434 |
| B | vq2 | geen | R1 | hnsw_ef100 | 40 | 0.85 | 1.8 | 2234 |
| B | vq2 | geen | R1 | hnsw_ef200 | 40 | 0.95 | 2.2 | 2911 |
| B | vq2 | geen | R1 | iteratief_ef40 | 40 | 0.75 | 1.8 | 2016 |
| B | vq2 | geen | R2 | exact | 40 | 1 | 62.5 | 120575 |
| B | vq2 | geen | R2 | planner | 38 | 0.7 | 1.6 | 1413 |
| B | vq2 | geen | R2 | hnsw_ef40 | 38 | 0.7 | 1.5 | 1413 |
| B | vq2 | geen | R2 | hnsw_ef100 | 40 | 0.85 | 2 | 2213 |
| B | vq2 | geen | R2 | hnsw_ef200 | 40 | 0.95 | 2.5 | 2890 |
| B | vq2 | geen | R2 | iteratief_ef40 | 40 | 0.75 | 2.2 | 1995 |
| B | vq2 | reglement+pw | R1 | exact | 40 | 1 | 3.4 | 6735 |
| B | vq2 | reglement+pw | R1 | planner | 40 | 1 | 3.3 | 6735 |
| B | vq2 | reglement+pw | R1 | hnsw_ef40 | 0 | 0 | 0.9 | 1161 |
| B | vq2 | reglement+pw | R1 | hnsw_ef100 | 0 | 0 | 1.3 | 1998 |
| B | vq2 | reglement+pw | R1 | hnsw_ef200 | 0 | 0 | 2.3 | 2773 |
| B | vq2 | reglement+pw | R1 | iteratief_ef40 | 40 | 0.625 | 80.7 | 49119 |
| B | vq2 | reglement+pw | R2 | exact | 40 | 1 | 3.9 | 6716 |
| B | vq2 | reglement+pw | R2 | planner | 40 | 1 | 3.8 | 6716 |
| B | vq2 | reglement+pw | R2 | hnsw_ef40 | 0 | 0 | 1.4 | 1155 |
| B | vq2 | reglement+pw | R2 | hnsw_ef100 | 0 | 0 | 1.7 | 1992 |
| B | vq2 | reglement+pw | R2 | hnsw_ef200 | 0 | 0 | 2.1 | 2767 |
| B | vq2 | reglement+pw | R2 | iteratief_ef40 | 40 | 0.625 | 75.1 | 49098 |

#### Vector — stand `b5000` (recall@40 t.o.v. exacte KNN mét filters; ms p50; buffers)

| fonds | vq | scope | route | variant | teruggegeven | recall@40 | p50 ms | buffers |
|---|---|---|---|---|---|---|---|---|
| A | vq1 | geen | R1 | exact | 40 | 1 | 69 | 135044 |
| A | vq1 | geen | R1 | planner | 0 | 0 | 1.3 | 1247 |
| A | vq1 | geen | R1 | hnsw_ef40 | 0 | 0 | 1.3 | 1252 |
| A | vq1 | geen | R1 | hnsw_ef100 | 0 | 0 | 1.9 | 2367 |
| A | vq1 | geen | R1 | hnsw_ef200 | 0 | 0 | 2.5 | 3530 |
| A | vq1 | geen | R1 | iteratief_ef40 | 40 | 1 | 14.5 | 16776 |
| A | vq1 | geen | R2 | exact | 40 | 1 | 74 | 135025 |
| A | vq1 | geen | R2 | planner | 0 | 0 | 1.5 | 1228 |
| A | vq1 | geen | R2 | hnsw_ef40 | 0 | 0 | 1.4 | 1228 |
| A | vq1 | geen | R2 | hnsw_ef100 | 0 | 0 | 1.9 | 2343 |
| A | vq1 | geen | R2 | hnsw_ef200 | 0 | 0 | 2.4 | 3506 |
| A | vq1 | geen | R2 | iteratief_ef40 | 40 | 1 | 12.2 | 16752 |
| A | vq1 | reglement+pw | R1 | exact | 40 | 1 | 4.2 | 8813 |
| A | vq1 | reglement+pw | R1 | planner | 40 | 1 | 4.1 | 8813 |
| A | vq1 | reglement+pw | R1 | hnsw_ef40 | 0 | 0 | 0.9 | 1234 |
| A | vq1 | reglement+pw | R1 | hnsw_ef100 | 0 | 0 | 1.3 | 2349 |
| A | vq1 | reglement+pw | R1 | hnsw_ef200 | 0 | 0 | 1.8 | 3512 |
| A | vq1 | reglement+pw | R1 | iteratief_ef40 | 40 | 1 | 10.9 | 16774 |
| A | vq1 | reglement+pw | R2 | exact | 40 | 1 | 4.5 | 8794 |
| A | vq1 | reglement+pw | R2 | planner | 40 | 1 | 7.9 | 8794 |
| A | vq1 | reglement+pw | R2 | hnsw_ef40 | 0 | 0 | 2.2 | 1228 |
| A | vq1 | reglement+pw | R2 | hnsw_ef100 | 0 | 0 | 2.6 | 2343 |
| A | vq1 | reglement+pw | R2 | hnsw_ef200 | 0 | 0 | 2.4 | 3506 |
| A | vq1 | reglement+pw | R2 | iteratief_ef40 | 40 | 1 | 12.7 | 16750 |
| A | vq2 | geen | R1 | exact | 40 | 1 | 70.1 | 135044 |
| A | vq2 | geen | R1 | planner | 38 | 0.7 | 1.6 | 1433 |
| A | vq2 | geen | R1 | hnsw_ef40 | 38 | 0.7 | 1.4 | 1438 |
| A | vq2 | geen | R1 | hnsw_ef100 | 40 | 0.85 | 1.7 | 2238 |
| A | vq2 | geen | R1 | hnsw_ef200 | 40 | 0.95 | 2 | 2915 |
| A | vq2 | geen | R1 | iteratief_ef40 | 40 | 0.75 | 1.6 | 2020 |
| A | vq2 | geen | R2 | exact | 40 | 1 | 66.6 | 135025 |
| A | vq2 | geen | R2 | planner | 38 | 0.7 | 1.6 | 1414 |
| A | vq2 | geen | R2 | hnsw_ef40 | 38 | 0.7 | 1.5 | 1414 |
| A | vq2 | geen | R2 | hnsw_ef100 | 40 | 0.85 | 1.9 | 2214 |
| A | vq2 | geen | R2 | hnsw_ef200 | 40 | 0.95 | 2.2 | 2891 |
| A | vq2 | geen | R2 | iteratief_ef40 | 40 | 0.75 | 1.8 | 1996 |
| A | vq2 | reglement+pw | R1 | exact | 40 | 1 | 4.2 | 8813 |
| A | vq2 | reglement+pw | R1 | planner | 40 | 1 | 4.2 | 8813 |
| A | vq2 | reglement+pw | R1 | hnsw_ef40 | 0 | 0 | 0.9 | 1162 |
| A | vq2 | reglement+pw | R1 | hnsw_ef100 | 0 | 0 | 1.2 | 1999 |
| A | vq2 | reglement+pw | R1 | hnsw_ef200 | 0 | 0 | 1.5 | 2774 |
| A | vq2 | reglement+pw | R1 | iteratief_ef40 | 40 | 0.575 | 83.3 | 47946 |
| A | vq2 | reglement+pw | R2 | exact | 40 | 1 | 4.9 | 8794 |
| A | vq2 | reglement+pw | R2 | planner | 40 | 1 | 4.5 | 8794 |
| A | vq2 | reglement+pw | R2 | hnsw_ef40 | 0 | 0 | 1.4 | 1156 |
| A | vq2 | reglement+pw | R2 | hnsw_ef100 | 0 | 0 | 1.7 | 1993 |
| A | vq2 | reglement+pw | R2 | hnsw_ef200 | 0 | 0 | 2.1 | 2768 |
| A | vq2 | reglement+pw | R2 | iteratief_ef40 | 40 | 0.575 | 72.9 | 47922 |
| B | vq1 | geen | R1 | exact | 40 | 1 | 87 | 155178 |
| B | vq1 | geen | R1 | planner | 40 | 0.7 | 1.8 | 1510 |
| B | vq1 | geen | R1 | hnsw_ef40 | 40 | 0.7 | 1.5 | 1511 |
| B | vq1 | geen | R1 | hnsw_ef100 | 40 | 1 | 2.3 | 2571 |
| B | vq1 | geen | R1 | hnsw_ef200 | 40 | 1 | 2.5 | 3634 |
| B | vq1 | geen | R1 | iteratief_ef40 | 40 | 0.7 | 1.8 | 2253 |
| B | vq1 | geen | R2 | exact | 40 | 1 | 78.8 | 155159 |
| B | vq1 | geen | R2 | planner | 40 | 0.7 | 1.6 | 1498 |
| B | vq1 | geen | R2 | hnsw_ef40 | 40 | 0.7 | 1.5 | 1498 |
| B | vq1 | geen | R2 | hnsw_ef100 | 40 | 1 | 2 | 2558 |
| B | vq1 | geen | R2 | hnsw_ef200 | 40 | 1 | 2.5 | 3621 |
| B | vq1 | geen | R2 | iteratief_ef40 | 40 | 0.7 | 1.9 | 2240 |
| B | vq1 | reglement+pw | R1 | exact | 40 | 1 | 3.3 | 6735 |
| B | vq1 | reglement+pw | R1 | planner | 40 | 1 | 3.2 | 6735 |
| B | vq1 | reglement+pw | R1 | hnsw_ef40 | 0 | 0 | 0.9 | 1234 |
| B | vq1 | reglement+pw | R1 | hnsw_ef100 | 0 | 0 | 1.3 | 2349 |
| B | vq1 | reglement+pw | R1 | hnsw_ef200 | 0 | 0 | 1.8 | 3512 |
| B | vq1 | reglement+pw | R1 | iteratief_ef40 | 40 | 0.975 | 11.3 | 17097 |
| B | vq1 | reglement+pw | R2 | exact | 40 | 1 | 3.6 | 6716 |
| B | vq1 | reglement+pw | R2 | planner | 40 | 1 | 3.9 | 6716 |
| B | vq1 | reglement+pw | R2 | hnsw_ef40 | 0 | 0 | 1.4 | 1228 |
| B | vq1 | reglement+pw | R2 | hnsw_ef100 | 0 | 0 | 1.9 | 2343 |
| B | vq1 | reglement+pw | R2 | hnsw_ef200 | 0 | 0 | 2.3 | 3506 |
| B | vq1 | reglement+pw | R2 | iteratief_ef40 | 40 | 0.975 | 13.6 | 17075 |
| B | vq2 | geen | R1 | exact | 40 | 1 | 79 | 155178 |
| B | vq2 | geen | R1 | planner | 38 | 0.7 | 1.4 | 1433 |
| B | vq2 | geen | R1 | hnsw_ef40 | 38 | 0.7 | 1.3 | 1436 |
| B | vq2 | geen | R1 | hnsw_ef100 | 40 | 0.85 | 1.6 | 2236 |
| B | vq2 | geen | R1 | hnsw_ef200 | 40 | 0.95 | 1.9 | 2913 |
| B | vq2 | geen | R1 | iteratief_ef40 | 40 | 0.75 | 1.6 | 2018 |
| B | vq2 | geen | R2 | exact | 40 | 1 | 75.2 | 155159 |
| B | vq2 | geen | R2 | planner | 38 | 0.7 | 1.5 | 1414 |
| B | vq2 | geen | R2 | hnsw_ef40 | 38 | 0.7 | 1.5 | 1414 |
| B | vq2 | geen | R2 | hnsw_ef100 | 40 | 0.85 | 1.8 | 2214 |
| B | vq2 | geen | R2 | hnsw_ef200 | 40 | 0.95 | 2.2 | 2891 |
| B | vq2 | geen | R2 | iteratief_ef40 | 40 | 0.75 | 1.9 | 1996 |
| B | vq2 | reglement+pw | R1 | exact | 40 | 1 | 3.8 | 6735 |
| B | vq2 | reglement+pw | R1 | planner | 40 | 1 | 3.5 | 6735 |
| B | vq2 | reglement+pw | R1 | hnsw_ef40 | 0 | 0 | 1 | 1162 |
| B | vq2 | reglement+pw | R1 | hnsw_ef100 | 0 | 0 | 1.4 | 1999 |
| B | vq2 | reglement+pw | R1 | hnsw_ef200 | 0 | 0 | 1.5 | 2774 |
| B | vq2 | reglement+pw | R1 | iteratief_ef40 | 40 | 0.625 | 80.5 | 49121 |
| B | vq2 | reglement+pw | R2 | exact | 40 | 1 | 3.8 | 6716 |
| B | vq2 | reglement+pw | R2 | planner | 40 | 1 | 3.8 | 6716 |
| B | vq2 | reglement+pw | R2 | hnsw_ef40 | 0 | 0 | 1.4 | 1156 |
| B | vq2 | reglement+pw | R2 | hnsw_ef100 | 0 | 0 | 1.9 | 1993 |
| B | vq2 | reglement+pw | R2 | hnsw_ef200 | 0 | 0 | 2.1 | 2768 |
| B | vq2 | reglement+pw | R2 | iteratief_ef40 | 40 | 0.625 | 84.8 | 49099 |

_(De vectormeting in de geknepen container staat in `vector-cpu025.json`: zelfde recall, alleen de tijden schalen.)_

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
- `tests/karakterisering/zoekpad-pr0-meting.mjs` — harnas (fasen `meting`, `plannen`, `lek`, `vector`, `invariantie`, `hypothesen`); `zoekpad-pr0-tabellen.mjs` — tabellen uit de JSON-uitvoer; `zoekpad-pr0-guard.test.mjs` — negatieve test van het lokaal-alleen-guardblok.
- `tests/karakterisering/uitvoer/zoekpad-pr0/` — samenvattingen, lekmatrices, vector-/invariantie-/hypothesen-JSON en `plannen-*.txt`; ruwe runs (`*.jsonl`) blijven lokaal (`.gitignore`).
- `decisions/0217-zoekpad-twee-fasen-CONCEPT.md` — opties, invarianten, restrisico's, open beslissingen.
