# Werkopdracht AQL-1 — Fundament & seed (AI Output Quality & Governance Lab)

- **Ticket:** AQL-1 (eerste van 4 uit `AQLAB-ROADMAP.md`) · **Versie:** v1.0 · **Datum:** 2026-07-10
- **Overdracht:** goedgekeurd in plansessie (Cowork) → uit te voeren in Claude Code, repo-root. Zie `WERKOPDRACHT-TEMPLATE.md` en `decisions/0004`.
- **Werkmodus:** begin in **Plan-modus**. Lever eerst een implementatieplan; wijzig pas ná expliciet akkoord.

---

## Doel & context

Het AQLab is de kwaliteits- en verantwoordingslaag over de AI-output van het Bestuurdersportaal (beheersmaatregel binnen verantwoord AI-gebruik, **Optie A**: operationele module in de platform-backoffice, fonds krijgt later een read-only assurance-rapport). AQL-1 legt het **fundament**: het `aqlab_`-datamodel staat idempotent en RLS-conform in Supabase, en de inhoudelijk gevalideerde synthetische golden set (demofonds *Horizon*) is geseed via een gate-bewaakte loader. Zonder dit fundament kan geen enkele run (AQL-2), consistentiemeting (AQL-3) of assurance/release (AQL-4) gebouwd worden.

## Goedgekeurd ontwerp/plan (leidend)

- **Roadmap:** `ai-quality-lab/AQLAB-ROADMAP.md` → AQL-1 en de bindende werkopdracht-conventie.
- **Technisch:** `ai-quality-lab/AI-QUALITY-LAB-TECHNISCH.md` — datamodel §1 (13 kern + 2 MVP-light), entiteiten §2, scope/tenant-isolatie §1.4, spikes §8, DoD §13.
- **Functioneel:** `ai-quality-lab/AI-QUALITY-LAB-FUNCTIONEEL.md` (context; UI valt grotendeels ná AQL-1).
- **Seed:** `ai-quality-lab/AQLAB-SEEDLOADER-VOORSTEL-v0.1.md`, `AQLAB-SEED-STRUCTUUR-v0.2.yaml`, `AQLAB-HORIZON-FIXTURES-v0.2.md`, `AQLAB-FIXTURE-HASHES-v0.1.yaml`.
- **Validatie:** `ai-quality-lab/AQLAB-PRE-SEED-VALIDATIERAPPORT-v0.1.md` (271/271 structureel groen; seeding-gate met 4 open poorten).
- **ADR:** `decisions/0056-aqlab-consistentie-correctheid-en-stability.md` (reserveer velden; volledige implementatie is AQL-3).

> Bij twijfel wint de code + `supabase/migrations/` (CLAUDE.md, bron-van-waarheid-hiërarchie). Verifieer elke aanname tegen de migraties en `lib/` vóór je erop bouwt.

## Entry-criteria (blokkerend — controleren vóór start)

**A. Pre-implementation spikes afgerond** (technisch §8), elk met korte notitie + go/no-go:
1. Headless generatie (relevant voor AQL-2, maar bevestig haalbaarheid/omvang R4).
2. Background jobs (hergebruik `document_processing_jobs`?).
3. Tenantdata/platformtoegang (geen service-role in client).
4. Retentie/privacy (MVP `refs_only`, AVG-toets).

**B. Seeding-gate — alle vier groen** (validatierapport §6; `SEED_ALLOWED = false` tot dan):
1. `content_hash` ingevuld in de bron (hashes staan berekend klaar in `AQLAB-FIXTURE-HASHES-v0.1.yaml`; invullen ná tekst-freeze).
2. AVG-scope **SEC-06** juridisch/FG-bevestigd.
3. Compliance-/juridische duiding **BS-06 / BV-04 / SEC-04** gevalideerd.
4. **Judge-JSON-schema's** gedefinieerd.

> **Als A of B niet volledig groen is:** blijf in Plan-modus, seed niet, en rapporteer welke poort open staat. De loader moet technisch weigeren te draaien zolang `SEED_ALLOWED = false` (gate-first).

## Scope

**Wel**
- Idempotente migraties voor de **13 kern-tabellen** + **2 MVP-light** (`aqlab_ai_features`, `aqlab_test_sets`, `aqlab_test_cases`, `aqlab_prompt_versions`, `aqlab_model_configurations`, `aqlab_runs`, `aqlab_run_outputs`, `aqlab_scores`, `aqlab_findings`, `aqlab_release_decisions`, `aqlab_audit_exports`, `aqlab_fixture_documents`, `aqlab_log`; light: `aqlab_human_reviews`; `aqlab_score_criteria` = later/seed-in-code) in `supabase/migrations/<datum>_<naam>.sql`, met `schema.sql` bijgewerkt als documentatie.
- **RLS aan** op alle `aqlab_`-tabellen; `aqlab_log` append-only via `fn_log_append_only`-trigger (bestaande functie hergebruiken). Reserveer de ADR-0056-aggregaatvelden (`consistency_*`, `retrieval_stability`) zonder ze in AQL-1 te berekenen.
- **Seedloader** conform `AQLAB-SEEDLOADER-VOORSTEL-v0.1.md`: dry-run default, `--apply` alleen na expliciet akkoord; stappen 1–6 (gate-check → 271 structurele checks → hash-verificatie → plan/diff → transactionele upsert → post-seed-verificatie). `synthetic = true` afgedwongen.
- **Seeden** van 3 provider-golden testsets (samenvatting, vraagbeantwoording, besluitvoorbereiding) + **33 testcases** + **24 fixtures** met reproduceerbare bronreferentie `fixture_id + versie + content_hash`.
- **Code-seed** van de 12 scorecriteria + consistency-config als constante (`lib/aqlab/criteria.ts`, `lib/aqlab/consistency.ts`) — géén beheerbare tabel in de MVP.
- **Cross-tenant/§15-suite** uitgebreid en groen (`bash scripts/cross-tenant-ci.sh`): AQLab-tabellen lekken geen data cross-tenant; assurance-pad bevat geen ruwe content.

**Niet** (bewust buiten AQL-1)
- Run-engine, generatie-adapter, scoring, LLM-judge (**AQL-2**).
- Consistentiemeting/regressie/run-types-implementatie en de volledige ADR-0056-berekening (**AQL-3**); AQL-1 reserveert alleen de velden.
- Assurance-view, release-besluitworkflow, auditexport-UI (**AQL-4**).
- Fonds-specifieke assurance op echte fondsdata, `fonds_id`-scoped tabellen, materialized snapshots (bewust later — architectuur §12).
- UI/schermen behalve wat nodig is om de seed te verifiëren.

## Relevante bestanden / modules (verifiëren tegen echte code)

- `supabase/migrations/` (nieuw: `<datum>_aqlab_fundament.sql`), `supabase/schema.sql`, `supabase/checks/` (cross-tenant), `T3-RLS-CONTROLEKADER.md`.
- `lib/aqlab/criteria.ts`, `lib/aqlab/consistency.ts` (nieuw), evt. `lib/aqlab/seed/`.
- Seed-CLI (referentie `aqlab_seed_dryrun.py`) + bron-YAML/MD in `ai-quality-lab/`.
- Audit: bestaande `fn_log_append_only` / `*_log`-patroon.
- `tests/cross-tenant/*.test.ts`, `scripts/cross-tenant-ci.sh`, `.github/workflows/rls-cross-tenant.yml`.

## Guardrails (`CLAUDE.md` — niet-onderhandelbaar)

- **Tenant-isolatie via RLS**; uitsluitend anon-key, **nooit service-role in client-code**. MVP-tabellen zijn provider-globaal/synthetisch (geen `fonds_id`); toon aantoonbaar dat er **geen ongedekte tenant-write** is en dat `WITH CHECK` gereed staat voor latere fonds-scoped paden.
- **Append-only audit**: elke seed-/Lab-actie logt in `aqlab_log`; geen UPDATE/DELETE (trigger blokkeert).
- **Human-in-the-loop**: `--apply` alleen na expliciete goedkeuring; dry-run is default.
- **Migratie-eerst-dán-deploy**: draai migratie eerst in Supabase, dán code. Bestaande migraties niet achteraf wijzigen.
- **Snapshot-integriteit**: fixture-tekstwijziging = nieuwe `versie` (nieuwe hash); oude rij blijft staan (historische runs reproduceerbaar).
- **Geen schijnzekerheid**: geen juridische/actuariële claims zonder bron; `[Volgens wetgeving]`-cases (BS-06/BV-04/SEC-04) blijven judge/mens, niet deterministisch.

## In te zetten subagents (`SUBAGENTS-ONTWERP.md` §4)

Nieuwe tabellen/migratie → **`supabase-rls-reviewer`**, **`audit-evidence-reviewer`**, **`code-reviewer`**. Aanvullend **`ontwerp-sync-reviewer`** (drift ontwerp↔code, verplicht vóór merge). ADR-0056-raakvlak → `ai-governance-reviewer` mag meelezen op schijnzekerheid/reservering.

## Werkmodus

Begin in **Plan-modus**: lever eerst een implementatieplan met (a) migratie-opzet + volgorde, (b) RLS-policy per tabel + `WITH CHECK`-strategie, (c) seedloader-stappen + gate-afhandeling, (d) testaanpak (cross-tenant + sanity), (e) risico's. **Wijzig pas na expliciet akkoord.**

## Definition of Done (`CLAUDE.md` + roadmap "klaar wanneer")

- [ ] Alle `aqlab_`-migraties **idempotent** en schoon toegepast in Supabase; `schema.sql` bijgewerkt.
- [ ] **RLS aan** op alle `aqlab_`-tabellen; `aqlab_log` append-only (trigger); geen service-role-key in client.
- [ ] **Cross-tenant/§15-suite groen** (`bash scripts/cross-tenant-ci.sh`), incl. nieuwe AQLab-cases; aantoonbaar geen ongedekte tenant-write.
- [ ] `SEED_ALLOWED = true` pas nadat alle 4 gate-poorten groen zijn; loader weigert anders te draaien.
- [ ] **3 testsets + 33 testcases + 24 fixtures** geseed; **post-seed-verificatie groen** (rijtellingen, bidirectionele koppelingen, elke testcase resolvet fixture + facts).
- [ ] `synthetic = true` afgedwongen; hashes geverifieerd (`fixture_id + versie + content_hash`).
- [ ] 12 scorecriteria + consistency-config als code-seed aanwezig; ADR-0056-velden gereserveerd (niet berekend).
- [ ] `./node_modules/.bin/tsc --noEmit --skipLibCheck` = exit 0; sanity-checks groen.
- [ ] **Documentatiehaak (gate/mijlpaal):** `HANDOVER.md` release-historie bijgewerkt, decision-log-entry, en de `00–09`-set geactualiseerd volgens `00 Overzicht en status/release-template.md` (+ `06 Roadmap/releasehistorie.md` en de marker in `00 Overzicht en status/doc-actualisatie-log.md`). Ontwerp-sync-check groen.

## Terugkoppeling (antwoordformat `CLAUDE.md`)

Rapporteer kort in deze volgorde: (1) samenvatting, (2) aangepaste bestanden, (3) RLS/security-impact, (4) audit-logging-impact, (5) datamodel/migratie-impact, (6) test/verificatie, (7) openstaande risico's / vervolg (o.a. overdracht naar AQL-2).
