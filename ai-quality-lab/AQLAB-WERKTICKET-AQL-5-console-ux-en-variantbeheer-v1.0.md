# Werkopdracht AQL-5 — Console-UX & variantbeheer (AI Quality Lab)

- **Ticket:** AQL-5 (UX-/bruikbaarheidsiteratie na AQL-1..4) · **Versie:** v1.0 · **Datum:** 2026-07-11
- **Overdracht:** goedgekeurd in plansessie (Cowork, mockups doorlopen) → uit te voeren in Claude Code, repo-root. Zie `WERKOPDRACHT-TEMPLATE.md` en `decisions/0004`.
- **Werkmodus:** begin in **Plan-modus**. Lever eerst een implementatieplan; wijzig pas ná expliciet akkoord.

---

## Doel & context

De AQLab-console werkt technisch (AQL-1..4), maar het "Run samenstellen"- en het "Run-uitkomst"-scherm zijn nog niet bruikbaarsvriendelijk: velden staan plat naast elkaar ongeacht run-type, het is onduidelijk wat het huidige productiemodel is en wat je ertegenaf zet, en **je kunt geen ander model kiezen** omdat er geen modelconfiguraties zijn geseed. AQL-5 maakt de console bruikbaar: een duidelijke **baseline → challenger**-flow, een gevulde modelkeuze (variantbeheer-light), instelbare tokens/temperature, benoembare runs, en een vergelijkende uitkomstweergave.

## Goedgekeurd ontwerp/plan (leidend)

- **Mockups (leidend):** `ai-quality-lab/AQLAB-MOCKUP-run-samenstellen-v0.1.html` en `ai-quality-lab/AQLAB-MOCKUP-run-uitkomst-v0.1.html`.
- **Ontwerp:** `AI-QUALITY-LAB-FUNCTIONEEL.md` (scherm 3 run samenstellen, §2.5 run-types, scherm 4 outputvergelijking, scherm 6 regressierapport) en `AI-QUALITY-LAB-TECHNISCH.md` (§2.5 `aqlab_model_configurations`, §2.6 `aqlab_runs`, §2B reproduceerbaarheid effectieve instellingen, §7 performance-aggregatie).
- **ADR-raakvlak:** decision 0058 (aqlab_* deny-by-default + service-role-wrapper).

> Bij twijfel wint de code + `supabase/migrations/`. Verifieer aannames tegen de migraties en `lib/aqlab/*` vóór je bouwt.

## Entry-criteria

- **AQL-1..4 gebouwd** (datamodel, run-engine, scoring, consistentie, regressie, release/assurance werken; scorekaart + run-detail bestaan).

## Vastgestelde feiten (geverifieerd in de code)

- De modeldropdown leest uit `aqlab_model_configurations`; de seed (`lib/aqlab/seed/apply.ts`) seedt **géén** modelconfiguraties → dropdown is leeg op de placeholder na (oorzaak "kan niet switchen").
- Beschikbare modellen in de techniek: `claude-sonnet-4-6` (productiekern `AI_MODEL`, `lib/generatie-kern.ts`), `claude-opus-4-8` (judge, `lib/aqlab/judge.ts`), `claude-haiku-4-5-20251001` (hulp), `claude-sonnet-4-5` (ouder). De kostentabel in `lib/aqlab/run-orchestrator.ts` kent al de eerste drie.
- De generatie-adapter (`lib/aqlab/generate-adapter.ts`) accepteert al `cfg.model/maxTokens/temperature/topP`; productie zet temperature/top_p bewust **niet** (provider-default, §2B).
- `aqlab_runs` heeft al een `notitie`-kolom (`2026_07_10_aqlab_2_runs.sql`), maar die wordt in `acties.ts` hard gevuld met "Gestart door …" en nergens getoond.
- Mistral zit in de stack, maar **alleen voor embeddings/OCR** (`lib/embeddings.ts`, `lib/ocr.ts`), niet voor generatie.

## Scope

**Wel — Run samenstellen (input, scherm 3)**
1. **Progressive disclosure:** het run-type stuurt welke velden verschijnen (baseline/challenger alleen bij regressie/subset; ad-hoc-vraag alleen bij ad_hoc; subset-selectie alleen bij subset).
2. **Baseline → challenger** als expliciete vergelijking: links de **vaste productie-baseline** (laatst vrijgegeven variant uit `aqlab_release_decisions`), rechts de **challenger-keuze**. De **"gewijzigde as" wordt automatisch afgeleid** (niet meer handmatig gekozen).
3. **Modelkeuze vullen (variantbeheer-light):** seed een starter-set `aqlab_model_configurations` — *Productiekern* (`claude-sonnet-4-6`, `is_baseline = true`), *Opus-challenger* (`claude-opus-4-8`), *Haiku-challenger* (`claude-haiku-4-5-20251001`); optioneel `claude-sonnet-4-5`. Introduceer een **allowlist-constante** `AQLAB_TOEGESTANE_MODELLEN` (afgeleid van de infra + API-key); modelkeuze is nooit vrije tekst.
4. **Challenger-instellingen** (tokens / temperature / top-p) **zonder naam**: worden automatisch **append-only gepind als een `aqlab_model_configurations`-rij** (BESLOTEN — optie A). Om wildgroei te voorkomen: **dedup-op-hash** over (model + temperature + max_tokens + top_p + retrieval) — bestaat er al een identieke config, hergebruik die (upsert op de hash-sleutel); anders één nieuwe append-only rij. De config krijgt een **interne auto-naam** (bv. `sonnet-4-6 · temp0.2 · 3200`), zodat de gebruiker niets hoeft te benoemen. De run verwijst via `model_configuration_id`; een release verwijst zo naar een onveranderlijke, herbruikbare variant (§2B). Temperature als *"provider-default (zoals productie)"* vs *"expliciet"* — bij expliciet een waarschuwing dat de variant afwijkt van wat live draait.
5. **Run benoembaar:** voeg een aparte kolom **`naam text`** toe aan `aqlab_runs` (naast `notitie` voor vrije toelichting); vul uit het formulier; toon in de runs-lijst (`lijstRuns`) en in de run-header.
6. **Proactieve vereisten/blokkers** (CLAUDE.md-UX-principe): toon vóór het starten wat ontbreekt en disable de knop met reden (regressie zonder security/safety-set kan nooit "accepteren"; lege testset; enz.).
7. **Empty-state-begeleiding** ("nog geen testset geseed → doe X") en opruimen van de **ad-hoc-redundantie** (nu zowel knop bovenaan als run-type).

**Wel — Run-uitkomst (output)**
8. **Performance vergelijkend** tonen: latency (gem/mediaan/P95), tokens/kosten en uitkomsten (voldoet/geblokkeerd/review) **baseline naast challenger** — beide runs hebben `aggregatie.performance`; laad de baseline-performance mee in `haalRunDetail`.
9. **Outputvergelijking uitklapbaar** per testcase (`<details>` per rij; samenvatting toont code + scores + gate), zodat 33 outputs overzichtelijk blijven.
10. Behoud/borg de bestaande scheiding **`quality_score` (gradueel) vs `gate_status` (categorisch)** en de per-testcase regressie-deltatabel.

**Niet (bewust later / apart besluit)**
- **Mistral als generatie-challenger** (multi-provider): vereist een provider-abstractie in de generatie-adapter + Mistral-generatieclient + kostenrow + governance-labeling, en doorbreekt "exact dezelfde kern als productie". Leg dit vast als **apart decision-record**, niet in dit ticket.
- **Vrije run-vs-run-kiezer** (willekeurig twee bestaande runs vergelijken) en **trend over meerdere runs** (`aqlab_regression_results`) — later.
- Volledig beheerscherm om willekeurige modellen aan de allowlist toe te voegen — MVP = code-constante.

## Relevante bestanden / modules (verifiëren tegen echte code)

- Input: `app/(platform)/platform/(beveiligd)/aqlab/page.tsx`, `.../aqlab/acties.ts`.
- Output: `app/(platform)/platform/(beveiligd)/aqlab/runs/[runId]/page.tsx`, `.../vergelijking-blok.tsx`, `.../regressie-blok.tsx`.
- Data/logica: `lib/aqlab/console-lees.ts` (`lijstRuns`, `haalModelConfiguraties`, `haalRunDetail`, `haalBaselineKandidaten`), `lib/aqlab/generate-adapter.ts`, `lib/aqlab/run-orchestrator.ts`, `lib/generatie-kern.ts`.
- Seed/config: nieuwe code-seed voor `aqlab_model_configurations` + `AQLAB_TOEGESTANE_MODELLEN` (bv. `lib/aqlab/modellen.ts`).
- Migratie: `supabase/migrations/<datum>_aqlab_5_run_naam.sql` (kolom `naam` op `aqlab_runs`) + `schema.sql` bijwerken.

## Guardrails (`CLAUDE.md` — niet-onderhandelbaar)

- **RLS/tenant-isolatie:** `aqlab_*` blijft provider-globaal, deny-by-default + service-role-wrapper (decision 0058); **geen service-role-key in client**; niets hiervan in de fonds-assurance-view.
- **Reproduceerbaarheid (§2B):** challenger-instellingen worden append-only gepind als effectieve instellingen; een modelconfig wordt niet ge-edit maar als nieuwe rij toegevoegd.
- **Geen schijnzekerheid:** expliciete temperature wijkt af van productie → waarschuwen; `quality_score` heft `gate_status` nooit op.
- **Append-only audit:** modelconfig-aanmaak en run-naamgeving via `aqlab_log`; migratie-eerst-dán-deploy; bestaande migraties niet wijzigen.
- **AI-toon-systeemprompt** ongemoeid.

## In te zetten subagents (`SUBAGENTS-ONTWERP.md` §4)

`supabase-rls-reviewer` (nieuwe kolom + modelconfig-rijen), `audit-evidence-reviewer` (append-only config + naming gelogd, reproduceerbaarheid), `ai-literacy-ux-reviewer` (microcopy, disclaimers, twee-assen-duidelijkheid, provider-/temperature-waarschuwingen), `ai-governance-reviewer` (schijnzekerheid bij afwijkende instellingen), `code-reviewer`, en `ontwerp-sync-reviewer` vóór merge (werk functioneel scherm 3/4/6 + technisch §2.5/§2.6 bij).

## Werkmodus

Plan-modus eerst: (a) migratie `naam` + seed modelconfigs + allowlist, (b) baseline-afleiding uit release_decisions, (c) auto-pin van challenger-instellingen, (d) form-herstructurering + proactieve blokkers, (e) uitkomst: baseline-performance meeladen + uitklapbare vergelijking, (f) testaanpak + risico's. **Wijzig pas na akkoord.**

## Definition of Done (`CLAUDE.md`)

- [ ] Modeldropdown gevuld (≥3 modelconfigs geseed); gebruiker kan een **challenger-model kiezen** en baseline-vs-challenger draaien; modelkeuze via allowlist.
- [ ] Baseline (productie/laatst vrijgegeven) is expliciet zichtbaar; **"gewijzigde as" automatisch afgeleid**.
- [ ] Tokens/temperature/top-p instelbaar; instellingen worden append-only gepind als `aqlab_model_configurations`-rij met **dedup-op-hash** (geen wildgroei) + interne auto-naam; expliciete temperature waarschuwt (§2B, optie A besloten).
- [ ] Run heeft een **naam** (kolom `naam`), zichtbaar in runs-lijst + run-header; migratie idempotent, `schema.sql` bij.
- [ ] Formulier past zich aan het run-type aan; **vereisten/blokkers vooraf** zichtbaar, knop geblokkeerd met reden.
- [ ] Uitkomst: latency/tokens/kosten/uitkomsten **baseline naast challenger**; outputvergelijking **uitklapbaar** per testcase; `quality_score`/`gate_status`-scheiding intact.
- [ ] RLS/deny-by-default intact; append-only logging van modelconfig + naming; **geen service-role in client**.
- [ ] `./node_modules/.bin/tsc --noEmit --skipLibCheck` groen; `npm run sanity` + cross-tenant-suite groen; `npm run aqlab:smoke` draait.
- [ ] **Documentatiehaak:** `HANDOVER.md` + decision-log-entry (o.a. run-`naam`, modelconfig-seed, allowlist); functioneel/technisch bijgewerkt; ontwerp-sync-check groen.
- [ ] **Apart decision-record** aangemaakt voor "multi-provider (Mistral) generatie: wel/niet" (scope-out, expliciet vastgelegd).

## Terugkoppeling (antwoordformat `CLAUDE.md`)

(1) samenvatting, (2) aangepaste bestanden, (3) RLS/security-impact, (4) audit-logging-impact, (5) datamodel/migratie-impact (kolom `naam`, modelconfig-seed), (6) test/verificatie, (7) openstaande risico's / vervolg (multi-provider, run-vs-run-kiezer, trend).
