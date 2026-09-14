# Rechtenmatrix PGB SharePoint retrievalacceptatieset

Doel: `PGB Preview-pilot`  
Eigenaar: M365 pilotteam  
Herziening: 10 december 2026

Deze matrix gebruikt alleen publieke testrollabels. De koppeling naar accounts, groepen en Microsoft-identifiers blijft in het lokale bestand `.pgb-sharepoint-fixtures.local.json` met bestandsmodus `0600`.

## Testrollen

| Rol | SharePointgroep | Algemene mappen | Beperkte map | Testdoel |
|---|---|---:|---:|---|
| `rol_a` | `PGB354-Test-A-Lezen` | lezen | lezen | positieve lijst-, preview- en retrievaltests; intrekking op één fixture |
| `rol_b` | `PGB354-Test-B-Lezen` | lezen | geen toegang | negatieve rechtenproef en gewone positieve tests |

De site-eigenarengroep voert de inrichting uit maar telt niet als testrol. Een testaccount mag niet via een andere groep, deelkoppeling of directe machtiging alsnog toegang krijgen.

## Mappen

| Map onder `PGB` | Overerving | `rol_a` | `rol_b` | Beginstaat na reset |
|---|---|---:|---:|---|
| `01 Vergaderstukken` | van bibliotheekroot | lezen | lezen | A en B zichtbaar |
| `01 Vergaderstukken/2026-09 Bestuursvergadering` | van bovenliggende map | lezen | lezen | A en B zichtbaar |
| `01 Vergaderstukken/2026-10 Bestuursvergadering` | van bovenliggende map | lezen | lezen | A en B zichtbaar |
| `02 Beleid en reglementen` | van bibliotheekroot | lezen | lezen | A en B zichtbaar |
| `03 Historisch en vervallen` | van bibliotheekroot | lezen | lezen | A en B zichtbaar |
| `04 Beperkt bestuur` | unieke rechten | lezen | geen toegang | alleen A zichtbaar |
| `99 Mutatie- en intrekkingstests` | van bibliotheekroot | lezen | lezen | A en B zichtbaar |

## Mutaties

| Scenario | Tijdelijke wijziging | Verwachte waarneming | Herstel |
|---|---|---|---|
| S06 | hernoem `PGB354-DOC-003-Hernoem-en-verplaatsproef.docx` naar `PGB354-DOC-003-Verplaatst.docx` en verplaats het naar de vergadering van oktober | dezelfde lokale bronreferentie; nieuwe naam en map; geen verwisseling met een andere fixture | verplaats terug naar `99 Mutatie- en intrekkingstests` en herstel de exacte beginnaam |
| S07 | vervang de inhoud van `PGB354-DOC-004-Inhoudsmutatie.docx` in hetzelfde item door `mutaties/PGB354-DOC-004-Inhoudsmutatie-v2.docx` | eTag en cTag veranderen; antwoord wijzigt van donderdag 09.20 uur naar vrijdag 10.35 uur | vervang de inhoud van hetzelfde item door de basisfixture uit `bibliotheek/`; controleer opnieuw gewijzigde versie-indicatoren |
| S08 en S09 | verwijder `PGB354-Test-A-Lezen` tijdelijk van `PGB354-DOC-005-Intrekkingsproef.docx` of van de unieke beperkte maprechten | lopend verzoek faalt gesloten; replay levert geen eerder opgehaalde passage | voeg `PGB354-Test-A-Lezen` terug met alleen lezen en controleer dat alleen rol A toegang heeft |

Als een tweede interactief account ontbreekt, blijft de uitvoering met `rol_b` open. De matrix mag dan wel worden ingericht, maar S01, S02, S04, S05 en S10 krijgen geen status geslaagd.
