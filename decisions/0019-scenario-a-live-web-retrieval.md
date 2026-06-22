# 0019 — Scenario A: live web-retrieval in de AI-assistent (beslisdocument)

- **Status:** **Voorstel — ter besluitvorming** (nog niet geaccepteerd; build wacht op akkoord + B10-checkpoint)
- **Datum:** 2026-06-22
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder + compliance-akkoord), Claude (uitvoering/advies)
- **Relatie:** vervolg op [`0018`](./0018-increment-h-zoekmodule-en-i3-bronvermelding.md) (Increment I-3 / Scenario B). I-3 maakte herkomst transparant binnen wat het systeem nu kan (documenten + modelkennis); dit besluit gaat over het toevoegen van de **derde** bronsoort: live opgehaalde webbronnen.

> **Leeswijzer (feit / aanname / inschatting).** Onder "Feiten" staat alleen wat geverifieerd is (codebase + Anthropic-documentatie, geraadpleegd 2026-06-22). Aannames en professionele inschattingen zijn als zodanig gelabeld. Dit document is bedoeld om besluitbaar te zijn voor jezelf én de compliance-kant; het zet nog geen code aan.

## Context — waarom dit een apart besluit is

De AI-assistent put nu uit twee bronsoorten: **fonds-/generieke documenten** (RAG) en **algemene kennis uit het taalmodel zelf** (Scenario B). Er is geen live internet-opzoeking. Scenario A voegt **echte, opvraagbare webbronnen** toe (een DNB-pagina, wetten.overheid.nl, een Pensioenfederatie-bericht) die het systeem op het moment van de vraag leest en als geverifieerde, klikbare bron toont. Dat is niet "het model weet meer", maar "het antwoord verwijst naar een externe pagina die daadwerkelijk is geraadpleegd".

Dit raakt drie dingen die een gewone UI-wijziging niet raakt: **bronvertrouwen** (wat mag als bron gelden voor een bestuurlijk advies), **governance/DPIA** (externe content voorgeschoteld aan bestuurders), en **veiligheid** (prompt injection vanuit opgehaalde pagina's). Daarom: eerst besluiten, dan bouwen.

## Feiten

**Codebase (geverifieerd).**
- De Anthropic-calls in `app/api/chat/route.ts` gebruiken **geen `tools`-parameter** → geen web_search. Enige externe fetch = de Mistral-embedding. Dit ís Scenario B.
- Het bronmodel `lib/assistant-source.ts` heeft de `web`-variant (`AssistantSourceWeb`: url/titel/domein/datum/snippet) al, plus `webBronNaarSource` met `isVeiligeUrl`-guard.
- `OnderbouwingPaneel.tsx` heeft een voorbereid *Webbronnen*-blok dat pas rendert als `webRetrievalActief === true` én er bronnen zijn. De chat-route stuurt nu `web_retrieval_actief: false` mee en bevat een `TODO(web-retrieval — Scenario A)`-blok.
- Conclusie: de plumbing (model, UI, audit-velden) staat klaar; de resterende bouw is de zoek-/ophaalstap + mapping + de vlag op `true`.

**Anthropic web search tool (docs.claude.com, geraadpleegd 2026-06-22).**
- Server-side tool: het model bepaalt zelf wanneer het zoekt; de API voert de zoekopdracht uit en levert resultaten + **verplichte citaties** (url, title, `cited_text` ≤150 tekens) terug.
- **Prijs: $10 per 1.000 zoekopdrachten**, bovenop standaard tokenkosten (opgehaalde resultaten tellen als input-tokens). Eén zoekopdracht = één "use", ongeacht aantal resultaten; bij een fout wordt niet gefactureerd.
- **Domeinfiltering ingebouwd:** `allowed_domains` (whitelist) en `blocked_domains` (blacklist) op tool-niveau → exact het mechanisme voor een gezaghebbende-bronnen-whitelist.
- `max_uses` begrenst het aantal zoekopdrachten per request (kosten-/latency-cap).
- Org-admin moet de tool **expliciet aanzetten** in de Claude Console (privacy-instellingen).
- **Juridisch (uit de docs):** "When displaying API outputs directly to end users, citations must be included to the original source." Bij bewerking/combinatie van output: citatieweergave afstemmen met juridisch.
- Er bestaat ook een aparte **web_fetch tool** (één specifieke URL ophalen) naast web_search.

**Aanname (te verifiëren vóór bouw).** Dat web search beschikbaar/toegestaan is op jullie Anthropic-account/contract en op het exacte modelstring dat de chat-route gebruikt (nu `claude-sonnet-4-5`). De toolversie `web_search_20250305` is de basisvariant; nieuwere versies bieden dynamic filtering maar vereisen ook de code-execution-tool. Dit moet tegen de live config bevestigd worden.

## Opties

### Route 1 — Anthropic's ingebouwde web search tool *(aanbevolen als start)*
Voeg `tools: [{ type: "web_search_20250305", name: "web_search", allowed_domains: [...], max_uses: 3 }]` toe aan de chat-call. Het model zoekt zelf, de API levert resultaten + citaties; wij mappen de citaties naar `AssistantSourceWeb` en zetten `webRetrievalActief = true`.
- **Voor:** snelste route (inschatting: enkele dagen); zoeken/ophalen/citeren door Anthropic; whitelist + max_uses out-of-the-box; citaties standaard.
- **Tegen:** minder controle over de exacte ophaal-/cachelaag; afhankelijkheid van Anthropic-tool en -prijs; per-zoek-kosten.

### Route 2 — eigen retrieval-pijplijn
Eigen zoek-API (Brave/Bing/Google) → eigen fetch → tekstextractie → als context aan het model voeren, met eigen citatiestructuur.
- **Voor:** volledige controle over bronnen, caching, logging, dataretentie; geen modelafhankelijkheid voor de zoeklaag.
- **Tegen:** wezenlijk meer bouw- en onderhoudswerk (inschatting: weken); je bouwt zelf wat Route 1 kant-en-klaar levert; eigen kosten voor zoek-API + hosting.

### Route 0 — niet doen (bewust nul-optie)
Scenario B handhaven; algemene kennis blijft modelkennis, geen webbronnen.
- **Voor:** geen nieuwe kosten, governance-last of aanvalsoppervlak.
- **Tegen:** de assistent kan geen actuele externe bron (wetswijziging, recent toezichtsignaal) staven; voor een Wtp-/toezicht-gevoelige context is dat een reële beperking.

## Aanbeveling (professionele inschatting, geen bestuursbesluit)

**Route 1 als begrensde pilot**, met:
1. een **harde `allowed_domains`-whitelist** van gezaghebbende bronnen (voorstel: `dnb.nl`, `afm.nl`, `pensioenfederatie.nl`, `wetten.overheid.nl`, `rijksoverheid.nl`, `eur-lex.europa.eu`, `toezicht.dnb.nl`) — uit te breiden na evaluatie;
2. `max_uses` laag (3) voor kosten-/latency-beheersing;
3. webbronnen **zichtbaar gescheiden** van fondsbronnen in het onderbouwingspaneel (al gedekt door het bronmodel) en nooit gepresenteerd als "vastgesteld fondsdocument";
4. een **expliciete melding** in het antwoord wanneer een webbron is geraadpleegd.

Route 2 pas overwegen als compliance een eigen ophaal-/retentielaag eist die Route 1 niet biedt. Dit is een aanbeveling; de keuze Route 1/2/0 is aan jou + compliance.

## Governance, compliance & veiligheid (vóór go-live af te tikken)

- **B10-poort (DPIA + AI-governance-checkpoint).** Externe webcontent voorschotelen aan bestuurders valt onder hetzelfde checkpoint dat nu al boven de duiding/sparring-laag hangt. *Aanname:* dit moet geactualiseerd worden vóór productief gebruik; bouw/merge mag, deploy-naar-productie wacht.
- **Bronvertrouwen.** Whitelist is sterk aanbevolen; een willekeurige blog als onderbouwing onder een bestuurlijk advies is een reputatie-/aansprakelijkheidsrisico.
- **Prompt injection.** Een opgehaalde pagina kan instructies bevatten die het model proberen te kapen. Mitigatie: opgehaalde tekst inhoudelijk isoleren (als bron, niet als instructie), de bestaande anti-fabricage-promptregels uitbreiden naar webcontent, en `blocked_domains` voor bekende risicobronnen.
- **Citatieplicht (juridisch).** De Anthropic-docs vereisen dat citaties naar de oorspronkelijke bron worden getoond bij directe weergave aan eindgebruikers — past bij ons bronmodel, maar moet met juridisch bevestigd worden gezien wij output bewerken/combineren.
- **Kosten & latency.** $10/1.000 zoekopdrachten + tokens + enkele seconden per zoek. *Inschatting:* beheersbaar bij bestuurlijk volume met `max_uses`, maar monitoren via `server_tool_use.web_search_requests` in de usage-respons.
- **Dataretentie/ZDR.** Indien ZDR-eisen gelden: de docs beschrijven ZDR-geschiktheid + `allowed_callers`-werkwijze voor server tools — apart te verifiëren.

## Bouwimpact (Route 1, indicatief)

- `app/api/chat/route.ts`: `tools`-parameter toevoegen (whitelist + max_uses); het server-side zoek-/`pause_turn`-loopgedrag afhandelen in de SSE-stream; web-citaties uit de response mappen naar `AssistantSourceWeb`; `webRetrievalActief = true` + webbronnen in `meta`/`done`-event.
- `lib/assistant-source.ts`: `webBronNaarSource` hergebruiken (klaar); evt. helper om Anthropic-citatieobjecten te mappen.
- UI: `OnderbouwingPaneel` *Webbronnen*-blok is klaar; alleen een antwoord-melding "webbron geraadpleegd" toevoegen.
- Config: org-admin zet web search aan in de Console; `allowed_domains` als config (in code of env).
- Audit: `RetrievalMeta` web-velden zijn er; `web_search_requests` per vraag meeloggen in `governance_log.retrieval_meta`.
- Geen datamodelwijziging, geen migratie verwacht.

## Acceptatiecriteria (Route 1)

1. Webbronnen verschijnen **alleen** uit de whitelist; een niet-gewhiteliste URL komt nooit als bron.
2. Elke getoonde webbron is klikbaar met url + titel + (waar beschikbaar) datum, en is **visueel gescheiden** van fonds-/documentbronnen.
3. Het antwoord meldt expliciet wanneer een webbron is geraadpleegd; geen webbron getoond = `webRetrievalActief` blijft praktisch onzichtbaar (geen lege/voorbereide suggestie).
4. Geen fabricage: een webbron verschijnt alleen als de API hem daadwerkelijk retourneerde (citaat aanwezig).
5. `max_uses` wordt gerespecteerd; kosten/zoekaantallen zijn herleidbaar in het auditspoor.
6. Prompt-injection-regressie: een testpagina met een ingebedde instructie verandert het gedrag van de assistent niet.
7. B10-checkpoint geactualiseerd vóór productie-deploy.

## Openstaande vragen (validatie nodig)

1. Is web search aan op jullie Anthropic-account, en op welk modelstring? (admin-Console + contract)
2. Akkoord op de voorgestelde whitelist — en wil compliance open web (whitelist uitbreidbaar) of strikt gesloten?
3. Wie tekent het B10/DPIA-checkpoint af, en op welke termijn?
4. Juridisch akkoord op de citatieweergave bij bewerkte output?
5. Budget-/kostenplafond per maand (bepaalt `max_uses` en of een hard cap nodig is)?

## Referenties

- Anthropic web search tool — docs.claude.com/en/docs/agents-and-tools/tool-use/web-search-tool (prijs $10/1.000, `allowed_domains`/`max_uses`, verplichte citaties; geraadpleegd 2026-06-22).
- Anthropic — "Introducing web search on the Anthropic API" (anthropic.com/news/web-search-api).
- [`decisions/0018`](./0018-increment-h-zoekmodule-en-i3-bronvermelding.md) (Scenario B + web-TODO), `0006` (B10-poort), `0014`/`0016` (brongebruik + schijnzekerheid-guardrail).
- Code: [`app/api/chat/route.ts`](../app/api/chat/route.ts), [`lib/assistant-source.ts`](../lib/assistant-source.ts), [`app/(dashboard)/ai/_components/OnderbouwingPaneel.tsx`](../app/(dashboard)/ai/_components/OnderbouwingPaneel.tsx).
