# 0063 — AQLab: multi-provider (Mistral) generatie-challenger — scope-out

- **Status:** Vervangen door [[0064-aqlab-multi-provider-generatie-interim]] (AQL-6, 2026-07-12) — multi-provider generatie (OpenAI + Mistral) is nu wél in scope, synthetic-only. Oorspronkelijk: Geaccepteerd (scope-out, expliciet uitgesteld)
- **Datum:** 2026-07-11
- **Betrokkenen:** Merlin (akkoord 2026-07-11, plansessie AQL-5)
- **Leidend ontwerp:** werkopdracht AQL-5 v1.0 ("Niet"-lijst); mockup `AQLAB-MOCKUP-run-samenstellen-v0.1.html` (toont Mistral als optie). Raakvlak: [[0062-aqlab-aql5-console-ux-variantbeheer]], HANDOVER release-historie 7 juni 2026 (Mistral als sub-verwerker voor embeddings/OCR).

## Context

De mockup voor "run samenstellen" toont `mistral-large-latest` als challenger-optie ("ander provider"). Mistral zit in de stack, maar **uitsluitend voor embeddings (`mistral-embed`) en OCR** (`lib/embeddings.ts`, `lib/ocr.ts`) — niet voor antwoordgeneratie. De AQLab-belofte is dat het Lab **exact dezelfde generatie-/retrievalkern als productie** draait; productie genereert op Anthropic (`claude-sonnet-4-6`).

## Besluit

**Mistral (of enig ander niet-Anthropic model) als generatie-challenger valt buiten AQL-5.** De allowlist `AQLAB_TOEGESTANE_MODELLEN` bevat uitsluitend Anthropic-modellen; de challenger-dropdown toont bewust géén Mistral (afwijking van de mockup, hier vastgelegd). De `MISTRAL_API_KEY` bestaat al voor embeddings/OCR, maar wordt niet voor generatie gebruikt.

## Overwogen alternatieven

- **Mistral nu meenemen als generatie-challenger** — verworpen voor de MVP: vereist (a) een provider-abstractie in `lib/aqlab/generate-adapter.ts` + `lib/generatie-kern.ts`, (b) een Mistral-generatieclient, (c) een kostentabelrij, (d) governance-labeling ("ander provider dan productie"), en het **doorbreekt "exact dezelfde kern als productie"** — de gewijzigde as wordt dan "provider + model" en het regressiesignaal is minder zuiver toewijsbaar. Te veel oppervlak voor een UX-iteratie.
- **Mistral tonen maar disablen** — verworpen: schijnkeuze; beter geheel weglaten tot het echt gebouwd is.

## Gevolgen

- Wordt heroverwogen als multi-provider-vergelijking een expliciet doel wordt. Dan minimaal: provider-abstractie, generatieclient, kostenrij, governance-labeling, en een aparte "gewijzigde as" `provider`/`provider+model`. De judge blijft Claude (`claude-opus-4-8`) — cross-provider judging is juist anti-bias en acceptabel.
- Geen code- of datamodel-impact in AQL-5; puur een expliciet vastgelegde scope-grens.
