# ADR AQLAB-0001 — Consistentie = stabiliteit én correctheid; source- vs retrieval-stability

- **Status:** voorgesteld (ter vaststelling)
- **Datum:** 2026-07-10
- **Context:** AI Output Quality & Governance Lab — consistentiemeting (regressieset v0.4, technisch v0.5)
- **Aanleiding:** pre-seed validatierapport v0.1, bevindingen §3 en §4
- **Reikwijdte:** raakt `lib/aqlab/consistency.ts` + het consistentie-aggregaat in `aqlab_runs.aggregatie` en de run-outputpresentatie. **Geen** herstructurering van de regressieset.

## Besluit 1 — Consistentie meet niet alleen stabiliteit, maar ook correctheid

**Probleem.** De consistentiemeting meet stabiliteit (identiek over iteraties). Een output die 5/5 keer *hetzelfde maar fout* antwoordt, scoort daardoor hoog. Stabiliteit zonder correctheid is misleidend voor een governanceproduct.

**Besluit.**

1. `consistency_score` (stabiliteit) mag **nooit zelfstandig** `release_eligible` bepalen.
2. `release_eligible` vereist **zowel stabiliteit als correctheid**.
3. Naast de stabiliteitsmaten worden expliciet **correctheidsmaten** berekend en vastgelegd:
   - `gate_pass_rate` — fractie iteraties met `gate_status = passed`;
   - `fact_correctness_rate` — fractie iteraties waarin de `expected_facts` **juist** zijn (niet slechts identiek);
   - `source_correctness_rate` — fractie iteraties met de **juiste** toegestane bronnen + correcte labels;
   - `format_pass_rate` — fractie iteraties met alle `required_sections`;
   - `score_spread` — spreiding van `quality_score` (stabiliteit, blijft behouden).
4. Als een testcase **stabiel maar inhoudelijk fout** is, geldt:
   - `consistency_status = consistent_but_incorrect`;
   - `release_eligible = false`;
   - bij **kritieke, safety- en cijfercases: blokkerend** (niet slechts *review_required*).

**Beslisregel (samengevat).** `release_eligible = (stabiliteit voldoet) EN (correctheid voldoet) EN (geen kritieke/safety blokkade)`. Hoge stabiliteit met lage `*_correctness_rate` ⇒ `consistent_but_incorrect` ⇒ niet vrijgeefbaar.

**Gevolgen.** De statuswaarde-set van `consistency_status` wordt uitgebreid met `consistent_but_incorrect` (naast `consistent`, `light_variation`, `review_required`, `unstable`). Het aggregaat en de UI (consistentie-overzicht) tonen zowel de stabiliteits- als de correctheidsmaten. Deterministisch meetbaar zijn `gate_pass_rate`, `fact_correctness_rate` (t.o.v. `expected_facts`), `format_pass_rate`; `source_correctness_rate` deels heuristisch; inhoudelijke juistheid buiten `expected_facts` blijft judge/mens.

## Besluit 2 — Onderscheid `source_stability` en `retrieval_stability`

**Probleem.** Eén bronmetric (`source_stability`) maakt niet zichtbaar of instabiliteit uit de retrieval-laag of uit generatie/citatie komt.

**Besluit.**

1. **`source_stability`** = stabiliteit van de bronnen die het **model daadwerkelijk citeert/gebruikt** in het antwoord (modelgedrag).
2. **`retrieval_stability`** = stabiliteit van de bronnen/chunks die de **retrieval-laag teruggeeft** vóór generatie (infrastructuur).
3. **`source_stability` telt mee** in het releaseadvies (zoals nu).
4. **`retrieval_stability` is diagnostisch**: het helpt bij foutanalyse maar is **niet zelfstandig release-blokkerend**, tenzij het aantoonbaar tot een fout antwoord leidt (dan slaat het neer via `source_correctness_rate`/`gate`).
5. In de **run-output worden beide getoond**, zodat zichtbaar is of instabiliteit uit retrieval of uit generatie/citatie komt.

**Gevolgen.** Het consistentie-aggregaat krijgt een extra veld `retrieval_stability` naast `source_stability`. De runner legt per iteratie zowel de retrieval-trace (bron-ID's/chunks vóór generatie) als de geciteerde bronnen (in de output) vast — `aqlab_run_outputs` bevat beide al conceptueel (`snapshot_refs`/`retrieval_filter` vs `gebruikte_bronnen`). Geen datamodel-breuk; het is een afgeleide metric + een presentatieregel.

## Alternatieven overwogen

- *Alleen stabiliteit meten (status quo).* Verworpen: laat consistent-fout gedrag positief scoren.
- *Correctheid alleen via de judge.* Verworpen als enige weg: waar deterministisch mogelijk (`expected_facts`, `required_sections`, gate) is dat betrouwbaarder; judge blijft voor het zachte deel.
- *`retrieval_stability` ook blokkerend maken.* Verworpen: retrieval mag variëren zolang het antwoord juist en stabiel-geciteerd blijft; blokkeren zou onnodig streng zijn.

## Status van doorvoering

Dit is een **ontwerpbesluit**, nog **niet geïmplementeerd**. Doorvoering raakt `lib/aqlab/consistency.ts`, het `aqlab_runs.aggregatie`-consistentieblok en de consistentie-overzicht-UI. De regressieset (v0.4) en de fixtures blijven ongewijzigd. Verwerken in technisch ontwerp §7A en functioneel §scherm 6b bij implementatie.

## Referenties

- Pre-seed validatierapport v0.1, §3 (source vs retrieval) en §4 (correctheid naast stabiliteit).
- Technisch ontwerp v0.5 §7A (consistentie-aggregaat), §7B (persist_mode).
- Functioneel ontwerp v0.5 §scherm 6b (consistentie-overzicht), §6.3b (consistentie in releaseadvies).
- Regressieset v0.4 — consistentiemeting.
