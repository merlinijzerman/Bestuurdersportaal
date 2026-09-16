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
