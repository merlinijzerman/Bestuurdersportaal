# Gemeenschappelijk retrievalcontract — fase 4 (#322/#348), tranche T1

> **Status:** T1 afgerond; ontwerp gereviewd en R1–R6 **beslist** (9 september 2026).
> Geen productiecode, geen migratie en geen databaseobject gewijzigd.
> Fase 3 (#323, #324) en de AI-gateway-cutover (#325) zijn op `preview` gemerged.
> Wat vóór T2-1 nog moet gebeuren is **T1b** (embeddingstub + hybride golden, besluit R3);
> de ontwerpvragen zijn dicht — zie §6.
> Bron van waarheid voor de huidige keten: `core/lib/rag.ts` en de migraties. Dit
> document beschrijft wat er **is** (gemeten, met vindplaats) en wat het contract
> moet dragen.

Dit is de F4-T1-tranche van umbrella-issue #322, uitgewerkt naar de opdracht in
#348. Besluit: [`decisions/0213`](./decisions/0213-retrievalcontract-adaptergrens-en-contextlaag.md).

---

## 1. Waarom

Besluit 0208 maakt de bronlaag duaal: de eigen variant zoekt in de Supabase-RAG, de
Microsoftvariant zoekt later live in SharePoint. Zonder één providerneutraal contract
lopen bronselectie, rechten, citaties, foutgedrag en audit per bron uiteen. Fase 3
(#321, besluit 0210) heeft de SharePoint-identiteit al vastgelegd (lokale referentie,
drive/item privé, eTag/cTag, previewmogelijkheid, controlemoment); de AI-gateway
(#311, besluit 0209) heeft het generatiecontract. Dit document legt de retrievalzijde
daartussen vast.

T1 verandert niets aan gedrag. Het levert drie dingen: een **volledige, telbare
inventarisatie**, een **karakterisering die bewijsbaar rood wordt** bij de dingen die
zij heet te bewaken, en een **contractontwerp** met een geprioriteerde gaplijst.

---

## 2. Inventarisatie

Alle aantallen hieronder komen uit twee machinaal gegenereerde registers, niet uit
handwerk. Ze zijn reproduceerbaar met:

```bash
node tests/karakterisering/retrieval-census.mjs            # toon
node tests/karakterisering/retrieval-census.mjs --schrijf  # registers bijwerken
```

en bevroren door `tests/cross-tenant/retrieval-census.test.ts` (5 tests).

### 2.1 De kern

`zoekRelevanteChunksMetMeta(vraag, fondsId, maxResults, hybrideAan, documentIds, filters, opties)`
in [`core/lib/rag.ts:1276`](./core/lib/rag.ts) is de facto het contract. Het pad:
documentscope → expliciete fondsfilter (server-side, body genegeerd) →
jargonexpansie (vlag) → hybride RRF via `zoek_chunks_hybride` of FTS via `zoek_chunks`
(strikt, daarna verslapte OR-terugval, daarna PostgREST-fallback) →
`handhaafFondsdiscipline` (app-guard náást RLS en RPC) → zwakke-generiek-filter →
bronsoortweging → regime-demotie → optionele reranker (Haiku via de gateway) en
drempel → selectie (max per document, Jaccard-dedup, representatieconstraints) →
parent-context (vlag) → `RetrievalMeta`. Beide RPC's zijn `security invoker`; RLS
blijft leidend.

### 2.2 Aantallen

| Grootheid | Aantal | Herkomst |
|---|---|---|
| Bestanden in de retrievalcensus | **17** | `retrieval-census.expected.json` |
| Daarvan met een **runtime**-symbool uit `rag.ts` | **4** | C1–C4, C7 hieronder |
| Daarvan met **alleen** directe `document_chunks`-toegang (ingest/beheer) | **7** | klasse C, §2.5 |
| Daarvan met **alleen type-imports** uit `rag.ts` | **3** | klasse C, §2.5 |
| Aanroepen van `zoekRelevanteChunksMetMeta` in productiecode | **6** | §2.3, kolom "vindplaats" |
| Directe `.from()`-lezingen in `app/api/chat/route.ts` | **24** | `retrieval-contextbronnen.expected.json` |
| Bestanden in de **transitieve** importgraaf vanaf de chatroute | **106** | idem |
| Daarvan bestanden die zelf een tabel lezen of schrijven | **13** | idem |
| Unieke tabellen bereikbaar op het antwoordpad | **33** | idem |
| — waarvan klasse **evidence** (citeerbaar en versiebaar) | **5** | gate `F4-context` |
| — waarvan klasse **modelcontext** (prompt in, niet citeerbaar) | **18** | idem |
| — waarvan klasse **configuratie/autorisatie/bronbeleid** | **7** | idem |
| — waarvan klasse **audit/persistentie** | **3** | idem |
| Evidencebronnen die vandaag via de retrievalkern lopen | **2** (`document_chunks`, `documenten`) | idem |
| Evidencebronnen die er **buiten** om lopen | **3** (`decision_objects`, `semantic_units`, `concepts`) | idem |

**Correctie op de eerste ronde.** Die telde "31 tabellen buiten de retrievalkern" en
noemde dat de contextlaag. Dat was een verkeerde classificatie: in dat getal zaten
configuratie, autorisatie en bronbeleid (`fonds_theming`, featureflags, `profielen`,
de web-whitelist) — dat is geen modelcontext. De scan volgde bovendien alleen de
**directe** imports van de chatroute; een tabellezing in een transitief geïmporteerde
helper bleef onzichtbaar. Beide zijn hersteld: de scan loopt nu de hele importgraaf af
(106 bestanden) en elke bereikte tabel draagt een expliciete klasse, waarbij een
**onbekende tabel de gate rood maakt**.

De transitieve scan vond dezelfde 33 tabellen — de telling klopte dus, maar toevallig —
en **drie extra lezende bestanden** die de directe scan miste: `core/lib/fonds-sessie.ts`,
`core/lib/profiel.ts` en, het meest sprekend, `core/lib/parent-context.ts`, dat
`document_chunks` rechtstreeks leest.

Het scherpere beeld: niet "31 tabellen omzeilen de kern", maar **3 van de 5
evidencebronnen** doen dat — besluitregistratie en de twee vergelijk-tabellen — en
daarnaast staat er een aparte laag van 18 gestructureerde contexttabellen die nooit
citeerbaar wordt maar wel de prompt in gaat.

### 2.3 Klasse A — retrieval-call-sites

Paden die bronnen ophalen, filteren, selecteren, samenvoegen, reranken of citeren.
Elke vindplaats is exact herleidbaar.

| # | Call-site (vindplaats) | Fonds/actor | Capability | Bronbereik | Filters | Limieten | Ranking | Citaatvorm | Versie | Quota/kill-switch | Timeout | Cancellation | Audit | Foutgedrag | PII |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C1 | `chat/route.ts:2441` + `:2454` (primair + aanvullend spoor) | `ctx.fondsId`, body genegeerd | `chat.use` | fonds + gepubliceerd generiek; scope op document/agendapunt | modus, peildatum, bronsoortprofiel, primairRegime; primair spoor zonder filters bij scope | 10 + 5, overfetch max(3×,20), max/doc | fondsvlaggen (rerank, drempel, jargon, parent, representatie) + gateway | `maakContext` → `[Bron N]`, sentinel, statuslabel, `BronVerwijzing` | `bronversie_audit` (status, datum) — **geen eTag/hash** | `chat` 20/5 min; `ai_kill_switch` (globaal/anthropic/mistral/openai) | **geen** | **geen** | `governance_log.retrieval_meta` via `schrijf_ai_interactie`, gesplitst basis/bron/inhoud | rerank fail-safe → RRF; Mistral-uitval → FTS met `fallback_reason` + `ai_begrenzing` | PII-gate vóór retrieval en web |
| C2 | `chat/route.ts:2297` (`haalBevrorenChunks`, reflectiepad) | idem | `chat.use` | bevroren bronset op chunk-id | `documenten.actief`, fondsguard | 200 | geen | zelfde labeling | bronset-hash | idem C1 | **geen** | **geen** | `methode:"geen"` | — | — |
| C3 | `chat/route.ts:2097` (`haalDocumentChunksMetDekking`, breed pad) | idem | `chat.use` | één of enkele documenten volledig | fondsguard | cap 5000, pagina 1000 | geen (documentvolgorde) | paginaverwijzingen | — | idem C1 | **geen** | **geen** | `scope.strategie`, `documentdekking` | afkapredenen expliciet | — |
| C4 | `chat/route.ts` web-arm (`web-retrieval.ts`) | idem | `chat.use` | whitelistdomeinen | PII-gate, whitelist | `WEB_MAX_USES` | provider | `bouwWebbronnen` | ophaaltijdstip | idem C1 | providerzijdig | **geen** | `web`-blok, domeinen | — | PII-gate |
| C5 | `zoeken/route.ts:107` | `ctx.fondsId` | `zoeken.use` | fonds + generiek | modus, bronsoort, **procesinstantie uit de query-string** | 40, max 3 treffers/doc, fragment 220 | **geen fondsvlaggen** (env-defaults) | eigen `ZoekResultaat`, **geen citation-id** | geen | `zoeken` 60/5 min, fail-closed | **geen** | **geen** | `audit: "geen"` | rate-limit fail-closed; fouten generiek | **geen PII-gate** (zoekterm) |
| C6 | `vergelijk-productie.ts:72`, `:142`, `:143` | `ctx.fondsId` | via de aanroepende route | één document per zijde | **`filters = {}`** | 4/5 passages per zijde | **`parentRetrieval:true` hardcoded**, geen rerank/drempel | eigen `PassageLite`, pagina | geen | erft de chatlimiet | **geen** | **geen** | `fn_schrijf_vergelijking` | — | — |
| C7 | `platform/lib/aqlab/generate-adapter.ts:134` | platform, fonds = `null` | platform | synthetische fixtures | — | fixturelengte | geen | `maakContext` (identiek aan C1) | — | platform | — | — | AQLab-run | — | — |
| C8 | `platform/lib/semantische-extractie-job.ts` | job | platform | volledige documentset | actief/geïndexeerd | alles, hash-incrementeel | geen | `semantic_units` met chunk-id | hash | platform | — | — | `fn_schrijf_semantische_extractie` | — | — |

**Drie rubrieken staan over de hele breedte op "geen":**

- **Cancellation.** `core/lib/rag.ts`, `core/lib/rerank.ts` en `core/lib/embeddings.ts`
  bevatten **nul** voorkomens van `AbortSignal` (gemeten: `grep -c AbortSignal` = 0/0/0).
  De chatroute kent alleen twee lokale aborts — de contextresolver (`:915`) en een
  mapstap (`:3316`) — die de retrieval niet raken. Een afgebroken verzoek laat de
  retrieval dus gewoon uitlopen.
- **Timeout.** Geen enkele retrieval-call-site kent een eigen looptijdbegrenzing.
- **Versie-identiteit.** Geen enkele call-site legt een exacte documentversie per
  geselecteerde passage vast; `bronversie_audit` kent alleen status en datum.

### 2.4 Klasse B — het antwoordpad in vier hoedanigheden

Het antwoordpad leest 33 tabellen. Ze hebben niet dezelfde rol, en de eerste ronde
behandelde ze wél als één hoop ("31 contexttabellen"). De indeling hieronder is een
**ontwerpoordeel**, vastgelegd in `TABELKLASSE` (`retrieval-census.mjs`) en afgedwongen
door de gate: een bereikte tabel zonder klasse maakt haar rood.

| Klasse | # | Tabellen | Wat het contract ermee doet |
|---|---|---|---|
| **evidence** — citeerbaar én versiebaar | 5 | `document_chunks`, `documenten`, `decision_objects`, `semantic_units`, `concepts` | hoort **achter het retrievalcontract**. Vandaag lopen alleen de eerste twee via `rag.ts`; de andere drie zijn de eigenlijke omzeiling (gap G-1) |
| **modelcontext** — gaat de prompt in, niet citeerbaar | 18 | `agendapunten`, `agendapunt_inbreng`, `vergaderingen`, `procedures`, `procedure_stappen`, `procedure_requirements`, `procedure_bewijs`, `procedure_eigenaars`, `risicos`, `risico_log`, `risico_maatregelen`, `organisatie_profielen`, `expertises`, `gremia`, `kritische_focusgebieden`, `profiel_expertises`, `profiel_focusgebieden`, `profiel_gremia` | blijft **buiten documentretrieval**, maar krijgt in T2 een **eigen typed contextcontract** met eigen audit (besluit R5) |
| **configuratie/autorisatie/bronbeleid** | 7 | `profielen`, `fonds_feature_flags`, `fonds_config_log`, `fonds_content_overrides`, `fonds_module_manifest`, `fonds_theming`, `bron_whitelist` | **geen contextlaag.** Stuurt de retrieval, maar belandt niet als inhoud in de prompt. Hoort niet in enige contextteller |
| **audit/persistentie** | 3 | `governance_log`, `governance_log_inhoud`, `voorbereidingen` | het auditspoor en het bewaarde antwoordproduct; geen bron |

Per lezend bestand (13 van de 106 bereikte bestanden), met de rol die het speelt:

| Bestand | Klassen die het raakt | Rol |
|---|---|---|
| `app/api/chat/route.ts` | evidence, modelcontext, configuratie, audit | agendapunt-, proces-, risico- en risicomatrixblokken; chunkpresentie per document (3 plekken: `:1036`, `:1063`, `:1298`) |
| `core/lib/portaalcontext.ts` | modelcontext (+ `documenten`, `profielen`) | **vergadering- en agendacontext** ("wat speelt er nu") |
| `core/lib/profielsturing.ts` | modelcontext (+ `profielen`) | persoonsgebonden sturing van het antwoord |
| `core/lib/organisatieprofiel.ts` | modelcontext | regimekader/organisatieblok |
| `core/lib/besluitvorming-bron.ts` | **evidence** | besluitregistratie als "formele bron náást `document_chunks`" — wordt citeerbaar (R5) |
| `core/lib/vergelijk-productie.ts` | **evidence** | vergelijkpad: `semantic_units`, `concepts` |
| `core/lib/rag.ts` | **evidence** | de enige twee die vandaag via de retrievalkern lopen |
| `core/lib/parent-context.ts` | **evidence** | leest `document_chunks` rechtstreeks — **alleen zichtbaar door de transitieve scan** |
| `core/lib/fonds-config.ts` | configuratie | vlaggen die de retrieval sturen |
| `core/lib/capabilities.ts`, `core/lib/fonds-sessie.ts`, `core/lib/profiel.ts` | configuratie | autorisatie en identiteit (de laatste twee alleen transitief bereikbaar) |
| `core/lib/web-whitelist-data.ts` | configuratie | bronbeleid van de webarm |

De gate `F4-context` pint de vier klassengroottes (5/18/7/3) hard, pint de omvang van de
importgraaf (106), en maakt elke bereikte tabel zónder klasse rood. Classificeren is
daarmee een gereviewde handeling: een nieuwe tabel kan niet stilzwijgend als "context"
meeliften, en configuratie kan niet stilzwijgend voor modelcontext doorgaan.

> **Reikwijdte van deze bevinding.** Dit is géén beveiligingslek: al deze lezingen lopen
> onder RLS met de tenant-client, en `module_scope` weigert expliciet bij een
> niet-gevonden `procedure_id`/`risico_id` in plaats van terug te vallen op fondsbrede
> data (`module-scope.ts`, kopcommentaar). Het punt is architectonisch, en na de
> herclassificatie scherper dan in de eerste ronde: **drie van de vijf evidencebronnen
> lopen buiten de retrievalkern om** en zijn daardoor niet citeerbaar of versiebaar,
> terwijl 18 contexttabellen dat ook nooit worden — maar wel een eigen contract nodig
> hebben in plaats van stilzwijgend meeliften.

### 2.5 Klasse C — geen retrieval (expliciet afgebakend)

Om de inventarisatie sluitend te maken: de resterende 10 bestanden uit de census
doen géén retrieval en blijven buiten de adaptergrens.

- **Type-only (3):** `core/lib/besluitvorming-bron.ts` (`type BronVerwijzing`),
  `core/lib/organisatieprofiel.ts` en `core/lib/profielsturing.ts` (`type RetrievalMeta`).
  Deze staan in de census omdat zij uit `rag.ts` importeren, maar roepen niets aan.
- **Ingest/beheer (7):** `app/(platform)/…/generieke-bibliotheek/acties.ts`,
  `app/api/classificatie/backfill/route.ts`, `app/api/documents/reindex-backfill/route.ts`,
  `core/lib/reindex.ts`, `platform/lib/generiek-pipeline.ts`,
  `platform/lib/ingest-orchestrator.ts`, `platform/lib/semantische-extractie-job.ts`.
  Zij **schrijven** `document_chunks`; ze halen geen bronnen op voor een antwoord.
- `app/api/notulen/segmenten/[id]/bevestig/route.ts` importeert
  `maakChunksUitSegmenten` — chunking, geen retrieval.

### 2.6 Divergenties die het contract moet opheffen

1. **Vlaggen.** C5 en C6 slaan de fondsvlaggen over; `regimeWeging` (de enige vlag met
   default aan) zit niet in `RetrievalVlaggen` en is per fonds niet stuurbaar.
2. **Filters.** C6 zoekt zonder peildatum, modus of regime en produceert toch citaten.
3. **Drie bronvormen.** `BronVerwijzing` (C1/C7), `ZoekResultaat.treffers` (C5),
   `PassageLite` (C6). Alleen de eerste draagt citation-id, sentinel en statuslabel.
4. **Versie-identiteit.** Nergens een exacte documentversie per passage.
5. **Correlatie.** `ctx.requestId` gaat naar `handelingen_log` en naar de gateway-log,
   maar **niet** in `retrieval_meta`. De keten retrieval → gateway → governance is nu
   alleen via `gesprek_audit_id` te volgen.
6. **Directe tabeltoegang** op het antwoordpad: de chatroute leest `document_chunks`
   op drie plekken buiten `rag.ts` om.
7. **Ongevalideerde referentie uit de query-string.** C5 zet `?procesinstantie=<id>`
   rechtstreeks in `filters.procesinstantie_ids` zonder te toetsen of het dossier bij
   het fonds hoort. RLS en de expliciete fondsfilter maken dit vandaag onschadelijk
   (een vreemd dossier levert simpelweg niets op), maar het contract moet de
   scopevalidatie expliciet beleggen in plaats van haar aan RLS over te laten.
8. **Geen cancellation en geen timeout** in de hele keten (§2.3).
9. **De contextlaag (klasse B)** kent geen enkele van de contractrubrieken.

---

## 3. Karakterisering

### 3.1 Wat is vastgelegd

- **Census-gates** (`tests/cross-tenant/retrieval-census.test.ts`, 5 tests): het
  retrievalregister (17 bestanden, per symbool), de eis dat zoek-RPC's uitsluitend in
  `rag.ts` leven, de vier productie-ingangen, plus de twee nieuwe contextgates
  (106 bereikte bestanden, 13 lezers, 33 tabellen in vier klassen).
- **Retrieval-goldens in het W1-harnas** (`tests/karakterisering/`):
  - vier extra chunks onder het bestaande `document1` in de seed — geen nieuw
    document, en de teksten vermijden elk woord uit de #311-chatvragen, zodat de
    bestaande snapshots ongewijzigd blijven;
  - zeven `w322.zoeken.get.bestuurder.*`-scenario's: kandidatenset, volgorde,
    treffers per document, fragmentafkapping en `retrieval_meta` op het FTS-pad,
    inclusief lege sets voor modus `actueel` (document1 is concept), bronsoort
    `generiek`, een onbestaande term en een **vreemde procesreferentie**;
  - één `w322.chat.post.bestuurder.retrieval-meta`-scenario: dezelfde beurt als
    `w311 … sse-met-bron`, met als nawerk de deterministische projectie van
    `governance_log.retrieval_meta`.
- **Volgordeprojectie** (`tests/karakterisering/retrieval-volgorde.mjs`) — zie §3.3.
- **Negatieve controles** (`tests/cross-tenant/retrieval-golden-gevoeligheid.test.ts`,
  15 tests, volledig offline).

### 3.2 Welke velden byte-identiek moeten blijven, en welke niet

T2 mag de goldens niet bijwerken om regressies te maskeren. Daarvoor moet vaststaan
wat "identiek" betekent. Drie klassen:

| Klasse | Velden | Eis bij T2 |
|---|---|---|
| **Byte-identiek** | `methode`, `opgehaald`, `geselecteerd`, `toegepaste_fonds_filter`, `namespace_conventie`, `fondsdiscipline_gedropt`, `body_fonds_id_genegeerd`, `citaties.{totaal,ongeldig}`, `selectie.*` (constraints, afvaltellingen, intent, regime), `filters.*`, `antwoordmodus`, `bronbasis`, `gereformuleerd`, en de **volledige volgordeprojectie** (`volgorde.*`) | onveranderd, zonder uitzondering |
| **Semantisch/typevast** (structuur en type vast, waarde omgevingsafhankelijk) | UUID's (via `<uuid:N>` alleen relationeel gepind), `peildatum` (`<datum>`), tijdstempels (`<ts>`), `rang`/`fts_rang`/`vec_rang` als de ranking-implementatie aantoonbaar equivalent blijft | type en aanwezigheid vast; een waardewijziging vereist een expliciete motivering in de PR |
| **Niet gekarakteriseerd** (bewust) | duur, tokentellingen, ttft, providerlatency, `retrieval_pogingen[].query` bij gereformuleerde vragen | blijven buiten het snapshot; opnemen zou het snapshot per run laten omvallen |

### 3.3 Negatieve controles — en drie bevindingen die zij opleverden

Een golden bewijst pas iets als hij rood wordt bij het gedrag dat hij heet te
bewaken. De suite `retrieval-golden-gevoeligheid.test.ts` toetst dat mechanisch en
**offline** (geen stack, geen DB): zij voert de echte snapshotpijplijn op
synthetische responsen uit, muteert precies één ding, en eist een verschil.

Dat leverde drie bevindingen op de karakterisering van de eerste T1-ronde op.

**Bevinding 1 — de goldens pinden de volgorde niet.**
`normaliseerJson()` sorteert **elke** array recursief op genormaliseerde inhoud
(`normaliseer.mjs`, stap 2). Dat is voor de 380 bestaande snapshots precies goed — het
maakt ze onafhankelijk van de rijvolgorde die PostgREST toevallig teruggeeft. Maar
voor retrieval ís de volgorde het resultaat. Empirisch vastgesteld op
`w322.zoeken.get.bestuurder.premiebeleid`: treffers omgekeerd → **byte-identiek
snapshot**. De claim "kandidatenset en stabiele volgorde" was dus niet gedekt.

*Remedie:* niet de gedeelde normalisatie versoepelen (dat raakt alle snapshots), maar
de volgorde **in de waarde** zetten. `retrieval-volgorde.mjs` projecteert elke
kandidaat-, treffer-, audit- en pogingregel met haar nulgebaseerde positie als prefix;
sorteren kan die positie dan niet meer wegpoetsen. Passages gaan als sha256-prefix mee
— gewijzigde inhoud wordt zichtbaar zonder documenttekst in een snapshot vast te leggen.

**Bevinding 2 — een citaat-ID is alleen relationeel te pinnen.**
`mapUuids()` vervangt elke UUID door `<uuid:N>` op volgorde van eerste voorkomen. Een
consistente hernoeming van alle chunk-ID's is daardoor **per ontwerp onzichtbaar**.
Dat is juist gewenst — de seed geeft bij elke heropbouw andere UUID's, en een golden
die de letterlijke waarde pinde zou bij elke herseed omvallen. Wat wél gepind is en
moet blijven, is de **co-referentie**: een citaat dat naar een ander document wijst,
of een chunk die niet meer in `poging_herkomst` voorkomt, maakt de golden rood. Beide
helften staan als test vast, zodat de grens gedocumenteerd is en niet voor dekking
wordt aangezien.

**Bevinding 3 — object-sleutels ontsnappen aan de UUID-maskering.**
`mapUuids()` vervangt UUID's in string-*waarden*, niet in object-*sleutels*.
`poging_herkomst` is als enige retrievalveld sleutelgeadresseerd op chunk-ID en zou
dus rauwe seed-UUID's in het snapshot zetten die bij elke herseed omvallen. Vandaag
bijt dat niet (op het FTS-terugvalpad is het veld `null`), maar het is een val voor
T2, waar het hybride pad wél herkomst vult. *Remedie:* het scenario neemt
`poging_herkomst` niet rauw op maar als telling plus de projectie
`volgorde.poging_herkomst`.

De 15 controles dekken samen de vier mutaties die #348 eist — volgorde, citation-ID,
fondsfilter, versie-identiteit — plus de drie bevindingen als bewaakte aannames.

### 3.4 Wat niet karakteriseerbaar is, en waarom

#348 §2 vraagt goldens voor **timeout, annulering en veilige foutcategorieën**. Die
zijn niet op te nemen, om een inhoudelijke reden: *dat gedrag bestaat niet*. Er is
geen `AbortSignal` en geen looptijdbegrenzing in de retrievalketen (§2.3), dus er is
geen bestaand gedrag om vast te leggen. Een golden verzinnen zou karakterisering
verwarren met ontwerp.

Deze scenario's horen daarom bij **T2-5**, als contracttest op de nieuwe
`RetrievalAdapter` — niet bij T1. Hetzelfde geldt voor het **hybride pad**: zonder
Mistral-sleutel valt de keten lokaal deterministisch terug op FTS
(`embedding_query_success:false`); een embeddingstub naast de Anthropic-stub is
voorwaarde voor een hybride golden. Besluit R3: dat gebeurt in een eigen tranche **T1b**, vóór enige productiecode in T2-1 — het hybride pad is in productie het primaire pad, dus de goldens dekken vandaag alleen de terugval.

Wél karakteriseerbaar en opgenomen: lege resultaten (drie scenario's), truncatie
(fragmentafkapping op 220 tekens), en manipulatie met een **procesreferentie** uit de
query-string (`…&procesinstantie=<vreemd id>`, §2.6 punt 7) — het enige
manipulatiepad dat vandaag zonder servervalidatie de retrievalfilters bereikt.

Manipulatie met **document- en fondsreferenties** is niet in de w322-goldens
herhaald: die staat al in `tests/cross-tenant/rag-discipline.test.ts` — T11
(fondsgrens), T12 (gespoofte/ontbrekende `fonds_id` → fail-closed), T14a
(documentscope alleen uit de RLS-zichtbare set) en T15 (parent-retrieval trekt nooit
een vreemd fonds in de passage). Manipulatie met een **vergaderingreferentie** loopt
niet via de retrievalfilters maar via de contextlaag (`portaalcontext.ts`, klasse B)
en is daarmee onderdeel van gaplijst G-1, niet van de retrievalkarakterisering.

### 3.5 Reproduceerbare uitvoerinstructie

**Offline (geen stack nodig) — draait mee in `npm run test:xtenant`:**

```bash
node --import tsx --test tests/cross-tenant/retrieval-census.test.ts tests/cross-tenant/retrieval-golden-gevoeligheid.test.ts
```

**Volledig, tegen een uit de repo opgebouwde wegwerpstack:**

```bash
export PATH="<scratchpad>/bin:$PATH"          # supabase→npx-pin 2.114.0, psql→postgres:17-container
bash scripts/start-ephemeral-supabase.sh
TEST_DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:54322/postgres \
  bash scripts/testdb-apply-migrations.sh
node tests/e2e/fixtures/ai-provider-stub.mjs &                 # deterministische Anthropic-stub, poort 8790
npm run build && PORT=3000 npm run start &
node --env-file=.env.local tests/karakterisering/run.mjs --verify --only=w322
```

Drie opeenvolgende `--verify`-rondes moeten identiek zijn; CI doet dat standaard
(`.github/workflows/karakterisering.yml`, ronde 1/3 t/m 3/3).

**Opnieuw opnemen** (alleen bij een gemotiveerde gedragswijziging):
`… run.mjs --record --only=w322`.

---

## 4. Het contract (ontwerp T2)

Alle typen server-only, in `core/lib/retrieval/contract.ts`. Geen providertokens,
endpoints, ruwe Graph-/Search-responses of database-implementatiedetails in het
publieke contract.

### 4.1 Typen

```ts
export type Bronsoort = "fonds" | "generiek" | "sharepoint" | "notulen" | "web";
export type Retrievalstrategie = "gericht" | "volledig" | "vergelijk" | "bevroren";

export interface RetrievalContext {           // server-side vastgesteld, nooit uit body
  fondsId: string;                            // uit sessie/profiel
  actor: { gebruikerId: string; rol: Rol };
  taaktype: Taaktype;                         // hergebruik van het gateway-contract
  bronbeleid: Bronbeleid;                     // welke bronsoorten dit fonds mag: uit fondsconfig
  scope?: { documentIds?: string[]; vergaderingId?: string; agendapuntId?: string; procesId?: string; bevrorenChunkIds?: string[] };
  correlationId: string;                      // = ctx.requestId; gaat door naar gateway en governance
  signal?: AbortSignal;
}

export interface RetrievalQuery {
  origineleVraag: string;
  zoekvraag: string;                          // gevalideerd/geherformuleerd; kan de scope niet wijzigen
  filters: { modus; peildatum; bronsoort?; procesinstantieIds?; bronsoortprofiel?; primairRegime?; toonZwakkeGeneriek? };
  strategie: Retrievalstrategie;
  maxKandidaten: number;                      // harde bovengrens
  maxContextTekens: number;                   // harde bovengrens
}

export interface Bronresultaat {
  ref: string;                                // lokale, fondsgebonden referentie (chunk-id of sharepoint_documenten.id)
  bronsoort: Bronsoort;
  titel: string;
  documentIdentiteit: { documentId: string; bibliotheek?: string; bron?: string };

  // WAT is er gelezen — versiebewijs. `gecontroleerdOp` is het moment waarop de
  // VERSIE is vastgesteld, en uitdrukkelijk niet het moment van de rechtencheck.
  versie: { soort: "etag" | "ctag" | "hash" | "status-datum" | "onbekend"; waarde: string | null; gecontroleerdOp: string };

  // OF DE ACTOR HET MOCHT LEZEN — rechtenbewijs, een ander bewijs met een eigen
  // tijdstip. Zonder dit veld is `AdapterCapabilities.permissionProof` niets meer
  // dan een belofte van de adapter over zichzelf; de orkestratie kan er niet op
  // toetsen. Verplicht zodra `capabilities().permissionProof` waar is; de
  // orkestratie weigert dan elk resultaat zonder `toegangscontrole.toegestaan`
  // en elk resultaat waarvan `gecontroleerdOp` buiten het toegestane venster valt.
  toegangscontrole?: {
    toegestaan: true;                         // alleen toegestane resultaten verlaten de adapter
    gecontroleerdOp: string;                  // ISO-tijdstip van de live rechtencheck
    basis: "delegated_user" | "rls";          // met wiens rechten is getoetst
    bronconfiguratieVersie: number;           // sharepoint_bronnen.versie die gold
  };

  locator: { pagina?: number | null; paragraaf?: string | null; mappad?: string; chunkIndex?: number };
  passage: string;                            // geneutraliseerd, begrensd
  status: { documentstatus?; bronstatus?; geldigTot?; actueel: boolean };
  rang: { positie: number; score?: number | null; fts?: number | null; vec?: number | null; poging?: string };
  previewMogelijk?: boolean;                  // SharePoint: alleen na permission-check
}

export interface AdapterCapabilities {
  bronsoorten: Bronsoort[];
  strategieen: Retrievalstrategie[];
  ondersteundeFilters: (keyof RetrievalQuery["filters"])[];  // een niet-ondersteund filter is een fout, geen stille no-op
  versiebewijs: boolean;                      // levert eTag/cTag/hash per resultaat
  permissionProof: boolean;                   // toetst gebruikersrechten per request
  preview: boolean;
  cancellation: boolean;                      // honoreert AbortSignal
  timeout: boolean;                           // kent een eigen looptijdbegrenzing
}

// Wat een ADAPTER teruggeeft. Bewust GEEN `geselecteerd`, `bronverwijzingen`
// of `meta`: selecteren, samenvoegen, citeren en auditeren zijn taken van de
// centrale orkestratie (§4.2). Zou de adapter die velden vullen, dan kon elke
// provider zijn eigen selectie- en citatieregels meebrengen — precies de
// divergentie die dit contract opheft.
export interface AdapterUitkomst {
  kandidaten: Bronresultaat[];                // gerangschikt, begrensd op maxKandidaten
  methode: RetrievalMeta["methode"] | "sharepoint_live" | "geen";
  provider: "supabase" | "microsoft" | "geen";
  latencyMs: number;
  truncatie?: { reden: "kandidaten" | "tijd" | "annulering" };
  fout?: RetrievalFoutcategorie;
  diagnostiek?: { pogingen?: RetrievalMeta["retrieval_pogingen"]; embeddingGelukt?: boolean; fallbackReden?: string };
}

// Wat de ORKESTRATIE oplevert, en het enige dat de generatielaag te zien krijgt.
export interface RetrievalUitkomst {
  kandidaten: Bronresultaat[];                // deterministisch samengevoegd over adapters
  geselecteerd: Bronresultaat[];              // door de orkestratie geselecteerd
  bronverwijzingen: BronVerwijzing[];         // door de orkestratie gebouwd; bestaande vorm voor C1/C7
  perAdapter: { naam: RetrievalAdapter["naam"]; methode: AdapterUitkomst["methode"]; latencyMs: number; kandidaten: number; fout?: RetrievalFoutcategorie }[];
  latencyMs: number;                          // totaal, inclusief orkestratie
  truncatie?: { reden: "kandidaten" | "tekens" | "tijd" | "annulering" };
  fout?: RetrievalFoutcategorie;              // genormaliseerd over de adapters
  meta: RetrievalMeta;                        // bestaande audit-vorm, byte-compatibel
}

export type RetrievalFoutcategorie =
  | "geen_resultaten" | "buiten_scope" | "toestemming_geweigerd" | "configuratiefout"
  | "timeout" | "rate_limit" | "providerfout" | "truncatie" | "annulering";

export interface RetrievalAdapter {
  readonly naam: "supabase-rag" | "microsoft-sharepoint";
  capabilities(): AdapterCapabilities;
  zoek(ctx: RetrievalContext, query: RetrievalQuery): Promise<AdapterUitkomst>;
}
```

Drie dingen zijn nieuw ten opzichte van de eerste T1-ronde, alle drie uit de review:

- **`AdapterUitkomst` is losgetrokken van `RetrievalUitkomst`.** In de eerste opzet gaf
  `zoek()` de volledige `RetrievalUitkomst` terug, inclusief `geselecteerd` en
  `bronverwijzingen` — dan kan elke adapter zelf selecteren en citeren, terwijl §4.2
  juist voorschrijft dat de orkestratie dat doet. De adapter levert nu **alleen
  kandidaten plus diagnostiek**; selectie, samenvoeging, citatievorming en
  `RetrievalMeta` zijn exclusief van de orkestratie.
- **`Bronresultaat.toegangscontrole` maakt de permissionproof afdwingbaar.**
  `capabilities().permissionProof` was een boolean waarmee de adapter iets over
  zichzelf beweerde; er stond geen feitelijk rechtenbewijs in het resultaat, dus de
  orkestratie kon niet toetsen wat §4.7 belooft. Versiecontrole en autorisatiecontrole
  zijn bovendien **verschillende bewijzen met verschillende tijdstippen**:
  `versie.gecontroleerdOp` wordt daarom niet langer voor beide gebruikt.
- **`ondersteundeFilters`, `cancellation` en `timeout`** in `AdapterCapabilities`: §2.3
  laat zien dat de bestaande keten geen van drieën kent, en zonder expliciete capability
  zou een adapter een niet-ondersteund filter stil kunnen negeren — precies de
  divergentie die C6 vandaag al vertoont.

### 4.2 Orkestratie (`core/lib/retrieval/orkestratie.ts`)

1. Fonds, bronbeleid en toegestane adapters worden **server-side** bepaald; de browser
   of het generatiemodel kiest nooit adapter, fonds, endpoint of document-id.
2. Rechten-, status-, geldigheids-, privacy- en scopefilters **vóór** ranking en vóór
   selectie van modelcontext; de bestaande PII-gate en `handhaafFondsdiscipline`
   blijven op hun plek. Scopereferenties (proces, vergadering, agendapunt, document)
   worden expliciet gevalideerd tegen het fonds — niet impliciet aan RLS overgelaten
   (§2.6 punt 7).
3. **Geen cross-providerfallback.** Een adapterfout wordt genormaliseerd en volgens
   fondsbeleid afgehandeld (nu: veilige fout of leeg resultaat, nooit een bredere bron).
4. Samenvoeging deterministisch: adaptervolgorde uit bronbeleid, daarna rang, daarna
   `(documentId, chunkIndex, ref)` als stabiele tiebreaker; dedup op `ref`.
5. Begrenzing per call: kandidaten, tekens, looptijd (`AbortSignal.timeout`),
   concurrency 1 per adapter.
6. De gateway ontvangt uitsluitend `geselecteerd` als begrensde passages; de
   retrievallaag kiest **nooit** provider of model.
7. **Toelatingspoort per kandidaat, vóór selectie.** De orkestratie weigert een
   `Bronresultaat` dat niet voldoet aan de capabilities die de adapter zelf claimt:
   ontbrekende `versie.waarde` bij `versiebewijs: true`, ontbrekende of verlopen
   `toegangscontrole` bij `permissionProof: true`, of een filter uit `query.filters`
   dat niet in `ondersteundeFilters` staat. Een geweigerde kandidaat verdwijnt uit de
   kandidatenset en telt als `toestemming_geweigerd` of `configuratiefout` — hij komt
   nooit alsnog via een andere weg in de context.

**Wie doet wat.** De scheiding is hard, en volgt uit de splitsing in §4.1:

| Taak | Adapter | Orkestratie |
|---|---|---|
| Kandidaten ophalen en rangschikken | ✅ | — |
| Versie- en rechtenbewijs per kandidaat leveren | ✅ | — |
| Toelatingspoort op dat bewijs | — | ✅ |
| Samenvoegen over bronsoorten, dedup, tiebreak | — | ✅ |
| Selectie (max per document, dedup, representatie) | — | ✅ |
| Citaties en `BronVerwijzing` bouwen | — | ✅ |
| `RetrievalMeta` en het auditspoor schrijven | — | ✅ |
| Begrenzing op tekens en looptijd | — | ✅ |

### 4.3 Datastroom

```
  browser ──vraag+scopehint──►  route (withFondsRoute)
                                  │  capability, hostGuard, rateLimit, schema
                                  │  fondsId uit sessie   ← body genegeerd
                                  ▼
                            PII-gate ──blokkade──► veilige fout
                                  │
                                  ▼
                         RetrievalContext  (fonds, actor, bronbeleid,
                                            scope, correlationId, signal)
                                  │
                                  ▼
                          orkestratie ──► adapter(s)         [1 per bronsoort]
                                  │         supabase-rag  →  zoek_chunks(_hybride)  (RLS, security invoker)
                                  │         microsoft-sharepoint → Graph  (privé, achter de vault)
                                  │
                    filters/rechten/status/geldigheid  ◄── vóór ranking
                                  │
                             ranking + selectie + begrenzing
                                  │
                                  ▼
                        RetrievalUitkomst.geselecteerd  (begrensde passages)
                                  │
                                  ▼
                          AI-gateway (#311)  ── correlatieId ──►  gateway-log
                                  │
                                  ▼
                        antwoord + [Bron N]  ──►  governance_log.retrieval_meta
                                                   (correlationId, bronversie, citaties)
```

De **contextlaag (klasse B)** loopt vandaag langs deze pijl heen, rechtstreeks van de
route naar de prompt. Zij blijft in T2 buiten de adapter, maar krijgt wél een expliciet
label in de prompt en een eigen regel in het auditspoor (gaplijst G-1).

### 4.4 Foutmodel

Elke adapterfout wordt genormaliseerd naar één van negen categorieën. De categorie is
inhoudsvrij en gaat naar de audit; de gebruiker ziet een generieke melding.

| Categorie | Betekenis | Vandaag | Gedrag in T2 |
|---|---|---|---|
| `geen_resultaten` | legitiem leeg | leeg resultaat, `methode:"geen"` | ongewijzigd; nooit een bredere bron |
| `buiten_scope` | referentie valt buiten fonds/scope | RLS levert niets → oogt als leeg | expliciet onderscheiden van leeg |
| `toestemming_geweigerd` | rechten ontbreken (SharePoint-permissioncheck) | n.v.t. | resultaat weggelaten, nooit in AI-context |
| `configuratiefout` | ontbrekende sleutel/bron/vlag | 403 of stille terugval | fail-closed, geen terugval |
| `timeout` | looptijdbegrenzing bereikt | **bestaat niet** | truncatie met reden `tijd` |
| `rate_limit` | limiet bereikt | 429 (`zoeken` fail-closed) | ongewijzigd |
| `providerfout` | adapter/upstream faalt | rerank fail-safe → RRF; Mistral → FTS | genormaliseerd, geen providerdetail naar de client |
| `truncatie` | begrenzing kandidaten/tekens | afkapredenen op C3 | uniform per call |
| `annulering` | verzoek afgebroken | **bestaat niet** | keten stopt, geen halve context |

Geen enkele categorie mag leiden tot het verruimen van de bronset. Dat is de
belangrijkste invariant van het foutmodel.

### 4.5 Securitygrenzen

| Grens | Regel | Waar afgedwongen |
|---|---|---|
| Fondsbepaling | uitsluitend uit serversessie/profiel; body-`fonds_id` genegeerd en gesignaleerd (`body_fonds_id_genegeerd`) | `withFondsRoute` + `rag.ts` |
| Adapterkeuze | uit fondsconfig; browser noch model kan adapter, endpoint of tenant kiezen | orkestratie |
| Tenant-isolatie | RLS leidend, `handhaafFondsdiscipline` als app-guard náást RLS en RPC | DB + `rag.ts:129` |
| Scopevalidatie | proces-, vergadering-, agendapunt- en document-referenties expliciet tegen het fonds getoetst | orkestratie (**nieuw**, §2.6 punt 7) |
| Versiebewijs | elk resultaat draagt `versie.{soort,waarde,gecontroleerdOp}`; volledige hash op het eigen pad, eTag/cTag op het Microsoftpad. `status-datum` is een zwakke legacyfallback en op het Microsoftpad **niet toegestaan** (R1) | toelatingspoort §4.2 punt 7 |
| Rechtenbewijs | claimt een adapter `permissionProof`, dan draagt **elk** resultaat een `toegangscontrole` met eigen `gecontroleerdOp`, `basis` en `bronconfiguratieVersie`. Versie- en rechtencontrole zijn gescheiden bewijzen met gescheiden tijdstippen | toelatingspoort §4.2 punt 7, weigert |
| Capability-eerlijkheid | een filter uit `query.filters` dat niet in `ondersteundeFilters` staat is een fout, nooit een stille no-op | toelatingspoort §4.2 punt 7 |
| PII | PII-gate vóór retrieval en vóór elke web-arm | chatroute; **ontbreekt op C5** (gaplijst G-4) |
| Bronscheiding | centrale sectorbronnen blijven een eigen bronsoort; vermenging alleen deterministisch in de orkestratie | orkestratie |
| Geheimen | drive/item-identiteit, tokens en Graph-responses uitsluitend achter de private gateway | `microsoft_private.*` |
| Audit | inhoudsvrij; geen passages, geen zoekvragen met persoonsgegevens, geen tokens in operationele logs | `audit-meta.ts` |

### 4.6 Supabase-RAG-adapter

Dunne laag om `zoekRelevanteChunksMetMeta` **zonder semantische herbouw**: vertaalt
`RetrievalContext`/`RetrievalQuery` naar de bestaande zeven parameters en het resultaat
naar een `AdapterUitkomst` — dus **alleen kandidaten en diagnostiek**. De selectie die
`rag.ts` vandaag zelf doet (max per document, Jaccard-dedup, representatieconstraints)
en de opbouw van `RetrievalMeta` verhuizen naar de orkestratie; de adapter houdt het
ophalen en rangschikken. Vlaggen komen altijd uit `retrievalVlaggenVoorFonds` (C5 en C6
gaan dus mee), `regimeWeging` wordt een fondsvlag met default aan.

**Versie (besluit R1):** de volledige `hash` van `(document_id, indexering_versie,
bestand_hash)` is de versie-identiteit. `status-datum` blijft bestaan als **expliciet
zwakke legacyfallback** voor documenten waarvoor die drie velden nog niet compleet zijn,
draagt `soort: "status-datum"` in het resultaat en is **niet voldoende voor een
Microsoftresultaat** — daar weigert de toelatingspoort hem.

`capabilities()` = `{versiebewijs: true (na T2-3), permissionProof: false — RLS doet het
en de adapter kan er geen per-resultaat bewijs voor leveren, preview: false,
cancellation: true, timeout: true}`. Die laatste twee komen in **T2-1** mee, niet in
T2-5 (besluit R6): begrenzing hoort bij de orkestratiegrens zelf, niet bij de tests.
`toegangscontrole` blijft op dit pad leeg, met `basis: "rls"` zodra de adapter wél een
per-resultaat bewijs kan leveren; de orkestratie eist het veld alleen als de adapter
`permissionProof: true` claimt.

**Acceptatie:** de w322-goldens en de w311-SSE-snapshots byte-/structuuridentiek
volgens de klassenindeling van §3.2.

### 4.7 Microsoft-adaptergrens (stub, geen netwerk)

> **T1 leest, kopieert, chunkt of embedt geen enkele SharePoint-inhoud, en doet geen
> enkele Microsoft-retrievalcall.** Er is in deze tranche geen Graph-verkeer, geen
> Retrieval-API, geen SharePoint Search, geen Azure AI Search en geen Copilot-API.
> Wat hier staat, is uitsluitend de vorm van de grens.

De mapping van de fase-3-referentie naar het contract:

| Fase-3-gegeven (#321/0210) | Contractveld | Regel |
|---|---|---|
| `microsoft_private.sharepoint_documenten.id` | `ref` | lokale, **fondsgebonden** referentie — de enige die het contract verlaat |
| `sharepoint_bronnen.versie` (configuratieversie) | `toegangscontrole.bronconfiguratieVersie` | welke bronregistratie gold ten tijde van de rechtencheck |
| drive-id / item-id | — | **blijft privé**, uitsluitend achter de vault; komt het contract niet binnen |
| `eTag` / `cTag` | `versie.{soort,waarde}` | `soort: "etag"` respectievelijk `"ctag"` |
| moment waarop die eTag/cTag is gelezen | `versie.gecontroleerdOp` | **versiebewijs** |
| moment van de live permission-check | `toegangscontrole.gecontroleerdOp` | **rechtenbewijs**, met het token van de **gebruiker** (`basis: "delegated_user"`), niet van de app |
| previewrecht na hostvalidatie | `previewMogelijk` | alleen `true` ná een geslaagde permission-check |

De twee tijdstippen zijn bewust gescheiden. Ze vallen in de praktijk vaak samen, maar het
zijn verschillende beweringen: "dit is de versie die ik heb gelezen" en "deze actor mocht
haar op dat moment lezen". Eén veld voor beide maakt het onmogelijk om een verlopen
rechtencheck op een nog geldige versie te herkennen.

`capabilities()` = `{versiebewijs: true, permissionProof: true, preview: true,
cancellation: true, timeout: true, strategieen: ["gericht"]}`. Omdat deze adapter
`permissionProof: true` claimt, dwingt de toelatingspoort (§4.2 punt 7) af dat **elk**
resultaat een volledige `toegangscontrole` draagt met `basis: "delegated_user"`, een
`gecontroleerdOp` binnen het toegestane venster en de `bronconfiguratieVersie` die op dat
moment gold — plus een `versie` van soort `etag` of `ctag`. `status-datum` is hier
onvoldoende. Een resultaat dat daar niet aan voldoet wordt geweigerd, niet gedegradeerd.
In T2 kent deze adapter uitsluitend een teststub.

### 4.8 Audit en observability

Inhoudsvrij per retrievalcall: fonds, actor, taaktype, adapter, methode,
configuratieversie, aantallen kandidaten/selectie, latency, foutcategorie,
correlation-id. `correlationId` komt in `retrieval_meta` (basisniveau; allowlist in
`audit-meta.ts` en de SQL-projectie) zodat retrieval, gateway-log en governance met
één id te verbinden zijn — vandaag kan dat niet (§2.6 punt 5). Bronidentiteit en
versie op bronniveau: `bronversie_audit` krijgt `versie`. Geen passages, geen
zoekvragen met persoonsgegevens, geen tokens of providerresponses in operationele logs.

---

## 5. Gaplijst en T2-migratieplan

### 5.1 Gaplijst — omzeilende of afwijkende call-sites, geprioriteerd

| # | Gap | Call-sites | Ernst | Waarom | Pakket |
|---|---|---|---|---|---|
| **G-1a** | Drie van de vijf **evidencebronnen** lopen buiten de retrievalkern om | `besluitvorming-bron.ts` (`decision_objects`), `vergelijk-productie.ts` (`semantic_units`, `concepts`) | **hoog** | formele bronnen zonder citation-id, versie of ranking; R5 maakt ze citeerbaar en versiebaar | T2-4 |
| **G-1b** | 18 **modelcontext**-tabellen gaan de prompt in zonder enig contract | `portaalcontext.ts`, `module-scope`, `profielsturing.ts`, `organisatieprofiel.ts` | **hoog** | geen typed vorm, geen audit, geen begrenzing; R5 geeft ze een eigen contextcontract | T2-4 |
| **G-2** | Geen versie-identiteit per passage | C1–C6 | **hoog** | zonder exacte versie kan een Microsoftresultaat niet worden toegelaten; blokkeert §4.7. R1: volledige hash, `status-datum` alleen als zwakke legacyfallback | T2-3 |
| **G-3** | Geen cancellation en geen timeout in de keten | alle | **hoog** | een afgebroken verzoek laat retrieval en modelcalls doorlopen (kosten + belasting). R6: meteen in T2-1 | **T2-1** |
| **G-3b** | `permissionProof` was niet afdwingbaar | contract | **hoog** | capability-boolean zonder bewijs per resultaat; opgelost met `Bronresultaat.toegangscontrole` + toelatingspoort §4.2 punt 7 | T2-1 |
| **G-4** | C5 zonder fondsvlaggen, zonder PII-gate, zonder citation-id | `zoeken/route.ts:107` | midden | zelfde bronnen, ander gedrag en andere bronvorm dan de chat | T2-2 |
| **G-5** | C6 met `filters = {}` en hardcoded `parentRetrieval` | `vergelijk-productie.ts:72,142,143` | midden | R2: het **huidige gedrag blijft** — expliciet gekozen historische stukken moeten vergelijkbaar blijven. Alleen de bronvorm wordt gelijkgetrokken | T2-2 |
| **G-6** | Scopereferentie uit de query-string niet servervalidatie | `zoeken/route.ts` `?procesinstantie=` | midden | vandaag onschadelijk door RLS, maar de validatie hoort in de laag | T2-2 |
| **G-7** | `correlationId` niet in `retrieval_meta` | C1 | midden | R4: toevoegen, inclusief de kleine forwardmigratie | T2-3 |
| **G-8** | Directe `document_chunks`-toegang buiten `rag.ts` | `chat/route.ts:1036,1063,1298` en **`core/lib/parent-context.ts`** | midden | de laatste kwam pas met de transitieve scan boven water | T2-4 |
| **G-9** | Drie onverenigbare bronvormen | C1/C7, C5, C6 | midden | alleen `BronVerwijzing` draagt citation-id en sentinel | T2-2 |
| **G-10** | Hybride pad niet gekarakteriseerd | C1 | **hoog** (was: laag) | het is in productie het **primaire** pad; de goldens dekken alleen de FTS-terugval. R3: eigen tranche vóór T2-1 | **T1b** |
| **G-11** | `regimeWeging` niet per fonds stuurbaar | kern | laag | enige vlag met default aan, buiten `RetrievalVlaggen` | T2-2 |

### 5.2 Werkpakketten

| # | Pakket | Raakt | Gate |
|---|---|---|---|
| **T1b** | Embeddingstub naast de Anthropic-stub + geëmbedde fixtures; hybride golden op het `zoek_chunks_hybride`-pad. **Nog steeds geen productiecode.** | tests, fixtures | nieuwe hybride golden; bestaande 390 ongewijzigd |
| T2-1 | Contract + orkestratie + Supabase-adapter; C1 erdoorheen. **Inclusief `AbortSignal`, timeout en de toelatingspoort** (R6, G-3, G-3b) | chatroute, `rag.ts` (wrapper) | w311/w322-goldens identiek volgens §3.2; contracttests op cancellation/timeout |
| T2-2 | C5 en C6 door de orkestratie (vlaggen, bronvorm, scopevalidatie, PII-gate op C5). **C6 behoudt zijn filtergedrag** (R2) | zoeken, vergelijk | nieuwe goldens vóór en ná |
| T2-3 | Versie-identiteit (volledige hash, R1) in `bronversie_audit`; `correlationId` in `retrieval_meta` (R4, één forwardmigratie) | `audit-meta.ts`, SQL-projectie, migratie | audit-meta-sanity + karakterisering + R1-gates |
| T2-4 | Evidencebronnen achter het contract (G-1a); **typed contextcontract + audit voor de 18 modelcontext-tabellen** (G-1b); census krimpt tot adapter/orkestratie; chunkpresentie en `parent-context` via de adapter | chatroute, contextmodules | census-gate + contextgate (klassengroottes verschuiven bewust) |
| T2-5 | Microsoft-stub + contracttests: capabilities, versie- én **rechtenbewijs**, truncatie, alle negen foutcategorieën, cross-tenant met gemanipuleerde refs | tests | xtenant |
| T2-6 | Docs: dreigingsmodel, ASVS, HANDOVER, rollback | docs | ontwerp-sync |

**Migratie-impact.** Het contract blijft een codecontract; rollback is `git revert`.
Eén migratie is nu **besloten** (R4): `correlationId` in de SQL-allowlist van
`meta_basisniveau()` vraagt om één kleine, idempotente forwardmigratie mét check, plus
een regel in `supabase/checks/allowlist-grants.tsv` als er een object of grant wijzigt.

---

## 6. Beslissingen (vastgesteld)

De opdrachtgever heeft R1–R6 op 9 september 2026 beslist; ze zijn hierboven al verwerkt.
Vastgelegd in [`decisions/0213`](./decisions/0213-retrievalcontract-adaptergrens-en-contextlaag.md), status **Geaccepteerd**.

| # | Vraag | Besluit | Gevolg |
|---|---|---|---|
| **R1** | Versiebewijs Supabase | **Volledige hash** `(document_id, indexering_versie, bestand_hash)` als versie-identiteit. `status-datum` blijft uitsluitend als **expliciet zwakke legacyfallback** en is **niet voldoende voor een Microsoftresultaat** | §4.6; toelatingspoort weigert `status-datum` op het Microsoftpad |
| **R2** | Vergelijk-filters | **Huidig gedrag behouden.** Geen impliciet `actueel`-filter: expliciet gekozen historische documenten moeten vergelijkbaar blijven | G-5 beperkt zich tot de bronvorm; geen gedragswijziging in T2-2 |
| **R3** | Hybride golden | **Eigen tranche T1b**, vóór enige productiecode in T2-1 | G-10 van laag naar hoog; T1b toegevoegd aan §5.2 |
| **R4** | `correlationId` | **Toevoegen**, forwardmigratie geaccepteerd | G-7 sluit in T2-3; één idempotente migratie |
| **R5** | Reikwijdte contextlaag | **Hybride.** Besluitregistratie en andere formele evidence worden **citeerbaar en versiebaar**; agenda-, vergadering-, proces- en profielcontext blijft buiten documentretrieval maar krijgt een **eigen typed contextcontract met eigen audit**. Configuratie/autorisatie is **geen contextlaag** | G-1 gesplitst in G-1a/G-1b; de vier tabelklassen zijn hierop gebouwd en door de gate afgedwongen |
| **R6** | Cancellation/timeout | **Meteen in T2-1**, met de contracttests erbij. Het hoort bij de orkestratiegrens en de kostenbeheersing, niet bij de tests | G-3 verplaatst van T2-5 naar T2-1 |

**Wat nu nog openstaat vóór T2-1:** alleen T1b (R3). De ontwerpvragen zijn beslist.
