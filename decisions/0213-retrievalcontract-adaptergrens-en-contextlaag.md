# 0213 — Retrievalcontract fase 4: waar de adaptergrens ligt, en wat er bewust buiten valt

- **Status:** Geaccepteerd (2026-09-09, na review; R1–R6 beslist en verwerkt)
- **Datum:** 2026-09-09
- **Betrokkenen:** Merlin (opdrachtgever/productowner), Claude (inventarisatie, karakterisering en ontwerp, issues #322/#348)
- **Ticket:** [#348](https://github.com/merlinijzerman/Bestuurdersportaal/issues/348) — M365 fase 4 · T1 inventarisatie, karakterisering en retrievalcontract (tranche van [#322](https://github.com/merlinijzerman/Bestuurdersportaal/issues/322))

## Context

Besluit 0208 maakt de bronlaag duaal: de eigen variant zoekt in de Supabase-RAG, de Microsoftvariant later live in SharePoint. Fase 3 (0210, #321) legde de SharePoint-identiteit vast, de AI-gateway (0209, #311) het generatiecontract. Daartussen ontbreekt een providerneutraal retrievalcontract; zonder dat lopen bronselectie, rechten, citaties, foutgedrag en audit per bron uiteen.

Tranche T1 mag geen productiecode raken. Ze moet vaststellen wat er vandaag ís, dat gedrag deterministisch vastleggen vóór enige verplaatsing, en de grens van het contract bepalen.

Twee metingen tijdens die inventarisatie dwongen dit besluit af.

**Meting 1 — de retrievalkern dekt maar een deel van wat het antwoordpad leest.** Vanaf `app/api/chat/route.ts` is de importgraaf (112 bestanden) afgelopen; dertien bestanden lezen zelf een tabel, samen **45 lezingen** over 33 tabellen. Die lezingen zijn per stuk geclassificeerd, want per tabel bleek te grof: `profielen` levert op vijf plekken zowel autorisatie en identiteit (`capabilities.ts`, `fonds-sessie.ts`, `profiel.ts`) als modelcontext (`profielsturing.ts` met bestuurlijke rol, antwoordvoorkeur en detailniveau; `portaalcontext.ts` met namen), en de chatroute leest beide doelen in één query.

De verdeling: **7 evidencelezingen** (waarvan er **2** via `rag.ts` lopen en **5** eromheen — `decision_objects` op twee plekken, `document_chunks` in de chatroute en in `parent-context.ts`, en `semantic_units`), **26 modelcontextlezingen**, **11 configuratielezingen** en **3 auditlezingen**. Een adaptergrens die alleen om `rag.ts` heen wordt getrokken, laat dus vijf van de zeven evidencelezingen buiten zichzelf — en 26 contextlezingen die nooit citeerbaar worden maar wel de prompt in gaan.

Twee eerdere formuleringen van deze meting waren onjuist en zijn vervangen: "31 tabellen buiten de kern" telde configuratie, autorisatie en bronbeleid mee als context, en `concepts` stond als evidence terwijl de lezing (`id, key, label, type, status`) een begrippencatalogus is die `semantic_units` interpreteert.

**Meting 2 — de eerste karakterisering pinde niet wat zij claimde.** `normaliseerJson()` sorteert elke array recursief; een omgekeerde ranking gaf een byte-identiek snapshot. Empirisch vastgesteld op `w322.zoeken.get.bestuurder.premiebeleid`. De acceptatiegrens van T2 ("volgorde ongewijzigd") stond dus op een golden die dat niet kon aantonen. Twee vervolgmetingen legden de grenzen van de UUID-maskering bloot: chunk-ID's zijn alleen relationeel te pinnen, en object-*sleutels* ontsnappen volledig aan de maskering (`poging_herkomst`).

Randvoorwaarden: RLS blijft leidend en wordt niet versoepeld; het auditspoor blijft append-only en inhoudsvrij; de bestaande 380+ snapshots mogen niet omvallen; T1 doet geen enkele Microsoft-call en leest geen SharePoint-inhoud.

## Besluit

1. **Het antwoordpad valt uiteen in vier hoedanigheden, en de grens loopt tussen de eerste twee** (R5, hybride). *Evidence* — `document_chunks`, `documenten`, `decision_objects`, `semantic_units`, `concepts` — wordt **citeerbaar en versiebaar** en gaat achter het retrievalcontract; de besluitregistratie hoort daar expliciet bij. *Modelcontext* — de 18 tabellen achter agenda-, vergadering-, proces-, risico- en profielcontext — blijft buiten documentretrieval maar krijgt een **eigen typed contextcontract met eigen audit**, in plaats van stilzwijgend mee te liften. *Configuratie/autorisatie/bronbeleid* (`profielen`, featureflags, `fonds_theming`, de web-whitelist) is **geen contextlaag** en hoort in geen enkele contextteller. *Audit/persistentie* is geen bron.

   De eerste ronde van dit besluit sprak van "31 contexttabellen buiten de kern". Dat was een verkeerde classificatie: het klopte als telling van `.from()`-aanroepen, maar gooide configuratie, autorisatie en bronbeleid op één hoop met inhoud. Het scherpere beeld is dat **3 van de 5 evidencebronnen** buiten de retrievalkern lopen.

2. **Wat buiten de grens valt, wordt bevroren én per lezing geclassificeerd — en de scan resolveert echt.** Het register (`tests/cross-tenant/retrieval-contextbronnen.expected.json`, gate `F4-context`) loopt de hele importgraaf vanaf de chatroute af (112 bestanden, 13 lezers) en pint de klassenverdeling 7/26/11/3 over 45 lezingen. Een bereikte lezing **zonder klasse maakt de gate rood**: classificeren is een ontwerpoordeel en mag niet meeliften.

   Twee correcties op de eerste opzet. De directe-import-scan miste lezers, waaronder `core/lib/parent-context.ts`, dat `document_chunks` rechtstreeks leest. En de eerste "transitieve" versie resolveerde relatieve specifiers verkeerd — `./config-db-core` vanuit `core/lib/ai-gateway/config-db.ts` werd `core/lib/config-db-core.ts`, en `../ai-poort` werd genegeerd — zodat de graaf niet bewezen volledig was. De resolver volgt nu de tsconfig-alias, echte relatieve paden inclusief `../`, extensies en indexbestanden, met een negatieve controle op precies die gevallen. Dit is de tegenhanger van de retrievalcensus (17 bestanden), die in T2 juist krimpt tot adapter en orkestratie.

3. **Een golden die niet aantoonbaar rood wordt, telt niet als karakterisering.** Elke retrieval-golden krijgt een volgorde-gecodeerde projectie (`tests/karakterisering/retrieval-volgorde.mjs`): de positie staat in de waarde, zodat de gedeelde array-sortering haar niet kan wegpoetsen. De gedeelde `normaliseer.mjs` wordt daarvoor **niet** versoepeld — dat zou alle bestaande snapshots raken. Een offline suite van 15 negatieve controles (`retrieval-golden-gevoeligheid.test.ts`) bewijst per mutatie — volgorde, citaat-ID, fondsfilter, versie-identiteit — dat de golden kantelt, en legt de drie gemeten grenzen van de normalisatie vast als bewaakte aanname.

4. **Ontbrekend gedrag wordt niet gekarakteriseerd maar als gap geregistreerd.** `rag.ts`, `rerank.ts` en `embeddings.ts` bevatten nul voorkomens van `AbortSignal`, en geen enkele retrieval-call-site kent een looptijdbegrenzing. Goldens voor timeout en annulering zijn daarom in T1 onmogelijk: er is geen gedrag om vast te leggen. `AdapterCapabilities` krijgt expliciet `cancellation`, `timeout` en `ondersteundeFilters`: een adapter die een filter niet kan uitvoeren, moet dat melden in plaats van het stil te negeren. **Besluit R6:** cancellation en timeout landen in **T2-1**, samen met hun contracttests — het is een orkestratiegrens en een kostenmaatregel, geen testonderwerp.

5. **De adapter levert kandidaten; de orkestratie selecteert en citeert.** `RetrievalAdapter.zoek()` gaf in de eerste opzet de volledige `RetrievalUitkomst` terug, inclusief `geselecteerd` en `bronverwijzingen` — daarmee kon elke provider zijn eigen selectie- en citatieregels meebrengen, precies de divergentie die dit contract opheft. Er zijn nu twee typen: `AdapterUitkomst` (kandidaten, methode, timing, foutinformatie, diagnostiek) en `RetrievalUitkomst` (pas door de orkestratie opgebouwd, inclusief selectie, citaties en `RetrievalMeta`).

6. **Een permissionproof die niet aan actor én verzoek gebonden is, is geen proof.** `capabilities().permissionProof` was een boolean waarmee de adapter iets over zichzelf beweerde. Elk resultaat draagt nu `toegangscontrole { toegestaan, gebruikerId, correlationId, gecontroleerdOp, basis, bronconfiguratieVersie }`, en een toelatingspoort vóór de selectie toetst vijf voorwaarden (ontwerp §4.2.1): toegestaan, **dezelfde actor**, **hetzelfde `correlationId`**, binnen het venster (na verzoekstart, ≤ 60 s oud, ≤ 2 s klokspeling) en op een bronconfiguratieversie die **op het moment van de poort opnieuw uit de bronregistratie is gelezen** en nog verbonden is. Zonder `gebruikerId` en `correlationId` zou een verse, op zichzelf geldige proof van een ándere gebruiker of uit een eerdere request door de poort komen. En zonder de HERLEZING bij V5 zou een intrekking of herconfiguratie tijdens het verzoek onzichtbaar blijven: de eerste formulering vergeleek met de versie die bij verzoekstart was vastgelegd, wat neerkomt op een waarde met zichzelf vergelijken. Dat is als expliciete acceptatievoorwaarde bij T2-1 belegd. **Versiecontrole en autorisatiecontrole zijn gescheiden bewijzen met gescheiden tijdstippen**: `versie.gecontroleerdOp` wordt niet langer ook als permission-checktijd gebruikt — anders is een verlopen rechtencheck op een nog geldige versie niet te herkennen.

7. **Versie-identiteit is de volledige hash** (R1): `hash(document_id, indexering_versie, bestand_hash)`. `status-datum` blijft bestaan als **expliciet zwakke legacyfallback**, draagt dat in `versie.soort`, en is op het Microsoftpad **niet toegestaan**.

8. **Het vergelijkpad behoudt zijn filtergedrag** (R2). Er komt géén impliciet `actueel`-filter bij: wie twee documenten expliciet kiest om te vergelijken, moet ook historische stukken kunnen vergelijken. T2-2 trekt alleen de bronvorm gelijk.

9. **`correlationId` gaat in `retrieval_meta`** (R4), met de kleine idempotente forwardmigratie voor de SQL-allowlist van `meta_basisniveau()`. De keten retrieval → gateway → governance wordt daarmee met één id te volgen.

10. **Het hybride pad krijgt een eigen tranche T1b** (R3, ticket [#349](https://github.com/merlinijzerman/Bestuurdersportaal/issues/349)): embeddingstub plus geëmbedde fixtures en een hybride golden, vóór enige productiecode in T2-1. Zonder die stub karakteriseren de goldens alleen de FTS-terugval, terwijl het hybride pad in productie het primaire pad is.

11. **Geen cross-providerfallback, en geen enkele foutcategorie verruimt de bronset.** Negen genormaliseerde categorieën (`geen_resultaten`, `buiten_scope`, `toestemming_geweigerd`, `configuratiefout`, `timeout`, `rate_limit`, `providerfout`, `truncatie`, `annulering`). Een Microsoftresultaat zonder exacte versie én actuele permissionproof komt het contract niet binnen; drive- en item-identiteit blijven achter de private gateway.

12. **Scopevalidatie hoort in de laag, niet in de database.** `GET /api/zoeken` zet vandaag `?procesinstantie=<id>` rechtstreeks in de retrievalfilters zonder te toetsen of dat dossier bij het fonds hoort. RLS en de expliciete fondsfilter maken dat onschadelijk — een vreemd dossier levert niets op — maar het contract belegt de validatie voortaan expliciet in de orkestratie.

## Overwogen alternatieven

- **Alles achter één retrievalcontract, contextlaag inbegrepen.** Consistent, maar het maakt de tranche onbeheersbaar (33 tabellen, 13 modules, raakt de op sha256 gepinde toon-systeemprompt) en dwingt ranking- en citatiemachinerie op inhoud die daar niet om vraagt. Verworpen.
- **Alles buiten het contract laten behalve `document_chunks`/`documenten`** (het voorstel van de eerste ronde). Verworpen: dan blijven `decision_objects`, `semantic_units` en `concepts` formele bronnen zonder citation-id of versie — de besluitregistratie noemt zichzelf in haar eigen kopcommentaar "formele bron náást `document_chunks`". Gekozen is de **hybride** vorm (besluit 1): evidence erbij, modelcontext een eigen contract, configuratie erbuiten.
- **Eén tijdstip voor versie- én rechtencontrole** (`versie.gecontroleerdOp` voor beide). Compacter, en in de praktijk vallen de twee momenten vaak samen. Verworpen: het maakt een verlopen rechtencheck op een nog geldige versie onherkenbaar, en dat is precies het geval dat de poort moet vangen.
- **`permissionProof` als capability-boolean laten staan.** Verworpen: dan bewijst de adapter iets over zichzelf en kan de orkestratie het niet toetsen. Een belofte zonder controle is geen grens.
- **Eén klasse per tabel houden.** Compacter en makkelijker te pinnen. Verworpen: `profielen` doet aantoonbaar drie dingen op vijf plekken, en één klasse maakte de modelcontext-rol ervan onzichtbaar. De classificatie gaat per lezing (`bestand::tabel`) en een lezing mag meerdere klassen dragen.
- **`concepts` als evidence houden.** Verworpen na inspectie van de lezing: `id, key, label, type, status` is een begrippencatalogus die de interpretatie van `semantic_units` stuurt. Citeerbaar bewijs is documentgebonden — `semantic_units` draagt `document_id`, `page` en `evidence`, `concepts` niet.
- **`normaliseer.mjs` aanpassen zodat arrays niet meer worden gesorteerd.** De directe oplossing voor bevinding 1. Verworpen: het raakt alle 380+ bestaande snapshots, waarvan de meeste juist ordeonafhankelijk moeten zijn omdat PostgREST geen rijvolgorde garandeert. De projectie lost het lokaal op zonder die eigenschap te verliezen.
- **De letterlijke chunk-UUID's in de goldens pinnen.** Zou bevinding 2 volledig sluiten. Verworpen: de seed geeft bij elke heropbouw andere UUID's, dus zulke goldens vallen bij elke herseed om — precies het gedrag dat aanleert om snapshots blind bij te werken. Co-referentie pinnen levert de veiligheidsrelevante helft (een citaat dat naar een ander document wijst) zonder die broosheid.
- **Timeout- en annuleringsgoldens alsnog opnemen door het gedrag in T1 te bouwen.** Verworpen: T1 mag geen productiecode wijzigen, en karakterisering die haar eigen onderwerp eerst bouwt, karakteriseert niets.

## Gevolgen

**RLS/tenant-isolatie.** Ongewijzigd. Geen policy, grant, `SECURITY DEFINER`-functie of databaseobject geraakt. De app-guard `handhaafFondsdiscipline` blijft náást RLS staan. Besluit 12 voegt in T2 een extra, striktere controle toe (scopevalidatie vóór de DB), nooit een lossere; besluit 6 voegt met de toelatingspoort een tweede strikte weigering toe.

**Audit/reproduceerbaarheid.** T1 verandert niets aan het auditspoor. T2-3 voegt `correlationId` toe aan `retrieval_meta` (R4) en `versie` aan `bronversie_audit` (R1). Positief neveneffect van besluit 3: het scenario neemt `poging_herkomst` niet langer rauw op, waardoor er geen seed-UUID's in een snapshot terechtkomen — een val die pas in T2 zou zijn gaan bijten.

**Datamodel/migraties.** T1 raakt niets; het contract blijft een codecontract en rollback is `git revert`. Voor T2 is één migratie **besloten** (R4): `correlationId` in de SQL-allowlist van `meta_basisniveau()`, idempotent en mét check, plus een regel in `supabase/checks/allowlist-grants.tsv` als er een object of grant wijzigt.

**Gebruikers- en beheerervaring.** Geen zichtbare wijziging, in T1 noch in T2. Besluit 8 (R2) houdt het vergelijkgedrag expliciet gelijk: er komt géén impliciet `actueel`-filter bij, zodat expliciet gekozen historische stukken vergelijkbaar blijven. Dat was in de eerste ronde nog een open gedragswijziging.

**Bewust geaccepteerde schuld.** (a) `GET /api/zoeken` blijft tot T2-2 zonder PII-gate op de zoekterm. (b) De 18 modelcontext-tabellen blijven tot T2-4 zonder typed contract; de gate bevriest en classificeert ze, maar sluit het gat niet. (c) De klassenindeling zelf is een ontwerpoordeel, geen afleiding uit de code — ze staat als leesbare tabel in `TABELKLASSE` en verschuift alleen met een besluit. Vervallen ten opzichte van de eerste ronde: het ongekarakteriseerde hybride pad is geen geaccepteerde schuld meer maar een eigen tranche (T1b, besluit 10).

## Referenties

- Issues [#322](https://github.com/merlinijzerman/Bestuurdersportaal/issues/322) (umbrella), [#348](https://github.com/merlinijzerman/Bestuurdersportaal/issues/348) (deze tranche) en [#349](https://github.com/merlinijzerman/Bestuurdersportaal/issues/349) (T1b — harde voorwaarde voor T2-1)
- Ontwerp: [`RETRIEVALCONTRACT-F4-ONTWERP.md`](../RETRIEVALCONTRACT-F4-ONTWERP.md) — §2 inventarisatie, §3 karakterisering, §4 contract, §5 gaplijst, §6 open beslissingen
- Eerdere besluiten: [0208](./0208-twee-productvarianten-eigen-en-microsoft.md) (duale bronlaag), [0209](./0209-centrale-ai-gateway-per-fonds.md) (generatiecontract), [0210](./0210-sharepoint-readonly-sites-selected-per-gebruiker.md) (SharePoint-identiteit)
- Code: `core/lib/rag.ts`, `app/api/chat/route.ts`, `app/api/zoeken/route.ts`, `core/lib/vergelijk-productie.ts`, `core/lib/ai-gateway/contract.ts`
- Registers en gates: `tests/cross-tenant/retrieval-census.test.ts`, `tests/cross-tenant/retrieval-golden-gevoeligheid.test.ts`, `tests/karakterisering/retrieval-census.mjs`, `tests/karakterisering/retrieval-volgorde.mjs`
