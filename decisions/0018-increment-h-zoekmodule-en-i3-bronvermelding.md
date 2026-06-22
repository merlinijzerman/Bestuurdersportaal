# 0018 — Increment H (zoekmodule) + I-3 (uniforme bronvermeldingstransparantie)

- **Status:** Geaccepteerd
- **Datum:** 2026-06-22
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder), Claude (uitvoering)

## Context

Twee samenhangende wensen zijn in één bouwslag opgepakt:

1. **Bronvermelding transparanter maken (Increment I-3).** De AI-assistent moest
   zichtbaar maken *waar elk deel van een antwoord vandaan komt* — niet alleen de
   document-/RAG-bronnen, maar óók de **algemene/externe kennis** uit het taalmodel —
   **zonder te begrenzen** waar het model uit mag putten en **zonder ooit een bron te
   fabriceren**. Alleen bronnen die de applicatie daadwerkelijk heeft opgehaald, of
   instanties die **letterlijk** in de modeltekst staan, mogen worden getoond.

2. **Zoekmodule (Increment H).** De laatste openstaande Doorontwikkeling-v2-increment:
   een doorzoekbare lijst-UI bovenop dezelfde retrieval als de AI-assistent.

Een codebase-analyse stelde vast dat er **geen live web-retrieval** bestaat: de
Anthropic-calls in `app/api/chat/route.ts` gebruiken **geen `tools`-parameter** (dus geen
`web_search`); de enige externe fetch is de Mistral-embedding. Algemene kennis komt dus
**uitsluitend uit het taalmodel zelf** — in dit besluit "Scenario B" genoemd, tegenover het
toekomstige "Scenario A" waarin echte webbronnen worden opgehaald.

## Besluit

1. **Eén gedeeld bronmodel** `lib/assistant-source.ts` (`AssistantSource` = discriminated
   union `document | web | model_knowledge`). Zowel de AI-assistent als de zoekmodule
   leunen hierop; de web-variant is **voorbereid maar leeg** tot Scenario A bestaat. Het
   bestand is bewust **DB-vrij** (structurele input-interfaces i.p.v. een import van
   `BronVerwijzing`) zodat het puur testbaar blijft.

2. **Anti-fabricage in drie lagen.** (a) **Promptregels** in `app/api/chat/route.ts`
   verbieden expliciet het verzinnen van documenttitels, paragraaf-/paginanummers, URL's,
   datums of dossiernamen. (b) `webBronNaarSource` geeft `null` terug bij een onveilige/lege
   URL (`isVeiligeUrl`), zodat een onbetrouwbare URL nooit een klikbare "bron" wordt.
   (c) **Instantie-detectie** (`detecteerInstantie*`) toont uitsluitend instanties die
   **letterlijk** in de antwoordtekst voorkomen; staat er geen instantie, dan blijft
   `instantie = null` (nooit een verzonnen naam).

3. **Markeer-handhaving (schijnzekerheid-guardrail).** Algemene kennis wordt afgeleid uit de
   inline-markers `[Algemene kennis]` / `[Volgens wetgeving]`.
   `ontbrekendeAlgemeneKennisMarkering` signaleert **alleen** in de pure algemeen-modus zonder
   enige marker — zodat een algemeen antwoord niet stil als brongebaseerd kan overkomen.
   *(Implementatiedetail: de marker-regexes hebben bewust **geen `g`-flag** — met de globale
   flag onthoudt `.test()` zijn `lastIndex` over aanroepen heen en geeft het wisselend foute
   negatieven.)*

4. **Rustige, gegroepeerde weergave.** Het paneel **"Onderbouwing en bronnen"** scheidt de
   herkomst in drie blokken: *Documentbronnen* (RAG), *Niet-brongebaseerde duiding (algemene
   kennis)* met de genoemde instantie + grond, en een **voorbereid** *Webbronnen*-blok dat pas
   verschijnt zodra `webRetrievalActief` waar is én er resultaten zijn. In de chat toont
   `KennisPill` de genoemde instantie naast de marker.

5. **Increment H hergebruikt de bestaande retrieval, geen nieuwe engine en geen migratie.**
   `GET /api/zoeken` roept dezelfde RPC's aan (`zoek_chunks` / `zoek_chunks_hybride`,
   Increment G) met dezelfde `RetrievalFilters` (modus/bronsoort/procesinstantie) — dus
   dezelfde scope-vóór-ranking, dezelfde RLS (SECURITY INVOKER → tenant-isolatie blijft
   gelden). De UI groepeert documenten per procesinstantie (dossier) en hergebruikt
   `bronkaartLabels` voor de metadatabadges.

6. **Web-retrieval is een expliciete TODO (Scenario A).** Het bronmodel, de UI-laag en een
   `TODO(web-retrieval — Scenario A)`-blok in de chat-route zijn voorbereid, maar er wordt
   **niets** getoond zolang er geen echte webbronnen zijn. Het aanzetten van web_search is een
   apart, later besluit.

## Overwogen alternatieven

- **Algemene kennis ongemarkeerd laten** — verworpen: dan kan modelkennis stil als
  fondsbron overkomen (schijnzekerheid).
- **Een instantie/bron "raden" als er geen genoemd is** — verworpen: schendt de
  anti-fabricage-eis; `instantie = null` is eerlijker.
- **Aparte bronmodellen voor zoek en chat** — verworpen: één gedeeld model voorkomt drift en
  borgt dat I-3 en H dezelfde herkomstdefinitie gebruiken.
- **Nu al een placeholder-webbron tonen** — verworpen: een lege/voorbereide laag mag de
  gebruiker geen suggestie van geverifieerde webbronnen geven.

## Gevolgen

- **Geen datamodelwijziging, geen migratie.** `RetrievalMeta` (in `lib/rag.ts`) is additief
  uitgebreid met `sources` / `source_summary` / `markeringen`; `governance_log.retrieval_meta`
  is reeds `jsonb`.
- **Audit:** het auditspoor legt nu per antwoord de bronsamenvatting + markeringsstatus vast
  (welke instanties genoemd zijn, of het ontbrekend-signaal afging).
- **Tests:** `lib/assistant-source.sanity.ts` (15 tests, groen) dekt document-mapping,
  veilige/onveilige web-URL, instantie-detectie, model_knowledge-afleiding, de gecombineerde
  samenvatting en de markeer-handhaving, plus prompt-injectie-regressies. `tsc --noEmit`
  groen incl. de nieuwe `/zoeken`-pagina en `/api/zoeken`-route.
- **Acceptatiecriteria (I-3):** (1) elk antwoorddeel is herleidbaar naar document, genoemde
  instantie (algemene kennis), of — later — webbron; (2) nooit een gefabriceerde bron;
  (3) algemene kennis is nooit stil; (4) het model blijft onbegrensd in wat het mag gebruiken.
- **Acceptatiecriteria (H):** dezelfde bronnen/relevantie/RLS als de assistent; resultaten
  per dossier gegroepeerd; filters (tijdsperiode/bronsoort/dossier) werken; link naar het
  origineel (incl. `#page=`) waar beschikbaar.
- **Openstaand (bewust, niet-blokkerend):** Scenario A (live web-retrieval) activeren; een
  browser-smoke van `/zoeken` en het gegroepeerde onderbouwingspaneel; B10/AI-governance-
  checkpoint blijft leidend vóór productief gebruik van de duiding/sparring-laag.

## Referenties

- [`lib/assistant-source.ts`](../lib/assistant-source.ts) + [`lib/assistant-source.sanity.ts`](../lib/assistant-source.sanity.ts)
- [`app/api/chat/route.ts`](../app/api/chat/route.ts), [`app/api/zoeken/route.ts`](../app/api/zoeken/route.ts)
- [`app/(dashboard)/ai/_components/OnderbouwingPaneel.tsx`](../app/(dashboard)/ai/_components/OnderbouwingPaneel.tsx),
  [`app/(dashboard)/ai/page.tsx`](../app/(dashboard)/ai/page.tsx),
  [`app/(dashboard)/zoeken/page.tsx`](../app/(dashboard)/zoeken/page.tsx)
- Besluiten `0006` (B12 bronsoort), `0013` (Increment G retrieval), `0014`/`0016` (I-2 brongebruik + schijnzekerheid-guardrail).
