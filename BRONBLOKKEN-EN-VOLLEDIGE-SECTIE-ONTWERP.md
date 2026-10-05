# Bronblokken, foutbestendige (her)indexering en volledige sectie — ontwerp (#548)

- **Ticket:** #548 (gerelateerd: #532 juridische retrieval, #547 BWB-XML)
- **Besluit:** [`decisions/0219`](./decisions/0219-gedeelde-bronblokken-indexering-en-volledige-sectie.md)
- **Status:** gebouwd op branch `codex/548-generieke-pdf-indexering`; PR naar `preview`. Migratie nog niet toegepast op Preview of Productie.
- **Datum:** 2026-10-05

## 1. Probleem

De PDF-extractie zette elke visuele regel op een eigen regel, en vaak met een witregel ertussen. De oorzaak: de einde-regelmarkering van pdfjs en de Y-sprong telden allebei als regelovergang. Daardoor ging er drie dingen mis:

- **Valse koppen.** Een afgebroken zin als `artikel 102a, heeft aangegeven …` stond als losse regel. De parlementaire parser las die regel als een nieuwe artikelkop. Het patroon reageerde op kleine letters en eiste niets na het nummer.
- **Woordafbreking werd nooit hersteld.** Het herstel keek naar `woord-` aan het einde van de lopende tekst. Daar stond al een regelovergang, dus het herstel greep niet.
- **Paginaopmaak in de doorzoekbare tekst.** Kamerstuk-paginavoeten (`Tweede Kamer, vergaderjaar …, nr. 90 1`), ISSN, `kst-…` en paginanummers stonden midden in de tekst.

Daarnaast liet de (her)indexering bij een fout een gedeeltelijke chunkset achter. Geen enkele zoekroute filtert op `geindexeerd` of `verwerkingsstatus`. Een volledige sectie opvragen kon alleen voor wetgeving met een BWB-link.

## 2. Nulmeting en resultaat

Het meetscript is `scripts/meting/548-generieke-pdf-meting.mts`. Het werkt lokaal, zonder database, modelcalls of OCR. We draaiden het op een checkout van `main` (vóór) en op de branch (na). De PDF's zijn openbare Kamerstukken en repo-fixtures; we gebruikten geen Production-originelen.

| Document | Route | Chunks | Valse artikelkoppen | Afbrekingsresten | Drukvoeten in chunks | Controles |
|---|---|---|---|---|---|---|
| Kamerstuk 36 067 nr. 90 (amendement, 3 p.) | main | 12 | **2** (`Artikel 102a` p. 1, `Artikel 109a` p. 2) | 11 | 5 | 4/4 |
| | branch | 11 | **0** | 0 | 0 | 4/4 |
| Kamerstuk 36 067 nr. 3 (MvT Wtp, 445 p.), als wetsgeschiedenis | main | 2.738 | 51 | 2.704 | 447 | 2/2 |
| | branch | 2.846 | 0 | 4¹ | 0 | 2/2 |
| Idem, zonder documenttype (generieke structuur) | main | 2.707 | 19 | 2.717 | 447 | 1/1 |
| | branch | 2.834 | 0 | 4¹ | 0 | 1/1 |
| Rapport met tabellen (`Marktverkenning en prijsstrategie.pdf`, 18 p.) | main | 93 | 0 | 1 | 0 | – |
| | branch | 76 | 0 | 0 | 0 | – |
| Fixture `PGB354-PDF-001` (3 p.) | main / branch | 9 / 9 | 0 | 0 | 0 | – |
| Scanfixture `PGB354-PDF-003` | branch | tekstlaag leeg → `heeftOcrNodig = true` | | | | OCR niet gedraaid (kosten) |

¹ De vier resten zijn: tweemaal `ex- ante` (p. 44) en eenmaal `projectierende- conform` (p. 77), waar het afbrekingsteken in de bron niet als gewoon koppelteken aan het regeleinde staat, en eenmaal `directeur-` / `grootaandeelhouder` (p. 353), dat over een alineagrens loopt. De meting telt een koppelteken gevolgd door een voegwoord (`hoog- en laag`, `opbouw- als uitkering`) bewust niet als rest.

De controles koppelen een zinsnede aan een verwachte pagina en een verwacht label. Twee voorbeelden: `bedoeld in artikel 102a, heeft aangegeven` hoort bij p. 1 onder `Amendement — wijziging — Artikel 150r`. `De definitie van afkoop …` hoort bij p. 354 onder `Artikelsgewijze toelichting — Artikel I, onderdeel A`.

**Verliesvrij.** Per pagina is de tekst gereconstrueerd uit de chunks: overlap verwijderd, alinea's hersteld. Die reconstructie is woord voor woord gelijk aan de bronblokken, met 0 afwijkingen over 449 pagina's in vier documenten. Er valt dus geen tekst weg.

**Looptijd.** De extractie van de MvT (445 p.) duurt lokaal ~3,9 s, tegen ~1,9 s op main. Er zijn geen extra externe calls.

## 3. Ontwerp

### 3.1 Bronblokken (`core/lib/pdf-bronblokken.ts`, puur)

De bronblokken worden in vijf stappen opgebouwd:

1. **Regels.** Items op dezelfde basislijn (binnen een halve lettergrootte) vormen één regel. Een groot horizontaal gat (> 2,2× de lettergrootte) splitst de regel in cellen. Een voetnootverwijzing in superscript valt weg; aan het begin van een voetnootregel wordt hij het nummer.
2. **Marge.** In de bovenste 6% en onderste 12% van de pagina vallen weg:
   - kale paginanummers (cijfers of kleine romeinse cijfers; `II` blijft staan, dat is een onderdeel);
   - bekende drukvoeten (Kamerstuk, ISSN, `kst-`, Staatsblad/Staatscourant);
   - cellen die op ≥ max(2, 30%) van de pagina's terugkomen (na het normaliseren van cijfers).
3. **Blokken.**
   - **Inhoudsopgave.** Regels met een paginaverwijzing rechts worden één blok: `Inhoudsopgave: 1. Inleiding (blz. 1); …`. Zo'n blok is nooit een kop.
   - **Voetnoten.** Kleine letter onder de hoofdtekst wordt een `[n] …`-blok.
   - **Kantlijn.** Een cel ruim links van de hoofdtekstkolom wordt een eigen blok.
   - **Tabel.** Minstens twee meercellige regels dicht bij elkaar (≤ 2,6 regelafstanden) worden `| … |`-rijen. Een losse regel met een gat (formule) is geen tabel.
   - **Alinea's.** Een nieuwe alinea begint bij:
     - een grote regelafstand;
     - een andere lettergrootte;
     - inspringing ná een afgesloten zin of bij een lijstitem;
     - een afgesloten korte regel.

     Een hangende inspringing loopt door.
4. **Woordafbreking.** `letter-` gevolgd door een kleine letter wordt aaneengeschreven. Volgt er een voegwoord (`en`, `of`, `tot`, `als`, `naar`, `dan`, …), dan blijft het koppelteken staan. Over een paginagrens verhuist alleen het eerste woord.
5. **Uitvoer.** Eén segment per bronpagina, met de alinea's als regels gescheiden door een witregel. De segmenten krijgen `opmaak: "alinea_per_regel"`.

OCR-uitvoer (Mistral-markdown) krijgt alleen de conservatieve nabewerking `schoonOcrSegmenten`: drukvoeten en kale paginanummers verdwijnen en woordafbreking wordt hersteld.

### 3.2 Structuur en chunking (gedeeld, fonds + generiek)

De strategie volgt het **tekstformaat van de extractor**, niet de bibliotheek. PDF (bronblokken), DOCX (mammoth, één alinea per regel) en nabewerkte OCR leveren `alinea_per_regel`. PPTX en XLSX houden het oude gedrag.

- **Parlementaire parser** (`wetsgeschiedenis-structuur.ts`):
  - een artikelkop begint met `Artikel`/`ARTIKEL` (hoofdletter);
  - het nummer is arabisch (met letter) of een romeins hoofdletternummer;
  - daarna volgt het regeleinde, een punt, een opschrift met hoofdletter, een gedachtestreep of `en …`;
  - `Hoofdstuk N Titel` in het algemeen deel is een kop;
  - een losse romeinse regel in de wijzigingstekst van een amendement wordt `Wijzigingsonderdeel N`. Daardoor loopt artikel 150r niet door in onderdeel II.
- **Generieke structuur** (`chunking.ts`, optie `alineaPerRegel`):
  - een unit die doorloopt over een paginagrens houdt haar type en label;
  - koppen die eindigen op `?` en `Hoofdstuk N Titel` zonder punt worden herkend;
  - een genummerde regel die eindigt op `:`, `;` of `,` is een lijstitem en geen kop.
- **Chunking** (`maakChunks`, `alineaModus`):
  - er valt geen korte chunk weg;
  - zinnen van één alinea worden met een spatie samengevoegd;
  - na de overlapwoorden volgt `\n` als de chunk een alinea voortzet, en `\n\n` bij een nieuwe alinea. Zo kan de sectieroute de overlap exact verwijderen.
- **Indexversie.** Chunks uit `alinea_per_regel`-tekst krijgen `BRONBLOKKEN_INDEXERING_VERSIE = 'r2-bronblokken'`. De letterlijke tekst (`tekst`) blijft gescheiden van `context_prefix` en de embeddingtekst (`verrijkTekst`).

### 3.3 Atomische (her)indexering

De migratie `2026_10_05_548_chunks_atomisch_vervangen.sql` voegt `fn_document_chunks_vervangen(uuid, jsonb)` toe:

- **Werking:** in één transactie gaat het document naar `geindexeerd=false` en `embedding`, de oude chunks gaan weg en de nieuwe kale chunks komen erin. Faalt dat, dan blijft de oude set volledig staan.
- **Beveiliging:** SECURITY INVOKER, `statement_timeout` 120 s, EXECUTE voor authenticated en service_role.
- **Gebruik:** zowel de worker (eerste ingest, beide bibliotheken) als de gedeelde herindexering (`herindex-kern.ts`) gebruikt de functie.

De herindexering verloopt in drie stappen:

1. Atomisch vervangen.
2. Verrijken via dezelfde DB-route als de worker (`verrijkChunks`).
3. Pas als er geen chunk zonder embedding meer is: `geindexeerd=true` en `beschikbaar`.

Faalt de verrijking, dan worden alle chunks van het document verwijderd en krijgt het de status `mislukt`. Er is geen gedeeltelijke of half verrijkte bron die als volledig doorzoekbaar geldt, en er is geen schaduwindex.

### 3.4 Eenmalige herindexering (alleen generiek)

`curatieHerindexeren` (platform, service-role) selecteert uitsluitend `bibliotheek='generiek'` PDF- en DOCX-documenten. Een fondsdocument-id wordt geweigerd. De stand wordt per document bepaald (`herindex-selectie.ts`, puur):

- **klaar:** chunk 0 op `r2-bronblokken` én `geindexeerd = true`;
- **mislukt / overgeslagen:** volgt uit de laatste job-regel in `document_processing_jobs` (stap `indexering`, foutcode `herindex:r2-bronblokken:<reden>`), ook als het document geen chunks meer heeft;
- **te doen:** al het andere.

Per-document-aanroep met `{ documentId }` is er voor de pilot en voor het hervatten na een fout. Een mislukt document blokkeert de batch niet; het verschijnt in de eindmelding.

Bestaande fondsdocumenten worden niet herindexeerd. De fonds-backfill selecteert onveranderd alleen baseline-chunks (`indexering_versie is null`).

### 3.5 Volledige sectie (`core/lib/retrieval/document-sectie*.ts`)

1. **Verzoek.** De vraag bevat `hele/volledige/integrale/letterlijke/…` plus `artikel|hoofdstuk|paragraaf|sectie|§ N` (eventueel met `, onderdeel X`), en termen die het document aanduiden.
2. **Document.**
   - **Ophalen:** via de gebruikersclient onder RLS, met een voorfilter op titel, bestandsnaam en dossiernummer.
   - **Toelatingspoort:**
     - alleen PDF en DOCX;
     - fondsdocumenten alleen van het eigen fonds (bovenop RLS) en vastgesteld/van kracht;
     - generiek alleen van kracht en met een geldige reviewdatum;
     - bronstatus actief, geldigheidsvenster en scanbewijs.
   - **Keuze:** op score. Gelijke topscores geven een keuzevraag; er wordt nooit gegokt.
3. **Afbakening.** Eerst de metadata van **alle** chunks: gepagineerd en geteld, met dezelfde poort per chunk. Op `structuur_label` wordt bepaald waar de sectie begint (eerste chunk met het gevraagde label) en waar ze eindigt (de volgende kop op hetzelfde of een hoger niveau, een ander deel of een andere kop). Lopende tekst, tabellen en definities horen bij de sectie waarin ze staan.
4. **Volledigheid.** Letterlijke weergave volgt alleen als alle volgende voorwaarden gelden:
   - alle chunks staan op `r2-bronblokken`;
   - het document is geen OCR-document;
   - `chunk_index` loopt aaneengesloten van 0 tot n-1;
   - het label komt niet op meerdere plekken voor;
   - de eerste chunk begint met de kop;
   - de sectie telt ≤ 160 chunks en ≤ 60.000 tekens.

   Anders volgt een melding met de reden en een link naar het origineel (`/api/documents/{id}/bestand#page=N`). Er wordt geen tekst gereconstrueerd. Een oude (fonds)index krijgt altijd deze melding, en de sectietekst wordt dan niet eens opgehaald.
5. **Weergave.** De tekst staat in bronvolgorde, met overlap verwijderd en alinea's hersteld. Een paginawissel krijgt `*[pagina N]*`. Bij DOCX is de locatie het sectielabel. Er is geen top-10-limiet en geen modelcall. De route logt via `schrijf_ai_interactie` (`methode: gerichte_documentsectie`).

De bestaande juridische paragraafroute (wetgeving met BWB-link) heeft voorrang. Gewone vragen lopen ongewijzigd via de RAG-zoekstraat, met de verbeterde chunks.

## 4. Tests

| Test | Wat |
|---|---|
| `core/lib/pdf-bronblokken.sanity.ts` (12) | 102a als verwijzing, afbreking (ook over een pagina), `waarde- en premie…`, drukvoeten, `II` blijft, voetnoten, inhoudsopgave, tabel tegenover een losse regel met een gat, kantlijn, determinisme, OCR-nabewerking |
| `core/lib/wetsgeschiedenis-structuur.sanity.ts` (+4) | kst 36067-90: koppen 150r/145q, 102a/109a als verwijzing, wijzigingsonderdelen I/II, toelichting apart; oude regelweergave; koppelkoppen; `Hoofdstuk N` |
| `core/lib/document-sectie.sanity.ts` (16) | verzoek en labels; volledige sectie over meerdere chunks en pagina's; oude index, onderbroken, OCR, te groot, meerdere; documentkeuze; overlap; synthetische **fonds-DOCX** (JSZip): hoofdstuk en artikel, locatie = sectiekop; dezelfde structuur voor fonds en generiek; PPTX ongewijzigd |
| `tests/cross-tenant/retrieval-document-sectie.test.ts` (12) | eigen fonds tegenover fonds B (nooit gelezen), keuze A bij A+B, generieke publicatie/review/bronstatus/geldigheid, fondsconcept, PPTX, oude index zonder tekstquery, chunkpoort, scanpoort, paginering > 1.000, dubbelzinnig, geen verzoek |
| `tests/cross-tenant/herindex-foutafhandeling.test.ts` (9) | succes (atomisch, r2, 0..n-1, pas daarna beschikbaar); vervangen mislukt (niets weg, nooit `true`); verrijking faalt of geen voortgang of rest-null (opruimen + `mislukt`); dezelfde payload voor fonds en generiek; selectie (terugvindbaar zonder chunks); generiek-only; worker gedeeld en atomisch |
| `supabase/checks/2026_10_05_548_chunks_vervangen_rls.sql` (DB-laag, in `cross-tenant-ci.sh`) | V0 structuur/ACL; V1 eigen fonds; V2 fonds B → 42501; V3 generiek als tenant → 42501; V3b service_role; V4 ongeldige set → 22023 en de set ongewijzigd; V5 anon |

## 5. Beperkingen en vervolg

- **OCR-documenten** krijgen nooit een letterlijke volledige sectie (reden `ocr`). Zo'n tekst is niet te controleren.
- **Kolomopmaak.** De leesvolgorde is op de geteste pagina's correct. Echte meerkoloms opmaak (twee tekstkolommen naast elkaar) wordt als tabelrij gelezen. Er is geen kolomdetectie gebouwd, omdat de meting dat niet vroeg.
- **Formules als afbeelding** blijven een gat. De tekst eromheen blijft wel letterlijk.
- **Documentkeuze** werkt op woorden uit titel, bestandsnaam en dossiernummer. Een vraag zonder herkenbare documentterm valt terug op de gewone RAG.
- **Fondsdocumenten in `concept`** krijgen geen volledige-sectieweergave (modus actueel). Ze gaan via de gewone RAG.
- **OCR-limiet.** Drie generieke PDF's in Production zijn langer dan 200 pagina's. Hebben ze een tekstlaag, dan raakt de OCR-limiet ze niet. Ze zijn nog niet individueel gecontroleerd.
- **Vóór/na-antwoorden** van gewone vragen met het model zijn niet lokaal gedraaid (kosten). Dat volgt in de Preview-pilot.
