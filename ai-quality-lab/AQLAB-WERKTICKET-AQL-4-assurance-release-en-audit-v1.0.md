# Werkopdracht AQL-4 — Assurance, release & audit (AI Output Quality & Governance Lab)

- **Ticket:** AQL-4 (vierde en laatste uit `AQLAB-ROADMAP.md`) · **Versie:** v1.0 · **Datum:** 2026-07-10
- **Overdracht:** goedgekeurd in plansessie (Cowork) → uit te voeren in Claude Code, repo-root. Zie `WERKOPDRACHT-TEMPLATE.md` en `decisions/0004`.
- **Werkmodus:** begin in **Plan-modus**. Lever eerst een implementatieplan; wijzig pas ná expliciet akkoord.

---

## Doel & context

Met AQL-3 kan het Lab consistentie meten, regressie berekenen en een release-*advies* geven. AQL-4 sluit de MVP-keten: het legt het formele **vrijgavebesluit** append-only vast, geeft het fonds een **read-only assurance-view** (nooit ruwe output), en genereert een verifieerbaar **auditrapport** (gehasht). Dit is de stap van "technisch werkend Lab" naar "governance-instrument met assurance-waarde" — en het punt waarop de Definition of Done van de hele MVP behaald moet zijn.

## Goedgekeurd ontwerp/plan (leidend)

- **Roadmap:** `ai-quality-lab/AQLAB-ROADMAP.md` → AQL-4 (sluit de keten; DoD = exit-criterium MVP).
- **Technisch:** `AI-QUALITY-LAB-TECHNISCH.md` — `aqlab_release_decisions` §2.13, `aqlab_audit_exports` §2.10, release-service §5.6b, auditexport-service §5.7, assurance-service §5.8, DoD §13.
- **Functioneel:** `AI-QUALITY-LAB-FUNCTIONEEL.md` — releasebesluitvorming/7 statussen §6, releaseadvies per run-type §6.3a, assurance-view (scherm 9) §5, scope-label productbreed/fonds-specifiek §5.0, strikte scheiding platform-console vs fonds-view §5.7, disclaimer §4.4, auditrapport (scherm 8), dashboard kwaliteit per feature (scherm 7).
- **ADR:** `decisions/0056-...` (consistentie weegt mee in `release_eligible`; komt via AQL-3 het advies binnen).

> Bij twijfel wint de code + `supabase/migrations/`. Verifieer aannames tegen de migraties, `lib/aqlab/*` (uit AQL-1/2/3), `lib/auditdossier-html.ts` en `fonds_module_manifest`/`fonds_feature_flags` vóór je bouwt.

## Entry-criteria (blokkerend — controleren vóór start)

- **AQL-3 afgerond** (DoD groen): regressie-delta's + `release_advies` en het consistentie-aggregaat (ADR 0056) worden berekend en in `aqlab_runs.aggregatie` weggeschreven.
- **`aqlab_release_decisions` en `aqlab_audit_exports`** bestaan als tabel (uit AQL-1) met append-only trigger.
- **Fonds-koppeling beschikbaar**: `fonds_module_manifest`/`fonds_feature_flags` bruikbaar om te bepalen welke features een fonds gebruikt (voor de assurance-scope).
- **Spike 3 (platformtoegang) en spike 4 (retentie/privacy)** afgerond — relevant voor het enige tenant-facing leespad (assurance) en voor de bewaartermijn van exports.

## Scope

**Wel**
- **Release-service** (`lib/aqlab/release.ts`): legt het vrijgavebesluit vast als **append-only regel in `aqlab_release_decisions`** (geen UPDATE op de run). Neemt `release_advies` uit de run over; **motivatie verplicht bij afwijken** van het advies; telt `kritieke_bevindingen_count` (ernst `kritiek`, status open) uit `aqlab_findings`.
  - **Harde beslisregel (DB + service):** `kritieke_bevindingen_count > 0` ⇒ `besluit ≠ vrijgegeven` en `release_advies ≠ accepteren`. Governance-kritieke consistency failure blokkeert eveneens (via AQL-3-advies).
  - **7 statussen** (`concept`/`getest`/`review_vereist`/`aangepast`/`vrijgegeven`/`geblokkeerd`/`gearchiveerd`); statuswijziging = nieuwe regel. `vrijgegeven` vereist `besluit = vrijgegeven` + `besluit_door`/`_op`.
  - **Run-type-regel:** `ad_hoc` kan nooit `vrijgegeven` opleveren; `subset` alleen met expliciete governance-motivatie; formele vrijgave vereist in principe een `full_regression` incl. de `security_blocking`-set. `assurance_scope = productbreed` in de MVP.
- **Auditexport-service** (`lib/aqlab/audit-export.ts`): hergebruik het `lib/auditdossier-html.ts`-patroon; genereert bevroren **HTML/PDF**, berekent **`inhoud_hash` (sha256)**, slaat op in Storage (`opslag_ref`), logt append-only. Auditrapport-scherm (scherm 8) voor platformrollen; fonds downloadt read-only via de assurance-view.
- **Assurance-service** (`lib/aqlab/assurance.ts`): **server-side**, het **enige tenant-facing leespad**. Geeft uitsluitend **geaggregeerde** scores/metadata terug voor de features die een fonds gebruikt (join manifest/flags), incl. de laatst-vrijgegeven status en het **`assurance_scope`-label**. Voegt de vaste toelichting toe dat de controle op representatieve testgevallen is uitgevoerd en niet bewijst dat elk fondsdocument inhoudelijk is gevalideerd. **Nooit** ruwe output/context/prompt/testcase-inhoud/andere-fondsen-data.
- **Assurance-view (scherm 9)** — het **enige fonds-scherm**, volledig **read-only**: status, geaggregeerde scores, scope-label, geaggregeerde bevindingen, laatste kwaliteitscontrole, vrijgavestatus, auditrapport-download, en prominent de **disclaimer** (§4.4). Statustaal bewust "vrijgegeven voor gebruik", niet "goedgekeurd/gegarandeerd"; meetbeperking bij elke score. Autorisatie: fondsrollen read-only (+ export voor bestuursbureau).
- **Kwaliteitsdashboard per feature (scherm 7)** in de platform-console (metrics met "wat betekent dit / hoe gemeten / wat níet", steekproefkarakter zichtbaar).
- **DoD-afronding** van de volledige MVP (§13): eindcontrole dat álle criteria over AQL-1 t/m AQL-4 aantoonbaar groen zijn.

**Niet** (bewust later — architectuur §12)
- **Fonds-specifieke assurance** op echte fondsdocumenten (`fonds_id`-scoped tabellen + RLS + `WITH CHECK` + retentie); MVP is uitsluitend `assurance_scope = productbreed`.
- Auditor-portaal, CI/CD-blokkade als merge-gate, multi-model-orchestratie, materialized snapshots, per-fonds scorecriteria.

## Relevante bestanden / modules (verifiëren tegen echte code)

- `lib/aqlab/release.ts`, `lib/aqlab/audit-export.ts`, `lib/aqlab/assurance.ts` (nieuw/afronden).
- `aqlab_release_decisions`, `aqlab_audit_exports` (+ append-only trigger `fn_log_append_only`), `aqlab_findings` (kritieke telling).
- `lib/auditdossier-html.ts` (patroon), Supabase Storage, `fonds_module_manifest` / `fonds_feature_flags`.
- Fonds-facing route voor scherm 9 (assurance-view) onder het `governance`-pad; platform-console-routes voor scherm 7/8.
- Cross-tenant: `tests/cross-tenant/*.test.ts` — nieuwe case: assurance-API lekt geen ruwe content en respecteert fonds-scope.

## Guardrails (`CLAUDE.md` — niet-onderhandelbaar)

- **RLS + tenant-isolatie**: assurance is het enige tenant-leespad; uitsluitend anon-key + RLS, **geen service-role in client**; fonds A ziet nooit data van fonds B; assurance geeft **nooit** ruwe output/prompt.
- **Append-only audit**: release-besluiten en auditexports worden nooit ge-UPDATE/DELETE; statuswijziging = nieuwe regel; elk besluit herleidbaar naar gebruiker, run, tijdstip, motivatie.
- **Human-in-the-loop**: vrijgave is een **mensbesluit** (Governance Owner), niet automatisch uit een score; afwijken van advies vereist motivatie.
- **Geen schijnzekerheid**: statustaal "vrijgegeven voor gebruik" i.p.v. "gegarandeerd"; disclaimer + meetbeperking prominent; kritieke bevinding of consistentie-blokkade dwingt `besluit ≠ vrijgegeven` af.
- **Snapshot-/audit-integriteit**: `inhoud_hash` maakt het auditrapport verifieerbaar; migratie-eerst-dán-deploy.

## In te zetten subagents (`SUBAGENTS-ONTWERP.md` §4)

Tenant-leespad + nieuwe tabellen-gebruik → **`supabase-rls-reviewer`** (assurance lekt geen cross-tenant/ruwe data). **`audit-evidence-reviewer`** (append-only besluiten/exports, `inhoud_hash`, reproduceerbaarheid). **`ai-governance-reviewer`** (human-in-the-loop, schijnzekerheid, statustaal). **`ai-literacy-ux-reviewer`** (microcopy/disclaimers/bestuurlijke uitleg in de assurance-view). **`ontwerp-sync-reviewer`** verplicht vóór merge; **`code-reviewer`** eindreview.

## Werkmodus

Plan-modus eerst: (a) release-besluitregels + statusmachine + harde blokkade, (b) auditexport (HTML/PDF + hash + Storage + log), (c) assurance-service + fonds-scope-join + wat wél/niet getoond wordt, (d) assurance-view + disclaimer + microcopy, (e) RLS/cross-tenant-testaanpak, (f) DoD-eindcontrole + risico's. **Wijzig pas na expliciet akkoord.**

## Definition of Done (`CLAUDE.md` + roadmap "klaar wanneer" + MVP-DoD §13)

- [ ] **Vrijgavebesluit** vastgelegd in `aqlab_release_decisions` (append-only), met `assurance_scope`, motivatie bij afwijking, en de 7 statussen; go/no-go **herleidbaar** vastgelegd (wie/wanneer/waarom).
- [ ] **Kritieke bevinding blokkeert vrijgave** (`besluit ≠ vrijgegeven`, advies ≠ accepteren) — afgedwongen in **DB én service**; consistentie-blokkade weegt mee.
- [ ] `ad_hoc` kan nooit `vrijgegeven` opleveren; `subset` alleen met expliciete governance-motivatie.
- [ ] **Assurance-view read-only** zichtbaar voor het fonds met scope-label en "wat betekent deze score wél/niet"; **fonds ziet alleen aggregaten**, nooit ruwe output/prompt/testcase-inhoud/andere-fondsen-data; disclaimer prominent.
- [ ] **Auditexport** genereerbaar (HTML/PDF) met **`inhoud_hash`**; verifieerbaar (herbereken hash = match); fonds downloadt read-only.
- [ ] **Cross-tenant tests groen** incl. nieuwe AQLab-case (assurance lekt geen ruwe content, respecteert fonds-scope); `./node_modules/.bin/tsc --noEmit --skipLibCheck` = exit 0; `npm run sanity` + `npm run aqlab:smoke` groen.
- [ ] **Volledige MVP-DoD (§13) aantoonbaar groen** over AQL-1 t/m AQL-4 (migraties idempotent, RLS aan, geen service-role in client, seed, run-types, consistentie, scorekaart, regressie, release, assurance, audit).
- [ ] **Documentatiehaak (gate/mijlpaal + MVP-afronding):** `HANDOVER.md` release-historie bijgewerkt, decision-log-entry, `00–09`-set geactualiseerd (release-template) + as-built Word-doc als momentopname + `06 Roadmap/releasehistorie.md` + doc-actualisatie-log-marker; ontwerp-sync-check groen.

## Terugkoppeling (antwoordformat `CLAUDE.md`)

(1) samenvatting, (2) aangepaste bestanden, (3) RLS/security-impact (tenant-leespad assurance), (4) audit-logging-impact (append-only besluiten/exports), (5) datamodel/migratie-impact, (6) test/verificatie (cross-tenant + hashverificatie + MVP-DoD-eindcontrole), (7) openstaande risico's / groeipad (fonds-specifieke assurance, CI-merge-gate).
