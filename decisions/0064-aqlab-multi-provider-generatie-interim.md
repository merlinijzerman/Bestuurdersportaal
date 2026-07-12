# 0064 — AQLab: multi-provider generatie (OpenAI + Mistral) — interim, synthetic-only

- **Status:** Voorgesteld (governance-poort; wordt Geaccepteerd ná FG/DPO-akkoord)
- **Datum:** 2026-07-12
- **Betrokkenen:** Merlin (opdrachtgever); FG/DPO (akkoord op de interim-opzet vereist vóór de eerste externe call in productie)
- **Vervangt:** [[0063-aqlab-multi-provider-generatie-scope-out]] (Mistral-scope-out uit AQL-5)
- **Leidend:** werkopdracht AQL-6 v1.0. Raakvlak: [[0062-aqlab-aql5-console-ux-variantbeheer]], `AI-GOVERNANCE-ONTWERP.md`, roadmap-item "EU-dataresidentie migratie".

## Context

Het AI Quality Lab kon tot AQL-5 alleen Claude-varianten vergelijken (decision 0063 hield andere providers bewust buiten scope). De bestuurlijke vraag "moeten we (deels) van model/provider wisselen?" vraagt om een onderbouwde vergelijking op de golden set. AQL-6 opent die vergelijking naar **OpenAI (GPT)** en **Mistral**, met Claude als vaste baseline en judge.

Randvoorwaarden die meewegen: AVG/sub-verwerking (externe providers zijn nieuwe verwerkers), no-training, dataresidentie (reguliere OpenAI API = VS-verwerking), reproduceerbaarheid (provider bevriezen per output), en het vermijden van schijnzekerheid (provider + model als gewijzigde as → regressiesignaal minder zuiver toewijsbaar).

## Besluit

**OpenAI (reguliere API `api.openai.com`) en Mistral worden toegelaten als generatie-*challengers* in het Lab, uitsluitend op de synthetische golden set — nooit echte fondsdata.** Baseline blijft Claude (productie), de judge blijft Claude-opus (cross-provider = anti-bias). **No-training is vereist** (OpenAI API traint standaard niet op API-data; Mistral no-training op accountniveau geregeld). **EU-dataresidentie is in deze fase géén eis** en bewust uitgesteld naar de roadmap; reguliere OpenAI API (VS-verwerking) is daarom aanvaardbaar zolang alléén synthetische data wordt verzonden. Gemini/Google blijft buiten scope.

De koppeling wordt pas in productie geactiveerd (keys gezet) **nadat FG/DPO akkoord op deze interim-opzet heeft gegeven**; tot dat moment blijven de externe adapters ongebruikt (geen key → de adapter faalt hard).

## Overwogen alternatieven

- **Wachten tot de EU-migratie rond is** — verworpen: blokkeert de providervergelijking onnodig lang, terwijl de golden set synthetisch is en er dus geen fondsdata bij een US-provider terechtkomt.
- **Provider in de dedup-hash (`canoniekeVariant`) opnemen** — verworpen: modelnamen zijn provider-uniek (`claude-*`/`gpt-*`/`mistral-*`), dus het model draagt de identiteit al. Provider in de hash zou álle bestaande Anthropic-config-hashes kantelen en een re-seed forceren zonder functionele winst. Provider wordt wél vastgelegd op de config (`model_provider`) én bevroren per output (`aqlab_run_outputs.model_provider`, migratie `2026_07_12_aqlab_7`).
- **Officiële OpenAI/Mistral-SDK's** — verworpen voor nu: het bestaande Mistral-REST-patroon (`lib/embeddings.ts`, raw `fetch`) houdt de providerlaag verwisselbaar en dependency-vrij, en maakt de latere EU-endpoint-wissel een config-wissel (`OPENAI_BASE_URL` / `MISTRAL_CHAT_URL`) i.p.v. een herbouw.

## Gevolgen

- **Data-scope (hard):** externe providers draaien uitsluitend op synthetische data. Echte fondsdata via externe/US-providers is uitgesloten **tot de EU-dataresidentie-migratie is afgerond** (Azure OpenAI EU / Claude op Bedrock/Vertex EU / Mistral EU) — dat is een aparte, verplichte roadmap-stap vóór enige echte-data-koppeling.
- **Security:** nieuwe server-side keys (`OPENAI_API_KEY`, en `MISTRAL_API_KEY` nu óók voor chat/generatie), nooit `NEXT_PUBLIC_`. De endpoints komen uit base-URL-constanten zodat EU-omschakeling later een config-wissel is.
- **Reproduceerbaarheid/audit:** provider wordt bevroren op de modelconfig én per output; het append-only pin-spoor (`aqlab_log: modelconfig_pinned`) draagt nu de echte provider.
- **Geen schijnzekerheid:** een GPT-/Mistral-run test een *ander provider* dan productie. De gewijzigde as is **provider + model**; het signaal is minder zuiver aan één oorzaak toe te schrijven. De UI labelt dit expliciet (provider-badge + "ander provider dan productie"-waarschuwing). Baseline en judge blijven Claude.
- **Reasoning-modellen (o-serie/GPT-5):** toegevoegd als aparte modelklasse met eigen API-contract — `max_completion_tokens` i.p.v. `max_tokens`, **temperature/top_p vergrendeld** (de provider weigert ze), en een `reasoning_effort`-knop (minimal/low/medium/high). `reasoning_effort` is een reproduceerbare variant-as: gevraagd op de config (`reasoning_effort_requested`) én effectief per iteratie bevroren (`reasoning_effort_effective`), en telt in de config-hash alleen mee als het gezet is (back-compat, geen re-seed). De UI verbergt de sampling-knoppen voor deze modellen en toont in plaats daarvan de effort-keuze. Aandachtspunt: verborgen reasoning-tokens tellen mee in het token-/kostenbudget (te krap budget → afgekapt zichtbaar antwoord), dus `defaultMaxTokens` staat ruim en de kosten liggen hoger dan een chat-model met hetzelfde zichtbare antwoord. **Bewust nog buiten scope:** oudere o1-modellen (kunnen een `developer`- i.p.v. `system`-rol vereisen) en de Responses API (`max_output_tokens`); de huidige adapter draait op Chat Completions.
- **Bewust geaccepteerde schuld:** VS-verwerking bij reguliere OpenAI API in de interim-fase (gemitigeerd doordat alleen synthetische data wordt verzonden). Modelstrings (incl. `gpt-5*`), reasoning_effort-waarden (o.a. of `minimal` per model geldig is) en externe tarieven zijn indicatief en te verifiëren tegen het provider-account vóór productiegebruik.

## Referenties

- Provider-abstractie: `lib/llm-providers/{types,anthropic,openai,mistral,index}.ts`, dispatcher in `lib/generatie-kern.ts` (`genereerAntwoord`).
- Allowlist + provider: `lib/aqlab/modellen.ts`, seed `lib/aqlab/modellen-hash.ts`, pin `app/(platform)/platform/(beveiligd)/aqlab/acties.ts`.
- Kosten/usage: `lib/aqlab/run-orchestrator.ts` (`KOSTEN_PER_MTOK`, `laadModelConfig`).
- Migraties: `supabase/migrations/2026_07_12_aqlab_7_run_outputs_provider.sql` (provider bevriezen) + `2026_07_12_aqlab_8_reasoning_effort.sql` (reasoning_effort gevraagd + effectief).
- UI + labeling: `app/(platform)/platform/(beveiligd)/aqlab/run-samenstellen-form.tsx`.
- Tests: `lib/aqlab-modellen.sanity.ts`, `lib/aqlab/smoke.ts` (provider-pariteit).
