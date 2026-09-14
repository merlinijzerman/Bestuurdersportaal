# Microsoft 365 PGB SharePoint retrievalacceptatieset

> Uitvoeringsticket #385 onder #354. Doel: `PGB Preview-pilot`. Eigenaar: M365 pilotteam. Herziening: 10 december 2026.
>
> Status op 14 september 2026: de bestaande lege map `PGB` is in de aangewezen testsite geverifieerd. De zeven vaste mappaden en tien synthetische bibliotheekfixtures zijn ingericht; de v2-mutatiefixture is niet als apart SharePoint-item geupload. DOCX, digitaal doorzoekbare PDF en PPTX openen rechtstreeks in Microsoft 365 met het beheerdersaccount. De algemene PGB-root geeft testgroepen A en B lezen; `04 Beperkt bestuur` heeft unieke rechten met Owners en testgroep A, zonder machtiging voor testgroep B. Afzonderlijke testidentiteiten, de effectieve rol-A-/rol-B-proef, portaalweergave, live Graph-retrievalrondes en volledige reset zijn nog niet uitgevoerd en blijven harde voorwaarden voor een GO.

## 1 Doel en grenzen

Deze set maakt lijstweergave, browserpreview, live retrieval, versie-identiteit, rechtenintrekking en audit reproduceerbaar voor het PGB-proefonds. De bibliotheek bevat uitsluitend synthetische fixtures met vooraf bekende canarytermen en feiten.

Gebruik een afzonderlijke SharePoint-testsite of een duidelijk afgebakende testbibliotheek in onze eigen Microsoft 365-omgeving. Wijzig geen applicatiepermissions, Preview-featureflags, productieconfiguratie of brede tenantconsent als onderdeel van dit runbook. Gebruik geen echte bestuursstukken, persoonsgegevens, klantinhoud, tokens of ruwe Graph-responses.

De repo bevat geen private Microsoft-identifiers. Site-, drive-, item- en accountreferenties staan uitsluitend in `.pgb-sharepoint-fixtures.local.json`; meetbewijs staat uitsluitend in `.pgb-sharepoint-bewijs.local.ndjson`. Beide bestanden zijn gitignored en hebben bestandsmodus `0600`.

## 2 Bronnen van waarheid

- [`tests/e2e/fixtures/pgb-sharepoint/manifest.json`](../tests/e2e/fixtures/pgb-sharepoint/manifest.json) bevat de acceptatiematrix, vragen, broncodes, feiten, locators en foutcategorieën.
- [`tests/e2e/fixtures/pgb-sharepoint/rechtenmatrix.md`](../tests/e2e/fixtures/pgb-sharepoint/rechtenmatrix.md) bevat de begin- en herstelrechten.
- `tests/e2e/fixtures/pgb-sharepoint/bibliotheek/` is de exacte uploadboom onder de bestaande SharePointmap `PGB`.
- `tests/e2e/fixtures/pgb-sharepoint/mutaties/` bevat alleen de vervangende versie voor S07.
- `tests/e2e/fixtures/pgb-sharepoint/checksums.sha256` pint de beginstaat.

Controleer vóór inrichting:

```bash
npm run fixtures:pgb:check
npm run security:secrets
git status --short
```

`fixtures:pgb:check` controleert de versiebeheerbare corpus. De lokale mappingcontrole slaagt pas nadat stap 3.1 is uitgevoerd.

## 3 Voorbereiding

### 3.1 Lokale private state

Voer in de repo-root uit:

```bash
npm run fixtures:pgb:init
npm run fixtures:pgb:local-check
git check-ignore .pgb-sharepoint-fixtures.local.json .pgb-sharepoint-bewijs.local.ndjson
```

Vul daarna de lokale mapping in met de gecontroleerde site-, drive-, rootitem- en itemreferenties en de twee testidentiteiten. Toon het bestand niet in terminaloutput, tickets of auditbewijs. De controlescriptuitvoer bevat alleen status, geen waarden.

Gebruik vlak vóór een live retrievalrun de strengere poort:

```bash
npm run fixtures:pgb:ready
```

Deze poort faalt zolang een private site-, rol-A-, item-, eTag- of cTag-waarde ontbreekt. Een ontbrekende tweede identiteit houdt de rol-B-proef zichtbaar open, maar wordt niet stil door een beheeraccount vervangen.

### 3.2 SharePoint-bibliotheek

1. Bevestig dat de doelsite uitsluitend voor testdata wordt gebruikt en dat de bestaande read-only sitegrant uit fase 3 op precies deze testsite is begrensd.
2. Controleer dat de aangewezen, bestaande rootmap exact `PGB` heet en leeg is voordat de eerste upload plaatsvindt. Maak geen alternatieve rootmap aan.
3. Upload uitsluitend de inhoud onder `tests/e2e/fixtures/pgb-sharepoint/bibliotheek/`. Upload de map `mutaties` niet.
4. Controleer de zeven mappaden uit het manifest. SharePoint mag interne systeemmappen tonen; die tellen niet mee.
5. Maak of hergebruik twee expliciete testgroepen met de publieke labels `PGB354-Test-A-Lezen` en `PGB354-Test-B-Lezen`. Koppel de werkelijke accounts alleen lokaal.
6. Geef beide groepen alleen lezen op de algemene mappen. Stop de overerving op `04 Beperkt bestuur`, verwijder alle niet-noodzakelijke testgroepen en geef alleen groep A lezen.
7. Controleer dat rol B geen toegang erft via siteleden, een deelkoppeling, een andere groep of een directe machtiging.
8. Registreer de bibliotheekroot als PGB-bron volgens [`MICROSOFT-365-F3-RUNBOOK.md`](./MICROSOFT-365-F3-RUNBOOK.md). Verruim scopes niet als een Graph-call faalt; leg de foutcategorie vast en stop.

### 3.3 Beginstaat vastleggen

Sla uitsluitend lokaal per fixture op: itemreferentie, lokale bronreferentie, eTag en cTag. Noteer geen URL. Leg in het bewijslog één regel met resultaatcategorie `beginstaat_vastgelegd`, duur, versie-indicator `basis` en geanonimiseerde tellingen vast.

Toegestane bewijsvelden per NDJSON-regel:

```json
{"scenario":"S01","fixture_codes":["PGB354-DOC-001"],"role":"rol_b","result_category":"preview_beschikbaar","duration_ms":420,"version_indicator":"basis","counts":{"listed":10,"sources":0}}
```

Andere velden zijn niet toegestaan. Neem geen vraagtekst, antwoordtekst, passage, token, URL, hostnaam, account, correlation-id of Microsoft-objectreferentie op.

## 4 Nulmeting voor lijst en preview

Voer deze meting uit op een ingelogde Preview-sessie nadat fase 3 is geactiveerd voor PGB.

### Rol A

1. Open de SharePointsectie van de bibliotheek en vernieuw de lijst.
2. Verwacht tien bibliotheekbestanden: alle algemene fixtures en de twee beperkte DOCX-bestanden.
3. Open Preview voor `PGB354-DOC-001`, `PGB354-PDF-001` en `PGB354-PPT-001`.
4. Verwacht een veilige preview voor alle drie. `PGB354-UNS-001` toont geen preview.
5. Leg alleen resultaatcategorie, timing, versie-indicator en tellingen vast.

### Rol B

1. Open dezelfde bibliotheek met de tweede testidentiteit en vernieuw de lijst.
2. Verwacht acht zichtbare bestanden. `PGB354-DOC-002` en `PGB354-DOC-005` ontbreken volledig.
3. Een directe of eerder bekende lokale referentie naar een beperkt document mag geen titel, pad, preview of inhoud prijsgeven.
4. Preview van de drie algemene Office/PDF-fixtures werkt. Het onbekende bestand toont geen preview.

Als een tweede interactief account nog ontbreekt, markeer deze hele rol-B-meting als `niet_uitgevoerd`. Gebruik geen beheeraccount als vervanging.

## 5 Acceptatiescenario's

Het manifest is leidend voor de exacte vraag en verwachte bron. Voer de scenario's in deze volgorde uit, omdat S06 tot en met S09 de beginstaat wijzigen.

| Scenario | Handeling | Vooraf vastgelegde uitkomst | Bewijs |
|---|---|---|---|
| S01 | lijst en preview met rol B | algemene DOCX en PPTX zichtbaar en previewbaar; beperkte stukken afwezig | categorie, duur, `basis`, aantallen |
| S02 | vraag naar `Koraalmaat 47` | alleen `PGB354-DOC-001`; antwoord vier werkdagen; locator sectie 2.2, pagina 2 | broncount 1 en resultaatcategorie |
| S03 | fondsbrede vraag naar `Koraalmaat 47` en `IJsvogelkompas 73` | `PGB354-DOC-001` en `PGB354-PPT-001`; vier werkdagen en 23 oktober 2026 met eigen locators | broncount 2 en resultaatcategorie |
| S04 | actuele vraag naar `Maananker 61` | 34 tot en met 38 procent uit `PGB354-PDF-001`; historische 28 tot en met 32 procent vervangt het antwoord niet | primaire broncount 1, eventuele secundaire count |
| S05 | vraag als rol B naar `Saffierhek 29` | geen bron, passage, titel of antwoordfeit uit `PGB354-DOC-002` | `geen_resultaat_buiten_rechten` |
| S06 | hernoem en verplaats `PGB354-DOC-003`, vernieuw en vraag naar `Duinglas 84` | dezelfde lokale bronreferentie; bijgewerkte naam en map; woensdag blijft het antwoord | versie-indicator `verplaatst`; broncount 1 |
| S07 | vervang de inhoud van hetzelfde item voor `PGB354-DOC-004` door de v2-fixture | eTag en cTag veranderen; antwoord wordt vrijdag 10.35 uur | versie-indicator `v2`; broncount 1 |
| S08 | start retrieval voor `Nachtlelie 68` en trek vóór de content-/passagecontrole toegang van rol A in | fail-closed als `toegang_ingetrokken`; geen bronpassage in antwoord of audit | categorie, duur, broncount 0 |
| S09 | herhaal de vraag na intrekking | geen replay uit cache of eerdere context; opnieuw fail-closed | categorie, duur, broncount 0 |
| S10 | vraag naar `Mistboei 93` en `Veldkei 06` | `tekstlaag_ontbreekt` voor de scan en `bestandstype_niet_ondersteund` voor het onbekende formaat; geen ruwe providerfout | twee genormaliseerde categorieën |

Voor S08 is een controleerbaar pauzepunt tussen itemselectie en de laatste autorisatie-/contentcontrole nodig. Als de spike dat pauzepunt niet biedt, voer alleen de intrekking vóór een nieuw verzoek uit en markeer `intrekking_tijdens_verzoek` zichtbaar als open. Een snelle handmatige klikrace geldt niet als deterministisch bewijs.

## 6 Mutaties uitvoeren en herstellen

### S06 Hernoemen en verplaatsen

1. Lees de lokale bronreferentie voor `PGB354-DOC-003` uit de private mapping zonder hem te loggen.
2. Hernoem het SharePoint-item naar `PGB354-DOC-003-Verplaatst.docx`.
3. Verplaats hetzelfde item naar `01 Vergaderstukken/2026-10 Bestuursvergadering`.
4. Vernieuw de portaalbibliotheek. Controleer dat de lokale bronreferentie gelijk blijft, terwijl naam en map wijzigen.
5. Voer de vraag uit en verwacht woensdag als antwoord.
6. Herstel door hetzelfde item terug te verplaatsen naar `99 Mutatie- en intrekkingstests` en de naam exact terug te zetten naar `PGB354-DOC-003-Hernoem-en-verplaatsproef.docx`.
7. Vernieuw opnieuw en controleer naam, map en stabiele lokale bronreferentie.

### S07 Inhoudswijziging

1. Leg de eTag en cTag van `PGB354-DOC-004` lokaal vast.
2. Vervang de inhoud van hetzelfde item door `mutaties/PGB354-DOC-004-Inhoudsmutatie-v2.docx`. Maak geen tweede SharePoint-item.
3. Vernieuw en controleer dat eTag en cTag beide zijn veranderd.
4. Vraag naar `Bronzenveer 52` en verwacht vrijdag om 10.35 uur.
5. Herstel door de inhoud van hetzelfde item te vervangen door de basisfixture uit `bibliotheek/99 Mutatie- en intrekkingstests/`.
6. Vernieuw en controleer een nieuwe versie-indicator en het herstelde antwoord donderdag om 09.20 uur.

### S08 en S09 Intrekking

1. Bevestig vooraf dat rol A toegang heeft tot `PGB354-DOC-005` en rol B niet.
2. Start het gecontroleerde retrievalverzoek met rol A en pauzeer op het afgesproken testpunt.
3. Verwijder groep A van de unieke rechten op de intrekkingsfixture of beperkte map. Laat site-eigenaren en andere testaccounts buiten het verzoek.
4. Hervat S08 en voer daarna S09 uit.
5. Herstel groep A met alleen lezen en controleer dat rol A de fixture weer ziet en kan previewen.
6. Controleer opnieuw dat rol B geen toegang heeft.

## 7 Volledige reset

Voer deze procedure na iedere testronde uit, ook na een mislukte ronde.

1. Herstel eerst de rechten: groep A leest de beperkte map; groep B heeft daar geen enkele toegang; beide groepen lezen de algemene mappen.
2. Herstel `PGB354-DOC-003` naar de exacte map en bestandsnaam uit S06.
3. Herstel de basisinhoud van `PGB354-DOC-004` in hetzelfde SharePoint-item.
4. Verwijder geen versiegeschiedenis. De reset maakt de actuele inhoud en rechten deterministisch; SharePoint-versienummers mogen oplopen.
5. Vernieuw de portaalbibliotheek en controleer tien zichtbare bestanden voor rol A en acht voor rol B.
6. Controleer met de repo-checksums dat de lokale uploadbron zelf niet is gewijzigd.
7. Voer S02, S04 en de positieve preview uit als korte reset-smoke.
8. Leg één bewijsregel vast met categorie `reset_geslaagd`, versie-indicator `basis` en alleen tellingen.

De reset is pas volledig uitgevoerd als iedere controle hierboven is waargenomen. Een teruggezette bestandsnaam zonder rechten- en inhoudscontrole is geen geslaagde reset.

## 8 Gecontroleerd opruimen

Opruimen vraagt een apart besluit van de testset-eigenaar. Trek eerst de PGB-bronregistratie in het portaal in en zet eventuele testspecifieke vlaggen terug volgens het fase-3-runbook. Verwijder daarna de twee testgroepmachtigingen en pas als laatste de afgebakende bibliotheek of testsite. Bewaar geen lokale kopie van SharePoint- of Graph-responses.

De lokale mapping en bewijslog bevatten private testreferenties. Verwijder die na de afgesproken bewaartermijn via een recoverable lokale verwijderactie of overschrijf de waarden met `null`; commit ze nooit. De versiebeheerbare synthetische corpus blijft bestaan voor herhaalbaarheid.

## 9 Acceptatiechecklist

- [x] De zeven vaste mappaden bestaan onder `PGB`.
- [x] Alle tien bibliotheekfixtures zijn geüpload; de mutatiefixture v2 staat niet als aparte bron in de bibliotheek.
- [x] De groepsconfiguratie volgt de rechtenmatrix: A en B lezen de algemene root; alleen A leest de beperkte map.
- [ ] Rol A leest algemene en beperkte stukken; rol B uitsluitend algemene stukken.
- [ ] De rol-B-meting gebruikt een echt tweede interactief account of blijft zichtbaar open.
- [ ] S01 tot en met S10 hebben bewijs met uitsluitend toegestane velden.
- [x] DOCX, digitaal doorzoekbare PDF en PPTX zijn rechtstreeks in Microsoft 365 positief gepreviewd met het beheerdersaccount; rol A en de portaalpreview blijven onderdeel van de nulmeting.
- [ ] Actuele en historische antwoorden zijn onderscheiden.
- [ ] Naam, locatie, eTag en cTag veranderen volgens de mutaties zonder bronverwisseling.
- [ ] Intrekking tijdens een verzoek is deterministisch gemeten of zichtbaar open wegens ontbrekend pauzepunt.
- [ ] Replay na intrekking lekt geen eerdere inhoud.
- [ ] Scan en onbekend formaat leveren veilige genormaliseerde fouten.
- [ ] De volledige resetprocedure is eenmaal uitgevoerd en als `reset_geslaagd` vastgelegd.
- [ ] `npm run security:secrets`, `npm run fixtures:pgb:check` en de repositorygates zijn groen.

## 10 Uitvoeringsstand 14 september 2026

De SharePoint-inrichting is uitgevoerd binnen de vooraf aangewezen bestaande map. De bronmap was vóór de eerste mutatie leeg. De beginset bevat exact tien items verdeeld over de zeven manifestpaden. Lokaal is bevestigd dat de twee gewone PDF-fixtures een tekstlaag hebben en dat de scanfixture nul extraheerbare tekens heeft.

De directe Microsoft 365-weergave is met het beheerdersaccount positief voor een DOCX-, PDF- en PPTX-fixture. Dit bewijst browserweergave aan de Microsoft-kant, maar nog niet de fondsgebonden lijst- en previewroute van #321 of de effectieve toegang van een onafhankelijke testrol. De algemene PGB-root heeft unieke rechten waarbij beide testgroepen lezen en de bestaande sitegroepen behouden zijn. De beperkte map heeft eigen unieke rechten: Owners behouden volledig beheer, testgroep A heeft lezen en testgroep B heeft geen machtiging. Er is nog geen afzonderlijk Microsoft-testaccount aan de testgroepen gekoppeld. Daardoor gelden S05, S08 en S09 nog als niet uitgevoerd.

Het harnas uit #353/#357 is gereed maar nog niet lokaal uitvoerbaar met de private Preview-vaultverbinding. Daardoor zijn de drie live rondes, versie-identiteit, Graph-calltellingen en het vergelijkend GO/NO-GO-oordeel nog open. De huidige beslissing is **NO-GO voor productiewiring**, niet omdat Graph is afgewezen, maar omdat de effectieve identiteitstoegang en live retrieval nog niet end-to-end zijn bewezen.
