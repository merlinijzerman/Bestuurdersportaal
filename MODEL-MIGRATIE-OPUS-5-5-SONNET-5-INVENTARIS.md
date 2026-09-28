# Inventaris AI-calls voor migratie naar Opus 5.5 en Sonnet 5

Datum: 2026-09-27 · issue [#438](https://github.com/merlinijzerman/Bestuurdersportaal/issues/438)

## Uitkomst

Alle runtime-tekstgeneratie loopt via `core/lib/ai-gateway`. Alleen `core/lib/ai-gateway/adapters/anthropic.ts` importeert de Anthropic-SDK. Provider en model worden voor fondsgebonden taken uit `fonds × taakgroep` gekozen; alleen platformtaken mogen een expliciete, allowlist-gecontroleerde override gebruiken.

De vergelijkingscall is volledig in scope. `vergelijk_dimensies` en `vergelijk_waarde` gebruiken beide een verplichte functietool en raken daarom precies het Opus 5.5-verschil rond forced tool-choice.

## Call-sites

| Taaktype | Groep | Primaire locatie(s) | Vorm / migratierisico |
|---|---|---|---|
| `chat_generatie` | generatie | `app/api/chat/route.ts`, `core/lib/portaalcontext.ts` | streaming en non-streaming; webzoek kan als servertool worden toegevoegd |
| `vergelijk_waarde` | generatie | `core/lib/vergelijk-productie.ts`, aangeroepen vanuit chat en `/api/vergelijk` | verplichte tool; Opus 5.5 auto+strict+retry vereist |
| `chat_contextresolutie` | hulp_sterk | `app/api/chat/route.ts` | korte voorbereidende call |
| `chat_reformulatie` | hulp_sterk | `app/api/chat/route.ts` | korte voorbereidende call |
| `samenvatting` | concept | `core/lib/samenvatting.ts` | concept/stukvoorbereiding; kandidaat voor high/xhigh |
| `afschrift_concept` | concept | `app/api/procedures/[id]/afschrift/concept/route.ts` | stukvoorbereiding; kandidaat voor high/xhigh |
| `besluit_concept` | concept | `app/api/procedures/[id]/stappen/[stapId]/besluit-concept/route.ts` | besluitrijpheid; kandidaat voor high/xhigh |
| `chat_vraagrouter` | hulp_snel | `core/lib/vraagrouter-model.ts` | verplichte tool; strict schema al grotendeels aanwezig |
| `chat_mapstap` | hulp_snel | `app/api/chat/route.ts` | batch/mapcall |
| `rerank` | hulp_snel | `core/lib/rerank.ts`, `/api/zoeken` | korte rangschikking; kandidaat voor low |
| `vergelijk_dimensies` | hulp_snel | `core/lib/vergelijk-productie.ts` | verplichte tool; Opus 5.5 auto+strict+retry vereist |
| `context_prefix` | hulp_snel | `core/lib/chunk-ingest.ts` | ingest; niet interactief |
| `semantische_extractie` | hulp_snel | `core/lib/semantische-extractie.ts` | verplichte tool, veel herhaalde calls; kosten/latency gevoelig |
| `generiek_context_prefix` | platform | `core/lib/chunk-ingest.ts` | platformoverride, fonds `null` |
| `aqlab_generatie` | platform | `core/lib/generatie-kern.ts` | expliciete challenger/baseline-keuze binnen allowlist |
| `aqlab_judge` | platform | `platform/lib/aqlab/judge.ts` | expliciete judge-keuze binnen allowlist |

## PR1-contract

- SDK naar `@anthropic-ai/sdk` 0.128.x.
- Bestaande 4.x-requests blijven zonder adaptive thinking, effort, strict-markering of schemaherschrijving.
- Opus 5.5/Sonnet 5 vereisen expliciete effort en krijgen adaptive thinking.
- Samplingparameters worden voor 5.x niet meegestuurd.
- Strict tools sluiten ieder objectschema recursief met `additionalProperties: false`.
- Opus 5.5 + verplichte tool: `auto`, expliciete instructie, één retry, daarna fail-closed; verplichte-toolstreaming vooraf geweigerd.
- Refusal-uitleg verlaat de adapter niet; alleen categorie en genormaliseerde stopreden worden doorgegeven.
- `thinking_tokens` is afzonderlijk observeerbaar en blijft onderdeel van `output_tokens`.
- Cache-TTL `1h` is contractueel mogelijk; PR2 activeert die voor stabiele chatprefixen.
- Er wordt geen 5.x-model in configuratie, allowlist of defaults gezet.

## PR2 — effort en prompt caching

- Iedere gatewaytaak heeft een providerneutrale effortdefault. Korte hulp-, router-,
  rerank- en extractietaken gebruiken `low`; samenvattingen `medium`; generatie en
  AQLab `high`; afschrift- en besluitconcepten `xhigh`.
- De chatrouter verfijnt `chat_generatie`: feitelijk/bronoverzicht `low`, historisch
  `medium`, duiding/sparring `high` en besluitrijpheid/persoonlijke voorbereiding of
  stukvoorbereiding `xhigh`.
- **Grondige analyse** is een eenmalige productkeuze voor het volgende bericht en zet
  uitsluitend die call op `max`. Er is geen impliciete opschaling naar `max`.
- De vergelijkingscall is meegenomen: `vergelijk_dimensies` draait op `low` en
  `vergelijk_waarde` op `medium`.
- De gateway logt het werkelijk door het model toegepaste niveau. Modellen zonder
  effortondersteuning krijgen `NULL`; aangevraagde effort wordt dus niet ten onrechte als
  toegepast geregistreerd.
- Statische systeeminstructies, stabiele sessie-/broncontext en het laatste
  gebruikersbericht krijgen een cachebreekpunt met TTL `1h`. Een HMAC-afgeleide scope op
  fonds, gebruiker en gesprek maakt de sessieprefix herbruikbaar zonder voorspelbare
  sentinels of inhoud in logs op te nemen.
- Wijzigingen in prompts, tools of effort kunnen de providercache ongeldig maken; de
  bestaande velden `tokens_cache_lezen` en `tokens_cache_creatie` blijven daarom de bron
  voor hitratio, latency- en kostenanalyse.
- Ook PR2 activeert geen 5.x-model en wijzigt geen allowlist of fondsconfiguratie.

## Vervolgtranches

1. PR3 activeert uitsluitend de Preview-canary `m365-demo`: Opus 5.5 voor generatie
   (inclusief `vergelijk_waarde`), Sonnet 5 voor sterke hulp en concept, Haiku 4.5
   ongewijzigd voor snelle hulp. De overige Preview-fondsen en Productie blijven 4.x.
2. Route-smokes omvatten chat, **Grondige analyse**, documentvergelijking en controle
   van model, effort, thinking-tokens, cachemetingen, stopreden en toolherstel in het
   inhoudsvrije gatewaylog.
3. Directe PDF-/beeldinput blijft een aparte proef met visuele paginaselectie en
   meetset voor tabellen/grafieken.
4. Productie-go/no-go volgt pas op kwaliteit, refusal-rate, tool-retry/fail-closed,
   latency, tokens/kosten en cache-hitratio.
