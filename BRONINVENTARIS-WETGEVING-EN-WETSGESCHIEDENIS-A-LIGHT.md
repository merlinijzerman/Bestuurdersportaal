# Broninventaris — actuele wetgeving en wetsgeschiedenis (A-light)

| Veld | Waarde |
|---|---|
| **Peildatum inventarisatie** | 22 september 2026 |
| **Doel** | Bronselectie voor de A-light-pilot in het Bestuurdersportaal |
| **Uitgangspunt** | Alleen actuele geconsolideerde regelgeving is normatief; parlementaire geschiedenis is informatief |
| **Bijbehorend ticket** | `WERKTICKET-WETSGESCHIEDENIS-A-LIGHT.md` |

## 1. Advies in één zin

Begin met de actuele Pensioenwet en Wvb plus een kleine, hoogwaardige selectie van de
totstandkomingsgeschiedenis van de Wtp en de verlenging van de transitieperiode. Neem niet
automatisch alle stukken uit een wetgevingsdossier over.

## 2. Selectieregels

Een document wordt opgenomen wanneer het ten minste één van deze functies heeft:

1. het bevat de actuele, geldende norm;
2. het geeft de officiële artikelsgewijze toelichting op die norm;
3. het bevat een wijziging die aantoonbaar onderdeel is geworden van de uiteindelijke wet;
4. het bevat een inhoudelijk antwoord van de regering dat nodig is om doel, afweging of
   reikwijdte van een bepaling te begrijpen;
5. het is nodig om de formele keten van wetsvoorstel naar geldende regeling te herleiden.

Niet ieder opgenomen document hoeft ook op dezelfde manier doorzoekbaar te zijn. Er zijn
drie gebruiksstanden:

- **Normatief actief** — mag de basis zijn voor antwoorden over geldend recht.
- **Wetsgeschiedenis actief** — mag alleen als toelichting worden gebruikt en krijgt altijd
  het label `geen zelfstandige norm`.
- **Alleen ketenreferentie** — wordt vastgelegd voor herleidbaarheid, maar hoeft niet mee te
  doen in semantische retrieval.

## 3. Pilotset — direct opnemen

### 3.1 Actuele, normatieve bronnen

| Bron | Identificatie | Gebruik | Opmerking |
|---|---|---|---|
| Pensioenwet | [BWBR0020809](https://wetten.overheid.nl/BWBR0020809/) | Normatief actief | Alleen de actuele geconsolideerde toestand; per artikel splitsen |
| Wet verplichte beroepspensioenregeling | [BWBR0018831](https://wetten.overheid.nl/BWBR0018831/) | Normatief actief | Alleen de actuele geconsolideerde toestand; per artikel splitsen |

Bij elke verversing worden minimaal de BWB-id, officiële URL, datum `geldend vanaf`,
ophaaldatum en bronversie opgeslagen. Een eerdere toestand wordt gedeactiveerd en is niet
beschikbaar voor antwoorden.

### 3.2 Wtp — dossier 36 067

Deze stukken verklaren de grootste stelselwijziging en hebben daarom de hoogste waarde voor
de eerste pilot.

| Prio | Document | Officiële bron | Gebruik |
|---|---|---|---|
| P0 | Memorie van toelichting, TK nr. 3 | [36 067, nr. 3](https://zoek.officielebekendmakingen.nl/kst-36067-3.html) | Wetsgeschiedenis actief; algemeen en artikelsgewijs deel apart verwerken |
| P0 | Nota naar aanleiding van het verslag, TK nr. 7 | [36 067, nr. 7](https://zoek.officielebekendmakingen.nl/kst-36067-7.html) | Wetsgeschiedenis actief; regeringsantwoord op inhoudelijke vragen |
| P0 | Eerste nota van wijziging, TK nr. 8 | [36 067, nr. 8](https://zoek.officielebekendmakingen.nl/kst-36067-8.html) | Wetsgeschiedenis actief; gewijzigde tekst met toelichting |
| P0 | Nota naar aanleiding van het nader verslag, TK nr. 11 | [36 067, nr. 11](https://zoek.officielebekendmakingen.nl/kst-36067-11.html) | Wetsgeschiedenis actief |
| P0 | Tweede nota van wijziging, TK nr. 15 | [36 067, nr. 15](https://zoek.officielebekendmakingen.nl/kst-36067-15.html) | Wetsgeschiedenis actief |
| P0 | Derde nota van wijziging, TK nr. 43 | [36 067, nr. 43](https://zoek.officielebekendmakingen.nl/kst-36067-43.html) | Wetsgeschiedenis actief |
| P0 | Memorie van antwoord, EK letter H | [36 067, H](https://zoek.officielebekendmakingen.nl/kst-36067-H.html) | Wetsgeschiedenis actief; bevat ook een bruikbaar overzicht van de aangenomen amendementen |
| P0 | Nadere memorie van antwoord, EK letter K | [36 067, K](https://zoek.officielebekendmakingen.nl/kst-36067-K.html) | Wetsgeschiedenis actief |
| P0 | Nota van toelichting bij het Besluit toekomst pensioenen | [Stb. 2023, 217](https://zoek.officielebekendmakingen.nl/stb-2023-217.html) | Wetsgeschiedenis/toelichting lagere regelgeving; actief maar niet normatief |
| P1 | Wet toekomst pensioenen als wijzigingswet | [Stb. 2023, 216](https://zoek.officielebekendmakingen.nl/stb-2023-216.html) | Alleen ketenreferentie; niet presenteren als actuele Pensioenwet |
| P1 | Inwerkingtredingsbesluit Wtp | [Stb. 2023, 218](https://zoek.officielebekendmakingen.nl/stb-2023-218.html) | Alleen ketenreferentie, behalve bij vragen over inwerkingtreding |

Belangrijk: **Stb. 2023, 216** is de Wtp-wijzigingswet. **Stb. 2023, 218** is het
inwerkingtredingsbesluit en niet de wet zelf.

### 3.3 Aangenomen Wtp-amendementen

De memorie van antwoord aan de Eerste Kamer benoemt dertien amendementen die in het
geamendeerde wetsvoorstel zijn verwerkt. Deze zijn relevant, maar hoeven niet allemaal in de
allereerste technische import te zitten. Advies: begin met de amendementen die raken aan de
onderwerpen in de evaluatieset en importeer daarna de rest als één gecontroleerde batch.

| Nr. | Onderwerp volgens de officiële memorie van antwoord | Officiële bron |
|---:|---|---|
| 31 | Permanente geschilleninstantie | [36 067, nr. 31](https://zoek.officielebekendmakingen.nl/kst-36067-31.html) |
| 57 | Behoud standaardmodel uniform pensioenoverzicht | [36 067, nr. 57](https://zoek.officielebekendmakingen.nl/kst-36067-57.html) |
| 67 | Gegevensdeling vanuit het pensioenregister voor keuzebegeleiding | [36 067, nr. 67](https://zoek.officielebekendmakingen.nl/kst-36067-67.html) |
| 76 | Terugkoppeling over wat met de inbreng uit het hoorrecht is gedaan | [36 067, nr. 76](https://zoek.officielebekendmakingen.nl/kst-36067-76.html) |
| 77 | Monitoring van de transitie en de doelstellingen van de Wtp | [36 067, nr. 77](https://zoek.officielebekendmakingen.nl/kst-36067-77.html) |
| 90 | Mogelijkheid tot opschorting van individuele waardeoverdrachten tijdens de transitie | [36 067, nr. 90](https://zoek.officielebekendmakingen.nl/kst-36067-90.html) |
| 136 | Oordeel van verantwoordings- en belanghebbendenorgaan over uitvoeringskosten | [36 067, nr. 136](https://zoek.officielebekendmakingen.nl/kst-36067-136.html) |
| 152 | Premies en beleggingsrendementen op het UPO | [36 067, nr. 152](https://zoek.officielebekendmakingen.nl/kst-36067-152.html) |
| 164 | Vermogensverschuiving binnen grenzen bij invaren | [36 067, nr. 164](https://zoek.officielebekendmakingen.nl/kst-36067-164.html) |
| 167 | Reductiedoelstelling en monitoring van de witte vlek | [36 067, nr. 167](https://zoek.officielebekendmakingen.nl/kst-36067-167.html) |
| 170 | Oproep aan ondervertegenwoordigde leeftijdsgroepen voor het verantwoordingsorgaan | [36 067, nr. 170](https://zoek.officielebekendmakingen.nl/kst-36067-170.html) |
| 173 | Verlaging minimale toetredingsleeftijd van 21 naar 18 jaar | [36 067, nr. 173](https://zoek.officielebekendmakingen.nl/kst-36067-173.html) |
| 174 | Vervallen wachttijd voor ouderdomspensioen | [36 067, nr. 174](https://zoek.officielebekendmakingen.nl/kst-36067-174.html) |

Voor ieder amendement moet vóór import nog mechanisch worden gecontroleerd dat de URL de
laatste gewijzigde/vervangende versie onder dat Kamerstuknummer toont. De status wordt
opgeslagen als `aangenomen`; het amendement blijft desondanks wetsgeschiedenis en is geen
zelfstandige actuele norm.

### 3.4 Verlenging transitieperiode — dossier 36 578

Dit dossier is relevant omdat het de huidige wettelijke constructie en transitietermijnen
heeft gewijzigd.

| Prio | Document | Officiële bron | Gebruik |
|---|---|---|---|
| P0 | Memorie van toelichting, TK nr. 3 | [36 578, nr. 3](https://zoek.officielebekendmakingen.nl/kst-36578-3.html) | Wetsgeschiedenis actief |
| P0 | Nota naar aanleiding van het verslag, TK nr. 6 | [36 578, nr. 6](https://zoek.officielebekendmakingen.nl/kst-36578-6.html) | Wetsgeschiedenis actief |
| P1 | Nota naar aanleiding van het verslag, EK letter C | [36 578, C](https://zoek.officielebekendmakingen.nl/kst-36578-C.html) | Wetsgeschiedenis actief voor aanvullende Eerste Kamervragen |
| P1 | Wet verlenging transitieperiode | [Stb. 2025, 422](https://zoek.officielebekendmakingen.nl/stb-2025-422.html) | Alleen ketenreferentie; wijzigingen staan in de actuele geconsolideerde wet |
| P0 | Besluit transitietermijnen inclusief nota van toelichting | [Stb. 2025, 423](https://zoek.officielebekendmakingen.nl/stb-2025-423.html) | Besluittekst normatief zodra de actuele geconsolideerde AMvB wordt opgenomen; nota van toelichting informatief |

De in dit dossier ingediende amendementen zijn bij de Tweede Kamerbehandeling verworpen.
Ze worden daarom niet in gewone retrieval opgenomen. Ze kunnen later in een afzonderlijke
historische collectie worden toegevoegd met status `verworpen`.

## 4. Tweede tranche — relevante lagere regelgeving

De eerste routebeslissing beperkt het normatieve corpus tot de Pensioenwet en Wvb. Voor
volwaardige juridische antwoorden zijn onderstaande actuele regelingen echter ook relevant.
Voeg ze pas toe nadat de scheiding tussen norm en wetsgeschiedenis in de pilot aantoonbaar
goed werkt.

| Regeling | Identificatie | Waarom relevant |
|---|---|---|
| Besluit uitvoering Pensioenwet en Wet verplichte beroepspensioenregeling | [BWBR0020892](https://wetten.overheid.nl/BWBR0020892/) | Werkt veel verplichtingen uit de Pensioenwet en Wvb concreet uit |
| Besluit financieel toetsingskader pensioenfondsen | [BWBR0020871](https://wetten.overheid.nl/BWBR0020871/) | Bevat de actuele financiële en transitiegerelateerde uitwerking |
| Regeling Pensioenwet en Wet verplichte beroepspensioenregeling | [BWBR0020917](https://wetten.overheid.nl/BWBR0020917/) | Ministeriële uitwerking en uitvoeringsdetails |

Ook voor deze regelingen geldt: één actuele geconsolideerde toestand actief, eerdere
toestanden niet gebruiken voor antwoorden. Verwijzingen vanuit een nota van toelichting naar
een AMvB zijn zoekhints, geen handmatig gevalideerde artikelkoppelingen.

## 5. Tweede tranche — aanvullende wetsgeschiedenis

Deze stukken kunnen nuttig zijn bij diepere vragen, maar hebben voor de eerste pilot minder
toegevoegde waarde dan de regeringsstukken hierboven:

- advies Raad van State en nader rapport bij de Wtp: [36 067, nr. 4](https://zoek.officielebekendmakingen.nl/kst-36067-4.html);
- verslag en nader verslag bij de Wtp, nrs. [6](https://zoek.officielebekendmakingen.nl/kst-36067-6.html) en [10](https://zoek.officielebekendmakingen.nl/kst-36067-10.html), alleen als de oorspronkelijke vraagstelling relevant is naast het regeringsantwoord;
- wijzigingen voorgesteld door de regering na de amendementen: [36 067, nr. 182](https://zoek.officielebekendmakingen.nl/kst-36067-182.html), vooral voor herleidbaarheid van de eindtekst;
- advies Raad van State en nader rapport bij de verlenging: [36 578, nr. 4](https://zoek.officielebekendmakingen.nl/kst-36578-4.html);
- Handelingen van Tweede en Eerste Kamer, uitsluitend bij een concrete behoefte aan
  mondelinge toelichting die niet in de schriftelijke stukken staat;
- toelichtingen bij latere uitvoeringsbesluiten en ministeriële regelingen, zodra de
  bijbehorende actuele regeling ook in het normatieve corpus zit.

## 6. Watchlist — nog niet bij geldend recht plaatsen

### Dossier 36 957 — Wet toezeggingen Wtp en andere pensioenonderwerpen

Dit wetsvoorstel is op de peildatum nog in behandeling bij de Tweede Kamer. De voorbereiding
is voltooid, maar debat, stemming en afdoening zijn nog niet afgerond. Daarom:

- niet gebruiken in antwoorden over geldend recht;
- nog niet in de gewone wetsgeschiedeniscollectie plaatsen;
- wel als watchlist-item vastleggen;
- na inwerkingtreding opnieuw inventariseren: MvT, nota's van wijziging, regeringsantwoorden,
  aangenomen amendementen en Staatsblad-publicatie.

Bronnen voor de watchlist:

- [Memorie van toelichting, 36 957 nr. 3](https://zoek.officielebekendmakingen.nl/kst-36957-3.html);
- [Advies Raad van State en nader rapport, 36 957 nr. 4](https://zoek.officielebekendmakingen.nl/kst-36957-4.html);
- [actuele voortgang op de website van de Tweede Kamer](https://www.tweedekamer.nl/kamerstukken/wetsvoorstellen/detail?cfg=wetsvoorsteldetails&qry=wetsvoorstel%3A36957).

Pas dezelfde watchlistregel toe op ieder nieuw wetsvoorstel dat de Pensioenwet, Wvb of de
geselecteerde lagere regelgeving wijzigt.

## 7. Niet standaard opnemen

Deze documentsoorten vergroten de ruis en worden alleen bij een expliciete use-case toegevoegd:

- verworpen of ingetrokken amendementen;
- moties, ook als ze zijn aangenomen: een motie wijzigt de wettelijke norm niet;
- Kamervragen en commissievragen wanneer het inhoudelijke regeringsantwoord al als nota is
  opgenomen;
- voortgangsrapportages, monitoringbrieven en verzamelbrieven na inwerkingtreding;
- agenda's, convocaties, procedurebesluiten en aanbiedingsbrieven zonder zelfstandige
  inhoud;
- ambtelijke beslisnota's, consultatiereacties en bijlagen zonder aantoonbare noodzaak voor
  de bestuurdersvraag;
- dubbele HTML-, XML- en PDF-weergaven van hetzelfde officiële document;
- oude geconsolideerde wetstoestanden in de actieve zoekindex.

Het officiële dossier 36 067 bevat inmiddels honderden publicaties, waaronder veel
uitvoerings- en monitoringsstukken van na de totstandkoming. Het hele dossier importeren is
daarom geen bruikbare selectieheuristiek.

## 8. Minimale metadata per document

| Veld | Voorbeeld / regel |
|---|---|
| `source_id` | `BWBR0020809` of `kst-36067-3` |
| `document_type` | `wetgeving` of `wetsgeschiedenis` |
| `subtype` | wet, AMvB, MvT, nota van wijziging, nota n.a.v. verslag, amendement |
| `dossier_number` | `36067` |
| `publication_reference` | `Kamerstukken II 2021/22, 36 067, nr. 3` |
| `official_url` | Permanente officiële URL |
| `document_date` | Datum document/publicatie |
| `legal_status` | geldend, ingetrokken, in behandeling, ketenreferentie |
| `amendment_status` | aangenomen, verworpen, ingetrokken, onbekend, n.v.t. |
| `norm_weight` | bindend of informatief |
| `regime` | Pensioenwet, Wvb, beide, lagere regelgeving |
| `active_for_retrieval` | ja/nee |
| `valid_from` | Alleen voor normatieve geconsolideerde regelingen |
| `retrieved_at` | Ophaaldatum van de officiële bron |
| `section_kind` | algemeen deel, artikelsgewijs, artikel, toelichting amendement |

## 9. Concrete omvang van de pilot

Een beheersbare eerste import bestaat uit:

- 2 actuele wetten;
- 9 kernstukken uit dossier 36 067;
- 3 kernstukken uit dossier 36 578;
- 4 keten-/inwerkingtredingsreferenties, waarvan alleen relevante toelichtingen doorzoekbaar
  zijn;
- 4 tot 6 aangenomen Wtp-amendementen die aansluiten op de eerste evaluatievragen.

Dat is circa **22 tot 24 bronobjecten**. Daarna kunnen de overige aangenomen Wtp-amendementen
en lagere regelgeving gecontroleerd worden toegevoegd.

## 10. Controles vóór import

- Controleer dat de actuele XML/API-export van wetten.overheid.nl de gewenste artikelen,
  opschriften, geldigheidsdatum en permanente identifiers bevat.
- Controleer per amendement de laatste gewijzigde/vervangende versie en de status aan de
  hand van de officiële stemmings- en eindstukken.
- Controleer of een gemengd document passages over de Pensioenwet en Wvb betrouwbaar kan
  labelen of logisch kan splitsen.
- Controleer dat `kst-*`-publicaties ondanks het officiële domein altijd als informatief
  worden geclassificeerd.
- Leg bij ieder geïmporteerd document vast waarom het in de pilot zit; zo blijft de selectie
  later beheersbaar.
