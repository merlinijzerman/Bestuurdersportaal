# 0067 — Generatiemodel naar Opus 4.8 via env-var, modelconfig-unificatie en caching agendavoorbereiding

- **Status:** Geaccepteerd (experimenteerfase) — productie-validatie openstaand
- **Datum:** 2026-07-15
- **Betrokkenen:** Merlin (akkoord), Ontwikkeling

## Context

Input van een bestuurslid: bij laag vraagvolume weegt de bruikbaarheid van het antwoord zwaarder dan kosten/latency, dus overweeg het sterkere model. Daarnaast bleek het generatiemodel op meerdere plekken hardcoded (`core/lib/generatie-kern.ts`, `app/api/agendapunten/[id]/voorbereiding/route.ts`, en `core/lib/chunk-ingest.ts`) — een driftrisico: een wissel op één plek laat de andere paden achter op het oude model. Prompt caching zat al in de chat-route/generatiekern, maar niet in de agendavoorbereiding-route.

## Besluit

`AI_MODEL` is env-overschrijfbaar met default **`claude-opus-4-8`** in `core/lib/generatie-kern.ts` (`process.env.AI_MODEL ?? "claude-opus-4-8"`). De agendavoorbereiding-route importeert diezelfde constante i.p.v. een eigen hardcoded string, zodat chat en voorbereiding nooit uiteenlopen. Prompt caching (`cache_control: ephemeral`) is toegevoegd op de statische `SYSTEM_PROMPT` van de voorbereiding-route. De goedkope hulpmodellen blijven bewust ongewijzigd: `chunk-ingest` (Haiku context-prefix bij ingest) en de map-stap (`MAP_MODEL`).

## Overwogen alternatieven

- **Volledige switch zonder env-var** — afgewezen: geen triviale A/B-vergelijking of terugschakeling.
- **Model-per-modus tiering (Opus alleen voor complexe modi)** — bewaard als kostenhefboom, nu niet doorgevoerd om de wijziging klein te houden.
- **Op Sonnet 4.6 blijven** — het bestuurlijke uitgangspunt (bruikbaarheid boven kosten bij laag volume) rechtvaardigt de upgrade in de experimenteerfase.

## Gevolgen

- **Kosten/latency:** Opus is ± 1,7× duurder per token dan Sonnet en trager. Streaming (besluit 0071) compenseert de wáárgenomen snelheid; caching drukt de inputkost; echte tijdwinst vergt later model-tiering.
- **Compliance/validatie:** een modelwissel is een wijziging aan het AI-systeem → her-validatie via de AQLab-regressieset en een assurance/DPA-check zijn vereist vóór productie. Opus 4.8-beschikbaarheid, tarief en dataverwerkingsvoorwaarden moeten nog in het Anthropic-account worden geverifieerd.
- **Prompt-/UX-schuld:** het sterkere model repareert de prompt-/UX-bevindingen (0068–0071) niet; die zijn apart opgepakt.
- **RLS/tenant-isolatie/datamodel:** geen wijziging.

## Referenties

- `core/lib/generatie-kern.ts` (`AI_MODEL`), `app/api/agendapunten/[id]/voorbereiding/route.ts`, `core/lib/chunk-ingest.ts` (`PREFIX_MODEL`, ongewijzigd).
- Werknotitie `AI-assistent - verbeterpunten notitie 2026-07-15.md` (onderwerp 4).

## Vervolg (2026-07-15) — tokenbudget & zichtbaar afkap-signaal

Direct gevolg van de Opus-overstap: Opus schrijft uitgebreider, waardoor gestructureerde antwoorden tegen het `max_tokens`-plafond aanliepen en middenin een sectie afbraken. Bijgesteld: `MAX_TOKENS_BESTUURLIJK` 4500 → **8000** en `MAX_TOKENS` (feitelijk) 3200 → **5000** (`core/lib/generatie-kern.ts`), en de agendavoorbereiding-route 3500 → **5000**. Plafonds, geen streefwaarden. Aanvullend een **zichtbaar afkap-signaal** (`AFGEKAPT_MELDING` in `core/lib/vraagtype.ts`): raakt een antwoord alsnog het plafond (`stop_reason === "max_tokens"`), dan verschijnt een inline-melding "antwoord afgekapt — vraag om een vervolg" in plaats van een stille afkap. Toegepast op zowel de chat-route als de agendavoorbereiding-route. Verificatie: `tsc` 0; `vraagtype.sanity` 60/60.
