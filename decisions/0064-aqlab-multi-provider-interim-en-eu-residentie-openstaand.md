# 0064 — AQLab multi-provider interim (reguliere OpenAI API) + EU-dataresidentie migratie openstaand

- **Status:** Geaccepteerd (interim) — **EU-dataresidentie openstaand**
- **Datum:** 2026-07-11
- **Betrokkenen:** Merlin (akkoord 2026-07-11, plansessie AQL-6)
- **Leidend ontwerp:** werkopdracht `AQLAB-WERKTICKET-AQL-6-multi-provider-vergelijking-v1.0.md`; `AQLAB-ROADMAP.md` (roadmap-item "EU-dataresidentie migratie"). Heropent het uitstel uit [[0063-aqlab-multi-provider-generatie-scope-out]].

## Context

0063 stelde multi-provider generatie bewust uit (scope-out, buiten AQL-5). Er is nu besloten multi-provider tóch te doen (AQL-6: OpenAI + Mistral als challenger naast Claude), maar **bewust interim zonder EU-residentie** om snelheid te maken. Bij het uitwerken bleek bovendien een blinde vlek: de **first-party Anthropic API (Claude) kent zelf geen EU-residentie** — verwerking is VS. De EU-eis raakt dus niet alleen de nieuwe challengers, maar ook de baseline (Claude) én de bestaande productie-chat, die nu al echte fondsdata op de VS-Anthropic-API verwerkt.

## Besluit

1. **Interim:** AQL-6 bouwt multi-provider op de **reguliere OpenAI API (`api.openai.com`, VS)** + **Mistral** (bestaande key). **No-training aan**; **uitsluitend op de synthetische golden set — geen echte fondsdata.** EU-residentie is bewust uitgesteld.
2. **Openstaand punt — EU-dataresidentie migratie:** alle generatie naar EU-residentie brengen — Claude naar **AWS Bedrock EU** of **Google Vertex AI EU**, OpenAI naar **Azure OpenAI EU**, Mistral EU-instellingen. Staat op de roadmap. **Harde grens:** verplicht vóórdat er echte fondsdata (i.p.v. synthetische) via externe/US-providers loopt.
3. **Openstaand punt — FG-check productie-dataresidentie:** de bestaande productie-chat verwerkt nú echte fondsdata op de VS-Anthropic-API (los van het Lab). Bewust bevestigen/agenderen met FG.

## Overwogen alternatieven

- **EU-endpoints nu verplichten** (Azure OpenAI EU + Claude op Bedrock/Vertex EU) — verworpen voor nu: veel infra-/auth-opzet vóórdat bewezen is dat providervergelijking waarde heeft; de synthetische golden set maakt tijdelijk uitstel verantwoord.
- **Multi-provider blijven uitstellen (0063 handhaven)** — verworpen: er is nu een concrete wens om GPT/Mistral tegen Claude te vergelijken.

## Gevolgen

- Interim AVG-risico beheerst door de **harde synthetic-only-grens**; geen deelnemers-/fondsdata naar OpenAI/Mistral.
- Twee punten blijven expliciet **open** (EU-migratie, FG-check productie) — dit besluit sluit ze niet, het registreert ze.
- Client-/endpoint-laag in AQL-6 zo bouwen dat de latere EU-omschakeling een **config-wissel** is, geen herbouw.
- De EU-migratie raakt de provider-abstractie (AQL-6) + auth/infra + verificatie van modelbeschikbaarheid per EU-regio; valideren met FG. Advies: start met een korte spike (modelbeschikbaarheid + één EU-adapter + retrieval-pariteit).

## Referenties

- `decisions/0063-aqlab-multi-provider-generatie-scope-out.md` (voorafgaand uitstel).
- `ai-quality-lab/AQLAB-WERKTICKET-AQL-6-multi-provider-vergelijking-v1.0.md`.
- `ai-quality-lab/AQLAB-ROADMAP.md` (roadmap-item EU-dataresidentie migratie).
- Verificatie dataresidentie: Anthropic Platform Docs (data residency), OpenAI enterprise-privacy/data-controls — te toetsen met FG vóór productie-inzet.
