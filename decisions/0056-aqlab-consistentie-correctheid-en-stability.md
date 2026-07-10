# 0056 — AQLab: consistentie = stabiliteit én correctheid; source- vs retrieval-stability

- **Status:** Geaccepteerd
- **Datum:** 2026-07-10
- **Betrokkenen:** AI Governance Owner, AI Risk & Compliance Reviewer, Merlin (akkoord 2026-07-10)
- **Leidend ontwerp:** AI Output Quality & Governance Lab — regressieset v0.4, technisch ontwerp v0.5 (§7A consistentie-aggregaat), functioneel v0.5 (§scherm 6b, §6.3b). Aanleiding: pre-seed validatierapport v0.1 (§3 en §4).

## Context

De consistentiemeting van AQLab draait een testcase/ad-hoc vraag meerdere keren als iteratie binnen één run en beoordeelt de spreiding. De huidige meting meet **stabiliteit** (identiek over iteraties). Voor een bestuurlijk governanceproduct is dat onvoldoende op twee punten: (1) een output die 5/5 keer *hetzelfde maar fout* is, scoort hoog op stabiliteit — consistent fout gedrag zou positief scoren; (2) er is één bronmetric, waardoor niet zichtbaar is of instabiliteit uit de retrieval-laag of uit generatie/citatie komt. Randvoorwaarden die meewegen: reproduceerbaarheid/audit, geen schijnzekerheid richting bestuur, en aansluiting op het bestaande scoremodel (`quality_score` gescheiden van `gate_status`).

## Besluit

**1. Consistentie meet stabiliteit én correctheid.** `consistency_score` (stabiliteit) mag nooit zelfstandig `release_eligible` bepalen; vrijgave vereist stabiliteit **en** correctheid. Naast de stabiliteitsmaten worden `gate_pass_rate`, `fact_correctness_rate`, `source_correctness_rate`, `format_pass_rate` en `score_spread` berekend. Een stabiele maar inhoudelijk foute testcase krijgt `consistency_status = consistent_but_incorrect` en `release_eligible = false`; bij kritieke/safety/cijfercases is dat **blokkerend**.

**2. Onderscheid `source_stability` en `retrieval_stability`.** `source_stability` = stabiliteit van de bronnen die het model daadwerkelijk citeert/gebruikt (telt mee in releaseadvies). `retrieval_stability` = stabiliteit van wat de retrieval-laag teruggeeft (diagnostisch; **niet** zelfstandig release-blokkerend, tenzij het aantoonbaar tot een fout antwoord leidt). Beide worden in de run-output getoond.

## Overwogen alternatieven

- **Alleen stabiliteit meten (status quo)** — verworpen: laat consistent-fout gedrag positief scoren.
- **Correctheid uitsluitend via de judge** — verworpen als enige weg: waar deterministisch mogelijk (`expected_facts`, `required_sections`, gate) is dat betrouwbaarder; de judge blijft voor het zachte deel.
- **`retrieval_stability` ook release-blokkerend maken** — verworpen: retrieval mag variëren zolang het antwoord juist en stabiel-geciteerd blijft; blokkeren zou onnodig streng zijn en overlapt met `source_correctness_rate`/gate.

## Gevolgen

- **Datamodel/aggregaat:** `aqlab_runs.aggregatie.consistency[test_case_id]` krijgt de correctheidsmaten + `retrieval_stability`; `consistency_status` krijgt de extra waarde `consistent_but_incorrect`. Geen tabelbreuk — `aqlab_run_outputs` legt retrieval-trace (`snapshot_refs`/`retrieval_filter`) en geciteerde bronnen (`gebruikte_bronnen`) al apart vast.
- **Releaselogica:** `release_eligible = (stabiliteit voldoet) EN (correctheid voldoet) EN (geen kritieke/safety-blokkade)`.
- **UI:** het consistentie-overzicht (functioneel §scherm 6b) toont zowel stabiliteits- als correctheidsmaten en beide bronmetrics.
- **Reproduceerbaarheid/audit:** correctheid is deels deterministisch (`expected_facts`, gate, format), deels judge/mens (inhoudelijke juistheid buiten `expected_facts`) — dit wordt expliciet gelabeld, geen schijnzekerheid.
- **Doorvoering:** besluit **geaccepteerd 2026-07-10**, **geïmplementeerd in AQL-3 (2026-07-10)** — `lib/aqlab/consistency.ts::berekenConsistentie`, de regressie-doorwerking (`lib/aqlab/regression.ts` + `regression-core.ts`) en de UI (scherm 6b/6/4). Geen migratie nodig (aggregaat blijft JSON). Zie `decisions/0060`. De regressieset (v0.4) en fixtures blijven ongewijzigd.

## Referenties

- `ai-quality-lab/AQLAB-PRE-SEED-VALIDATIERAPPORT-v0.1.md` §3–§4.
- `ai-quality-lab/AI-QUALITY-LAB-TECHNISCH.md` §7A/§7B; `ai-quality-lab/AI-QUALITY-LAB-FUNCTIONEEL.md` §scherm 6b, §6.3b.
- `ai-quality-lab/AI-QUALITY-LAB-REGRESSIESET-v0.4.md` (consistentiemeting).
- `ai-quality-lab/AQLAB-ROADMAP.md` (iteratie 3: scoring + consistentie).
