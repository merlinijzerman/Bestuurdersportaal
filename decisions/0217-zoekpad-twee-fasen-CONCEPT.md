# 0217 — Zoekpad in twee fasen: id's + scores eerst, RLS-select daarna (CONCEPT)

- **Status:** CONCEPT — géén besluit; opties en open beslissingen voor de opdrachtgever
- **Datum:** 2026-10-03
- **Betrokkenen:** opdrachtgever (beslisser), Claude Code (meetonderzoek PR 0)

> Dit is uitdrukkelijk een concept. Het kiest niet tussen R1 en R2 en stelt geen
> migratie, grantwijziging of appwijziging voor. De onderbouwing staat in
> `ZOEKPAD-HERONTWERP-PR0-RAPPORT.md`; alle cijfers zijn **lokaal** gemeten
> (PG 17.6, pgvector 0.8.2, Supabase-CLI-stack) en zijn geen productiebewijs.

## Context

`zoek_chunks` en `zoek_chunks_hybride` zijn `SECURITY INVOKER`-SQL-functies die
onder RLS de hele `document_chunks`-tabel scannen. #505 haalde de per-rij-JWT-parse
weg, maar de planvorm bleef: op Productie ~245k buffers per aanroep, warm 0,8–1,0 s,
uitschieters 4–8,6 s tegen een `statement_timeout` van 8 s. Het artikelspoor (#506)
laat zien dat "eerst id's bepalen, dan een id-begrensde RLS-select" wél binnen
budget blijft (p95 82 ms).

PR 0 heeft drie routes gemeten op een productie-achtige fixture (111 documenten,
25.471 chunks, drie fondsen, HNSW + GIN), tekst én vector, met realistische JWT's,
plus een lek-/pariteitsmatrix met acht actoren en negatieve controles.

Randvoorwaarden die meewegen: tenant-isolatie via RLS blijft primair (CLAUDE.md),
`SECURITY DEFINER` is op Supabase alleen veilig met een expliciete ACL
(bevinding H-18), id's en scores zijn gevoelige uitkomst (fase 1 mag nooit een id
van een ander fonds of van een niet-toegelaten document teruggeven), en een
rechtenwijziging raakt bestaande aanroepers (inventaris in het rapport §10).

## Wat de meting vaststelt (samenvatting; details in het rapport)

- **R0 (huidig)** is traag door de **planvorm**, niet door RLS op zich: de
  SQL-functie krijgt een generiek plan (`rows=1`-schatting), een nested loop die
  `documenten` per chunkrij opnieuw scant, en in de hybride variant een exacte
  vectorsort over alle zichtbare embeddings plus een nested loop over de fusie.
  Lokaal: 57k buffers (FTS) en 245–390k buffers (hybride) per aanroep.
- **R1 (SECURITY INVOKER, id-begrensd)** blijft RLS-behoudend en haalt de buffers
  voor FTS terug naar O(zichtbare chunks) (≈ 5,4k voor het grote fonds A, 364 bij
  documentscope) en voor de vectorarm naar ~1–2,5k via HNSW. Grens: `@@` is niet
  leakproof, dus onder RLS is de GIN-index **nooit** bruikbaar; de kosten blijven
  evenredig met de heap-pagina's van alle zichtbare chunks. Voor een groot fonds
  met de hele generieke bibliotheek is dat ~75 % van de tabel.
- **R2 (SECURITY DEFINER, fonds uit `auth.uid()`)** kan de GIN gebruiken (FTS
  strikt ~140 buffers, < 1 ms lokaal) en met tenantzuivere armen (partiële GIN
  generiek + eigen-fonds-arm via `idx_chunks_document`) zijn buffers en timing van
  fonds A invariant onder 5.000 extra rijen van fonds B. De beveiligingsgrens
  verschuift van RLS naar functiecode + EXECUTE-ACL: de lekmatrix is schoon voor
  de zeven actoren die vandaag ook toegang hebben, maar een EXECUTE-grant aan een
  rol zonder SELECT op `documenten` (gemeten met `portaal_beperkt`) **lekt**
  id's en scores — dat is precies het H-18-risico.
- **Scores**: `ts_rank_cd` en RRF-rangen hangen niet van rijen van een ander fonds
  af; vastgelegd met id-/score-vergelijking 0 vs 5.000 B-chunks.
- **Vector**: bij een gedeelde HNSW filtert Postgres **ná** de indexscan; met
  `ef_search = 40` gaan voor fonds A kandidaten verloren (recall@40 0,75 zonder
  B-rijen; met 5.000 B-rijen die dicht bij de vraag liggen **0 van 40**, ook bij
  ef 200). `hnsw.iterative_scan = relaxed_order` (pgvector ≥ 0.8.0, dus ook
  Productie) vult aan tot 40/40 (recall 1,0 in dat geval) tegen 5–10× de
  buffers; bij een ander onderwerp met documentscope is hij duur én matig
  (recall 0,575, 48k buffers). `ef_search` 100–200 is goedkoper zolang het
  andere fonds de buurt niet domineert. Geen fysieke scheiding beloofd.

## Opties (geen keuze)

### R1 — RLS-behoudend, id-begrensd, SECURITY INVOKER

- **Beveiligingsgrens:** ongewijzigd — RLS op `documenten` en `document_chunks`
  blijft de enige tenantgrens; de functie voegt alleen filters toe (defense in
  depth). De negatieve controle "fondsclausule weg" wordt níet rood omdat RLS het
  opvangt (gemeten).
- **Invarianten:** fase 1 ⊆ RLS-zichtbaar ∩ filters (pariteit gemeten voor alle
  acht actoren); scores onafhankelijk van andere fondsen; buffers O(zichtbare
  chunks) voor FTS, O(ef_search) voor vector.
- **Restrisico's:** FTS blijft een filterscan over alle zichtbare chunk-pagina's
  (geen GIN mogelijk onder RLS); groeit de generieke bibliotheek, dan groeit elke
  aanroep mee. De `cross join websearch_to_tsquery`-vorm en `ROWS`-hint zijn nodig
  om het generieke plan goed te houden (gemeten: 70 → 12 ms). De ALL-policy op
  `document_chunks` blijft als tweede subplan meelopen.
- **Vereist:** nieuwe RPC's (migratie), app-aanroepers omzetten naar twee fasen,
  allowlist-grants, structurele gates — buiten PR 0.

### R2 — SECURITY DEFINER-prototype, fonds uit `auth.uid()` → `profielen`

- **Beveiligingsgrens:** functiecode + EXECUTE-ACL. RLS wordt in fase 1 omzeild;
  fase 2 (id-begrensde RLS-select) blijft de harde grens voor tekst en metadata,
  maar id's en scores zijn al uitkomst van fase 1.
- **Invarianten (gemeten):** fase 1 == RLS-zichtbaar ∩ filters voor de actoren
  eigen fonds, ander fonds, zonder profiel (alleen generiek), zonder sub (niets),
  anon (42501); tenantzuivere armen maken buffers/timing/scores van A invariant
  onder B-rijen; alle negatieve controles (p_lek) rood.
- **Restrisico's:** (1) elke rol met EXECUTE krijgt fase-1-uitkomsten ongeacht
  tabelgrants (gemeten lek voor `portaal_beperkt`); (2) `service_role`-aanroepers
  krijgen **niets** (geen `auth.uid()`), terwijl `zoek_chunks` vandaag EXECUTE aan
  `service_role` geeft; (3) de fondsafleiding kopieert de policy-logica — elke
  policywijziging moet ook hier landen (drift-risico, vergelijk 0216 "verplaatst de
  tenantgrens uit RLS naar functiecode"); (4) `postgres` als eigenaar: op Supabase
  niet-superuser maar wel tabeleigenaar (bypasst RLS); (5) scanbewijs,
  review-verval, geldigheid, bronstatus, scope en bronsoort moeten allemaal in
  fase 1 staan (nu wel, en getoetst), maar ze staan dan op twee plekken (functie én
  app `voldoetAanZoekfilters`).
- **Vereist bovenop R1:** H-18-ACL (`revoke … from public, anon`, grant alleen
  aan de rol die werkelijk aanroept), partiële GIN-index generiek, structurele
  gates A–H, V3-allowlist, drift-pins.

### Gemeenschappelijk voor beide

- Contractvorm fase 1: alleen `id`, `document_id`, scores (geen tekst, geen
  metadata). Fase 2 = `document_chunks?id=in.(…)` onder RLS (artikelspoorvorm,
  `core/lib/retrieval/artikeltoelating.ts`).
- Vectorarm: HNSW met `hnsw.iterative_scan = relaxed_order` via `set_config`
  binnen een plpgsql-functie (gemeten werkend als `authenticated`, geen
  superuser nodig); `SET` op de functie werkt lokaal ook voor niet-superuser
  `postgres` — of dit gehost werkt (42501-melding in de T4-migratie) is **niet**
  lokaal te bewijzen.
- Het `plain`-vangnet (`textSearch(…, { type: "plain" })`) gebruikt
  `plainto_tsquery($1)` zonder regconfig ⇒ `default_text_search_config` =
  `pg_catalog.english` ⇒ Nederlandse stammen matchen niet (gemeten: 0 treffers
  voor "pensioneren"). Dat is een bestaande, aparte bevinding.

## Open beslissingen voor de opdrachtgever

1. **R1 of R2** — RLS-behoudend met O(zichtbare chunks), of definer met
   GIN/tenantzuivere armen en een verplaatste beveiligingsgrens?
2. **Rechten** — wie mag fase 1 aanroepen? Vandaag: `authenticated` én
   `service_role`. R2 is voor `service_role` leeg; voor rollen zonder tabelgrants
   (`portaal_beperkt`) is R2 een lek tenzij EXECUTE wordt onthouden. Geen
   voorstel in PR 0; inventaris in het rapport §10.
3. **Scanbewijs in fase 1** — vandaag app-side ná de RPC
   (`filterOpScanbewijs`); in de prototypes in fase 1. Blijft het dubbel (fail-closed
   op twee lagen) of verhuist het?
4. **Vectorkwaliteit** — `ef_search`/iteratieve scan als functie-instelling of
   als sessie-GUC; wel of niet `max_scan_tuples` begrenzen; geen fysieke
   scheiding van indexen beloofd.
5. **Oude RPC's** — na een nieuw zoekpad: `zoek_chunks(_hybride)` laten staan
   (compatibiliteit voor checks/tests) of intrekken (allowlist, drift-pins,
   T4/T10/G20/#500/#505-checks).
6. **`plain`-vangnet** — apart issue: `plfts(dutch)` of verwijderen.

## Referenties

- `ZOEKPAD-HERONTWERP-PR0-RAPPORT.md` (meting, matrix, inventaris, hypothesen)
- `supabase/checks/2026_10_03_pr0_zoekpad_fixture.sql`, `…_b_match.sql`,
  `…_prototypes.sql`, `…_opruimen.sql` (lokaal onderzoek, geen CI)
- `tests/karakterisering/zoekpad-pr0-meting.mjs`, `zoekpad-pr0-tabellen.mjs`
- Besluiten 0139 (tiebreaker), 0216 (#505 InitPlan); issues #500, #505, #506
- `supabase/migrations/2026_08_12_t4_regime_borging.sql` §7 (huidige RPC's)
