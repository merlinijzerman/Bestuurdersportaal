# AQLab MVP — Definition-of-Done-bewijsmatrix (§13)

- **Versie:** v1.0 · **Datum:** 2026-07-10 · **Scope:** volledige MVP-keten AQL-1 t/m AQL-4.
- **Bron:** `AI-QUALITY-LAB-TECHNISCH.md` §13. **Legenda:** ✅ groen (code + verificatie) · 🟡 code klaar, live bewijs vereist deploy/seed · ⛔ operationeel geblokkeerd (seeding-gate/live DB).
- **Verificatie deze sessie:** `tsc --noEmit --skipLibCheck` = exit 0 · `npm run sanity` groen (incl. aqlab-release 10, aqlab-audit-export 6, aqlab-assurance 11, platform-capabilities 15) · `npm run aqlab:smoke` groen (5) · `npm run test:xtenant` 52/52 · `next build` exit 0 · `lint:colors` groen.

> **Kernvoorbehoud:** een aantal DoD-items vereist **geseede data + live runs** op een Supabase-DB. Dat hangt aan de AQL-1 **seeding-gate** (poorten content_hash / AVG SEC-06 / juridische duiding / judge-schema's — poort 4 gesloten in AQL-2, 1–3 open) en aan het migratie-eerst draaien van de migraties. Opening is governance/juridisch, geen code-taak (besluit AQL-4-plansessie: code + bewijsmatrix). Die items staan hieronder als 🟡/⛔.

## Migratie / RLS / security

| # | DoD-criterium | Status | Bewijs |
|---|---|---|---|
| 1 | Alle migraties idempotent | ✅ | `create table if not exists` / `on conflict do nothing` / guarded do-blocks in aqlab_1–5 (+ROLLBACKs). |
| 2 | RLS aan op alle relevante tabellen | ✅ | `aqlab-isolation.test.ts` (RLS enabled op elke aqlab-tabel). |
| 3 | `WITH CHECK` op elke tenant-schrijfpolicy (of aantoonbaar geen ongedekte tenant-write) | ✅ | Geen tenant-write op aqlab (deny-by-default); assurance is read-only server-gemedieerd; `aqlab-assurance-isolation.test.ts` (geen policy/geen fonds_id in aqlab_5). |
| 4 | Geen service-role-key in client | ✅ | `import "server-only"` op alle service-libs; `(dashboard)`-assurance-view importeert geen service-role (`aqlab-assurance-isolation.test.ts`). |
| 5 | Cross-tenant tests groen incl. AQLab-cases (assurance lekt geen ruwe content) | ✅ | `test:xtenant` 52/52 incl. 6 nieuwe AQL-4-cases. DB-laag onder échte RLS: 🟡 (vereist `TEST_DATABASE_URL`; draait in CI). |
| 6 | `sanity`/`tsc` groen | ✅ | zie kop. |

## Seed / run-engine (AQL-1/2/3)

| # | DoD-criterium | Status | Bewijs |
|---|---|---|---|
| 7 | Min. 20 testcases geseed (≤3 features) | ⛔ | Seeding-gate open (poort 1–3); loader klaar (`lib/aqlab/seed/*`), `--apply` weigert tot gate groen. |
| 8 | Synthetische fixtures (`synthetic=true` afgedwongen) | ✅ (schema) / ⛔ (geseed) | DB-CHECK + loader-weigering; seeden zelf gate-geblokkeerd. |
| 9–14 | Baseline/challenger/full_regression/subset/security_blocking/ad-hoc draaibaar | 🟡 | Code aanwezig (`run-orchestrator`, worker); live runs vereisen migratie + seed op DB. |
| 15 | Ad-hoc opslaan als testcase (promotie) | 🟡 | `lib/aqlab/promotie.ts` + UI; live vereist data. |
| 16–19 | run_type/latency/effectieve instellingen/scorekaart vastgelegd + getoond | 🟡 | Schema + UI (scherm 5/6); live bewijs vereist runs. |
| 20 | Regressieoverzicht zichtbaar | 🟡 | `RegressieBlok` + `regression.ts`; live vereist runs. |
| 21–30 | Consistentie (required/iteraties/subset/ad-hoc/score+status/advies/no-store) | ✅ (logica) / 🟡 (live) | AQL-3: `consistency.ts` + sanity; `aqlab:smoke` dekt consistent/unstable; live vereist runs. |

## AQL-4 — assurance / release / audit

| # | DoD-criterium | Status | Bewijs |
|---|---|---|---|
| 31 | Vrijgavebesluit in `aqlab_release_decisions` (append-only), met `assurance_scope` | ✅ | `lib/aqlab/release.ts` (INSERT-only, `assurance_scope='productbreed'`); append-only trigger (aqlab_3); `aqlab-release.sanity.ts`. |
| 32 | Kritieke bevinding blokkeert vrijgave (`besluit≠vrijgegeven`, advies≠accepteren) — DB én service | ✅ | DB-CHECK `aqlab_release_kritiek_blokkeert`; service `valideerVrijgaveBesluit` + `telKritiekeBevindingen`; sanity + smoke. |
| — | `ad_hoc` nooit vrijgegeven; `subset` alleen met governance-motivatie | ✅ | `valideerVrijgaveBesluit` (run-type-regels); `aqlab-release.sanity.ts`. |
| — | 7 statussen + statusmachine | ✅ | `STATUS_OVERGANGEN`/`isToegestaneOvergang`; sanity. |
| 33 | Assurance-view read-only, scope-label + "wat wél/niet" | ✅ | scherm 9 (`/governance/assurance`) + `assurance-core.ts` (vaste microcopy §4.4/§5); alleen aggregaten (`aqlab-assurance.sanity.ts`). |
| — | Fonds ziet alleen aggregaten, nooit ruw/andere-fondsen-data; disclaimer prominent | ✅ | server-gemedieerd endpoint; `AssuranceTegel` structureel aggregaat-only; `aqlab-assurance-isolation.test.ts`. |
| 34 | Auditexport genereerbaar met `inhoud_hash` + verifieerbaar (herbereken = match) | ✅ | `audit-export.ts` (`genereerAuditExport`/`verifieerAuditExport`); `aqlab-audit-export.sanity.ts` (hash-determinisme + wijziging→andere hash). Live upload/download: 🟡 (bucket-migratie op DB). |
| — | Fonds downloadt read-only via assurance-view | ✅ | `/api/aqlab/assurance/audit/[exportId]` (auth + `magFondsAuditExportZien` + append-only downloadlog). |
| 35 | Outputs bevatten promptversie/modelconfig/bronnen/tokens/latency/timestamp | 🟡 | Schema (aqlab_run_outputs) + auditrapport; live vereist runs. |

## Platform-console

| # | Criterium | Status | Bewijs |
|---|---|---|---|
| 36 | Scherm 7 dashboard kwaliteit per feature (met "wat/hoe/wat níet" + steekproef) | ✅ | `/platform/aqlab/dashboard` + `dashboard-lees.ts`. |
| 37 | Scherm 8 auditrapport + vrijgave-actie (CAP_GOVERN) | ✅ | `runs/[runId]/release-blok.tsx` + `acties.ts` (`legVrijgaveActie`/`genereerAuditActie`/`verifieerAuditActie`). |

## Review-ronde (2026-07-10)

Zes review-subagents ingezet; governance/tenant-isolatie/hash-integriteit deugdelijk, geen cross-tenant- of ruwe-output-lek. Doorgevoerd: pre-validatie vóór auditexport (geen wees-export), conditionele "wat wél"-tekst (schijnzekerheid weg), formeel no-go = mensbesluit + besluit↔status-consistentie, platform-auditrapport-route, altijd-gelogde acteur + `oude_waarde`, migratie-/sanity-hardening. Details + restrisico's (DB-onafhankelijkheid kritiek-telling, byte-integriteit-scope) staan in [`decisions/0061`](../decisions/0061-aqlab-aql4-assurance-release-audit-implementatie.md). **Besluit vastgelegd:** het fonds-auditrapport behoudt volledige findings + reviewer-namen conform §scherm 8 (formeel verantwoordingsdocument); `fragment`/ruwe output blijven uitgesloten (regressie-getest).

## Restpunten vóór "MVP volledig groen"

1. **Seeding-gate openen** (poort 1–3: content_hash, AVG SEC-06, juridische duiding) → seed ≥20 testcases.
2. **Migratie-eerst op live Supabase**: aqlab_1–5 draaien (incl. de nieuwe bucket + govern-capability), dán deploy.
3. **Live end-to-end**: baseline → challenger → regressie → vrijgavebesluit → auditexport (hashverificatie) → assurance-view (fonds-sessie).
4. **DB-laag cross-tenant** onder échte RLS (`TEST_DATABASE_URL` / CI).
5. **Review-subagents** (`supabase-rls-reviewer`, `audit-evidence-reviewer`, `ai-governance-reviewer`, `ai-literacy-ux-reviewer`, `ontwerp-sync-reviewer`, `code-reviewer`) + actualisatie `00`–`09`-set + as-built Word.
