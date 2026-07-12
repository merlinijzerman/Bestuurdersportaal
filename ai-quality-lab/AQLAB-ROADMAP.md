# AQLab — implementatieroadmap (4 iteraties, 4 werktickets)

- **Status:** concept ter planning · **Datum:** 2026-07-10
- **Scope:** van gevalideerd ontwerp naar een werkende MVP van het AI Output Quality & Governance Lab.
- **Uitgangspunten:** Optie A (platform-backoffice + read-only assurance-view), synthetische golden set (Horizon), reproduceerbaarheid via `fixture_id + versie + content_hash`, geen echte fondsdata in de MVP.
- **Opzet:** bewust **één werkticket per iteratie** (4 in totaal). Elk ticket is een samenhangende mijlpaal; de bouwstenen eronder zijn géén losse tickets maar de inhoud van dat ene ticket. Tickets zijn hier **niet** volledig uitgewerkt.

## Borging — werkopdracht-conventie (bindend)

Deze tickets zijn nu bewust kort. **Wanneer je vraagt "maak werkticket AQL-N", wordt het volledig uitgeschreven volgens `../WERKOPDRACHT-TEMPLATE.md`**, met verplicht:

- **Doel & context** + verwijzing naar het leidende ontwerp (`ai-quality-lab/AI-QUALITY-LAB-*.md`, ADR `decisions/0056`).
- **Scope (Wel / Niet)** en **relevante bestanden/modules** (geverifieerd tegen de echte code).
- **Guardrails (`CLAUDE.md`):** RLS per `fonds_id` (alleen anon-key), append-only audit, human-in-the-loop, migratie-eerst-dán-deploy, snapshot-integriteit, geen schijnzekerheid.
- **In te zetten subagents** (per `SUBAGENTS-ONTWERP.md` §4 triggermatrix) — zie per ticket hieronder; `ontwerp-sync-reviewer` altijd vóór merge.
- **Werkmodus:** eerst **Plan-modus**; pas bouwen na expliciet akkoord.
- **Definition of Done (`CLAUDE.md`):** functionaliteit volgens requirements, RLS-impact gecontroleerd, audit-logging, tests (of gemotiveerd niet), `tsc --noEmit --skipLibCheck` groen, ontwerpdoc bijgewerkt + **ontwerp-sync-check groen**, `HANDOVER.md` release-historie bijgewerkt + decision-log-entry, en de **documentatiehaak**: bij deze gate/mijlpaal de `00–09`-set actualiseren volgens `00 Overzicht en status/release-template.md` (+ `06 Roadmap/releasehistorie.md` en de doc-actualisatie-log-marker).
- **Terugkoppeling** in het antwoordformat uit `CLAUDE.md`.

Elk van de vier tickets is een **gate/mijlpaal**, dus de documentatiehaak geldt telkens. Zonder deze afspraak expliciet af te wijken, wordt géén ticket uitgevoerd buiten deze conventie om.

## Voorwaarden vooraf (entry-criteria, vóór AQL-1)

- **Pre-implementation spikes** (technisch §8): headless generatiekern, achtergrond-jobmechanisme, tenanttoegang/veiligheid, retentie/privacy.
- **Seeding-gate** (pre-seed validatierapport §6): `content_hash` gevuld, AVG-scope SEC-06 bevestigd, juridische duiding BS-06/BV-04/SEC-04 gevalideerd, judge-JSON-schema's gedefinieerd.

---

## AQL-1 — Fundament & seed

**Doel:** datamodel staat, migraties zijn idempotent en RLS-conform, en de gevalideerde golden set is geseed.
**Bouwstenen:** `aqlab_`-kernmigraties (RLS aan, `WITH CHECK` op tenant-schrijfpaden); seeding-gate sluiten; seedloader met dry-run default + `--apply`; 12 seedcriteria + consistency-config als code.
**Subagents:** `supabase-rls-reviewer`, `audit-evidence-reviewer`, `ontwerp-sync-reviewer`, `code-reviewer`.
**Impact:** RLS ja · audit `aqlab_log` (append-only) · migraties ja · documentatiehaak ja.
**Klaar wanneer:** migraties schoon in Supabase, cross-tenant-suite groen, `SEED_ALLOWED = true`, 3 testsets + 33 testcases + 24 fixtures geseed met post-seed-verificatie groen.

## AQL-2 — Run-engine & scoring

**Doel:** een run draait reproduceerbaar dezelfde generatiekern als productie, scoort output en toont de scorekaart.
**Bouwstenen:** headless generatie-adapter (`genereerAntwoord()` uit chat-route); run-orchestrator (async jobs, snapshot refs_only, effectieve modelinstellingen); auto-checks (`*.sanity.ts`) + LLM-judge (vast JSON-schema, apart gepind model); scorekaart met `quality_score` gescheiden van `gate_status` + dimensievloeren.
**Subagents:** `ai-governance-reviewer` (schijnzekerheid, human-in-the-loop), `audit-evidence-reviewer`, `ontwerp-sync-reviewer`, `code-reviewer`.
**Impact:** RLS n.v.t. (provider-globaal) · audit runs/outputs · migraties beperkt · documentatiehaak ja.
**Klaar wanneer:** streaming-route ongewijzigd, Lab draait exact dezelfde kern, scorekaart per output zichtbaar in de platform-console.

## AQL-3 — Consistentie & regressie

**Doel:** consistentie (stabiliteit én correctheid, **ADR 0056**), baseline-vs-challenger-regressie en de drie run-types werken.
**Bouwstenen:** consistentiemeting binnen één run incl. correctheidsmaten + `consistent_but_incorrect` + source-/retrieval-stability (implementeert `decisions/0056`); baseline = laatst vrijgegeven releasebesluit; run-types full/subset/ad-hoc + "opslaan als testcase"; run-overzicht (incl. performance) + testcase-overzicht.
**Subagents:** `ai-governance-reviewer`, `ontwerp-sync-reviewer`, `code-reviewer`.
**Impact:** RLS n.v.t. · audit runs · migraties (aggregaatvelden) · documentatiehaak ja; **verwerk ADR 0056 in technisch §7A en functioneel §scherm 6b**.
**Klaar wanneer:** consistentie-overzicht + Iteraties-tab zichtbaar, regressie-delta's + advies berekend, drie modi draaibaar.

## AQL-4 — Assurance, release & audit

**Doel:** vrijgavebesluit, read-only fonds-assurance en auditrapport sluiten de MVP-keten; DoD gehaald.
**Bouwstenen:** `aqlab_release_decisions` (append-only, 7 statussen, advies vs goedkeuring, kritieke bevinding + consistentie blokkeren vrijgave); read-only assurance-view in `governance` (scope-label, begrijpelijke termen, "wat betekent deze score wel/niet"); auditexport (HTML/PDF, `inhoud_hash`); DoD-afronding.
**Subagents:** `supabase-rls-reviewer`, `audit-evidence-reviewer`, `ai-governance-reviewer`, `ai-literacy-ux-reviewer` (microcopy/disclaimers), `ontwerp-sync-reviewer`, `code-reviewer`.
**Impact:** RLS ja (tenant-leespad assurance) · audit append-only exports/besluiten · migraties ja · documentatiehaak ja.
**Klaar wanneer:** go/no-go herleidbaar vastgelegd, fonds ziet alleen aggregaten (nooit ruwe output), auditexport verifieerbaar (hash), Definition of Done volledig groen.

---

## Vervolgtickets (na de MVP)

- **AQL-5 — Console-UX & variantbeheer** (zie `AQLAB-WERKTICKET-AQL-5-…`).
- **AQL-6 — Multi-provider vergelijking** (OpenAI + Mistral naast Claude; zie `AQLAB-WERKTICKET-AQL-6-…`). **Interim:** reguliere OpenAI API (VS), no-training aan, uitsluitend synthetische data.

## Roadmap-item — EU-dataresidentie migratie (belangrijk, ingepland)

Verplaatsen van álle generatie naar **EU-residentie**, consistent voor baseline én challengers:

- **Claude** (baseline + judge) van de first-party Anthropic API (VS) naar **AWS Bedrock EU** (Frankfurt/Ierland/Parijs/Stockholm) of **Google Vertex AI EU** — de first-party API kent (nog) geen EU-residentie.
- **OpenAI** van de reguliere API (VS) naar **Azure OpenAI EU**.
- **Mistral** EU-instellingen/no-training bevestigen.

**Harde grens:** deze migratie is **verplicht vóórdat er echte fondsdata** (i.p.v. de synthetische golden set) via externe/US-providers wordt verwerkt — geldt ook voor de bestaande productie-chat, die nu op de VS-Anthropic-API draait. Impact: provider-abstractie (AQL-6) + auth/infra-wissel + verificatie van modelbeschikbaarheid/versies per EU-regio. Valideren met FG. Advies: start met een korte spike (modelbeschikbaarheid + één EU-adapter + retrieval-pariteit).

## Buiten deze roadmap (bewust later)

Fonds-specifieke assurance op echte fondsdocumenten (fonds-scoped tabellen + RLS + retentie), CI/CD-blokkade als merge-gate, multi-model-orchestratie, auditor-portaal, materialized snapshots, per-fonds scorecriteria. Zie architectuur §12 (MVP vs groeipad).

## Afhankelijkheden

AQL-1 hangt op de spikes + seeding-gate → AQL-2 op spike 1/2 → AQL-3 bouwt op AQL-2 en implementeert ADR 0056 → AQL-4 sluit de keten; DoD is het exit-criterium van de MVP.
