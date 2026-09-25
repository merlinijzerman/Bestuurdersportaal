# PGB SharePoint retrievalacceptatie — tussenresultaat 14 september 2026

## Uitkomst

De vaste synthetische PGB-bibliotheek staat in de aangewezen Microsoft 365-testomgeving. De mappenstructuur en de volledige basisset zijn aanwezig. De Microsoft 365-browserweergave is met het beheerdersaccount positief voor Word, een digitaal doorzoekbare PDF en PowerPoint. De beperkte map heeft unieke rechten: alleen de site-eigenaren en testgroep A hebben toegang; testgroep B heeft daar geen machtiging. De repo bevat uitsluitend publieke fixturecodes en fictieve inhoud; private Microsoftreferenties blijven in de lokale genegeerde mapping.

Het resultaat is **DEELS GEREED / NO-GO voor productiewiring**. De documentinrichting en de groepsrechten zijn gereed: A en B lezen de algemene PGB-root, terwijl alleen A de beperkte map leest. De koppeling van afzonderlijke testidentiteiten, tweede-identiteitsproef, portaalpreview en drie live retrievalrondes ontbreken nog.

## Aanvulling 15 september 2026 — issue #399

De hermetische retrievalimplementatie is uitgebreid met expliciet actualiteitsbeleid, een positieve historische proef S04H, serververtrouwde fixturestatus op exacte fixturecode en vaste kandidaatdiagnostiek. Status is onderdeel van de bronvingerafdruk; onbekende of conflicterende status valt vóór downloaden fail-closed af. Kandidaatfouten leveren precies één categorie volgens de vaste fasevolgorde, terwijl actor-/tenantmismatch, bronconfiguratiedrift, timeout en cancellation fataal blijven voor het hele verzoek. De auditprojectie gebruikt uitsluitend de acht vaste platte `afwijzing_*`-velden.

Deze wijziging voegt geen migratie, opslag, permissie, productiewiring of scope toe. De Preview-vlag is niet ingeschakeld en er zijn nog geen live PGB-metingen uitgevoerd. De code- en fixturetests zijn lokaal groen; de status blijft **NO-GO voor productiewiring** totdat de PR groen is, op Preview is gedeployed en de onderstaande live volgorde volledig is doorlopen.

## Aanvulling 16 september 2026 — eerste korte live reeks en Office-rootfix

PR #400 is in `preview` gemerged. Na de eerste gecontroleerde meetpoging is de extra vlag geauditeerd teruggezet naar `false`, versie 4. De vijf bijbehorende auditregels bevatten exact de acht toegestane platte `afwijzing_*`-velden en geen genest afwijzingsobject.

De live waarneming wijst op een te strikte rootcontrole: PDF-items met een regulier bibliotheekpad slagen, terwijl Word- en PowerPoint-items Office-weergave-URL's van de vorm `/:w:/…` en `/:p:/…` leveren en onder `afwijzing_root` afvallen. Dit is nog geen positief eindbewijs voor de korte reeks. De gerichte vervolgfix bepaalt rootlidmaatschap daarom met de live drive- en parentreferenties en gebruikt de kandidaat-`webUrl` niet meer voor rootbewijs of locatorpad. Hermetische regressies dekken beide Office-URL-vormen en buiten-de-rootgevallen. Na een groene fix-PR worden S00 en de korte reeks S02, S03, S04 en S04H opnieuw uitgevoerd; S08 en S09 blijven tot die tijd buiten scope.

## Aanvulling 16 september 2026 — tweede korte live reeks en bronsetcorrectie

PR #401 is als `1d9f5fc` in `preview` gemerged; alle mergechecks en beide Preview-deployments waren groen. S00 slaagde. De Office-rootfix werkte: S02 en S03 lieten Word en PowerPoint door, terwijl S04 uitsluitend de actuele PDF en S04H uitsluitend de historische PDF toeliet. S02 leverde echter naast `PGB354-DOC-001` ook `PGB354-PPT-001`, terwijl de acceptatieset exact één bron voorschrijft. De 24-metingen en S08/S09 zijn daarom niet gestart. De extra vlag is direct geauditeerd teruggezet naar `false`, versie 6; de vijf meetregels bevatten de acht toegestane platte `afwijzing_*`-velden en geen geneste waarden.

De afwijking heeft twee oorzaken. De veilige meetprojectie markeerde iedere niet-lege kandidaatset als `geslaagd` en berekende alleen recall, waardoor een foutpositief bij recall 1 groen leek. Daarnaast bevatte de zichtbare locatoruitleg in de PowerPoint-fixture zelf de unieke S02-term `Koraalmaat 47`. De correctie vereist voortaan exacte gelijkheid met de vooraf vastgelegde bronset en classificeert een ontbrekende of extra fixture als `acceptatie_afwijking/onverwachte_bronset`. De PowerPoint-fixture behoudt het eigen antwoordfeit `IJsvogelkompas 73`, maar noemt de S02-canary niet meer. Na deploy wordt uitsluitend S00 plus de korte Drive-reeks opnieuw uitgevoerd; de vervolgmetingen blijven tot een volledig groene inhoudscontrole buiten scope.

## Aanvulling 18 september 2026 — issue #407, T0–T2 gebouwd (Copilot Retrieval als vierde meetarm)

Het spikeharnas heeft een vierde meetarm gekregen: `POST /v1.0/copilot/retrieval` met
`dataSource = sharePoint`. De arm is gebouwd, hermetisch getest en volledig geïsoleerd; hij
heeft **geen serverbrug** en is alleen via de lokale CLI en de tests bereikbaar.

In deze tranche is **niets** gewijzigd aan Microsoft-permissions, consent, billing,
featureflags, migraties of productiecode voor live retrieval, en is **geen enkele live
Graph-call** gedaan. T3 is niet gestart.

De verificatieketen behandelt een Copilot-extract uitdrukkelijk als onbetrouwbaar
kandidaatsignaal. De `webUrl` is uitsluitend een locator: hij wordt eerst tegen de opnieuw
gelezen root geprefilterd en daarna exact gematcht tegen een **read-only** locatorregister
dat wij zelf opbouwen uit de al geregistreerde DriveItems. Pas dan loopt de ongewijzigde
#353-keten. Elk extract moet bovendien **uniek** in onze eigen, zojuist uitgelezen tekst
terug te vinden zijn; ontbrekend, te kort, gewijzigd of meervoudig voorkomend valt
fail-closed af onder de nieuwe categorie `lokalisatie`. De passage komt altijd uit de eigen
extractie.

Bij de reviewronde van 18 september is de oorspronkelijke `/shares`-resolver geschrapt:
Microsoft noemt voor `GET /shares/{token}/driveItem` minimaal delegated `Files.ReadWrite`,
en een read-only spike mag geen schrijfrecht vragen. Het locatorregister vervangt hem
volledig en zonder extra permissie. Bewust geaccepteerd gevolg: Office-weergave-URL's
(`/:w:/…`, `/:p:/…`) matchen niet op het bibliotheekpad en vallen zichtbaar af onder
`mapping`.

Eén securitybevinding kwam uit de eigen tests en is meteen verholpen: `new URL()` codeert een
aanhalingsteken in een pad stilzwijgend tot `%22`. Een filter die er syntactisch schoon
uitziet, kan daardoor aan de Microsoft-kant alsnog als quote worden gelezen en de scope
openbreken — precies het risico dat #407 benoemt. De filterbouwer toetst nu de gedecodeerde
betekenis en codeert opnieuw vanuit de gecontroleerde vorm.

### Beslismatrix — stand per 18 september 2026

| Criterium | Bewijsbron | Stand |
|---|---|---|
| Geen live permission-, consent- of billingwijziging in de voorbereiding | diff + boundarygate | **groen** |
| Ongeldige filter kan nooit ongescoped vertrekken | hermetische test | **groen** |
| Raw extract bereikt nooit context of citaat | hermetische test | **groen** |
| Passage gelokaliseerd in actuele, dubbel versiegecontroleerde bron | hermetische test | **groen** |
| Bestaande routes gedragsmatig ongewijzigd met de arm uit | regressietest | **groen** |
| Type-, boundary-, secret-, security- en cross-tenantgates | `npm run gates` | **groen** (DB-laag niet gedraaid; geen DB-object geraakt) |
| S02/S03/S04/S04H exacte bronset via Copilot | live meting | **niet uitgevoerd — T3** |
| Twee semantische scenario's met aantoonbare recallwinst | live meting | **geblokkeerd** — fixtures ontbreken |
| Kosten- en licentiemodel vastgesteld | besluit | **open — beslissing gevraagd** |
| Tijdelijke brede grants aantoonbaar verwijderd | live rollback | **niet van toepassing — geen grant verleend** |

### Twee harde voorwaarden vóór T3

1. **Licentie, kosten en consent.** `POST /v1.0/copilot/retrieval` vereist een Microsoft 365
   Copilot-add-on of pay-as-you-go Preview, plus delegated `Files.Read.All` **én**
   `Sites.Read.All` samen — beide, niet één van de twee — voor uitsluitend de afgeschermde
   PGB-testidentiteit. Dat is breder dan de Microsoft Search-route uit #403/#405. Zonder dat
   besluit levert de arm `toestemming_geweigerd/copilot_toegang_geweigerd` (401/403, oorzaak
   bewust niet zelf geduid) of `copilot_licentie_of_billing` (402) — beide stopresultaten.
   Zie `COPILOT-RETRIEVAL-407-LICENTIE-EN-CONSENT.md`.
2. **Semantische fixtures.** De #385-set is volledig rond unieke canary-termen gebouwd; de
   generator zet canaryterm, vraag én antwoordfeit letterlijk in het document. Er is geen
   parafrase- of synoniemtekst. De semantische scenario's SEM01 en SEM02 zijn daarom nu
   uitsluitend hermetisch meetbaar. Live meten vereist eerst `PGB407-DOC-101` en
   `PGB407-DOC-102` in het manifest én in SharePoint, en daarna indexgereedheid.

De status blijft **NO-GO voor productiewiring**.

## Geanonimiseerd bewijs

| Onderdeel | Waarneming | Status |
|---|---|---|
| Bestaande root | De aangewezen map bestond en was vóór inrichting leeg | groen |
| Mappen | Zeven manifestpaden onder één afgebakende root | groen |
| Bestanden | Tien bibliotheekitems; geen aparte v2-mutatiebron | groen |
| Word | Eén fixture opent in Word voor het web met het beheerdersaccount | groen als M365-previewbasis; rol A nog niet afzonderlijk gemeten |
| PDF | Eén fixture opent met het beheerdersaccount in de SharePoint-browserpreview; lokaal 3 pagina's met tekstlaag | groen als M365-previewbasis; rol A nog niet afzonderlijk gemeten |
| PowerPoint | Eén fixture opent met het beheerdersaccount in PowerPoint voor het web en toont vier dia's | groen als M365-previewbasis; rol A nog niet afzonderlijk gemeten |
| Scanfixture | Eén pagina en nul lokaal extraheerbare tekens | groen als beginconditie |
| Onbekend formaat | Aanwezig als afzonderlijke synthetische fixture | groen als beginconditie |
| Beperkte map | Twee synthetische DOCX-fixtures aanwezig; unieke rechten met Owners volledig beheer, testgroep A lezen en geen machtiging voor testgroep B | groen als rechtenconfiguratie |
| Testgroepen | A en B bestaan; beide lezen de algemene PGB-root, alleen A leest de beperkte map; afzonderlijke Microsoft-testaccounts zijn nog niet gekoppeld | groen als groepsconfiguratie; effectieve identiteitstest open |
| Rol B | Geen tweede interactief testaccount gebruikt | niet uitgevoerd |
| Portaalweergave #321 | Nog niet tegen deze bron geregistreerd en gemeten | niet uitgevoerd |
| Graph-rondes #353/#357 | Private Preview-vaultverbinding niet lokaal beschikbaar | niet uitgevoerd |
| Mutatie, intrekking en reset | Beginstaat staat; scenario's nog niet gestart | niet uitgevoerd |

Er zijn geen echte bestuursstukken, klantgegevens, tokens, documentinhoud uit SharePoint, ruwe Graph-responses of private Microsoft-ID's in dit bewijs opgenomen.

## Resterende acceptatievolgorde

1. Koppel een afzonderlijk Microsoft-testaccount aan rol A; koppel rol B pas zodra een tweede account beschikbaar is. Controleer daarna de al ingerichte groepsrechten met beide identiteiten.
2. Vul na een gecontroleerde Graph-listing de private lokale site-, drive-, root- en itemreferenties in.
3. Registreer de PGB-root als Preview-bron volgens het fase-3-runbook en meet de portaalweergave voor rol A.
4. Gebruik een echte tweede identiteit voor de negatieve rol-B-lijst-, preview- en retrievalproef.
5. Merge en deploy de bronsetcorrectie, vervang daarna uitsluitend de synthetische PowerPoint-fixture volgens het resetrunbook en actualiseer de private versievelden voor hetzelfde item.
6. Controleer opnieuw S00 en de korte Drive-reeks S02, S03, S04 en S04H. Stop bij `acceptatie_afwijking`, onverwachte inhoud of een fatale fout.
7. Draai alleen na die groene korte reeks S02–S04H via beide retrievalroutes, drie volledige rondes per route (24 metingen), en leg alleen geanonimiseerde metingen vast.
8. Voer pas daarna S06–S10 uit, herstel naam, locatie, inhoud en rechten en bewijs één volledige reset.
9. Neem pas daarna het definitieve besluit: Graph live retrieval of een gerichte Azure AI Search-spike.

## Beslispunt

De documentset is geschikt als vaste acceptatieset. Zij levert nog geen bewijs dat de volledige live Microsoftretrieval veilig en voldoende presteert. Tot de open effectieve-identiteits- en retrievalmetingen groen zijn, blijft de productieadapter uit.
