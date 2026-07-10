# 0060 — AQLab AQL-3: implementatiekeuzes consistentie, regressie & run-types

- **Status:** Geaccepteerd
- **Datum:** 2026-07-10
- **Betrokkenen:** AI Governance Owner, AI Risk & Compliance Reviewer, Merlin (akkoord 2026-07-10)

## Context

AQL-3 maakt het AI Quality Lab stuurbaar: consistentiemeting (ADR 0056), regressie challenger-vs-baseline met releaseadvies, en de drie run-types (`full_regression` / `subset` / `ad_hoc`) inclusief "opslaan als testcase". Bij de uitvoering in Claude Code moesten enkele implementatiekeuzes worden vastgelegd die niet expliciet in ADR 0056 of het technisch ontwerp stonden. Randvoorwaarden: geen schijnzekerheid richting bestuur, human-in-the-loop, reproduceerbaarheid/audit, RLS ongewijzigd (provider-globaal, geen `fonds_id`).

## Besluit

1. **Geen migratie.** Alle benodigde kolommen bestonden al (`aqlab_runs.aggregatie jsonb`, `baseline_run_id`, `rol`, `soort`, `gewijzigde_as`, `atomair`, `subset_filter`, `selected_test_case_ids`, `promoted_*`, `aqlab_test_cases.consistency_*`). Het consistentie- en regressie-aggregaat blijft JSON in `aqlab_runs.aggregatie` (`consistency[test_case_id|"ad_hoc"]` en `regressie`).
2. **Synchrone in-process ad-hoc consistentietest.** Voor `persist_mode = none` ("alleen tonen") kan de detached cron-worker het resultaat niet terugkoppelen; daarom draait de ad-hoc consistentietest **synchroon in-proces** (`draaiAdHocConsistentieSync`) en toont het resultaat direct. Persist respecteert `persist_mode` strikt: `none` → niets persistent; `metadata_only`/`full_synthetic` → run + outputs + scores + aggregaat. Testcase-runs (full/subset) blijven async via de job-queue; consistentie wordt bij het afronden berekend (`berekenConsistentieVoorRun`).
3. **Conservatieve release_eligible (na governance/code-review).** `release_eligible` vereist niet alleen stabiliteit én correctheid, maar ook dat correctheid **machinaal is getoetst** (`correctheid_gemeten`) en dat de **volledige pass-regel** is gehaald (`volledig_gedraaid`, 3/3 of 5/5). Een gedegradeerde run of een ad-hoc zonder toetsbare checks krijgt `review_required`, nooit een groen vinkje.
4. **Consistentie-doorwerking onafhankelijk van `consistency_required`.** Zodra een consistentie-aggregaat bestaat, weegt het mee in het releaseadvies (`consistent_but_incorrect` en cijfer-/safety-inconsistentie blokkeren altijd) — óók als de testcase niet als `consistency_required` is gemarkeerd. Onder `metadata_only` is de exacte geciteerde bron-set niet vergelijkbaar (`source_stability_exact=false`) → geen automatisch accepteren.
5. **Sanity-bestandslocatie.** De nieuwe sanity-tests staan op `lib/aqlab-*.sanity.ts` (niet `lib/aqlab/*.sanity.ts`), zodat `npm run sanity` (glob `lib/*.sanity.ts`) ze meedraait.

## Overwogen alternatieven

- **Async ad-hoc met tijdelijke show-tabel** — verworpen: zachtere "niets persistent"-garantie en meer bouwwerk dan de synchrone runner.
- **Aparte consistency-tabel** — verworpen: `aqlab_run_outputs` bevat al één rij per iteratie; aggregaat als JSON volstaat (conform ADR 0056).
- **`release_eligible` puur op stabiliteit + correctheid** — verworpen na review: liet gedegradeerde runs en ongetoetste ad-hoc-antwoorden ten onrechte als vrijgeefbaar passeren (schijnzekerheid).

## Gevolgen

- **RLS/tenant:** ongewijzigd (provider-globaal, geen `fonds_id`, service-role achter de platform-wrapper; consistentie-/regressie-UI blijft in de platform-console, niet in de fonds-assurance-view).
- **Audit/reproduceerbaarheid:** regressie- en consistentieberekening loggen naar `aqlab_log` (append-only); regressie-advies is append in `aggregatie` met `berekend_op`. Advies is een voorstel — het formele besluit is AQL-4.
- **Datamodel/migraties:** geen. Aggregaatvelden zijn JSON.
- **Negatief/schuld:** de synchrone ad-hoc runner doet ≤5 LLM-calls in één request (verhoogde `maxDuration`); onder `metadata_only` is bronkeuze-stabiliteit niet exact toetsbaar (bewust gelabeld).

## Referenties

- `decisions/0056-aqlab-consistentie-correctheid-en-stability.md` (leidend).
- Code: `lib/aqlab/consistency.ts`, `lib/aqlab/regression.ts`, `lib/aqlab/regression-core.ts`, `lib/aqlab/run-orchestrator.ts`, `lib/aqlab/promotie.ts`, `lib/aqlab/diff.ts`.
- Sanity: `lib/aqlab-consistency.sanity.ts`, `lib/aqlab-regression.sanity.ts`, `lib/aqlab-diff.sanity.ts`.
- Ontwerp: `ai-quality-lab/AI-QUALITY-LAB-TECHNISCH.md` §7A/§5.6, `ai-quality-lab/AI-QUALITY-LAB-FUNCTIONEEL.md` §scherm 6b/6/4/5a.
