# 0213 — Retrievalcontract fase 4: waar de adaptergrens ligt, en wat er bewust buiten valt

- **Status:** Voorgesteld (T1-ontwerp ter review; T2 start pas na akkoord op R1–R6)
- **Datum:** 2026-09-09
- **Betrokkenen:** Merlin (opdrachtgever/productowner), Claude (inventarisatie, karakterisering en ontwerp, issues #322/#348)
- **Ticket:** [#348](https://github.com/merlinijzerman/Bestuurdersportaal/issues/348) — M365 fase 4 · T1 inventarisatie, karakterisering en retrievalcontract (tranche van [#322](https://github.com/merlinijzerman/Bestuurdersportaal/issues/322))

## Context

Besluit 0208 maakt de bronlaag duaal: de eigen variant zoekt in de Supabase-RAG, de Microsoftvariant later live in SharePoint. Fase 3 (0210, #321) legde de SharePoint-identiteit vast, de AI-gateway (0209, #311) het generatiecontract. Daartussen ontbreekt een providerneutraal retrievalcontract; zonder dat lopen bronselectie, rechten, citaties, foutgedrag en audit per bron uiteen.

Tranche T1 mag geen productiecode raken. Ze moet vaststellen wat er vandaag ís, dat gedrag deterministisch vastleggen vóór enige verplaatsing, en de grens van het contract bepalen.

Twee metingen tijdens die inventarisatie dwongen dit besluit af.

**Meting 1 — de retrievalkern is een minderheid van het antwoordpad.** `app/api/chat/route.ts` en zijn 45 direct geïmporteerde `core/lib`-modules lezen samen **33 unieke tabellen**. Daarvan lopen er **2** via `core/lib/rag.ts` (`document_chunks`, `documenten`) en **31** eromheen: agendapunt-, vergadering-, proces-, risico-, portaalstand- en profielsturingscontext, plus de besluitregistratie die zichzelf in haar eigen kopcommentaar "formele bron náást `document_chunks`" noemt. Die inhoud belandt in de modelcontext zonder ranking, zonder citation-id en zonder bronversie-audit. Een adaptergrens die alleen om `rag.ts` heen wordt getrokken, zou dus het grootste deel van wat het model te zien krijgt ongemerkt buiten zichzelf laten.

**Meting 2 — de eerste karakterisering pinde niet wat zij claimde.** `normaliseerJson()` sorteert elke array recursief; een omgekeerde ranking gaf een byte-identiek snapshot. Empirisch vastgesteld op `w322.zoeken.get.bestuurder.premiebeleid`. De acceptatiegrens van T2 ("volgorde ongewijzigd") stond dus op een golden die dat niet kon aantonen. Twee vervolgmetingen legden de grenzen van de UUID-maskering bloot: chunk-ID's zijn alleen relationeel te pinnen, en object-*sleutels* ontsnappen volledig aan de maskering (`poging_herkomst`).

Randvoorwaarden: RLS blijft leidend en wordt niet versoepeld; het auditspoor blijft append-only en inhoudsvrij; de bestaande 380+ snapshots mogen niet omvallen; T1 doet geen enkele Microsoft-call en leest geen SharePoint-inhoud.

## Besluit

1. **De adaptergrens ligt om de retrievalkern, niet om de contextlaag.** Het contract (`RetrievalContext`/`RetrievalQuery`/`Bronresultaat`/`RetrievalUitkomst`/`AdapterCapabilities`/`RetrievalAdapter`) dekt uitsluitend paden die bronnen ophalen, ranken, selecteren en citeren. De contextlaag — agendapunt, vergadering, proces, risico, portaalstand, profielsturing — blijft er expliciet buiten en wordt **niet** citeerbaar of versiebaar. Zij krijgt in T2 wél een expliciet promptlabel en een eigen auditregel. Of de besluitregistratie op die regel een uitzondering wordt, is reviewvraag R5.

2. **Wat buiten de grens valt, wordt bevroren in plaats van beschreven.** Een tweede register (`tests/cross-tenant/retrieval-contextbronnen.expected.json`, gate `F4-context`) pint per bestand welke tabellen het antwoordpad leest, en pint het getal 31 hard. Een nieuwe tabel in de modelcontext is daarmee een gereviewde handeling, geen stille uitbreiding. Dit is de tegenhanger van de bestaande retrievalcensus (17 bestanden), die in T2 juist krimpt tot adapter en orkestratie.

3. **Een golden die niet aantoonbaar rood wordt, telt niet als karakterisering.** Elke retrieval-golden krijgt een volgorde-gecodeerde projectie (`tests/karakterisering/retrieval-volgorde.mjs`): de positie staat in de waarde, zodat de gedeelde array-sortering haar niet kan wegpoetsen. De gedeelde `normaliseer.mjs` wordt daarvoor **niet** versoepeld — dat zou alle bestaande snapshots raken. Een offline suite van 15 negatieve controles (`retrieval-golden-gevoeligheid.test.ts`) bewijst per mutatie — volgorde, citaat-ID, fondsfilter, versie-identiteit — dat de golden kantelt, en legt de drie gemeten grenzen van de normalisatie vast als bewaakte aanname.

4. **Ontbrekend gedrag wordt niet gekarakteriseerd maar als gap geregistreerd.** `rag.ts`, `rerank.ts` en `embeddings.ts` bevatten nul voorkomens van `AbortSignal`, en geen enkele retrieval-call-site kent een looptijdbegrenzing. Goldens voor timeout en annulering zijn daarom in T1 onmogelijk: er is geen gedrag om vast te leggen. Ze verhuizen naar T2-5 als contracttest op de adapter. `AdapterCapabilities` krijgt daarom expliciet `cancellation`, `timeout` en `ondersteundeFilters`: een adapter die een filter niet kan uitvoeren, moet dat melden in plaats van het stil te negeren.

5. **Geen cross-providerfallback, en geen enkele foutcategorie verruimt de bronset.** Negen genormaliseerde categorieën (`geen_resultaten`, `buiten_scope`, `toestemming_geweigerd`, `configuratiefout`, `timeout`, `rate_limit`, `providerfout`, `truncatie`, `annulering`). Een Microsoftresultaat zonder exacte versie én actuele permissionproof komt het contract niet binnen; drive- en item-identiteit blijven achter de private gateway.

6. **Scopevalidatie hoort in de laag, niet in de database.** `GET /api/zoeken` zet vandaag `?procesinstantie=<id>` rechtstreeks in de retrievalfilters zonder te toetsen of dat dossier bij het fonds hoort. RLS en de expliciete fondsfilter maken dat onschadelijk — een vreemd dossier levert niets op — maar het contract belegt de validatie voortaan expliciet in de orkestratie.

## Overwogen alternatieven

- **De adaptergrens om het hele antwoordpad trekken (contextlaag erbij).** Consistent, en het zou G-1 in één keer sluiten. Verworpen voor T2: het maakt de tranche onbeheersbaar (31 tabellen, 10 modules, raakt de op sha256 gepinde toon-systeemprompt) en de contextlaag heeft geen ranking- of citatiebehoefte. De keuze blijft open als R5.
- **`normaliseer.mjs` aanpassen zodat arrays niet meer worden gesorteerd.** De directe oplossing voor bevinding 1. Verworpen: het raakt alle 380+ bestaande snapshots, waarvan de meeste juist ordeonafhankelijk moeten zijn omdat PostgREST geen rijvolgorde garandeert. De projectie lost het lokaal op zonder die eigenschap te verliezen.
- **De letterlijke chunk-UUID's in de goldens pinnen.** Zou bevinding 2 volledig sluiten. Verworpen: de seed geeft bij elke heropbouw andere UUID's, dus zulke goldens vallen bij elke herseed om — precies het gedrag dat aanleert om snapshots blind bij te werken. Co-referentie pinnen levert de veiligheidsrelevante helft (een citaat dat naar een ander document wijst) zonder die broosheid.
- **Timeout- en annuleringsgoldens alsnog opnemen door het gedrag in T1 te bouwen.** Verworpen: T1 mag geen productiecode wijzigen, en karakterisering die haar eigen onderwerp eerst bouwt, karakteriseert niets.

## Gevolgen

**RLS/tenant-isolatie.** Ongewijzigd. Geen policy, grant, `SECURITY DEFINER`-functie of databaseobject geraakt. De app-guard `handhaafFondsdiscipline` blijft náást RLS staan. Besluit 6 voegt in T2 een extra, striktere controle toe (scopevalidatie vóór de DB), nooit een lossere.

**Audit/reproduceerbaarheid.** T1 verandert niets aan het auditspoor. T2-3 voegt `correlationId` toe aan `retrieval_meta` (R4) en `versie` aan `bronversie_audit` (R1). Positief neveneffect van besluit 3: het scenario neemt `poging_herkomst` niet langer rauw op, waardoor er geen seed-UUID's in een snapshot terechtkomen — een val die pas in T2 zou zijn gaan bijten.

**Datamodel/migraties.** Geen. Het contract blijft een codecontract; rollback is `git revert`. Eén voorwaardelijke uitzondering: gaat R4 door, dan hoort daar één kleine idempotente forwardmigratie mét check bij voor de SQL-allowlist van `meta_basisniveau()`.

**Gebruikers- en beheerervaring.** Geen zichtbare wijziging in T1. In T2 wijzigt het gedrag van de vergelijkmodule wél merkbaar als R2 wordt aangenomen: die vergelijkt vandaag ook niet-actuele stukken en zou dan peildatum-, modus- en regimefilters krijgen.

**Bewust geaccepteerde schuld.** (a) Het hybride pad blijft ongekarakteriseerd tot er een embeddingstub is (R3), terwijl het in productie het primaire pad is — de goldens dekken vandaag alleen het FTS-terugvalpad. (b) De contextlaag blijft tot nader besluit buiten het contract; de gate bevriest hem, maar sluit het gat niet. (c) `GET /api/zoeken` blijft tot T2-2 zonder PII-gate op de zoekterm.

## Referenties

- Issues [#322](https://github.com/merlinijzerman/Bestuurdersportaal/issues/322) (umbrella) en [#348](https://github.com/merlinijzerman/Bestuurdersportaal/issues/348) (deze tranche)
- Ontwerp: [`RETRIEVALCONTRACT-F4-ONTWERP.md`](../RETRIEVALCONTRACT-F4-ONTWERP.md) — §2 inventarisatie, §3 karakterisering, §4 contract, §5 gaplijst, §6 open beslissingen
- Eerdere besluiten: [0208](./0208-twee-productvarianten-eigen-en-microsoft.md) (duale bronlaag), [0209](./0209-centrale-ai-gateway-per-fonds.md) (generatiecontract), [0210](./0210-sharepoint-readonly-sites-selected-per-gebruiker.md) (SharePoint-identiteit)
- Code: `core/lib/rag.ts`, `app/api/chat/route.ts`, `app/api/zoeken/route.ts`, `core/lib/vergelijk-productie.ts`, `core/lib/ai-gateway/contract.ts`
- Registers en gates: `tests/cross-tenant/retrieval-census.test.ts`, `tests/cross-tenant/retrieval-golden-gevoeligheid.test.ts`, `tests/karakterisering/retrieval-census.mjs`, `tests/karakterisering/retrieval-volgorde.mjs`
