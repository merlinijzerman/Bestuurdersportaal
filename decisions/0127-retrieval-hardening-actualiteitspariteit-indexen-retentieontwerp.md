# 0127 — Retrieval-hardening: actualiteitspariteit in de fonds-guard, denorm-indexen en governance_log-retentie als ontwerp

- **Status:** Geaccepteerd
- **Datum:** 2026-08-05
- **Betrokkenen:** Merlin (opdrachtgever), Claude (analyse & uitvoering)

## Context

Een analyse van de retrievalstack (zie [`PvA-vectorless-en-hybride-retrieval.md`](../PvA-vectorless-en-hybride-retrieval.md)) liet zien dat het merendeel van wat doorgaans "vectorless retrieval" heet in dit portaal al bestaat en productie-getest is: Nederlandse full-text search (`zoek_vector`/`zoek_chunks`), hybride RRF (`zoek_chunks_hybride`), metadatafilters vóór ranking, deterministische modus-/bronsoortrouting (`vraagtype.ts`), reranker, jargon-expansie en parent-context. De grootste openstaande hefbomen zijn meetbaarheid (evalset), een expliciete retrieval*methode*-router, hiërarchie/structuurbehoud en enkele hardeningpunten. Uit die laatste categorie zijn drie kleine, goed afgebakende items opgepakt; de grote items blijven op de roadmap uit de PvA.

Randvoorwaarden die meewegen: RLS/tenant-isolatie mag niet verzwakken, het append-only auditspoor is niet-onderhandelbaar, en de bestaande, bewust gekozen retrievalgedragingen (o.a. besluit 0091: `besluitvorming`/`historisch` tonen bewust niet-vastgestelde stukken) mogen niet breken.

## Besluit

1. **B-02 — actualiteitspariteit in de app-guard.** `handhaafFondsdiscipline` (`core/lib/rag.ts`) krijgt **regel 4**: onder `modus='actueel'` valt ook een niet-actueel *fonds*document af (via de al bestaande `zouActueelZijn`). De guard borgde de actuele-bron-definitie tot nu toe alleen als tweede laag voor **generiek** (regel 2+3); regel 4 maakt de twee-lagen-verdediging (besluit 0045) symmetrisch voor fonds. **Modus-bewust en default-off**: alleen actief als de aanroeper `modus='actueel'` meegeeft; de 5 brede retrievalpaden doen dat, de expliciete document-scope- (`haalDocumentChunks`) en reflectiepaden (`haalBevrorenChunks`) niet.
2. **B-03 — denorm-indexen.** Migratie `2026_08_05_c1_retrieval_denorm_indexen.sql` (+ ROLLBACK) voegt vier indexen toe op de gedenormaliseerde filtervelden van `document_chunks`/`documenten`. Op productie gedraaid en in de database geverifieerd (05-08-2026).
3. **B-15 — governance_log-retentie.** Wordt **niet** als delete-/retentiejob gebouwd (dat botst met de append-only-guardrail), maar als **ontwerp**: retentie op de inhoudslaag (`governance_log_inhoud`, inclusief de vraag-afgeleide velden in `retrieval_meta`), niet op het append-only auditskelet. Termijn en techniek zijn een open beslispunt.

## Overwogen alternatieven

- **B-02 blanket statusfilter voor fonds-docs in de guard** — afgewezen: de guard is modus-agnostisch, dus een onvoorwaardelijke filter zou `besluitvorming`/`historisch` (0091) breken. Daarom modus-bewust (alleen `actueel`).
- **B-02 alleen op de query-laag laten** — afgewezen: dan houdt fonds slechts één laag terwijl generiek er twee heeft; de asymmetrie in het defense-in-depth-patroon (0045) blijft dan bestaan.
- **B-06 — jargon-expansie ook op de vector-arm** — overwogen maar **niet** gedaan. Het draait een bewuste, gedocumenteerde ontwerpkeuze terug ("alleen de FTS-arm; de vectorquery blijft de originele vraag") én is technisch onjuist zoals bedacht: `expandeerFtsQuery` produceert een tsquery-string (`… or "wet toekomst pensioenen"`) die geen geldige embeddingtekst is. Het is bovendien een gedragswijziging die eerst gemeten hoort te worden. Verplaatst naar de meet-eerst-track met een apart voorstel (multi-query vectorfusie of natuurlijke-taal-expansie).
- **B-15 purge vs. crypto-shredding vs. anonimiseren** — bewust uitgesteld naar DPO/compliance; alleen het ontwerp is vastgelegd.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd. B-02 (regel 4) kan zichtbaarheid alleen verder inperken, nooit verruimen. B-03 raakt geen policies/grants/functies.
- **Audit/reproduceerbaarheid:** B-02 telt extra droppings in het bestaande `retrieval_meta.fondsdiscipline_gedropt`; in normale werking is dat 0 (de query verwijderde de rijen al) — het bijt alleen als laag 1 zou falen. Zes nieuwe sanity-tests borgen het gedrag.
- **Datamodel/migraties:** B-03 is additief, idempotent en vergt geen reindex. **As-run 05-08-2026** tegen de doeldatabase (project `aebwiufuegsiwhwpdrfb`, branch `main`/PRODUCTION): alle vier indexen bevestigd via `pg_indexes`. `schema.sql` als documentatie bijgewerkt.
- **Gebruikers-/beheerervaring:** geen wijziging.
- **Bewust geaccepteerde schuld / openstaand:** de **B-02-code is nog niet gedeployed** — `tsc --noEmit --skipLibCheck`, `npm run sanity` (de nieuwe regel-4-tests draaien mee) en `bash scripts/cross-tenant-ci.sh` moeten groen zijn, daarna commit/push via GitHub Desktop. **B-15** blijft een open beslispunt (termijn + techniek). **B-06** is uitgesteld, niet afgerond.

## Referenties

- Code: `core/lib/rag.ts` (`handhaafFondsdiscipline` regel 4, `zouActueelZijn`, 5 aangepaste aanroepplekken), `core/lib/rag-fondsdiscipline.sanity.ts` (6 nieuwe tests).
- Migratie: `supabase/migrations/2026_08_05_c1_retrieval_denorm_indexen.sql` (+ `_ROLLBACK.sql`); documentatie in `supabase/schema.sql`.
- Ontwerp: `GOVERNANCE-LOG-RETENTIE-ONTWERP.md` (B-15), `PvA-vectorless-en-hybride-retrieval.md` (volledige analyse + roadmap).
- Eerdere besluiten: [`0045`](./0045-t4-retrieval-fondsfilter-namespace.md) (twee-lagen fonds-discipline), [`0053`](./0053-t10-review-publicatieworkflow-generieke-content.md) (T10 review-verval), [`0073`](./0073-retrieval-reranker-haiku-en-gelijktijdige-activering.md) (R1.3–R1.6), [`0091`](./0091-expliciete-scopebepaling-en-voorstelvragen.md) (voorstelvragen/modus besluitvorming), [`0095`](./0095-hybride-zoeken-aangezet-voor-horizon.md) (hybride aan), [`0104`](./0104-retentie-app-errors-en-snapshots-geen-auditspoor.md) (retentie vs. auditspoor).
