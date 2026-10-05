# 0209 — Centrale AI-gateway met configuratie per fonds

- **Status:** Geaccepteerd
- **Datum:** 2026-09-04
- **Aangevuld:** 2026-10-02 (klant-eigen Azure OpenAI-provider)
- **Betrokkenen:** Merlin (product owner), development

## Context

AI-aanroepen waren over routes en workers verspreid en droegen impliciete Anthropic-keuzes.
Dat past niet bij besluit 0208: beide productvarianten gebruiken dezelfde portaalcode, terwijl
een fonds een platformmodel of later een goedgekeurd klant-eigen profiel kan kiezen.

## Besluit

Alle generatieve productietaken lopen door één providerneutrale AI-gateway. Provider en model
worden per fonds en taakgroep uit een privaat schema gelezen; een fonds kan uitsluitend een
platformprofiel of zijn eigen profiel gebruiken. Platformbrede taken mogen een expliciete,
allowlisted modelkeuze gebruiken. Elke logische actie reserveert vooraf quotum en iedere
providercall passeert de live poort.

De taakgroepen zijn `generatie`, `hulp_sterk`, `concept` en `hulp_snel`. De gateway gebruikt
een afzonderlijke minimale database-loginrol en schrijft per call een inhoudsvrije, append-only
auditregel. Die registratie is best-effort; een schrijffout blokkeert een reeds verkregen antwoord
niet, maar verschijnt in `app_errors` en het signaal `gateway_log_fouten`.

Embeddings en OCR blijven voorlopig buiten de tekstgateway, omdat een embeddingmodelwissel een
re-index vereist en OCR een eigen paginabudget heeft. Beide blijven verplicht gepoort en
gereserveerd. De ongebruikte Message Batches-baan is verwijderd; herintroductie vereist eerst een
providerneutraal batchcontract dat configuratieversie en actie-ID over start en polling bindt.

## Aanvulling: klant-eigen Azure OpenAI

Azure OpenAI van een klant is een afzonderlijke provider (`azure_openai`) en geen alias van het
platformprofiel `openai`. Daarmee blijven eigendom, kill switch, allowlist, kosten en audit
ondubbelzinnig. Het portaal blijft de instructies, retrievalcontext, bronverwijzingen en
antwoordopbouw bepalen; alleen de modelaanroep gaat naar het Azure OpenAI-resource en de
deployment van de klant.

De eerste implementatiefase opent uitsluitend het inerte providercontract en de adapter. Er wordt
geen klantprofiel, model of endpoint gezaaid en de providerswitch staat standaard op `gestopt`.
Een latere activering vereist een fonds-eigen profiel, expliciet allowlisted deploymentmodel,
secrets in de deploymentomgeving, een Preview-smoke over alle vier taakgroepen en de bestaande
vier-ogenprocedure. Er is geen stille terugval op Anthropic of platform-OpenAI.

De adapter gebruikt Azure OpenAI v1 Responses met `store: false`, de deploymentnaam als `model`,
de portaalprompt als `instructions` en uitsluitend een door code geallowliste HTTPS-endpoint op
een Azure AI-host. API-keys en endpoints staan nooit in de database. Microsoft Entra-workload-
authenticatie en verdere dataminimalisatie worden na de klanttoets apart beoordeeld; deze fase
wijzigt het bestaande portaalopslag- en auditbeleid niet.

## Overwogen alternatieven

- **Modelkeuze in routes of environmentvariabelen** — verworpen wegens configuratiedrift en
  het ontbreken van fondsgebonden beheer.
- **Secrets/configuratie zonder private DB-laag** — verworpen: tenant-eigenaarschap, endpoints
  en credentials vragen een expliciete server-only vertrouwensgrens.
- **Eén configuratieregel per call-site** — verworpen als te fijnmazig; het taaktype blijft wel
  afzonderlijk in het auditlog beschikbaar.

## Gevolgen

- Ontbrekende of ongeldige configuratie faalt gesloten, zonder providerfallback.
- `AI_MODEL` is geen runtime-override meer voor productiepaden.
- `anon`, `authenticated` en `service_role` hebben geen toegang tot `ai_gateway_private`.
- Nieuwe fondsen krijgen transactioneel vier configuratieregels; onvolledige defaults laten de
  fondscreatie falen.
- Semantische extractie en generieke curatie hebben een eigen reservering.
- Beheer blijft nu een gecontroleerde databaseprocedure; UI-beheer volgt in issue #317.

## Referenties

- `AI-GATEWAY-ONTWERP.md`
- `security/AI-GATEWAY-RUNBOOK.md`
- `supabase/migrations/2026_09_04_ai_gateway_configuratie.sql`
- `supabase/migrations/2026_09_04_t4_ai_actietype_semantische_extractie.sql`
- besluit `0208-twee-productvarianten-eigen-en-microsoft.md`
