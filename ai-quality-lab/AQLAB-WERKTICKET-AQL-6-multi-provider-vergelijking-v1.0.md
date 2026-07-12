# Werkopdracht AQL-6 — Multi-provider vergelijking (OpenAI + Mistral naast Claude)

- **Ticket:** AQL-6 (multi-provider-uitbreiding, bouwt op AQL-5) · **Versie:** v1.0 · **Datum:** 2026-07-11
- **Overdracht:** goedgekeurd in plansessie (Cowork) → uit te voeren in Claude Code, repo-root. Zie `WERKOPDRACHT-TEMPLATE.md` en `decisions/0004`.
- **Werkmodus:** begin in **Plan-modus**. Wijzig pas ná expliciet akkoord.
- **Besloten (interim, plansessie 2026-07-11):** challengers = **OpenAI (reguliere API `api.openai.com`)** en **Mistral-generatie** (Gemini bewust buiten scope). **No-training aan**, maar **EU-residentie nu níét vereist** — bewust uitgesteld naar de roadmap (zie roadmap-item "EU-dataresidentie migratie"). Harde voorwaarde in deze fase: externe providers draaien **uitsluitend op de synthetische golden set — géén echte fondsdata**.

---

## Doel & context

Het Lab kan nu alleen Claude-varianten vergelijken. AQL-6 opent de vergelijking naar **andere providers** (OpenAI/GPT en Mistral-generatie), zodat de vraag "moeten we (deels) van model/provider wisselen?" met de golden set onderbouwd kan worden. **Baseline blijft Claude (productie)**; andere providers zijn uitsluitend challengers en worden expliciet gelabeld. De judge blijft Claude-opus (cross-provider = anti-bias).

> Kernbelofte-nuance: productie draait op Claude. Een GPT-/Mistral-run test een *ander provider* — legitiem voor providervergelijking, maar het is niet "test wat live draait". De "gewijzigde as" is daarmee **provider + model**; het regressiesignaal is minder zuiver toewijsbaar (label dit expliciet, geen schijnzekerheid).

## Vastgestelde feiten (geverifieerd in de code)

- De allowlist `AQLAB_TOEGESTANE_MODELLEN` (`lib/aqlab/modellen.ts`) en de dedup-hash (`lib/aqlab/modellen-hash.ts`) bestaan al, maar zijn **Anthropic-only**: `model_provider` staat hard op `"anthropic"` en de sanity-test bevestigt dat `gpt-4o` wordt geweigerd (`lib/aqlab-modellen.sanity.ts`).
- De generatiekern (`lib/generatie-kern.ts` → `genereerAntwoord`, via `lib/aqlab/generate-adapter.ts`) praat **alleen Anthropic**.
- De kostentabel `KOSTEN_PER_MTOK` (`lib/aqlab/run-orchestrator.ts`) kent alleen Claude-modellen.
- **Geen** OpenAI-client/‑key aanwezig. **Mistral** heeft al een `MISTRAL_API_KEY` + REST-patroon, maar alleen voor embeddings/OCR (`lib/embeddings.ts`, `lib/ocr.ts`) — niet voor generatie.

## Entry-criteria (blokkerend)

- **AQL-5 gebouwd** (allowlist + modelconfig-dedup + variantbeheer-light).
- **Governance-poort groen (zie scope 1)** — geen provider-koppeling vóór no-training + DPA + synthetic-only bevestigd (EU-residentie is in deze fase géén eis, wel roadmap).

## Scope

**Wel**
1. **Governance-poort eerst (hard, blokkerend) — interim-variant.** Decision-record "multi-provider generatie (interim)" met: gekozen providers (OpenAI reguliere API, Mistral), **no-training bevestigd** (OpenAI API traint standaard niet op API-data; Mistral no-training regelen), DPA/sub-verwerker-akkoord, FG/DPO-akkoord op de **interim-opzet**, en de **harde afbakening: alleen synthetische data — geen echte fondsdata via externe providers**. **EU-residentie is in deze fase géén eis** (reguliere OpenAI API = VS-verwerking; bewust geaccepteerd omdat de golden set synthetisch is). De EU-migratie staat als apart roadmap-item ("EU-dataresidentie migratie") en is **verplicht vóór** enige echte fondsdata via externe/US-providers loopt. Koppeling start pas als dit decision-record groen is.
2. **Provider-abstractie in de generatiekern.** Refactor `genereerAntwoord` naar een provider-interface (input: system-blokken + berichten + model + max_tokens + temperature + top_p → output `{tekst, tokens{in,out}, latency}`), met adapters: `anthropic` (bestaand, ongewijzigd gedrag), `openai`, `mistral`. Prompt-/usage-mapping per provider (OpenAI chat-messages met system-rol; Mistral chat-completions). **Retrieval/RAG en `[Bron N]`-labels blijven identiek** — alleen het generatiemodel swapt.
3. **Clients + keys (server-side, nooit `NEXT_PUBLIC_`).** Nieuwe `OPENAI_API_KEY` (reguliere `api.openai.com`); Mistral-generatie-endpoint via de **bestaande** `MISTRAL_API_KEY` (verifieer dat het plan generatie/chat-completions dekt en zet no-training aan). Volg het bestaande Mistral-REST-patroon of een officiële SDK. **De client-laag zo bouwen dat later omschakelen naar EU-endpoints (Azure OpenAI EU / Claude op Bedrock/Vertex EU) een config-/endpoint-wissel is, geen herbouw.**
4. **Allowlist + configs + kosten uitbreiden.** `modellen.ts`: provider-dimensie + entries voor de toegestane GPT- en Mistral-generatiemodellen; `modellen-hash.ts` de **echte** provider laten dragen (niet hardcoded `anthropic`); `KOSTEN_PER_MTOK` uitbreiden; usage-/effectieve-instellingen-mapping per provider (`temperature/top_p/max_tokens`, `provider_default_used`, token-usage-velden verschillen); sanity-test bijwerken.
5. **UI + labeling.** Challenger-dropdown **groeperen per provider** (Anthropic / OpenAI / Mistral) met provider-badge en de bestaande "ander provider dan productie"-waarschuwing. Baseline blijft Claude; judge blijft Claude-opus. "Gewijzigde as" toont **provider + model**.

**Niet (bewust)**
- **Google/Gemini** — buiten scope in deze iteratie.
- **EU-residentie / EU-migratie** (Azure OpenAI EU + Claude op Bedrock/Vertex EU + Mistral EU-instellingen) — **op de roadmap**, niet in dit ticket. In deze fase reguliere OpenAI API (VS) toegestaan, uitsluitend op synthetische data.
- **Echte fondsdata via externe providers** — uitgesloten tot de EU-migratie is afgerond (harde grens).
- Multi-model-**orchestratie** (meerdere challengers tegelijk) — blijft later; MVP = 1 challenger vs 1 baseline.

## Relevante bestanden / modules (verifiëren tegen echte code)

`lib/generatie-kern.ts`, `lib/aqlab/generate-adapter.ts` (provider-abstractie), `lib/aqlab/modellen.ts` + `lib/aqlab/modellen-hash.ts` + `lib/aqlab-modellen.sanity.ts` (allowlist/hash/provider), `lib/aqlab/run-orchestrator.ts` (kostentabel + usage), nieuwe provider-clients (bv. `lib/llm-providers/openai.ts`, `lib/llm-providers/mistral.ts`), UI: `app/(platform)/platform/(beveiligd)/aqlab/page.tsx`. Env: `.env.local` (nieuwe keys). Decision: `decisions/<nr>-aqlab-multi-provider.md`.

## Guardrails (`CLAUDE.md`)

- **Data-scope (hard):** externe providers uitsluitend op **synthetische** data; **géén echte fondsdata** via OpenAI/Mistral tot de EU-migratie is afgerond. No-training aan; DPA vooraf. EU-residentie is bewust uitgesteld (roadmap) en gedocumenteerd in het decision-record; geen externe provider vóór de governance-poort groen is.
- **Geen key in client;** server-side only.
- **Retrieval/`[Bron N]` intact** — alleen generatie swapt; brongebonden-checks blijven geldig.
- **Reproduceerbaarheid:** effectieve instellingen per provider bevriezen; provider vastgelegd op de config (§2B).
- **Geen schijnzekerheid:** provider+model als gewijzigde as labelen; signaal minder zuiver toewijsbaar; baseline blijft Claude.
- **Append-only audit** van modelconfig-aanmaak; migratie-eerst-dán-deploy.

## In te zetten subagents (`SUBAGENTS-ONTWERP.md` §4)

`ai-governance-reviewer` (sub-verwerker/AVG, no-training, schijnzekerheid), `audit-evidence-reviewer` (reproduceerbaarheid + logging per provider), `code-reviewer` (provider-abstractie, security van keys), `ai-literacy-ux-reviewer` (provider-labeling/waarschuwingen), `ontwerp-sync-reviewer` vóór merge (technisch §2.5 provider-veld + functioneel scherm 3). Betrek FG/DPO buiten de subagents om voor de governance-poort.

## Werkmodus

Plan-modus eerst: (a) decision-record + governance-poort, (b) provider-interface + adapters (bewijs retrieval/`[Bron N]` identiek), (c) allowlist/hash/kosten/usage-mapping, (d) clients/keys (EU), (e) UI-groepering + labeling, (f) testaanpak + risico's. **Wijzig pas na akkoord.**

## Definition of Done

- [ ] **Governance-poort groen** (no-training aantoonbaar + synthetic-only + DPA/FG-akkoord op de interim-opzet) en vastgelegd in een **decision-record** dat het uitstel van EU-residentie expliciet benoemt; geen externe call vóór dat moment.
- [ ] Provider-abstractie werkt; Anthropic-gedrag **ongewijzigd**; retrieval/`[Bron N]` aantoonbaar identiek over providers.
- [ ] **GPT- en Mistral-generatie draaibaar als challenger** en scoorbaar; kosten/latency/tokens getoond; baseline blijft Claude; judge blijft Claude-opus.
- [ ] Allowlist + `model_provider` (echt) + kostentabel + usage-mapping uitgebreid; sanity-test groen (nu inclusief toegestane GPT/Mistral-modellen).
- [ ] Keys server-side; geen `NEXT_PUBLIC_`; **synthetic-only afgedwongen** (geen echte fondsdata via externe providers); endpoint-config zo dat EU-omschakeling later een config-wissel is.
- [ ] `./node_modules/.bin/tsc --noEmit --skipLibCheck` groen; `npm run sanity` + cross-tenant-suite groen; `npm run aqlab:smoke` draait.
- [ ] **Documentatiehaak:** `HANDOVER.md` + decision-log; functioneel/technisch bijgewerkt (provider-veld, provider-labeling); ontwerp-sync-check groen.

## Terugkoppeling (antwoordformat `CLAUDE.md`)

(1) samenvatting, (2) aangepaste bestanden, (3) RLS/security-impact (keys, endpoints), (4) audit-logging-impact, (5) datamodel/migratie-impact, (6) test/verificatie (retrieval-pariteit, provider-runs), (7) openstaande risico's / vervolg (Gemini, fonds-specifieke data op externe providers, multi-challenger-orchestratie).
