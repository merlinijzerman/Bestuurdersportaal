# Werkopdracht: Invaarprocedure — definitie + engine-uitbreidingen (D6/D7/D8)

> WO-1 van 2. Plak als eerste bericht in een Claude Code-sessie in de repo-root. Zie `decisions/0004` en `WERKOPDRACHT-TEMPLATE.md`.

---

**Doel & context** — Bouw de Wtp-invaarprocedure voor SPH als canonieke definitie én maak de proceduremodule-engine **parallel-by-default**, met aanpasbare vereisten en per-fonds fasebeschrijving. Zodat complexe, iteratieve procedures niet langer sequentieel worden afgedwongen en checklist/bewijslast tijdens de rit uitbreidbaar zijn.

**Goedgekeurd ontwerp/plan** — `mvp/PROCEDURE-ENGINE-V2-ONTWERP.md` is **leidend**; `03 Functioneel ontwerp/Procesontwerp-invaarprocedure-SPH-v0.1.md` is de functionele bron. Sluit aan op `Bestuurdersportaal - Proceduremodule generiek ontwerp v0.2` (fase B) en `decisions/0002` (definitie als data).

**Scope**
- **Wel:**
  - Canonieke definitie `mvp/definities/pensioenfondsen/pf_wtp_invaarbesluit@2.0.0.json` (SPH-fondsvariant, **géén blokkerende afhankelijkheden**) + Zod-schema en CI-/seed-validatie.
  - **D6** — parallelle activatie + heropenen: `blokkerende_afhankelijkheden` (generiek, leeg voor invaar), expliciet stap-statusmodel (`geblokkeerd/actief/afgerond/heropend`), `herberekenActiveerbaarheid()` i.p.v. auto-activeer-volgende, `herbevestiging_nodig`.
  - **D7** — aanpasbare checklist/bewijslast: `procedure_requirement_instance` (instantie-scoped), herkomst (`bron`) + soft-deactivate (`actief`) op checklist/requirements, **readiness-unie** (template + actieve instantie-items) in `fn_decision_readiness_check` en `buildEvidenceLijst`, governance-events + RLS.
  - **D8** — `procedure_template_fasen` (met generieke fasebeschrijving) + `procedure_fase_beschrijving_override` (fonds-override, fallback naar default) + `fase_code` op stappen.
- **Niet:** UI-consumptie (WO-2); in-app template-editor (fase G); AI-validatie/AI-controles; resolutie van de compliance-punten O1–O5 (die gaan naar openstaande-punten).

**Impactklasse** — **data + tenant/security**. Weging: nieuwe tabellen/kolommen, RLS/policies en governance-events. Daarom **vuurt de documentatiehaak** (00–09 + as-built Word volgens `00 Overzicht en status/release-template.md`; marker in `doc-actualisatie-log.md` **pas ná** de Word-actualisatie) en moeten de **structurele gates** (`supabase/checks/2026_07_31_r1_structurele_gates.sql`) schoon draaien tegen de doeldatabase.

**Relevante bestanden / modules** — `mvp/lib/decision.ts`, `mvp/lib/proces-templates.ts`, tabellen `procedure_stappen`/`procedure_checklist`/`procedure_requirements`, functies `fn_decision_readiness_check` + `buildEvidenceLijst`, `supabase/migrations/*`, nieuw `mvp/definities/pensioenfondsen/`, `09 Objectenmodel`. Claude Code verifieert tegen de werkelijke code.

**Guardrails (zie `CLAUDE.md`)** — bijzondere aandacht: append-only audit (0001/0024); fonds-RLS server-side (`fonds_id` nooit uit de request); snapshot-integriteit (lopende procedures wijzigen niet mee met een nieuwe templateversie); een blokkerende vereiste deactiveren kan **alleen met motivering** (REQ-006); de readiness-unie mag geen dubbeltelling van template- en instantie-items geven.

**In te zetten subagents** — `supabase-rls-reviewer`, `audit-evidence-reviewer`, `code-reviewer`; en **`ontwerp-sync-reviewer` vóór merge** — koppel parallel-by-default terug naar `Proceduremodule generiek ontwerp v0.2` (dat ging nog van sequentieel uit).

**Werkmodus** — begin in **Plan-modus**: lever eerst een implementatieplan (bestanden, RLS-impact, migratie-impact, testaanpak, risico's). **Wijzig pas na expliciet akkoord.**

**Definition of Done** — volg `CLAUDE.md` §Definition of Done. Opdracht-specifiek: ontwerpdoc = `PROCEDURE-ENGINE-V2-ONTWERP.md`; decision-records `decisions/0174…` voor D6/D7/D8 (mag gebundeld, vgl. `0006`); de testklassen uit §8 groen (parallelle-start, gate-fixture, heropen, aanpasbaarheid-readiness, governance/RLS, fonds-override, snapshot-integriteit); structurele gates schoon; documentatiehaak volledig afgerond.

**Openstaande punten** — leg de compliance-punten **O1–O5** (review) en **OB-E1..E4** (ontwerp) vast in `00 Overzicht en status/openstaande-punten-en-risicos.md`, **mét eigenaar** (compliance/actuarieel resp. tech-lead).

**Terugkoppeling** — rapporteer in het antwoordformat uit `CLAUDE.md` (samenvatting, aangepaste bestanden, RLS/security-impact, audit-impact, datamodel/migratie-impact, test/verificatie, openstaande risico's).
