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
- Cache-TTL `1h` is contractueel mogelijk maar nog nergens geactiveerd.
- Er wordt geen 5.x-model in configuratie, allowlist of defaults gezet.

## Vervolgtranches

1. Effortpolicy per taaktype en de productknop **Grondige analyse**; cacheblokken en meetpunten.
2. Allowlist/configuratie uitsluitend in Preview, gevolgd door AQLab-baseline/challenger en route-smokes — inclusief documentvergelijking.
3. Directe PDF-/beeldinput als aparte proef met visuele paginaselectie en meetset voor tabellen/grafieken.
4. Productie-go/no-go op kwaliteit, refusal-rate, tool-retry/fail-closed, latency, tokens/kosten en cache-hitratio.

