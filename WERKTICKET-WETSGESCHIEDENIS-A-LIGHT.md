# Werkticket — actuele wetgeving en wetsgeschiedenis (A-light)

| Veld | Waarde |
|---|---|
| **Status** | In uitvoering — foundation, structuur-ingest en R-1 bronduiding gerealiseerd; R-2 juridische vraagintentie (observe-only, #491) in PR naar `preview`; bronimport, routing/ranking (R-3, #492), vergelijking en evaluatie nog open |
| **Prioriteit** | P2 — pilotvoorbereiding |
| **Impactklasse** | AI/retrieval + beperkte data- en UI-impact |
| **Omvang** | Indicatie: 5–8 engineeringdagen + 1–2 dagen broncuratie |
| **Releaseweg** | Branch/PR → Preview → evaluatie → reguliere Productie-release |
| **Herkomst** | Vereenvoudiging van `../WERKOPDRACHT-WETSGESCHIEDENIS-EN-ARTIKELKOPPELING-2026-09-22.md` |
| **Broninventaris** | `BRONINVENTARIS-WETGEVING-EN-WETSGESCHIEDENIS-A-LIGHT.md` |

## 1. Doel

Bestuurders moeten bij een wetsbepaling niet alleen kunnen zien **wat momenteel geldt**, maar
ook **waarom de wetgever daarvoor heeft gekozen**. Het portaal combineert daarom actuele,
geconsolideerde wetgeving met relevante wetsgeschiedenis, met een zichtbaar en technisch
afgedwongen onderscheid tussen norm en toelichting.

De eerste versie kiest bewust voor semantische zoekrelaties. Er komt geen handmatig
gevalideerde koppeling tussen een passage en een wetsartikel.

## 2. Vaststaande uitgangspunten

1. Alleen de **actuele geconsolideerde versie** van de Pensioenwet en de Wet verplichte
   beroepspensioenregeling is actief en doorzoekbaar als geldend recht.
2. Een vervangen wetsversie mag technisch voor audit/herleidbaarheid worden bewaard, maar
   wordt niet gebruikt voor antwoorden. Historische peildatumvragen vallen buiten scope.
3. Staatsblad-publicaties van wijzigingswetten, waaronder de Wtp, zijn geen vervanging voor
   de geconsolideerde wettekst.
4. Memorie van toelichting, nota van wijziging, nota naar aanleiding van het verslag en
   amendementen zijn **wetsgeschiedenis** en nooit zelfstandig bindend.
5. In fase 1 worden alleen definitieve stukken uit afgeronde wetgevingsdossiers opgenomen.
   Van amendementen worden uitsluitend de laatste, **aangenomen** versies geïmporteerd.
   Verworpen, ingetrokken en status-onbekende amendementen worden niet opgenomen. De
   definitieve versie van een amendement geldt daarbij niet automatisch als aangenomen:
   de behandelingsstatus wordt vóór import aan de officiële bron gecontroleerd.
6. De relatie tussen artikel en wetsgeschiedenis wordt gelegd door retrieval op tekst,
   artikelnummer, onderwerp en metadata. Er komt geen artikelregister, passage-identiteit,
   koppeltabel of juridische validatieworkflow.
7. Wetsgeschiedenis mag alleen aanvullend worden gebruikt nadat de actuele norm is
   vastgesteld. Zij mag niet zelfstandig leiden tot formuleringen als "moet", "mag niet"
   of een wettelijke termijn.

## 3. Gebruikersresultaat

Bij een normatieve vraag geeft de assistent eerst antwoord uit de actuele wetgeving. Bij een
vraag naar bedoeling, achtergrond of totstandkoming kan hij aanvullend relevante
wetsgeschiedenis tonen.

Voorbeeld:

> Artikel 150d Pensioenwet bepaalt momenteel … Uit de memorie van toelichting en het
> aangenomen amendement blijkt dat de wetgever hiermee beoogde …

De bronweergave maakt het onderscheid expliciet, bijvoorbeeld:

- `Pensioenwet — geldend recht`
- `Memorie van toelichting — wetsgeschiedenis, geen norm`
- `Aangenomen amendement — wetsgeschiedenis, geen zelfstandige norm`

## 4. Scope en uitvoering

### PR 1 — Bronmodel en bibliotheekbeheer

- Voeg een herkenbaar documenttype `wetsgeschiedenis` toe.
- Hergebruik de bestaande documentmetadata en voeg alleen toe wat nog ontbreekt: subtype en
  dossiernummer. Leg daarnaast via de bestaande velden documentdatum, officiële URL,
  bronorganisatie, thema, rechtsregime/toepassingsgebied en normgewicht `informatief` vast.
- Sla `publicatiekenmerk` niet op als afzonderlijk veld. Neem de volledige officiële
  bronverwijzing consequent op in de titel, bijvoorbeeld
  `Memorie van toelichting — Kamerstukken II 2021/22, 36 067, nr. 3`.
- Ondersteun minimaal de subtypes `memorie_van_toelichting`, `aangenomen_amendement`,
  `nota_van_wijziging` en `nota_naar_aanleiding_van_het_verslag`.
- Voeg geen afzonderlijk veld voor behandelingsstatus toe. De importselectie laat alleen
  gecontroleerd aangenomen amendementen toe; `aangenomen` ligt voor deze documenten al vast
  in het subtype `aangenomen_amendement`.
- Breid de generieke bibliotheek alleen uit met de benodigde invoervelden, labels en
  filters; geen nieuw beheerscherm en geen nieuwe gebruikersrol.

### PR 2 — Bronnen, import en tekststructuur

- Neem de actuele geconsolideerde Pensioenwet en Wvb op met BWB-identificatie, officiële
  URL en versiedatum/ophaaldatum.
- Zorg dat per wet maximaal één versie actief en doorzoekbaar is.
- Deactiveer of herclassificeer bestaande Wtp-Staatsblad-pdf's zodat zij niet als actuele
  geconsolideerde wet worden gebruikt.
- Importeer een beperkte pilotset wetsgeschiedenis uit afgeronde dossiers.
- Controleer bij ieder amendement vóór import aan de officiële parlementaire bron dat het
  de laatste versie betreft én dat het amendement is aangenomen; leg deze controle vast in
  de broncuratielijst, niet als extra documentmetadata.
- Verdeel parlementaire stukken conservatief op algemeen deel, artikelsgewijze toelichting,
  artikel/onderdeel en toelichting bij een amendement.
- Splits gemengde Pensioenwet/Wvb-bronnen tijdens de import logisch per rechtsregime als dat
  nodig is om regimelekken te voorkomen.

### PR 3 — Retrieval, antwoordregels en bronweergave

- Herken of de gebruiker vraagt naar geldend recht of naar bedoeling/totstandkoming.
- Gebruik wetsgeschiedenis niet standaard in normatieve antwoorden; actuele wetgeving heeft
  daar voorrang en mag niet door een goed scorende toelichtingspassage worden verdrongen.
- Laat aangenomen amendementen de uiteindelijke tekst verklaren zonder ze als norm te
  presenteren.
- Verworpen, ingetrokken of status-onbekende amendementen kunnen in fase 1 niet worden
  opgehaald, omdat zij niet worden geïmporteerd.
- Toon het onderscheid tussen geldend recht en wetsgeschiedenis in antwoord en
  onderbouwing/bronnenpaneel.
- Pas hetzelfde onderscheid toe in de afzonderlijke documentvergelijking. Expliciet gekozen
  historische documenten blijven vergelijkbaar, maar de vergelijking presenteert wetgeving
  en wetsgeschiedenis nooit als twee gelijkwaardige bindende normen.
- Voeg documenttype, subtype, dossiernummer, versie/datum, normgewicht en rechtsregime toe
  aan de bestaande retrieval- en auditmetadata. Gebruik de documenttitel voor de volledige
  officiële bronverwijzing.
- Classificeer eventuele live webresultaten van `officielebekendmakingen.nl` op documentsoort;
  een `kst-*`-Kamerstuk mag niet door de domeinwhitelist als bindend worden behandeld.

### PR 4 — Evaluatie en gecontroleerde release

- Voeg een gerichte regressie-/evaluatieset toe voor actuele norm, bedoeling van de wetgever,
  aangenomen amendement, uitsluiting van niet-aangenomen amendementen, regimeafbakening en
  ontbrekende historische peildatum.
- Voer de pilot eerst op Preview uit met bron- en antwoordcontrole.
- Leg broncuratie, vervanging van de actuele wet en rollback vast in de beheerinstructie.
- Productie volgt alleen via de reguliere releaseweg na groene evaluatie.

## 5. Acceptatiecriteria

- Een vraag als "Wat bepaalt artikel X momenteel?" wordt primair beantwoord uit de actuele,
  geconsolideerde wet en citeert die als geldend recht.
- Een vraag als "Waarom is artikel X zo geformuleerd?" kan relevante wetsgeschiedenis
  toevoegen met kamerstuknummer, datum, officiële link en zichtbaar niet-bindend label.
- Een aangenomen amendement kan als verklaring voor de uiteindelijke tekst worden gebruikt,
  maar nooit als zelfstandige norm.
- Een expliciete vergelijking tussen actuele wetgeving en wetsgeschiedenis benoemt zichtbaar
  welke bron de actuele norm is en welke bron uitsluitend toelichting geeft; de selectie wordt
  niet door een impliciet actualiteitsfilter gewijzigd.
- Een verworpen, ingetrokken of status-onbekend amendement is niet geïmporteerd en kan
  daardoor niet in een antwoord verschijnen.
- Een passage over de Wvb verschijnt niet als onderbouwing bij een uitsluitend op de
  Pensioenwet begrensde vraag, en omgekeerd.
- De bestaande Wtp-wijzigingswet wordt niet meer gepresenteerd als actuele Pensioenwet.
- Na vervanging van de actuele wet wordt de oude versie niet meer doorzocht; bron en
  versiedatum blijven voor audit herleidbaar.
- Op de vraag "Wat gold op [historische datum]?" meldt het portaal dat historische
  wetsversies niet beschikbaar zijn en presenteert het de actuele tekst niet als historisch
  antwoord.
- Bestaande retrieval- en antwoordregressies blijven groen.

## 6. Buiten scope

- Gevalideerde koppelingen tussen wetsgeschiedenispassage, Staatsblad-onderdeel en artikel.
- Een artikelregister of afzonderlijke artikelversietabel.
- Historische wetsversies en antwoorden op een juridische peildatum.
- Een curator- of juristenrol voor het valideren van koppelingen.
- Automatische herbeoordeling van passagekoppelingen na een wetswijziging.
- Wetgevingsdossiers in behandeling in gewone antwoorden over geldend recht.
- Verworpen, ingetrokken en status-onbekende amendementen.
- Wijzigingen aan vergaderingen, besluiten, acties, risico's, procedures, fondsdocumenten,
  SharePoint/Microsoft-integraties of tenantautorisatie.

## 7. Risico's en beheersing

| Risico | Beheersing |
|---|---|
| Bestuurder leest toelichting als norm | Label in antwoord én bronnenpaneel; promptregel dat wetsgeschiedenis geen zelfstandige norm is |
| MvT scoort hoger dan de actuele wet | Documenttype vóór ranking filteren/routen; normatieve vragen primair uit actuele wet |
| Verouderde wet blijft actief | Eén actieve versie per wet; handmatig vervangingsproces met Preview-controle |
| Regimelek tussen Pensioenwet en Wvb | Bron logisch splitsen en rechtsregime vóór ranking afdwingen |
| Laatste versie van amendement wordt ten onrechte als aangenomen beschouwd | Status vóór import controleren aan de officiële parlementaire bron; alleen aangenomen versie importeren en typeren als `aangenomen_amendement` |
| Domeinwhitelist maakt Kamerstuk bindend | Classificatie op publicatiesoort/kenmerk, niet alleen op domein |
| Vergelijkingscall presenteert wet en toelichting als gelijkwaardige normen | Expliciete selectie behouden, maar documenttype, normgewicht en juridische rol doorgeven aan vergelijking, bronweergave en audit |

## 8. Startvoorwaarden en Definition of Done

Startvoorwaarden:

- Pilotset en actuele officiële wetbronnen zijn vastgesteld volgens de broninventaris; per
  bron is vóór import de actuele officiële versie/status nogmaals gecontroleerd.
- De broncuratielijst bevestigt voor ieder amendement zowel de laatste versie als de status
  `aangenomen`; deze controle is de importvoorwaarde en geen afzonderlijk metadata-attribuut.
- Vaststaat wie de actuele wet bij een wijziging vervangt; hiervoor is geen juridische
  validator nodig, wel operationeel bronbeheer.
- De relevante retrievalwijzigingen die al in uitvoering zijn, zijn eerst geland om
  conflicten in `app/api/chat/route.ts` en `core/lib/rag.ts` te voorkomen.

Klaar wanneer:

- alle acceptatiecriteria aantoonbaar groen zijn op Preview;
- database-/RLS-impact en auditmetadata zijn gecontroleerd;
- beheerinstructie en regressieset zijn bijgewerkt;
- de release via de normale Preview→Productie-route is uitgevoerd en gedocumenteerd.
