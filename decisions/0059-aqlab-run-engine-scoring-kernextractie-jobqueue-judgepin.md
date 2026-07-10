# 0059 — AQLab run-engine & scoring: kern-extractie, cron-jobqueue en judge-pin (AQL-2)

- **Status:** Geaccepteerd
- **Datum:** 2026-07-10
- **Betrokkenen:** platform-engineering, AI-governance

## Context

AQL-2 maakt het AI Quality Lab werkend: een run moet **reproduceerbaar exact dezelfde generatie-/retrievalkern als productie** draaien en elke output scoren (deterministisch → heuristisch → blokkade-gate → LLM-judge → human-review → aggregatie), zónder het bestaande streaming-chatpad te wijzigen. Drie keuzes waren leidend, elk met randvoorwaarden rond reproduceerbaarheid, audit en het niet-breken van productie.

## Besluit

1. **Kern-extractie (spike 1):** de answer-generation-kern (toon-systeemprompt `TOON_BLOK`, per-modus regelsets, system-prompt-builders) is byte-voor-byte verplaatst naar `lib/generatie-kern.ts` en wordt door zowel de streaming-route als het Lab geïmporteerd. De streaming-route blijft eigenaar van het SSE-pad (streamt onveranderd); het Lab draait dezelfde kern headless via `genereerAntwoord()` (`.finalMessage()`). Pariteit is bevroren met sha256-snapshots (`lib/generatie-kern.sanity.ts`).
2. **Achtergrond-jobmechanisme (spike 2):** een **cron-gedrainde job-queue** — één idempotente werk-rij per (run, testcase, iteratie) in `aqlab_run_jobs`; een worker-route claimt batches via `FOR UPDATE SKIP LOCKED` (RPC `aqlab_claim_run_jobs`) met lease/timeout/retry/kostenplafond; een Vercel Cron (`vercel.json`) draint elke minuut.
3. **Judge-model:** de LLM-judge draait op een **apart gepind model `claude-opus-4-8`**, verschillend van het generatiemodel (`claude-sonnet-4-6`), met een vast JSON-output-schema per criterium. De judge is **adviserend** en kan nooit zelfstandig een blokkade veroorzaken.

## Overwogen alternatieven

- **Kern: route de streaming-loop laten consumeren uit de kern** — afgewezen: invasiever in de route, hoger regressierisico op het kostbare SSE-pad. De gekozen "gedeelde builders, aparte call-sites" houdt de route-diff minimaal (alleen imports).
- **Jobs: hergebruik `document_processing_jobs`** — afgewezen: dat is een synchroon inline-logboek zonder claim/lease/retry; geen echte queue. **Synchroon-inline** (zoals de generieke pipeline) — afgewezen: ~150 modelcalls/run passen niet binnen één serverless-timeout. **Self-continuing worker** — afgewezen als primair mechanisme wegens onbetrouwbare serverless self-invocatie; de directe drain blijft wél een optionele versneller.
- **Judge = generatiemodel** — afgewezen wegens self-grading-bias (R2). **Haiku als judge** — afgewezen: te zwak voor groundedness/risk-duiding.

## Gevolgen

- **RLS/tenant-isolatie:** geen. `aqlab_*` blijft provider-globaal/synthetisch, deny-by-default; `aqlab_run_jobs` idem. Geen `fonds_id`. De worker gebruikt de niet-tenant service-role-client (`lib/supabase-service`), gescheiden van tenant-RLS.
- **Audit/reproduceerbaarheid:** run-/output-/score-acties gaan append-only naar `aqlab_log` (test­verkeer bewust NIET naar `governance_log`, besluit 8). Per output worden effectieve modelinstellingen + `snapshot_hash` + latency/tokens/kosten bevroren. Judge-motivatie/-bewijs en de meetbeperking per criterium zijn zichtbaar op de scorekaart ("geen groen vinkje zonder bewijs").
- **Datamodel/migraties:** additief `2026_07_10_aqlab_4_run_jobs.sql` — `aqlab_run_jobs` (queue), `quality_score`/`gate_status`-rollup + unieke (run,testcase,iteratie) op `aqlab_run_outputs`, claim-RPC, en de seed van twee capabilities `platform.aqlab.operate`/`.review` (code-union in `lib/platform-capabilities.ts`).
- **Beheer/gebruik:** nieuwe platform-console `/platform/aqlab` (run starten + scorekaart per output; `quality_score` strikt gescheiden van `gate_status`). Cron + `CRON_SECRET` is nieuwe infra; fallback is de directe/manuele worker-trigger.
- **Bewust geaccepteerd:** dimensievloeren (80/85) zijn werkhypotheses (parameters, niet hardgecodeerd). De pre-existing service-role-lek-melding op `lib/aqlab/seed/apply.ts` (AQL-1, CLI-pad) blijft staan — buiten AQL-2-scope.

## Referenties

- Code: `lib/generatie-kern.ts`, `lib/aqlab/{generate-adapter,run-orchestrator,evaluation-engine,judge,fixtures}.ts`, `lib/aqlab/checks/*`, `app/api/aqlab/worker/route.ts`, `app/(platform)/platform/(beveiligd)/aqlab/**`, `vercel.json`.
- Migratie: `supabase/migrations/2026_07_10_aqlab_4_run_jobs.sql` (+ ROLLBACK).
- Ontwerp: `ai-quality-lab/AI-QUALITY-LAB-TECHNISCH.md` §5/§7/§8, `-FUNCTIONEEL.md` scherm 4/5/6, werkticket AQL-2; ADR `decisions/0056`, `decisions/0058`.
