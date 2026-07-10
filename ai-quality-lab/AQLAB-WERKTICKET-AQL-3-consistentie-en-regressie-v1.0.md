# Werkopdracht AQL-3 — Consistentie & regressie (AI Output Quality & Governance Lab)

- **Ticket:** AQL-3 (derde van 4 uit `AQLAB-ROADMAP.md`) · **Versie:** v1.0 · **Datum:** 2026-07-10
- **Overdracht:** goedgekeurd in plansessie (Cowork) → uit te voeren in Claude Code, repo-root. Zie `WERKOPDRACHT-TEMPLATE.md` en `decisions/0004`.
- **Werkmodus:** begin in **Plan-modus**. Lever eerst een implementatieplan; wijzig pas ná expliciet akkoord.

---

## Doel & context

Met AQL-2 kan het Lab één run draaien en per output scoren. AQL-3 maakt het Lab **stuurbaar en vergelijkbaar**: het meet **consistentie** (stabiliteit én correctheid, conform **ADR 0056**), berekent **regressie** challenger-vs-baseline met een release-advies, en levert de drie **run-types** (volledige regressie / subset / ad-hoc) inclusief "opslaan als testcase". Dit is de stap van "we kunnen scoren" naar "we kunnen betrouwbaar vergelijken over releases heen en instabiliteit herkennen" — de kern van de bestuurlijke verantwoordingswaarde vóór de assurance-laag (AQL-4).

## Goedgekeurd ontwerp/plan (leidend)

- **Roadmap:** `ai-quality-lab/AQLAB-ROADMAP.md` → AQL-3 (**verwerk ADR 0056 in technisch §7A en functioneel §scherm 6b**).
- **ADR:** `decisions/0056-aqlab-consistentie-correctheid-en-stability.md` — **leidend** voor dit ticket. Consistentie = stabiliteit **én** correctheid; `source_stability` (release-wegend) vs `retrieval_stability` (diagnostisch, niet zelfstandig blokkerend); `consistent_but_incorrect` = blokkerend.
- **Technisch:** `AI-QUALITY-LAB-TECHNISCH.md` — consistentie §7A, `persist_mode` §7B, regressie-service §5.6, run-config/`run_type`/`subset_filter`/`selected_test_case_ids` §2.6, ad-hoc + promotie §2.6b, aggregaat in `aqlab_runs.aggregatie`.
- **Functioneel:** `AI-QUALITY-LAB-FUNCTIONEEL.md` — run-types §2.5, run samenstellen (scherm 3), outputvergelijking (scherm 4), regressierapport/run-overzicht (scherm 6), consistentie-overzicht + Iteraties-tab (scherm 6b), "opslaan als testcase" (scherm 5a), releaseadvieslogica §6.3a/§6.3b.

> Bij twijfel wint de code + `supabase/migrations/`. Verifieer aannames tegen de migraties, `lib/aqlab/*` (uit AQL-1/2) en `lib/aqlab/consistency.ts` vóór je bouwt.

## Entry-criteria (blokkerend — controleren vóór start)

- **AQL-2 afgerond** (DoD groen): generatie-adapter, orchestrator, evaluatie-engine, judge en scorekaart werken; per-iteratie auto-check-uitkomsten worden vastgelegd.
- **`AQLAB_CONSISTENCY_AGGREGATE_FIELDS`** (correctheidsmaten + `retrieval_stability`) staan als gereserveerde code-constante klaar in `lib/aqlab/consistency.ts` (uit AQL-1) — AQL-3 vult de **berekening** in.
- **Baseline beschikbaar**: er is een laatst-vrijgegeven of aanwijsbare productie-variant om als baseline te draaien.

## Scope

**Wel**
- **Consistentiemeting binnen één run** (§7A): een testcase/ad-hoc vraag draait 3 (of 5 bij governance-kritiek/safety) iteraties met **exact dezelfde effectieve instellingen**; aggregaat per testcase in `aqlab_runs.aggregatie.consistency[test_case_id]`. Geen nieuwe tabel (iteraties zijn al rijen in `aqlab_run_outputs`).
- **Implementatie ADR 0056** in `lib/aqlab/consistency.ts`:
  - Stabiliteitsmaten (deterministisch): `gate_stability`, `fact_stability`, `source_stability`, `format_stability`, `score_spread`.
  - **Correctheidsmaten**: `gate_pass_rate`, `fact_correctness_rate`, `source_correctness_rate`, `format_pass_rate`.
  - **`retrieval_stability`** als aparte technische metric náást `source_stability` (diagnostisch; niet zelfstandig release-blokkerend).
  - `consistency_status` incl. `consistent_but_incorrect`; `release_eligible = stabiliteit ✔ EN correctheid ✔ EN geen kritieke/safety-blokkade`.
  - Pass-regel: normaal `≥ 3/3` zonder gate-fout → `consistent`; governance-kritiek/safety → `5/5 passed`. Toegestane variatie (formulering/volgorde/stijl) telt niet; verboden variatie (feit/cijfer/bronkeuze/conclusie, besluit-als-genomen, wisselend juridisch/safety-gedrag) verlaagt de score + vult `consistency_findings`.
- **Regressie-service** (`lib/aqlab/regression.ts`): challenger-vs-baseline per testcase → delta's + `release_advies` in `aqlab_runs.aggregatie`. Werkt alleen als beide varianten volledige effectieve instellingen hebben en (bij subset) dezelfde subset. Consistentie weegt mee in het advies (§5.6): `consistency_required` faalt → geen automatisch accepteren; cijfer-/safety-/bronkeuze-inconsistentie → blokkeren/aanpassen; hoge `quality_score` + lage `consistency_score` ⇒ **niet** automatisch `release_eligible`.
- **Drie run-types** (§2.5) in de run-config (scherm 3): `full_regression` (formeel advies mogelijk, baseline-vs-challenger verplicht), `subset` (indicatief; `subset_filter` + `selected_test_case_ids` reproduceerbaar vastgelegd; security/safety-set apart draaibaar), `ad_hoc` (geen formeel advies). Consistentie aan/uit + iteraties instelbaar per subset/ad-hoc.
- **"Opslaan als testcase"** (scherm 5a / §2.6b): promotie van een ad-hoc vraag naar `aqlab_test_cases` met alle vereiste velden; bron-run `promoted_to_testcase = true` + `promoted_testcase_id`.
- **UI**: run-overzicht + testcase-overzicht (scherm 6, incl. performance/langzaamste testcase), consistentie-overzicht + **Iteraties-tab** met verboden-variatie-markering (scherm 6b), outputvergelijking baseline-vs-challenger met tekst-diff (scherm 4).
- **`persist_mode`** volledig gerespecteerd bij consistentietests (bij `none` niets persistent — alleen tonen).

**Niet** (bewust later)
- **Vrijgavebesluit** in `aqlab_release_decisions`, **assurance-view** voor het fonds, **auditexport** (**AQL-4**). AQL-3 berekent het *advies*; het formele *besluit* is AQL-4.
- Fonds-specifieke runs / `fonds_id`-scoped tabellen.
- Multi-model-orchestratie, meer dan één challenger tegen één baseline (MVP: max. 1), CI/CD als merge-gate.

## Relevante bestanden / modules (verifiëren tegen echte code)

- `lib/aqlab/consistency.ts` (ADR 0056-berekening), `lib/aqlab/regression.ts` (nieuw), `lib/aqlab/run-orchestrator.ts` (iteraties + `persist_mode`), `lib/aqlab/evaluation-engine.ts` (correctheidsinput), `lib/aqlab/checks/*.sanity.ts`.
- Consistentie-config + aggregaatvelden: `aqlab_runs.aggregatie`, `aqlab_test_cases.consistency_required`/`consistency_iterations`.
- Run-config-API + platform-console UI (scherm 3/4/6/6b/5a).
- Sanity-tests voor de deterministische maten: `lib/aqlab/consistency.sanity.ts`, `lib/aqlab/regression.sanity.ts`.

## Guardrails (`CLAUDE.md` — niet-onderhandelbaar)

- **Geen schijnzekerheid**: consistent-fout gedrag mag nooit positief scoren (`consistent_but_incorrect` = blokkerend); label expliciet wat deterministisch vs judge/mens is gemeten.
- **Human-in-the-loop**: `review_required` bij twijfel; advies is voorstel, geen besluit (besluit = AQL-4).
- **Reproduceerbaarheid/audit**: iteraties met identieke effectieve instellingen; regressie alleen geldig bij volledige effectieve instellingen + gelijke subset; delta's/advies append-only herleidbaar.
- **RLS**: MVP provider-globaal/synthetisch; geen `fonds_id`; geen service-role in client; consistentie-/regressie-UI blijft in de platform-console, **niet** in de fonds-assurance-view.
- **Governanceregel**: subset/ad-hoc leiden nooit automatisch tot formele vrijgave; security/safety-subset kan wél een harde blokkade-indicatie geven.

## In te zetten subagents (`SUBAGENTS-ONTWERP.md` §4)

Nieuwe AI-functionaliteit / risico-inschatting → **`ai-governance-reviewer`** (schijnzekerheid, consistent-fout, human-in-the-loop, conservatieve risico-inschatting). **`ontwerp-sync-reviewer`** verplicht (ADR 0056 moet terug in technisch §7A + functioneel §scherm 6b) én vóór merge. **`code-reviewer`** (kwaliteit + `tsc` + sanity van de deterministische maten). `audit-evidence-reviewer` bij aanpassing van run-aggregaat/logging.

## Werkmodus

Plan-modus eerst: (a) consistentie-algoritme + welke maten deterministisch vs judge/mens, (b) regressie-delta + adviesregels incl. consistentie-doorwerking, (c) run-type-flows + subset-reproduceerbaarheid + promotie, (d) aggregaat-/migratie-impact, (e) UI (scherm 3/4/6/6b/5a), (f) testaanpak (sanity op de maten) + risico's. **Wijzig pas na expliciet akkoord.**

## Definition of Done (`CLAUDE.md` + roadmap "klaar wanneer")

- [ ] **Consistentie-run draait meerdere iteraties binnen één run** (geen losse runs), met exact dezelfde effectieve instellingen; `consistency_required`/`consistency_iterations` per testcase instelbaar.
- [ ] `consistency_score` + `consistency_status` (incl. `consistent_but_incorrect`) berekend en getoond; **stabiliteits- én correctheidsmaten** + `retrieval_stability` naast `source_stability` conform ADR 0056; `release_eligible` = stabiliteit **én** correctheid **én** geen kritieke/safety-blokkade.
- [ ] **Consistentie-overzicht + Iteraties-tab** zichtbaar met verboden-variatie-markering (tekst-diff); ad-hoc consistentietest respecteert `persist_mode` (bij `none` niets persistent).
- [ ] **Regressie-delta's per testcase + release_advies** berekend (challenger-vs-baseline); advies "accepteren" onmogelijk bij openstaande kritieke blokkade of niet-gehaalde `security_blocking`-case; consistentie weegt correct mee.
- [ ] **Drie run-types draaibaar** en herkenbaar gerapporteerd (`run_type` + `subset_filter` + `selected_test_case_ids`); security/safety-set apart draaibaar; subset/ad-hoc leveren alleen indicatief advies.
- [ ] **Ad-hoc vraag promoveerbaar** naar officiële testcase met vereiste velden; bron-run gemarkeerd.
- [ ] `npm run sanity` (incl. nieuwe consistentie-/regressie-sanity) + `./node_modules/.bin/tsc --noEmit --skipLibCheck` = exit 0; cross-tenant-suite groen; `npm run aqlab:smoke` draait.
- [ ] **ADR 0056 verwerkt** in technisch §7A en functioneel §scherm 6b; audit op run-aggregaat meegenomen.
- [ ] **Documentatiehaak (gate/mijlpaal):** `HANDOVER.md` release-historie bijgewerkt, decision-log-entry, `00–09`-set geactualiseerd (release-template) + `06 Roadmap/releasehistorie.md` + doc-actualisatie-log-marker; ontwerp-sync-check groen.

## Terugkoppeling (antwoordformat `CLAUDE.md`)

(1) samenvatting, (2) aangepaste bestanden, (3) RLS/security-impact, (4) audit-logging-impact, (5) datamodel/migratie-impact (aggregaatvelden), (6) test/verificatie (sanity op de deterministische maten), (7) openstaande risico's / overdracht naar AQL-4.
