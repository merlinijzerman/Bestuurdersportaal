# Gemeenschappelijk retrievalcontract — fase 4 (#322/#348), tranche T1

> **Status:** T1-ontwerp ter review (bijgewerkt 9 september 2026). Geen productiecode,
> geen migratie en geen databaseobject gewijzigd.
> Fase 3 (#323, #324) en de AI-gateway-cutover (#325) zijn inmiddels op `preview`
> gemerged; de eerdere mergeblokkade is daarmee vervallen. Wat resteert vóór T2 is
> **review en besluit** op §6.
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
| Directe `core/lib`-imports van de chatroute | **45** | idem |
| Bestanden die het **antwoordpad** met DB-inhoud vullen | **10** | idem |
| Unieke tabellen bereikbaar op het antwoordpad | **33** | idem |
| Daarvan via de retrievalkern | **2** (`document_chunks`, `documenten`) | idem |
| Daarvan **buiten** de retrievalkern om | **31** | gate `F4-context` |

Die laatste twee regels zijn de kern van de bevinding: de retrievalkern is een
**kleine minderheid** van wat het antwoordpad in de modelcontext zet.

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

### 2.4 Klasse B — contextbronnen (de omzeilende laag)

Dit is de uitbreiding ten opzichte van de eerste T1-ronde, en de belangrijkste
vondst van #348 §1. Het antwoordpad vult de modelcontext óók met **gestructureerde
DB-inhoud die `rag.ts` nooit ziet**. Deze paden hebben geen ranking, geen citation-id
en geen bronversie-audit, en zouden een toekomstige adaptergrens **ongemerkt
omzeilen**. Bevroren in `tests/cross-tenant/retrieval-contextbronnen.expected.json`.

| Bestand | Tabellen | Rol in de modelcontext |
|---|---|---|
| `app/api/chat/route.ts` | 15 (`agendapunten`, `risicos`, `risico_log`, `risico_maatregelen`, `procedures`, `procedure_stappen`, `procedure_requirements`, `procedure_bewijs`, `decision_objects`, `documenten`, `document_chunks`, `governance_log`, `governance_log_inhoud`, `profielen`, `voorbereidingen`) | agendapunt-, proces-, risico- en risicomatrixblokken; chunkpresentie per document (3 plekken: `:1036`, `:1063`, `:1298`) |
| `core/lib/portaalcontext.ts` | `vergaderingen`, `agendapunten`, `agendapunt_inbreng`, `documenten`, `procedure_stappen`, `procedure_eigenaars`, `profielen` | **vergadering- en agendacontext** ("wat speelt er nu") |
| `core/lib/profielsturing.ts` | `profielen`, `expertises`, `gremia`, `kritische_focusgebieden`, `profiel_*` (3) | persoonsgebonden sturing van het antwoord |
| `core/lib/organisatieprofiel.ts` | `organisatie_profielen` | regimekader/organisatieblok |
| `core/lib/besluitvorming-bron.ts` | `decision_objects` | besluitregistratie als **formele bron náást** `document_chunks` |
| `core/lib/vergelijk-productie.ts` | `concepts`, `semantic_units` | vergelijkpad |
| `core/lib/fonds-config.ts` | `fonds_feature_flags`, `fonds_config_log`, `fonds_content_overrides`, `fonds_module_manifest`, `fonds_theming` | vlaggen die de retrieval sturen |
| `core/lib/capabilities.ts` | `profielen` | autorisatie |
| `core/lib/web-whitelist-data.ts` | `bron_whitelist` | webarm |
| `core/lib/rag.ts` | `document_chunks`, `documenten` | **de enige twee via de retrievalkern** |

Van de 33 unieke tabellen lopen er dus **2 via de kern en 31 eromheen**. De gate
`F4-context` pint dat getal hard: groeit het zonder besluit, dan is de contextlaag
stil uitgebreid.

> **Reikwijdte van deze bevinding.** Klasse B is géén beveiligingslek: al deze
> lezingen lopen onder RLS met de tenant-client, en `module_scope` weigert expliciet
> bij een niet-gevonden `procedure_id`/`risico_id` in plaats van terug te vallen op
> fondsbrede data (`module-scope.ts`, kopcommentaar). Het punt is architectonisch:
> deze inhoud is **niet citeerbaar, niet versiebaar en niet rankbaar**, en het
> contract moet expliciet zeggen dat zij dat ook niet wordt.

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
  (10 bestanden, 33 tabellen, 31 omzeilend).
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
voorwaarde voor een hybride golden (reviewvraag R3).

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
  versie: { soort: "etag" | "ctag" | "hash" | "status-datum" | "onbekend"; waarde: string | null; gecontroleerdOp: string };
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

export interface RetrievalUitkomst {
  kandidaten: Bronresultaat[];
  geselecteerd: Bronresultaat[];
  bronverwijzingen: BronVerwijzing[];         // bestaande vorm, ongewijzigd voor C1/C7
  methode: RetrievalMeta["methode"] | "sharepoint_live" | "geen";
  provider: "supabase" | "microsoft" | "geen";
  latencyMs: number;
  truncatie?: { reden: "kandidaten" | "tekens" | "tijd" | "annulering" };
  fout?: RetrievalFoutcategorie;
  meta: RetrievalMeta;                        // bestaande audit-vorm, byte-compatibel
}

export type RetrievalFoutcategorie =
  | "geen_resultaten" | "buiten_scope" | "toestemming_geweigerd" | "configuratiefout"
  | "timeout" | "rate_limit" | "providerfout" | "truncatie" | "annulering";

export interface RetrievalAdapter {
  readonly naam: "supabase-rag" | "microsoft-sharepoint";
  capabilities(): AdapterCapabilities;
  zoek(ctx: RetrievalContext, query: RetrievalQuery): Promise<RetrievalUitkomst>;
}
```

`ondersteundeFilters`, `cancellation` en `timeout` zijn nieuw ten opzichte van de
eerste T1-ronde. Reden: §2.3 laat zien dat de bestaande keten geen van drieën kent, en
zonder expliciete capability zou een adapter een niet-ondersteund filter stil kunnen
negeren — precies de divergentie die C6 vandaag al vertoont.

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
| Rechten/versie | een Microsoftresultaat zonder exacte versie én actuele permissionproof komt het contract niet binnen | orkestratie, weigert |
| PII | PII-gate vóór retrieval en vóór elke web-arm | chatroute; **ontbreekt op C5** (gaplijst G-4) |
| Bronscheiding | centrale sectorbronnen blijven een eigen bronsoort; vermenging alleen deterministisch in de orkestratie | orkestratie |
| Geheimen | drive/item-identiteit, tokens en Graph-responses uitsluitend achter de private gateway | `microsoft_private.*` |
| Audit | inhoudsvrij; geen passages, geen zoekvragen met persoonsgegevens, geen tokens in operationele logs | `audit-meta.ts` |

### 4.6 Supabase-RAG-adapter

Dunne laag om `zoekRelevanteChunksMetMeta` **zonder semantische herbouw**: vertaalt
`RetrievalContext`/`RetrievalQuery` naar de bestaande zeven parameters en
`RetrievalMeta` naar `RetrievalUitkomst`. Vlaggen komen altijd uit
`retrievalVlaggenVoorFonds` (C5 en C6 gaan dus mee), `regimeWeging` wordt een fondsvlag
met default aan. Versie: `hash` van `(document_id, indexering_versie, bestand_hash)`
waar beschikbaar, anders `status-datum` (reviewvraag R1).
`capabilities()` = `{versiebewijs: false→true na R1, permissionProof: false (RLS doet
het), preview: false, cancellation: false, timeout: false}` — en die laatste twee
worden in T2-5 op `true` gebracht.

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
| `sharepoint_bronnen.versie` (configuratieversie) | `documentIdentiteit.bron` | welke bronregistratie gold |
| drive-id / item-id | — | **blijft privé**, uitsluitend achter de vault; komt het contract niet binnen |
| `eTag` / `cTag` | `versie.{soort,waarde}` | `soort: "etag"` respectievelijk `"ctag"` |
| moment van de live permission-check | `versie.gecontroleerdOp` | met het token van de **gebruiker**, niet van de app |
| previewrecht na hostvalidatie | `previewMogelijk` | alleen `true` ná een geslaagde permission-check |

`capabilities()` = `{versiebewijs: true, permissionProof: true, preview: true,
cancellation: true, timeout: true, strategieen: ["gericht"]}`. De orkestratie
**weigert** elk resultaat zonder volledige identiteit, zonder versie of zonder
permissionproof. In T2 kent deze adapter uitsluitend een teststub.

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

| # | Gap | Call-sites | Ernst | Waarom | T2-pakket |
|---|---|---|---|---|---|
| **G-1** | Contextlaag omzeilt elke adaptergrens: 31 van de 33 tabellen op het antwoordpad | klasse B (10 bestanden) | **hoog** | niet citeerbaar, niet versiebaar, niet rankbaar; groeit vandaag zonder gate (nu wel bevroren) | T2-4 |
| **G-2** | Geen versie-identiteit per passage | C1–C6 | **hoog** | zonder exacte versie kan een Microsoftresultaat later niet toegelaten worden; blokkeert 4.7 | T2-3 |
| **G-3** | Geen cancellation en geen timeout in de keten | alle | **hoog** | een afgebroken verzoek laat retrieval en modelcalls doorlopen (kosten + belasting) | T2-5 |
| **G-4** | C5 zonder fondsvlaggen, zonder PII-gate, zonder citation-id | `zoeken/route.ts:107` | midden | zelfde bronnen, ander gedrag en andere bronvorm dan de chat | T2-2 |
| **G-5** | C6 met `filters = {}` en hardcoded `parentRetrieval` | `vergelijk-productie.ts:72,142,143` | midden | citaten zonder peildatum-, modus- of regimefilter (reviewvraag R2) | T2-2 |
| **G-6** | Scopereferentie uit de query-string niet servervalidatie | `zoeken/route.ts` `?procesinstantie=` | midden | vandaag onschadelijk door RLS, maar de validatie hoort in de laag, niet in de DB | T2-2 |
| **G-7** | `correlationId` niet in `retrieval_meta` | C1 | midden | keten retrieval → gateway → governance niet met één id te volgen (reviewvraag R4) | T2-3 |
| **G-8** | Directe `document_chunks`-toegang op het antwoordpad | `chat/route.ts:1036,1063,1298` | midden | omzeilt `rag.ts` voor chunkpresentie | T2-4 |
| **G-9** | Drie onverenigbare bronvormen | C1/C7, C5, C6 | midden | alleen `BronVerwijzing` draagt citation-id en sentinel | T2-2 |
| **G-10** | Hybride pad niet gekarakteriseerd | C1 | laag | vergt embeddingstub (reviewvraag R3) | T2-1 of T1b |
| **G-11** | `regimeWeging` niet per fonds stuurbaar | kern | laag | enige vlag met default aan, buiten `RetrievalVlaggen` | T2-2 |

### 5.2 T2-werkpakketten

| # | Pakket | Raakt | Gate |
|---|---|---|---|
| T2-1 | Contract + orkestratie + Supabase-adapter; C1 erdoorheen | chatroute, `rag.ts` (alleen wrapper) | w311/w322-goldens identiek volgens §3.2 |
| T2-2 | C5 en C6 door de orkestratie (vlaggen, filters, bronvorm, scopevalidatie) | zoeken, vergelijk | nieuwe goldens vóór en ná; motivering waar gedrag bewust verandert (G-5) |
| T2-3 | Versie-identiteit in `bronversie_audit`; `correlationId` in `retrieval_meta` | `audit-meta.ts`, SQL-projectie | audit-meta-sanity + karakterisering |
| T2-4 | Boundary: census krimpt tot adapter/orkestratie; chunkpresentie via de adapter; contextlaag krijgt expliciet label + auditregel | chatroute | census-gate + contextgate |
| T2-5 | Microsoft-stub + contracttests: capabilities, versie, **cancellation, timeout, truncatie, alle negen foutcategorieën**, cross-tenant met gemanipuleerde refs | tests | xtenant |
| T2-6 | Docs: dreigingsmodel, ASVS, HANDOVER, rollback | docs | ontwerp-sync |

**Migratie-impact.** Zolang het contract een codecontract blijft, is geen migratie
nodig; rollback is `git revert`. Eén uitzondering: komt `correlationId` in de
SQL-allowlist van `meta_basisniveau()` (G-7), dan hoort daar één kleine, idempotente
forwardmigratie mét check bij, plus een regel in `supabase/checks/allowlist-grants.tsv`
als er een object of grant wijzigt. Dat is reviewvraag R4.

---

## 6. Open beslissingen vóór T2

T2 start pas na expliciet akkoord op §5.1 én op deze zes vragen.

- **R1 — Versiebewijs voor Supabase-documenten.** `hash(document_id,
  indexering_versie, bestand_hash)` als volwaardige versie, of alleen `status-datum`
  tot er een echte documentversie in het datamodel bestaat? Dit bepaalt of G-2 in T2
  volledig sluit of half.
- **R2 — C6 (vergelijk) krijgt peildatum-, modus- en regimefilters.** Dat is een
  bewuste **gedragswijziging**: vandaag vergelijkt de module ook niet-actuele stukken.
  Gewenst, of bewust behouden met een expliciete uitzondering in het contract?
- **R3 — Hybride golden.** Embeddingstub in een T1b, of pas in T2-1? Zonder stub
  blijft het hybride pad ongekarakteriseerd terwijl het in productie het primaire pad is.
- **R4 — `correlationId` in `retrieval_meta`.** Forwardmigratie voor de SQL-allowlist
  accepteren, of de keten voorlopig via `gesprek_audit_id` blijven volgen?
- **R5 — De contextlaag (G-1).** Blijft klasse B definitief buiten het contract, met
  alleen een promptlabel en een auditregel? Of moet een deel ervan (besluitregistratie
  via `besluitvorming-bron.ts`, dat zichzelf "formele bron náást `document_chunks`"
  noemt) wél citeerbaar en versiebaar worden? Dit is de zwaarste van de zes: het
  bepaalt de omvang van T2-4.
- **R6 — Cancellation en timeout (G-3).** Horen die in T2-1 (meteen bij de
  orkestratie, want daar hoort de begrenzing) of in T2-5 (bij de contracttests)? Ze
  raken de chatroute en de kostenbeheersing, niet alleen de tests.
