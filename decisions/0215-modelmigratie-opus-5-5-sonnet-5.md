# 0215 — Modelmigratie naar Claude Opus 5.5 en Claude Sonnet 5

- **Status:** Geaccepteerd voor gefaseerde implementatie
- **Datum:** 2026-09-27
- **Betrokkenen:** Merlin IJzerman (opdrachtgever/eigenaar), Codex (analyse en uitvoering)
- **Issue:** [#438](https://github.com/merlinijzerman/Bestuurdersportaal/issues/438)

## Context

De centrale AI-gateway kiest het model al server-side per fonds en taakgroep. De stap naar Claude Opus 5.5 en Claude Sonnet 5 verandert echter meer dan een modelnaam: beide modellen gebruiken adaptive thinking en expliciete effort; Opus 5.5 ondersteunt geen geforceerde `tool_choice`; nieuwe stopredenen en afzonderlijke thinking-tokens vragen uitbreiding van observability. Tegelijk zijn verplichte functietools bedrijfskritisch voor onder meer documentvergelijking, routering en semantische extractie.

Naast de modelwissel zijn drie optimalisaties relevant, maar niet allemaal tegelijk veilig te activeren: effort als productknop, multimodale documentanalyse van grafieken/tabellen en prompt caching met een TTL van één uur.

## Besluit

1. De migratie gebeurt in gescheiden, terugdraaibare tranches. PR1 wijzigt uitsluitend SDK- en gatewaycontracten; er verandert geen actief model, fondsconfiguratie, allowlist of taakgroepdefault. De eerste omgevingsmutatie is uitsluitend in de geïsoleerde Preview-omgeving (`portal_preview`, projectref `swviwoytzvaqypieqgji`) en pas in een latere tranche. Productie (`aebwiufuegsiwhwpdrfb`) is buiten scope tot een apart go/no-go.
2. Providerafwijkingen staan centraal in een modelprofiel. Onbekende en bestaande Claude 4.x-modellen houden hun bestaande requestvorm byte-compatibel. Opus 5.5 en Sonnet 5 krijgen adaptive thinking, expliciete effort (`low` t/m `max`), geen niet-standaard samplingparameters en strict tools.
3. Verplichte tools op Opus 5.5 gebruiken `tool_choice: auto` plus een expliciete toolinstructie. Ontbreekt de toolcall, dan volgt precies één strengere retry; daarna faalt de adapter gesloten. Streaming met een verplichte tool faalt vooraf gesloten zolang dit herstelpad niet betrouwbaar kan worden uitgevoerd. Sonnet 5 houdt de door de provider ondersteunde gerichte toolkeuze.
4. De vergelijkingscalls zijn expliciet in scope: zowel `vergelijk_dimensies` als `vergelijk_waarde` lopen via de centrale gateway en gebruiken verplichte functietools. Dezelfde bescherming geldt voor vraagroutering en semantische extractie. Strict-tool-schema's worden centraal gesloten met `additionalProperties: false`, ook voor geneste objecten.
5. Effort komt nu in het providerneutrale gatewaycontract. De productmapping volgt in PR2: feitelijke/snelle hulp standaard `low`, reguliere duiding `medium`/`high`, besluitrijpheid en stukvoorbereiding `high`/`xhigh`, en een expliciete knop **Grondige analyse** op `max`. Geen impliciete automatische opschaling naar `max`.
6. Nieuwe stopredenen worden genormaliseerd als `weigering`, `pauze` en `contextvenster`. Alleen de inhoudsarme refusal-categorie mag het gatewaycontract passeren; de provideruitleg wordt niet gelogd. Thinking-tokens worden afzonderlijk opgeslagen maar blijven een subset van `tokens_out` en worden dus niet dubbel bij `tokens_totaal` opgeteld.
7. Directe PDF-/beeldanalyse voor grafieken, tabellen en schermafbeeldingen is waardevol, maar volgt als eigen tranche met paginaselectie, grootte-/kostenlimieten, bronverwijzing en een AQLab-meetset. Geëxtraheerde tekst blijft het zoek- en citeerbare spoor; geselecteerde visuele pagina's zijn aanvullende modelinput.
8. Het gatewaycontract ondersteunt een cache-TTL van één uur, maar PR1 zet die niet aan. PR2 kan systeemprompt, organisatieprofiel en stabiele documentcontext als afzonderlijke cacheblokken markeren. Activering vereist meting van cache-hitratio, latency, kosten en het risico op verouderde context.

## Alternatieven

- **Modelnamen direct in de call-sites vervangen.** Verworpen: dit omzeilt de centrale configuratie, verspreidt providerregels en maakt rollback per fonds onmogelijk.
- **Forced tool-choice toch naar Opus 5.5 sturen.** Verworpen: de provider ondersteunt dit pad niet; auto+strict met één begrensde retry geeft aantoonbaar gedrag en faalt daarna gesloten.
- **Alle optimalisaties in dezelfde cutover activeren.** Verworpen: dan zijn kwaliteit, latency, caching, multimodale input en modelgedrag niet afzonderlijk meetbaar of terug te draaien.
- **Thinking-tokens bij outputtokens optellen.** Verworpen: de provider rapporteert ze als uitsplitsing van output; optellen zou kosten/verbruik dubbel tellen.

## Gevolgen

- PR1 is gedrag-neutraal voor alle actieve Claude 4.x-routes en kan vóór de daadwerkelijke modelwissel worden uitgerold.
- De database krijgt alleen additieve observability en ruimere stopredenvalidatie; de rollback weigert dataverlies zodra nieuwe waarden aanwezig zijn.
- PR2 bepaalt en test de effortpolicy en caching. PR3 voert de Preview-canary en AQLab-vergelijking uit. Productiepromotie vereist apart akkoord en gemeten kwaliteit, latency, kosten en foutgedrag.
- Het eerder in #438 genoemde nummer 0196 was al bezet; conform het append-only besluitlog is dit besluit vastgelegd als 0215.

## Implementatiestatus 2026-09-28

- PR1 heeft het providercontract, adaptive thinking, strict-toolherstel en observability
  voorbereid zonder een model te activeren.
- PR2 implementeert de effortmapping uit dit besluit, inclusief de eenmalige knop
  **Grondige analyse**, de beide vergelijkingscalls en logging van werkelijk toegepast effort.
- PR2 activeert één-uurs caching voor stabiele chatprefixen. Dynamische sessie- en
  broncontext is gebonden aan een HMAC-afgeleide scope per fonds, gebruiker en gesprek;
  zonder veilige scope valt die optimalisatie gesloten terug.
- De Preview-canary/modelactivatie en directe PDF-/beeldanalyse blijven afzonderlijke
  vervolgtranches.

## Referenties

- [Migrating to Claude Opus 5.5](https://platform.claude.com/docs/en/about-claude/models/migrating-to-claude-opus-5-5)
- [Migrating to Claude Sonnet 5](https://platform.claude.com/docs/en/about-claude/models/migrating-to-claude-sonnet-5)
- [Effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- `core/lib/ai-gateway/anthropic-modelprofiel.ts`
- `MODEL-MIGRATIE-OPUS-5-5-SONNET-5-INVENTARIS.md`
- `supabase/migrations/2026_09_27_ai_gateway_opus_5_5_contract.sql`
- `supabase/migrations/2026_09_28_ai_gateway_effort_observability.sql`
