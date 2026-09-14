# PGB SharePoint retrievalacceptatie — tussenresultaat 14 september 2026

## Uitkomst

De vaste synthetische PGB-bibliotheek staat in de aangewezen Microsoft 365-testomgeving. De mappenstructuur en de volledige basisset zijn aanwezig. De Microsoft 365-browserweergave is met het beheerdersaccount positief voor Word, een digitaal doorzoekbare PDF en PowerPoint. De beperkte map heeft unieke rechten: alleen de site-eigenaren en testgroep A hebben toegang; testgroep B heeft daar geen machtiging. De repo bevat uitsluitend publieke fixturecodes en fictieve inhoud; private Microsoftreferenties blijven in de lokale genegeerde mapping.

Het resultaat is **DEELS GEREED / NO-GO voor productiewiring**. De documentinrichting en de groepsrechten zijn gereed: A en B lezen de algemene PGB-root, terwijl alleen A de beperkte map leest. De koppeling van afzonderlijke testidentiteiten, tweede-identiteitsproef, portaalpreview en drie live retrievalrondes ontbreken nog.

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
5. Draai de twee retrievalroutes uit #357 drie volledige rondes en leg alleen geanonimiseerde metingen vast.
6. Voer S06–S10 uit, herstel naam, locatie, inhoud en rechten en bewijs één volledige reset.
7. Neem pas daarna het definitieve besluit: Graph live retrieval of een gerichte Azure AI Search-spike.

## Beslispunt

De documentset is geschikt als vaste acceptatieset. Zij levert nog geen bewijs dat de volledige live Microsoftretrieval veilig en voldoende presteert. Tot de open effectieve-identiteits- en retrievalmetingen groen zijn, blijft de productieadapter uit.
