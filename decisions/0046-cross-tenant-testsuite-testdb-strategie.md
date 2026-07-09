# 0046 — Cross-tenant testsuite (T5): ephemere test-DB in CI als blokkerende poort

- **Status:** Geaccepteerd (beide validatiepunten gesloten, 2026-07-09)
- **Datum:** 2026-07-09
- **Betrokkenen:** Merlin (akkoord richting), Claude (uitvoering)
- **Nummerhistorie:** oorspronkelijk als `0045` opgesteld; hernummerd naar `0046`
  omdat besluit `0045` al door increment T4 (retrieval-fondsfilter) is bezet.

## Context

Increment **T5** (roadmap multi-tenant T-serie v0.1) bundelt de cross-tenant
testmatrix uit de beslisnotitie *Multi-tenant frontend en modulescheiding v0.4*
**§15** (scenario's T1–T14) tot één geautomatiseerde CI-suite en maakt die
**blokkerend**: een wijziging die een tenant-muur beschadigt wordt geweigerd vóór
merge naar `main`. Doel is isolatie *aantoonbaar en regressiebestendig* maken vóór
de P0-go/no-go (G2, T7) en de onboarding van fonds 2 (besluit
[`0040`](./0040-bridge-ready-pool-standaard-dedicated-isolatie-premium.md)).

Om die muren te toetsen is een **veilige test-database** nodig met de vereiste
Supabase-onderdelen (`auth`-schema, `storage`, `pgvector`) — nooit de
productiedatabase met fondsdata. As-built (T3) draait de RLS-suite
(`supabase/checks/2026_07_08_t3_cross_tenant.sql`) via
`scripts/rls-cross-tenant-test.sh` en de workflow
`.github/workflows/rls-cross-tenant.yml`, maar **non-blocking**: gated op secret
`TEST_DATABASE_URL`, met skip-exit-0 als die ontbreekt (bewust doorgeschoven naar
T5, zie `T3-RLS-CONTROLEKADER.md` §8).

De keuze in dit besluit: **welke test-DB voedt de blokkerende suite.**

## Besluit

**Primair — optie A: Supabase CLI, ephemeer in CI.** De GitHub Actions-runner boot
per run de volledige Supabase-stack (`supabase start`, Docker), past
`supabase/migrations/` toe, draait de suite en gooit alles weg. Elke run start
**schoon en geïsoleerd**: geen gedeelde muteerbare state, geen drift, parallelle
PR's botsen niet, en geen extern secret dat lekt of roteert. De test-DB is per
definitie gelijk aan de migraties — precies de "alles-als-migratie"-invariant die
T5 wil bewijzen en die aansluit op de bron-van-waarheid uit `CLAUDE.md` (migraties
leidend, `schema.sql` volgend).

**Deze suite wordt de blokkerende merge-gate**: de skip-exit-0-vangnet vervalt op
het kritieke pad; een rode test blokkeert de merge (via GitHub-branchprotectie,
zie Gevolgen — operationeel).

**Secundair — optie B behouden als niet-blokkerende fideliteitsrun.** Het bestaande
`TEST_DATABASE_URL`-pad naar een aparte, wegwerpbare gehoste test-branch-DB blijft
bestaan, maar **nachtelijk/handmatig** en **niet-blokkerend**. Doel: gehoste
configuratie vangen die niet in migraties zit (dashboard-instellingen,
storage-policies, rol-setup) — de bekende drift die A per definitie niet ziet.
Dit overlapt met de openstaande live-DB dump-diff-audit (`huidige-status.md` §6).

## Overwogen alternatieven

- **Optie B als primaire, blokkerende poort** — verworpen. Eén gedeelde gehoste
  test-DB heeft **muteerbare state**: een run die halverwege breekt of twee
  parallelle PR's op dezelfde DB geven contaminatie → vals alarm. Voor een
  *blokkerende* poort is flakiness die ongerelateerde PR's tegenhoudt het grootste
  uitvoeringsrisico (v0.4 RS10; raakt de gate-eigenaarvraag T7). B's meerwaarde
  (productie-fideliteit) weegt daar niet tegenop en wordt beter apart afgedekt
  (secundaire run + dump-diff-audit).
- **Alleen de bestaande non-blocking workflow laten staan** — verworpen: dan blijft
  isolatie *aangenomen* i.p.v. afgedwongen; T5 en daarmee G2 zouden niet aantoonbaar
  zijn.
- **Volledige E2E-/UI-testsuite optuigen** — buiten scope. T5 levert uitsluitend de
  §15-matrixsuite; brede CI/test-infra (typecheck-in-CI, ESLint, monitoring) is een
  aparte lijn (`huidige-status.md` §10 punt 4).

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd. T5 **bouwt of hardt geen** isolatielaag —
  het toetst RLS (T3), host-resolver/enforce (T1), auditbron (T2) en RAG-filter
  (T4). Geen policy geraakt.
- **CI/uitrol:** de blokkerende gate vergt (a) een Actions-workflow die
  `supabase start` draait met **gepinde** CLI-/image-versies, en (b) een
  **repo-admin-handeling**: de check in GitHub-branchprotectie als *required*
  markeren. Boot-overhead ~1–3 min per run (cachebaar).
- **Migratie-toepassing (mechanisme).** De repo-migraties heten `2026_05_03_…`
  e.d. — dat is **niet** het 14-cijferige tijdstempelformaat dat de Supabase-CLI-
  migratietracker (`supabase db reset`/`migration up`) verwacht. Om daar niet van
  afhankelijk te zijn past de suite de migraties **zelf toe via `psql`** in
  bestandsnaam-sorteervolgorde (`scripts/testdb-apply-migrations.sh`), ná
  `supabase start` (dat alleen de stack + lege DB levert). Deterministisch,
  spiegelt de bestaande psql-runner (T3), en vermijdt versie-parsingambiguïteit.
  `*_ROLLBACK.sql` en `supabase/checks/` worden uitgesloten.
- **Datamodel/migraties:** geen schemawijziging aan het product. Wél mogelijk
  aanvullende migraties om **nu-nog-handmatige config als migratie vast te leggen**
  (zie validatiepunt 2), zodat optie A representatief is.
- **Beheer (operationeel gevolg):** zodra de suite blokkeert, is een **gate-eigenaar**
  nodig die bij een rode/flaky run triëert (echt lek vs. ruis). Zonder belegging
  belandt elke geblokkeerde PR bij Merlin. Beleggen vóór de poort scherp gaat;
  hangt samen met de open T7-gate-eigenaarvraag.

**Twee validatiepunten (beide gesloten 2026-07-09; waren blokkerend voor "Geaccepteerd" i.p.v. "richting"):**
1. **Versie-pinning.** Optie A test alleen representatief als de CLI-Postgres- en
   `pgvector`-versie matchen met het gehoste project. *Vastgesteld (2026-07-09,
   Merlin):* gehoste Postgres = **major 14** (14.5) en **pgvector 0.8.0** → CLI
   pinnen op `major_version = 14` in `supabase/config.toml` en de `vector`-extensie
   op 0.8.0 in de test-DB. *Validatiepunt 1 afgerond.* *Aandachtspunt:* PG14 is een
   oudere hoofdversie; als het gehoste project later naar 15/17 migreert, moet deze
   pin mee (regressierisico op het testfundament).
2. **Handmatige/gehoste config.** `huidige-status.md` markeert de **storage-policies**
   als handmatig toegepast en `[Te valideren]`, en `schema.sql` loopt achter.
   Config die alleen in het dashboard leeft, bestaat onder A niet → T7
   (storage-download) kan vals-groen/-rood worden. *Bevinding (2026-07-09, code-audit
   migraties):* alle storage-config is als migratie vastgelegd, dus A bouwt ze
   representatief op — bucket `documenten` + policies "documenten storage lezen"/
   "documenten storage schrijven" (`2026_05_03_documenten_inzage_deactivatie.sql`,
   aangescherpt in `2026_06_20e_storage_generiek_readonly.sql`), en bucket
   `documenten-quarantaine` deny-by-default zonder policies
   (`2026_06_24_storage_quarantaine.sql`). Het `[Te valideren]` slaat op de handmatige
   *toepassing* op de live-DB (drift), niet op dashboard-only config; drift wordt door
   de nachtelijke optie-B-run afgedekt. *Bevestigd (2026-07-09, Merlin):*
   Supabase → Storage → Policies toont uitsluitend "documenten storage lezen"/
   "documenten storage schrijven"; geen extra handgeklikte policy. *Validatiepunt 2
   afgerond.*

## Referenties

- Werkopdracht: `02 Architectuur/Bestuurdersportaal - Werkopdracht T5 cross-tenant testsuite in CI.md`
- Roadmap: `02 Architectuur/Bestuurdersportaal - Implementatieroadmap multi-tenant (T-serie) v0.1.md` (T5)
- Beslisnotitie v0.4 §15 (testmatrix), §14 punt 7, §5/§14 (heruitvoeren bij wijziging); besluit [`0040`](./0040-bridge-ready-pool-standaard-dedicated-isolatie-premium.md)
- As-built T3: `T3-RLS-CONTROLEKADER.md` §8 (testkader + T5-grens), `supabase/checks/2026_07_08_t3_cross_tenant.sql`, `scripts/rls-cross-tenant-test.sh`, `.github/workflows/rls-cross-tenant.yml`
- Levert de RAG-scenario's T11–T14: werkopdracht T4 (RAG-tenantdiscipline)
