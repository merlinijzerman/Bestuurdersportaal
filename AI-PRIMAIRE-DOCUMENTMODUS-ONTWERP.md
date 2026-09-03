# AI-assistent — primaire-documentmodus en vindbaarheid van conceptstukken

> **Sinds P1a (03-09-2026, besluit 0201) staat de assistent in drie lagen.** De context (L1) en het gesprek (L2) wonen in `core/components/assistent/` en `core/lib/assistent-*`; `AssistentClient.tsx` is nog uitsluitend de presentatie (L3). Verwijzingen naar `AssistentClient` hieronder die over gespreksstaat, streaming of de payload gaan, slaan dus op `core/components/assistent/useAssistent.ts` of `core/lib/assistent-stream.ts`. Zie besluit 0201 §"Waar oudere besluiten naar AssistentClient verwijzen".
> Concreet voor dit document: de werkstand-STAAT (`voorbereidingsstand`, serverveld `neem_niet_vastgestelde_mee`) zit sinds 0201 in `useAssistent.ts`; het chiplabel en de schakelaar bleven in `AssistentClient.tsx`.


> **Status:** gebouwd 12-08-2026, nog niet gedeployed. Besluit: [`decisions/0172`](./decisions/0172-primaire-documentmodus-en-vindbaarheid-conceptstukken.md).
> Vervangt het strict-document gedrag uit increment 1/2 (`03 Functioneel ontwerp/Bestuurdersportaal - AI-vragen over een specifiek document ontwerp v0.2.md`, §6 + AC-148/158 — die criteria zijn hiermee vervallen).

## 1. Probleem

| # | Klacht | Wortel |
|---|---|---|
| 1 | Een document selecteren maakte de assistent dommer: alleen dat stuk werd nog bevraagd | `p_document_ids` als harde filter vóór de ranking, op vijf lagen tegelijk |
| 2 | Conceptstukken — en dus vrijwel alle vergaderstukken — werden niet gevonden, zelfs niet bij expliciet vragen | `modus 'actueel'` filtert op `documentstatus in ('vastgesteld','van_kracht')`; vergaderstukken blijven per constructie op `'concept'` staan |

Beide zijn dezelfde reflex: onzekerheid oplossen door te verbergen. Het reële risico
is niet dat er iets wordt verzonnen (elke uitspraak draagt een `[Bron N]`-marker),
maar **versieverwarring** — een concept- en een vastgestelde versie die netjes
gebrond samensmelten tot één uitspraak. Dat is een herkomstprobleem, en dat lost een
zichtbaar etiket beter op dan een filter.

## 2. Ontwerp — primaire-documentmodus

### 2.1 Tweesporen-retrieval

```
vraag + gekozen document
        │
        ├─ spoor A (primair)     scope = [gekozen doc]   filters = undefined   budget = CHUNK_BUDGET (10)
        │                        └─ byte-identiek aan het gedrag van vóór deze release
        │
        └─ spoor B (aanvullend)  scope = null            filters = normaal     budget = AANVULLEND_BUDGET (5)
                                 └─ documenten van het hoofddocument eruit gefilterd

        chunks = [...spoor A, ...spoor B]      (volgorde is betekenisdragend)
```

Beide sporen draaien **parallel** (`Promise.all`). Drie eigenschappen zijn de reden
voor deze vorm:

1. **Geen migratie.** De RPC's blijven ongewijzigd; terugdraaien is `AANVULLEND_BUDGET`
   op 0 zetten.
2. **Geen verdringing.** Eigen budget per spoor, dus de verbreding kan de dekking
   van het hoofddocument per constructie niet verslechteren. Zelfde principe als
   `fuseerHybridePogingen`: recall toevoegen, nooit wegnemen.
3. **Het hoofddocument blijft vrijgesteld van het statusfilter.** Dit is de kern van
   de veiligheid. Zou de scope simpelweg vervallen, dan zou een bewust gekozen
   **conceptvergaderstuk** door modus `'actueel'` uit zijn eigen antwoord vallen.

### 2.2 Herkomst en status in de prompt

`maakContext` krijgt twee optionele parameters (`primaireDocumentIds`, `peildatum`)
en zet in de bronkop:

```
[Bron 3] Bestuursvergadering — Conceptbegroting 2027 [concept — nog niet vastgesteld] [hoofddocument] (pag. 4)
[Bron 7] Bestuursvergadering — Begroting 2026 [aanvullend uit de bibliotheek] (pag. 11)
```

Statuslabels komen uit één plek: [`core/lib/documentstatus-label.ts`](./core/lib/documentstatus-label.ts).
Alleen **afwijkingen** krijgen een label; vastgesteld/van kracht is de norm en blijft
kaal. Een lege of onbekende status wordt expliciet benoemd (`[status onbekend]`) en
niet stil als geldend behandeld.

### 2.3 Antwoordvorm

`SP_DOCUMENT_PRIMAIR_REGELS` (targeted) en `SP_DOCUMENT_PRIMAIR_ALG_REGELS`
(met algemene kennis, vier gescheiden koppen). Kern: het hoofddocument is leidend;
een aanvullende bron mag duiden, vergelijken en aanvullen maar nooit een uitspraak
doen over wat er in het hoofddocument staat; het gebruik ervan wordt zichtbaar
gemaakt in de lopende tekst; een statuslabel wordt overgenomen zodra eruit wordt
geciteerd.

Het **brede pad** (doorgronden/samenvatten) blijft ongewijzigd: dat laadt het
volledige document en draait geen retrieval. `SP_DOCUMENT_SCOPE_ALG_REGELS` is
hernoemd naar `SP_DOCUMENT_BREED_ALG_REGELS` zodat uit de naam blijkt dat het bij
dat pad hoort; de tekst is ongemoeid.

## 3. Ontwerp — vindbaarheid conceptstukken

| Maatregel | Plek |
|---|---|
| Open staart op `concept` (lookahead voor `conceptueel`/`conceptualiseren`) | `vraagtype.ts` `VOORSTELVRAAG_PATRONEN` |
| Vergaderstuk-vocabulaire: `vergaderstuk`, `bestuursstuk`, `oplegnotitie`, `ter agendering`, `geagendeerd`, `op de agenda` | idem |
| `fondsTreffers === 0`-drempel weg bij de verbredingstelling; melding blijft voorbehouden aan het nul-treffers-geval | `route.ts` |
| Zichtbare, persistente werkstand "Stukken in voorbereiding meenemen" | `AssistentClient.tsx` |
| Statuslabel in de prompt (zie 2.2) | `rag.ts` / `documentstatus-label.ts` |

**Bewust niet gedaan:** het harde statusfilter in de RPC's vervangen door een
rangkorting. Structureel beter, maar vergt een migratie, het opruimen van drie
gedupliceerde statusdefinities en een evalronde. Eerst meten hoe vaak de werkstand
wordt aangezet.

## 4. Acceptatiecriteria

**Primaire-documentmodus**

- AC-1 — Bij een gekozen document levert de retrieval passages uit dat document **en** uit de rest van de bibliotheek; het gekozen document staat vooraan in de bronnummering.
- AC-2 — De dekking van het hoofddocument is niet slechter dan vóór deze release: spoor A draait met hetzelfde budget, dezelfde scope en zonder statusfilter.
- AC-3 — Een gekozen document met status `concept` levert nog steeds passages op. *(Regressietest: kies een conceptvergaderstuk en stel er een inhoudelijke vraag.)*
- AC-4 — Elke bron in de prompt draagt `[hoofddocument]` of `[aanvullend uit de bibliotheek]`.
- AC-5 — Het antwoord maakt in lopende tekst zichtbaar wanneer een aanvullende bron is gebruikt; "staat niet in dit stuk, wél elders" wordt als zodanig benoemd.
- AC-6 — Zonder documentselectie verandert er niets: `primaireIds` is leeg, er draait één spoor, en de bronkop krijgt geen herkomstmarkering.
- AC-7 — `retrievalMeta.chunks` bevat de chunks van **beide** sporen (voedt `bepaalBronset` → bevroren reflectiebronset + bronset-hash met SQL-spiegel in `reflectie_transitie()`).
- AC-8 — `retrievalMeta.scope` bevat `modus: "primair"`; `retrievalMeta.aanvullend` bevat `{ chunks, documenten }`. Dat laatste staat bewust top-level en niet in `scope`, omdat `scope.document_ids` via `leesScopeDocumentIds` de bronset-hash voedt.

**Vergadermodule (agendapuntchat + voorbereiding)**

- AC-17 — In agendapunt-modus levert de retrieval passages uit de gekoppelde stukken **en** uit de rest van de bibliotheek; gekoppelde stukken staan vooraan in de bronnummering en dragen `[gekoppeld stuk]`.
- AC-18 — Het primaire spoor in agendapunt-modus draait ongefilterd (zoals voorheen), zodat conceptvergaderstukken meekomen. Het aanvullende spoor draagt wél de bibliotheekfilters.
- AC-19 — Het antwoord in de agendapuntchat houdt vier herkomsten gescheiden: toelichting, gekoppeld stuk, aanvullende bibliotheekbron, algemene kennis.
- AC-20 — "Stel mijn voorbereiding op" neemt stukken mee die nog niet zijn vastgesteld, met statuslabel. *(Regressietest: agendapunt met alleen een conceptstuk → de voorbereiding noemt het stuk en labelt het als concept.)*
- AC-21 — Proces-modus (`module_scope.soort === "proces"`) blijft hard afgebakend tot de bewijsstukken; geen aanvullend spoor.

**Conceptstukken**

- AC-9 — "Wat staat er in de conceptnotulen over X?" verlaat modus `'actueel'`. Idem voor `conceptbegroting`, `conceptjaarverslag`, `vergaderstukken`, `oplegnotitie`, `geagendeerd`.
- AC-10 — "Is dit conceptueel houdbaar?" verlaat modus `'actueel'` **niet**.
- AC-11 — Een conceptbron in de prompt draagt `[concept — nog niet vastgesteld]`; een vastgestelde bron draagt geen label.
- AC-12 — Het antwoord presenteert een niet-vastgesteld stuk niet als geldend beleid en smelt concept- en vastgestelde versie van hetzelfde stuk niet samen.
- AC-13 — De verbredingschip verschijnt zodra er niet-vastgestelde fondsstukken zijn, óók als de retrieval wél vastgestelde treffers had. De vervangende melding verschijnt alleen bij nul fondstreffers.
- AC-14 — De werkstand "Stukken in voorbereiding meenemen" geldt voor elke volgende vraag in het gesprek en is zichtbaar aan een indicator.

**Niet-functioneel**

- AC-15 — Tenant-isolatie ongewijzigd: spoor B gebruikt dezelfde server-side `fondsId` en filters als het gewone bibliotheekpad. Geen nieuwe query, RPC of policy. Te bevestigen met `scripts/cross-tenant-ci.sh`.
- AC-16 — `tsc --noEmit --skipLibCheck` exit 0 en `npm run sanity` volledig groen.

## 5. Gewijzigde bestanden

| Bestand | Wijziging |
|---|---|
| `core/lib/documentstatus-label.ts` | **nieuw** — statuslabels, één bron |
| `core/lib/documentstatus-label.sanity.ts` | **nieuw** — 7 checks |
| `core/lib/rag.ts` | `maakContext` + herkomst-/statuslabel; `RetrievalMeta.scope` uitgebreid |
| `core/lib/vraagtype.ts` | `VOORSTELVRAAG_PATRONEN` |
| `core/lib/vraagtype.sanity.ts` | 4 tests erbij (80 totaal) |
| `core/lib/generatie-kern.ts` | `SP_DOCUMENT_PRIMAIR_*` nieuw; `SP_DOCUMENT_SCOPE_REGELS` verwijderd; `_ALG_` hernoemd naar `_BREED_ALG_` |
| `core/lib/antwoord-klembord(.sanity).ts` | commentaarverwijzing naar de nieuwe naam |
| `app/api/chat/route.ts` | tweesporen-retrieval, filters, promptkeuze, gebruikersprompt, verbredingstelling, auditspoor |
| `app/(dashboard)/ai/_components/AssistentClient.tsx` | werkstand + chipteksten |
| `core/lib/agendapunt-context(.sanity).ts` | `SP_AGENDAPUNT_REGELS`: gekoppeld stuk vs. aanvullende bron + statuslabelregel; 3 asserts erbij |
| `app/api/agendapunten/[id]/voorbereiding/route.ts` | `modus: "actueel"` → `"besluitvorming"`; peildatum naar `maakContext` |

Géén migratie. De sha256-promptpins in `generatie-kern.sanity.ts` blijven ongemoeid:
die pinnen `TOON_BLOK`, `NIEUW_*`, `SP_SPARRING_*`, `SP_REFLECTIE_*` en assemblages
op basis van `SP_COMBINEREN_REGELS`/`SP_DOCUMENTEN_REGELS` — geen daarvan raakt de
`SP_DOCUMENT_SCOPE_*`-familie.

## 6. Openstaand

- Demotie i.p.v. filtering in de RPC's (met opruiming van de drie gedupliceerde statusdefinities).
- Statusverklaring op het vergaderstuk-uploadpad, zodat `'concept'` geen vergaarbak blijft.
- `zoek_vector` uitbreiden met `d.titel` (`setweight`) — verwijzen naar een stuk bij naam werkt nu niet. Vergt herindexering.
- Brede pad (doorgronden): wel of geen aanvullende bronnen.
- Niet-geïndexeerde gekoppelde stukken worden stil weggelaten terwijl de UI ze wél meetelt ("en N gekoppelde stukken"). Teller en doorzochte set kunnen uiteenlopen zonder signaal.
- Proces-modus bewust hard gelaten.
- v0.3 van het functioneel ontwerp in de documentatieset, met de vervallen AC's.
