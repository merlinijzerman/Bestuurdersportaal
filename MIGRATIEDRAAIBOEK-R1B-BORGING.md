# R1b-integriteitsborging (I1b_nn) → Preview en Productie: migratiedraaiboek

**Status: voorstel, lokaal getest. Niets is op Preview of Productie uitgevoerd.** Elke stap hieronder — PR openen, merge naar `preview`, Preview-migratie, promotie naar `main`, Productiemigratie — vraagt een **afzonderlijk, expliciet akkoord** van de opdrachtgever. De HNSW-recall- en kwaliteitspoort van R1b blijft rood en staat los van deze borging; deze migratie activeert geen zoekroute.

Wat de migratie doet: `document_chunks.document_id` en `.bibliotheek` NOT NULL; unique `documenten (id, bibliotheek)`; samengestelde FK `document_chunks (document_id, bibliotheek) → documenten (id, bibliotheek)` NO ACTION, DEFERRABLE INITIALLY DEFERRED. Geen wijziging aan RLS, grants, auth, zoek-RPC's, HNSW-indexen, triggers, vlaggen of app-code. Onderbouwing: `ZOEKPAD-R1B-B0-RAPPORT.md` §15–§19 (onderzoeksbranch `codex/r1b-b0-meting`).

## 0. Bestanden en SHA-256

Controleer vóór elke uitvoering de hash van het bestand dat je plakt (`shasum -a 256 <bestand>`). Wijkt hij af: niet uitvoeren.

| Bestand | SHA-256 |
|---|---|
| `supabase/migrations/2026_10_06_r1b_chunks_bibliotheek_borging.sql` | `f68e7734b33c8cabd529bc0f071fc4aca4671cc2fd6676b3d1f808fdff8196fe` |
| `supabase/rollbacks/2026_10_06_r1b_chunks_bibliotheek_borging_ROLLBACK.sql` | `125c49ce7970a52de88d027f0742530700aefccd536e8568e17edbc0324c8700` |
| `supabase/checks/2026_10_06_r1b_chunks_bibliotheek_borging.sql` (CI/lokaal; schrijft en rolt terug — **niet** op Preview/Productie) | `ce5a5cb104220137087192252d03e60ee43738a7d8fe534f85a4304bf5aa1f00` |
| `supabase/checks/2026_10_06_r1b_bibliotheek_drift_readonly.sql` (read-only) | `4728ac6cc583d6f116f4fc4e5d896a431bdfd25df2d4ab77c5cc745395ac21b6` |

## 1. Lockgedrag en waarom de migratie zo is opgebouwd

PostgreSQL 17, `ALTER TABLE`: `SET NOT NULL` zonder voorbereiding en een directe `ADD FOREIGN KEY` scannen de tabel onder een zware lock. De migratie splitst daarom in afzonderlijke transacties, elk met `lock_timeout = 3s`:

| Stap | Lock (PostgreSQL 17) | Scan | Lokaal gemeten (25.471 chunks, warme cache) |
|---|---|---|---|
| S0 preflight (read-only; fail-closed, géén backfill) | AccessShare | ja (telling + join) | 133 ms |
| S1 `unique (id, bibliotheek)` op documenten | Share + kort AccessExclusive op documenten (~100 rijen) | klein | 7 ms |
| S2 `CHECK (… IS NOT NULL) NOT VALID` (2×) | AccessExclusive, kort | nee | 2 ms |
| S3 `VALIDATE CONSTRAINT` (2×) | ShareUpdateExclusive — lezen en schrijven gaan door | ja | 14 ms |
| S4 `SET NOT NULL` (2×) + hulp-CHECK's weg | AccessExclusive, kort | nee (PG12+: gevalideerde CHECK) | 1,5 ms |
| S5 FK `NOT VALID` | ShareRowExclusive op beide tabellen, kort | nee | 4 ms |
| S6 `VALIDATE CONSTRAINT` (FK) | ShareUpdateExclusive (chunks) + RowShare (documenten) | ja | 16 ms |
| S7 postcheck | — | — | 3 ms |

Bewust **geen** `CREATE INDEX CONCURRENTLY` voor de unique: dat kan niet binnen een transactieblok, en de SQL-editor/Management API biedt een script als één (impliciete) transactie aan. Voor `documenten` (orde 100 rijen) is de korte lock goedkoper dan een extra niet-transactionele stap. Op Productie de absolute tijden en eventuele lockwachttijden vastleggen; `lock_timeout` breekt een stap af in plaats van verkeer op te houden — dan simpelweg opnieuw draaien (idempotent).

## 2. Preflight (read-only, per omgeving)

| # | Wat | Waar | Verwacht / stopregel |
|---:|---|---|---|
| 1 | Doelbevestiging: juiste project-ref (Preview `swviwoytzvaqypieqgji`, Productie `aebwiufuegsiwhwpdrfb`) en `select host from public.tenant_domains where actief` | SQL-editor van het doelproject | Klopt het doel niet: **stop**. |
| 2 | `supabase/checks/2026_10_06_r1b_bibliotheek_drift_readonly.sql` | idem | `ok = true`, `document_id_null = 0`, `bibliotheek_null = 0`, `zonder_document = 0`, `bibliotheek_afwijkend = 0`, `borging_aanwezig = false`. Elke afwijking: **stop** — geen backfill zonder nieuw bewijs en akkoord. |
| 3 | Rust: `select count(*) from pg_stat_activity where state = 'active' and pid <> pg_backend_pid()` en geen lopende ingest (`document_processing_jobs` zonder status `geslaagd/overgeslagen/mislukt`) | idem | Meer dan 1 actieve sessie of een lopende ingest: **wachten**. |
| 4 | Driftmomentopname `supabase/checks/2026_08_19_drift_momentopname.sql` (vóór) | idem | Vastleggen; ter vergelijking ná de migratie (de momentopname bevat geen constraints/NOT NULL; verwacht: ongewijzigd). |

Productietelling van 06-10-2026 (apart geautoriseerd, read-only): 24.662 chunks; 0 NULL `document_id`, 0 NULL `bibliotheek`, 0 wees-chunks, 0 bibliotheekafwijkingen. Dat is **preflightbewijs**, geen migratieakkoord; de telling wordt vlak vóór uitvoering herhaald.

## 3. Migratie

Plak `supabase/migrations/2026_10_06_r1b_chunks_bibliotheek_borging.sql` (hash gecontroleerd) in de SQL-editor van het doelproject. Bij voorkeur stap voor stap (S0 … S7 staan als afzonderlijke `begin … commit`-blokken in het bestand), op een rustig moment.

**Stopregels**
- S0 geeft `P0R08`: er is data die niet past — niets is veranderd; **stop** en rapporteer.
- Een stap faalt op `lock_timeout` (55P03): niets van die stap is doorgevoerd; later opnieuw (idempotent).
- Een `VALIDATE` faalt (23502/23503): de constraint blijft `NOT VALID` staan; **stop**, rollback-script draaien, rapporteren.
- S7 postcheck faalt: **stop**, rollback-script draaien, rapporteren.

## 4. Postcheck

| # | Wat | Verwacht |
|---:|---|---|
| 1 | NOTICE uit S7 | `R1B-BORGING: unique, NOT NULL (2) en FK (deferred, gevalideerd) aanwezig.` |
| 2 | Driftcheck (read-only) | `ok = true`, `borging_aanwezig = true`, `fk_aanwezig_gevalideerd_deferred = true`, `not_null_kolommen = 2`, `hulp_checks = 0` |
| 3 | `supabase/checks/2026_07_31_r1_structurele_gates.sql` | OK A1, A2, B, C, C2, E, F, G, H, D |
| 4 | `supabase/checks/2026_08_20_v3_grants_volledig.sql` (psql vanuit de repo-root) | geen rechtenverschil door deze migratie (zij wijzigt geen grants) |
| 5 | Driftmomentopname (ná) | gelijk aan vóór; anders verklaren vóór verdere stappen |
| 6 | Functioneel (Preview): één herindexering via de beheerpagina en één fonds-herindexering | geen fout; chunks consistent (driftcheck `ok`) |

## 5. Rollback

`supabase/rollbacks/2026_10_06_r1b_chunks_bibliotheek_borging_ROLLBACK.sql` (hash gecontroleerd): verwijdert FK, unique en NOT NULL; **geen dataverlies**; idempotent; elke stap kort AccessExclusive zonder scan, met `lock_timeout`. Daarna de driftcheck: `borging_aanwezig = false`, `ok = true`. Lokaal bewezen: migratie → rollback → catalogus identiek aan vóór → migratie opnieuw.

## 6. Volgorde en goedkeuringspoorten

| Poort | Actie | Akkoord nodig |
|---|---|---|
| P1 | Commit en push van de branch, PR naar `preview` (`gh pr create --base preview`) | ja — opnieuw expliciet |
| P2 | CI groen (incl. de nieuwe suite in `scripts/cross-tenant-ci.sh`) en review | — |
| P3 | Preview: preflight (§2) → migratie (§3) → postcheck (§4) | ja |
| P4 | Merge naar `preview` en Preview-deploy waarnemen | ja |
| P5 | Promotie `preview` → `main` met releasenotitie | ja |
| P6 | Productie: preflight (§2, incl. hertelling) → migratie (§3) → postcheck (§4) | ja, afzonderlijk |

De borging heeft geen app-code nodig en verandert geen gedrag van geldige paden; de volgorde migratie ↔ code-deploy is daardoor niet kritisch. Een eventuele fout in een niet-geïnventariseerd schrijfpad (een chunk zonder `document_id`, of een directe chunk-update die `bibliotheek` laat afwijken) komt na de migratie als 23502/23503 terug — dat is precies de bedoeling, maar vraagt bij P3/P6 een korte controle van de ingest- en herindexeerlogs.
