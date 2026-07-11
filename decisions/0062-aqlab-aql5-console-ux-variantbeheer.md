# 0062 — AQLab AQL-5: console-UX & variantbeheer-light

- **Status:** Geaccepteerd
- **Datum:** 2026-07-11
- **Betrokkenen:** Merlin (akkoord 2026-07-11, plansessie AQL-5 in Cowork; mockups doorlopen)
- **Leidend ontwerp:** werkopdracht AQL-5 v1.0; mockups `ai-quality-lab/AQLAB-MOCKUP-run-samenstellen-v0.1.html` + `AQLAB-MOCKUP-run-uitkomst-v0.1.html`; `AI-QUALITY-LAB-FUNCTIONEEL.md` (scherm 3/4/6, §2.5) + `AI-QUALITY-LAB-TECHNISCH.md` (§2.5/§2.6/§2B/§7). Raakvlak: [[project_bestuurdersportaal]], ADR 0058 (aqlab_* deny-by-default + service-role-wrapper), ADR 0059/0060/0061 (AQL-2..4).

## Context

De AQLab-console werkte technisch (AQL-1..4) maar was niet bruikbaar: de modeldropdown was leeg (geen modelconfiguraties geseed → "kan niet switchen"), velden stonden plat naast elkaar ongeacht run-type, en het was onduidelijk wat de productie-baseline was en wat je ertegen afzette. AQL-5 maakt de console bruikbaar zonder de guardrails (RLS, append-only, reproduceerbaarheid, geen schijnzekerheid) te raken.

## Besluit

**1. Modelkeuze via een code-constante allowlist, geseed als starter-set.** `AQLAB_TOEGESTANE_MODELLEN` (`lib/aqlab/modellen.ts`) is de enige bron van toegestane generatiemodellen: `claude-sonnet-4-6` (productiekern, `is_baseline`), `claude-opus-4-8`, `claude-haiku-4-5-20251001`, `claude-sonnet-4-5`. Modelkeuze is **nooit vrije tekst** (`isToegestaanModel`-check server-side). Seeden gebeurt via een **code-seed** (`npm run aqlab:seed:modellen` → `seedStarterModelConfigs`), idempotent en dedup-op-hash — bewust náást de gate-bewaakte golden-set-loader, want dit zijn code-constante modelinstellingen (geen synthetische fondsdata) en hoeven niet achter de seeding-gate te wachten.

**2. Challenger-instellingen worden append-only gepind met dedup-op-hash (besloten optie A, §2B).** Tokens/temperature/top-p worden zonder naam gepind als `aqlab_model_configurations`-rij. Om wildgroei te voorkomen: **`config_hash`** (sha256 over model + temperature + max_tokens + top_p + retrieval, uniek). Een identieke variant hergebruikt de bestaande rij (reuse-of-append); een nieuwe rij krijgt een interne **auto-naam** (`sonnet-4-6 · temp0.2 · 3200`) en wordt **append-only gelogd** (`aqlab_log`, actie `modelconfig_pinned`). De hash-implementatie leeft **uitsluitend in TS** (`lib/aqlab/modellen-hash.ts`) — de migratie berekent niets (single source of truth). Expliciete temperature levert een §2B-waarschuwing (variant wijkt af van productie, dat provider-default draait).

**3. Baseline → challenger als expliciete vergelijking; "gewijzigde as" automatisch afgeleid.** De vaste productie-baseline is de **laatst vrijgegeven variant** uit `aqlab_release_decisions` (release_status=`vrijgegeven`) voor de feature van de testset (`haalProductieBaseline`). De handmatige `gewijzigde_as`-dropdown vervalt; `leidGewijzigdeAsAf` leidt de as af uit baseline-vs-challenger (`geen`/`model`/`temperature`/`max_tokens`/`retrieval`/`meerdere`). Omdat de DB-enum geen aparte `top_p`-as kent, telt een top_p-wijziging onder de sampling-as `temperature`. Zonder vrijgegeven baseline (o.a. de security/safety-set, `feature_id=null`) valt de UI terug op de productiekern-default zonder harde blokkade.

**4. Run benoembaar via een aparte kolom `naam`** (naast `notitie` voor vrije toelichting), zichtbaar in de runs-lijst en de run-header.

**5. Formulier volgt het run-type (progressive disclosure) met proactieve blokkers.** De client-form (`run-samenstellen-form.tsx`) toont baseline→challenger + testset alleen bij regressie/subset, ad-hoc-vraag alleen bij ad_hoc, subset-selectie alleen bij subset. Vereisten/blokkers staan vóóraf zichtbaar en blokkeren de knop met reden (lege testset, testset zonder cases, ad-hoc zonder vraag; empty-state "nog geen testset geseed"). **Deze gating wordt server-side her-gevalideerd** in `startRunActie` (CLAUDE.md: gating hoort niet uitsluitend in de frontend).

**6. Uitkomst vergelijkend.** De run-detail laadt de baseline-performance mee (`haalRunPerformance`) en toont latency/tokens/kosten/uitkomsten **baseline naast challenger** (`performance-vergelijking-blok.tsx`). De outputvergelijking is **uitklapbaar** per testcase (`<details>` met samenvatting code + scores + gate). De scheiding `quality_score` (gradueel) vs `gate_status` (categorisch) en de per-testcase regressie-deltatabel blijven intact.

## Overwogen alternatieven

- **Modelconfigs seeden in de migratie (SQL INSERT met vooraf berekende hashes)** — verworpen: dupliceert de hash-logica in SQL (drift-risico met de TS-hash). Code-seed houdt één hash-implementatie.
- **Vrije modelinvoer / beheerscherm voor de allowlist** — verworpen voor de MVP: code-constante is voldoende en veiliger.
- **Handmatige "gewijzigde as"** (bestaand) — verworpen: foutgevoelig; automatisch afleiden uit baseline-vs-challenger is betrouwbaarder.
- **Naam in `notitie` hergebruiken** — verworpen: `notitie` is vrije toelichting (nu "Gestart door …"); een aparte `naam`-kolom is zuiverder.

## Gevolgen

- **Datamodel/migratie:** `2026_07_11_aqlab_6_console_ux.sql` (+ROLLBACK) — `aqlab_runs.naam` + `aqlab_model_configurations.config_hash` (uniek, niet-partieel: NULLs distinct → bestaande rijen ok + ON CONFLICT-dedup). Idempotent; migratie-eerst, dán deploy, dán `npm run aqlab:seed:modellen`.
- **RLS/security:** ongewijzigd. `aqlab_*` blijft deny-by-default + service-role-wrapper (0058); geen service-role in client; nieuwe kolommen erven de RLS; niets richting de fonds-assurance-view. Nieuwe kolommen zonder policy → T3-dekkingsgate blijft groen.
- **Audit:** modelconfig-seed (`modelconfig_seed`), modelconfig-pinning (`modelconfig_pinned`) en run-naam (op de run) lopen via `aqlab_log`/`aqlab_runs` append-only.
- **Reproduceerbaarheid (§2B):** een modelconfig wordt nooit ge-edit; identieke instellingen deduppen op hash, afwijkende worden nieuw geappend. Effectieve instellingen blijven per output bevroren.
- **Ontwerp-sync:** functioneel scherm 3/4/6 + technisch §2.5/§2.6 aangevuld met run-`naam`, allowlist/starter-seed en `config_hash`-dedup. Kostentabel `KOSTEN_PER_MTOK` uitgebreid met `claude-sonnet-4-5`.
- **Scope-out:** multi-provider (Mistral) generatie is bewust uitgesteld en apart vastgelegd in [[0063-aqlab-multi-provider-generatie-scope-out]]; de mockup toont Mistral als optie, de implementatie laat het bewust weg.
