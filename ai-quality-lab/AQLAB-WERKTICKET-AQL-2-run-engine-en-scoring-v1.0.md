# Werkopdracht AQL-2 — Run-engine & scoring (AI Output Quality & Governance Lab)

- **Ticket:** AQL-2 (tweede van 4 uit `AQLAB-ROADMAP.md`) · **Versie:** v1.0 · **Datum:** 2026-07-10
- **Overdracht:** goedgekeurd in plansessie (Cowork) → uit te voeren in Claude Code, repo-root. Zie `WERKOPDRACHT-TEMPLATE.md` en `decisions/0004`.
- **Werkmodus:** begin in **Plan-modus**. Lever eerst een implementatieplan; wijzig pas ná expliciet akkoord.

---

## Doel & context

Met AQL-1 staat het datamodel en is de golden set geseed. AQL-2 maakt het Lab **werkend**: een run draait **reproduceerbaar exact dezelfde generatie-/retrievalkern als productie**, scoort elke output (deterministisch → heuristisch → blokkade-gate → LLM-judge → optionele human-review), en toont de scorekaart per output in de platform-console. Kritieke randvoorwaarde: het bestaande streaming-chatpad blijft **ongewijzigd** — de generatiekern wordt eruit gelicht en door zowel de route als het Lab aangeroepen.

## Goedgekeurd ontwerp/plan (leidend)

- **Roadmap:** `ai-quality-lab/AQLAB-ROADMAP.md` → AQL-2.
- **Technisch:** `AI-QUALITY-LAB-TECHNISCH.md` — services/engine §5 (orchestrator §5.1, generatie-adapter §5.2, evaluatie-engine §5.3, auto-checks §5.4, judge §5.5), entiteiten `aqlab_runs` §2.6 / `aqlab_run_outputs` §2.7 / `aqlab_scores` §2.8 / `aqlab_findings` §2.9, model-config §2.5, logging/performance/`persist_mode` §7 / §7B.
- **Functioneel:** `AI-QUALITY-LAB-FUNCTIONEEL.md` — evaluatiescorekaart (scherm 5), outputvergelijking (scherm 4), run-overzicht/performance (scherm 6), scoremodel `quality_score` vs `gate_status`.
- **ADR:** `decisions/0056-...` (consistentie-berekening zelf = AQL-3; AQL-2 levert de per-iteratie auto-check-uitkomsten waarop AQL-3 voortbouwt).

> Bij twijfel wint de code + `supabase/migrations/`. Verifieer aannames tegen de migraties en `lib/` (m.n. `app/api/chat/route.ts`, `lib/rag.ts`) vóór je bouwt.

## Entry-criteria (blokkerend — controleren vóór start)

- **AQL-1 afgerond** (DoD groen): migraties toegepast, golden set geseed, cross-tenant-suite groen.
- **Spike 1 (headless generatie)** afgerond met go: de generatielogica is extraheerbaar naar een pure `genereerAntwoord(params)` zonder het streaming-UI-pad te breken.
- **Spike 2 (background jobs)** afgerond met gekozen mechanisme (hergebruik `document_processing_jobs`-patroon of alternatief) incl. retries/status/timeouts/cancellation/kostenplafond.
- **Judge-JSON-schema's** gedefinieerd (was gate-poort 4 in AQL-1; nodig voor de judge-adapter).

## Scope

**Wel**
- **Generatie-adapter** (`lib/aqlab/generate-adapter.ts`): roept de *bestaande* generatie-/retrievalkern aan via de headless `genereerAntwoord(params)` uit spike 1. Parameters volledig gepind (prompt-versie, model-config, snapshot-refs, rol, synthetische context). **Exact dezelfde kern als productie** (temp/model/labels identiek).
- **Refactor generatiekern**: generatielogica uit `app/api/chat/route.ts` extraheren naar de herbruikbare pure service; de **streaming-route blijft functioneel ongewijzigd** (roept dezelfde kern aan). Wijzig de kostbare AI-toon-systeemprompt niet.
- **Run-orchestrator** (`lib/aqlab/run-orchestrator.ts`): neemt een run-config, zet `aqlab_runs` op `queued`, verwerkt testcases async via het spike-2-mechanisme, idempotent per (run, testcase, iteratie). Legt snapshot `refs_only` + `snapshot_hash` en **effectieve modelinstellingen** per output vast. Respecteert `persist_mode` (`full_synthetic`/`none`/`metadata_only`) vóór wegschrijven.
- **Evaluatie-engine** (`lib/aqlab/evaluation-engine.ts`): per output (1) deterministische checks → (2) heuristische checks → (3) blokkade-gate → (4) LLM-judge → (5) human-review-taak indien vereist → (6) aggregatie. Schrijft `aqlab_scores` + `aqlab_findings`.
- **Auto-check-bibliotheek** (`lib/aqlab/checks/*.sanity.ts`): pure, deterministische functies conform het `lib/*.sanity.ts`-patroon (via `npm run sanity`, `tsc`-getest). O.a. `formatCompliance`, `verplichteOnderdelenAanwezig`, `bronMarkerAanwezig`, `herkomstlabelScheiding` (borgt "vrije bestuurstekst nooit als `[Bron]`"). Elke check retourneert `{score, pass, motivatie, findings, methode}`.
- **LLM-judge-adapter** (`lib/aqlab/judge.ts`): vast judge-prompt per criterium, **vast JSON-output-schema** (score 0–100 + motivatie + geciteerd bewijs), **apart gepind judge-model** (self-grading-bias). Judge krijgt bron/context mee voor groundedness; judge-score altijd náást auto-checks, **nooit** als enige grond voor een blokkade.
- **Scorekaart per output** in de platform-console (scherm 5): score + methode + motivatie + bewijs + meetbeperking + human-review-mogelijkheid + blokkadecriteria; volledige herkomst (prompt/model/snapshot-hash/effectieve instellingen/tijdstip/starter/latency/tokens/kosten). **`quality_score` (kwaliteit) strikt gescheiden van `gate_status` (blokkade)**, met dimensievloeren.
- **Performance-vastlegging** per output (`latency_ms`, tokens, kostenindicatie) t.b.v. de latere run-aggregatie.

**Niet** (bewust later)
- Consistentiemeting/`consistency_score`, source-/retrieval-stability en de drie run-types full/subset/ad-hoc als *feature* (**AQL-3**) — AQL-2 levert wél de per-iteratie basis.
- Regressie baseline-vs-challenger + release_advies-berekening (**AQL-3/AQL-4**).
- Vrijgavebesluit, assurance-view, auditexport (**AQL-4**).
- Nieuwe `fonds_id`-scoped tabellen / fonds-specifieke runs (bewust later).
- Multi-model-orchestratie; CI/CD als merge-gate (MVP = géén blokkerende gate).

## Relevante bestanden / modules (verifiëren tegen echte code)

- `app/api/chat/route.ts` (kern-extractie; streaming-pad intact), `lib/rag.ts`, `lib/document-extractie.ts`.
- Nieuw: `lib/aqlab/generate-adapter.ts`, `lib/aqlab/run-orchestrator.ts`, `lib/aqlab/evaluation-engine.ts`, `lib/aqlab/judge.ts`, `lib/aqlab/checks/*.sanity.ts`, `lib/aqlab/criteria.ts` (uit AQL-1).
- Background jobs: bestaand `document_processing_jobs`-patroon.
- Foutafhandeling/rate-limit: `lib/api-errors.ts`, `lib/rate-limit.ts`.
- Platform-console UI (scherm 5/6) onder de platform-backoffice-routes; API-route(s) voor het starten/uitlezen van runs.

## Guardrails (`CLAUDE.md` — niet-onderhandelbaar)

- **Human-in-the-loop / geen schijnzekerheid**: judge is adviserend, nooit de enige blokkadegrond; **nooit een "groen vinkje" zonder onderliggend bewijs**; toon per criterium de meetbeperking en of menselijke review mogelijk/vereist is.
- **Reproduceerbaarheid**: effectieve modelinstellingen (`temperature_effective`, `max_tokens_effective`, `top_p_effective`, `provider_default_used`, `retrieval_settings_effective`) + `snapshot_hash` per output bevriezen; het Lab draait dezelfde kern als productie.
- **Append-only audit**: run-/output-/score-acties gelogd in `aqlab_log`; geen UPDATE/DELETE.
- **RLS**: MVP provider-globaal/synthetisch (geen `fonds_id`); geen service-role in client; assurance-pad (later) mag nooit ruwe output lekken — houd de scheiding platform-console (ruwe output) vs fonds-view (geen ruwe output) nu al zuiver.
- **AI-toon-systeemprompt** in `app/api/chat/route.ts` niet herschrijven; alleen de kern extraheren zonder gedrag te wijzigen.
- **Kern-extractie mag productiegedrag niet veranderen**: bewijs dat de streaming-route identiek blijft.

## In te zetten subagents (`SUBAGENTS-ONTWERP.md` §4)

Nieuwe AI-functionaliteit → **`ai-governance-reviewer`** (schijnzekerheid, human-in-the-loop, judge-adviserend), **`audit-evidence-reviewer`** (run/output/score-logging + reproduceerbaarheid), **`code-reviewer`** (kwaliteit + `tsc` + veilige kern-extractie). **`ontwerp-sync-reviewer`** verplicht vóór merge.

## Werkmodus

Plan-modus eerst: (a) refactorplan chat-route → `genereerAntwoord()` met bewijs dat streaming intact blijft, (b) orchestrator + jobmechanisme (spike 2), (c) evaluatie-pijplijn + check-registry + judge-schema, (d) datavastlegging (snapshot/effectieve instellingen/`persist_mode`), (e) scorekaart-UI, (f) testaanpak + risico's. **Wijzig pas na expliciet akkoord.**

## Definition of Done (`CLAUDE.md` + roadmap "klaar wanneer")

- [ ] **Streaming-route aantoonbaar ongewijzigd**; Lab draait exact dezelfde generatie-/retrievalkern (temp/model/labels identiek).
- [ ] Een run draait async, idempotent per (run, testcase, iteratie); status `queued/running/done/failed/cancelled` correct; foutmelding per output stopt de run niet (best-effort per testcase).
- [ ] Outputs leggen bronnen, herkomstlabels, `snapshot_refs` + `snapshot_hash`, **effectieve modelinstellingen**, tokens, `latency_ms`, timestamp vast; `persist_mode` gerespecteerd (bij `none` niets persistent).
- [ ] Auto-checks (`*.sanity.ts`) pass/fail met motivatie + findings; blokkade-gate werkt; **judge levert vast JSON-schema** met apart gepind model, náást de auto-checks.
- [ ] **Scorekaart per output zichtbaar** in de platform-console met methode/motivatie/bewijs/meetbeperking/human-review/blokkadecriteria + volledige herkomst; **`quality_score` gescheiden van `gate_status`**; geen groen vinkje zonder bewijs.
- [ ] Kritieke finding blokkeert pass ongeacht totaalscore.
- [ ] `npm run sanity` + `./node_modules/.bin/tsc --noEmit --skipLibCheck` = exit 0; cross-tenant-suite groen; `npm run aqlab:smoke` (mini-testset) draait.
- [ ] Audit: run/output/score-acties append-only gelogd.
- [ ] **Documentatiehaak (gate/mijlpaal):** `HANDOVER.md` release-historie bijgewerkt, decision-log-entry, `00–09`-set geactualiseerd (release-template) + `06 Roadmap/releasehistorie.md` + doc-actualisatie-log-marker; ontwerp-sync-check groen.

## Terugkoppeling (antwoordformat `CLAUDE.md`)

(1) samenvatting, (2) aangepaste bestanden, (3) RLS/security-impact, (4) audit-logging-impact, (5) datamodel/migratie-impact, (6) test/verificatie (incl. bewijs streaming intact + kern-pariteit), (7) openstaande risico's / overdracht naar AQL-3.
