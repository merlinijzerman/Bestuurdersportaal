# #407 — Licentie-, kosten- en consentbesluit vóór T3

Status: **BESLISSING GEVRAAGD.** T0, T1 en T2 zijn gebouwd en groen. T3 (de live
PGB-volgorde) is niet gestart en start niet zonder een expliciet akkoord op dit
document. Er is in deze tranche geen permission, consent, billing, featureflag of
live Graph-call aangeraakt.

## 1. Waarom dit besluit nodig is vóór er ook maar één call vertrekt

`POST /v1.0/copilot/retrieval` is geen gewone Graph-route. Hij is gebonden aan een
Microsoft 365 Copilot-rechtenmodel én aan een verbruiksmodel. Bovendien vraagt de
route **twee brede delegated scopes tegelijk** die we vandaag bewust niet hebben.

Een weigering is bewust niet zelf te duiden. De meetarm labelt 401 en 403 daarom
neutraal als `toestemming_geweigerd/copilot_toegang_geweigerd`: dat kan een
ontbrekende licentie zijn, maar net zo goed ontbrekend of ingetrokken consent.
Alleen 402 (Payment Required) krijgt `copilot_licentie_of_billing`, omdat dat wél
eenduidig over betaling gaat. Beide zijn stopresultaten, nooit een aanleiding om
zelf scope of billing te zetten.

De drie beslissingen hieronder zijn niet van elkaar los te knippen: zonder
licentie/verbruik is de scope zinloos, en zonder scope is de licentie zinloos.

## 2. Beslissing A — licentiemodel en kostendrager

Microsoft biedt twee wegen naar dezelfde API.

| | Copilot-add-on per gebruiker | Pay-as-you-go (Preview) |
|---|---|---|
| Vorm | Vaste maandprijs per licentie | Verbruiksafrekening via een Azure-abonnement |
| Wie heeft het nodig | De PGB-testidentiteit | Een gekoppeld Azure-abonnement met kostenplaats |
| Vooraf te regelen | Licentietoewijzing in de tenant | Azure-abonnement, resourcekoppeling, budgetalarm |
| Omkeerbaar | Ja, licentie intrekken | Ja, koppeling verbreken |
| Kostenrisico bij de spike | Vast en vooraf bekend | Variabel; begrensd door onze eigen requestbudgetten |
| Past bij een tijdelijke proef | Matig — een volle maand voor enkele meetrondes | Beter — betaal alleen voor de uitgevoerde metingen |

**Wat de spike zelf al begrenst**, ongeacht de gekozen weg:

* exact één `copilot/retrieval`-request per meting. Het lokale budget staat
  standaard op 1 en begrenst de **feitelijke netwerkpogingen**, backoff-herhalingen
  meegerekend: bij budget 1 is een 429 dus een stopresultaat en géén retry. Een
  aanroeper kan hooguit `COPILOT_LOKAAL_REQUESTBUDGET = 3` vragen, ver onder de
  Microsoft-grens van 200/uur/gebruiker;
* maximaal 25 resultaten per call;
* geen enkele extra call per hit: het locatorregister wordt read-only opgebouwd
  uit de al geregistreerde DriveItems, eenmalig per meting en pas wanneer er een
  hit bínnen de root is;
* de volledige vergelijkingsreeks is 2 rondes × 4 scenario's × 1 Copilot-call = **8 Copilot-calls**,
  plus 8 als de semantische scenario's live meedraaien. De orde van grootte is
  tientallen calls, geen duizenden.

**Wat moet worden vastgesteld vóór T3:**

1. Heeft de afgeschermde PGB-testidentiteit al een Copilot-add-on, of niet?
2. Zo nee: add-on toewijzen, of pay-as-you-go Preview inrichten?
3. Wie is de kostendrager en wie keurt het bedrag goed?
4. Welk budgetplafond en welk alarm gelden tijdens de proef?

Ik heb deze feiten niet en kan ze niet vaststellen zonder in de tenant en de
billingconfiguratie te kijken — precies wat buiten deze tranche valt.

## 3. Beslissing B — brede delegated scopes voor de testidentiteit

Microsoft vereist voor SharePoint-retrieval **delegated `Files.Read.All` én
`Sites.Read.All` samen** — het is geen keuze tussen de twee. Application
permissions worden niet ondersteund. Beide scopes zijn aanzienlijk breder dan wat
het portaal vandaag gebruikt, en ze moeten dus allebei tegelijk worden verleend en
daarna allebei aantoonbaar worden ingetrokken.

Bron: [Copilot Retrieval API](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/ai-services/retrieval/copilotroot-retrieval).

Dat verschilt van de Microsoft Search-route uit #403/#405, waar `Files.Read.All`
**of** `Sites.Read.All` volstond. Het consentverzoek voor deze arm is dus breder
dan het vorige, niet gelijkwaardig eraan.

Voorwaarden waaronder dit aanvaardbaar kan zijn:

1. de grant geldt **uitsluitend** voor de afgeschermde PGB-testidentiteit, nooit
   tenantbreed en nooit voor een echte bestuurder;
2. de grant is **tijdelijk** en hoort bij één afgebakend meetvenster;
3. na de laatste meetronde worden beide grants direct verwijderd en wordt via
   Graph plus de private tokenkluis bewezen dat ze weg zijn;
4. een productievoorstel motiveert afzonderlijk waarom deze breedte aanvaardbaar
   is, of kiest een minder brede route.

Let op de precedent-observatie uit #403/#405: bij Microsoft Search bleven de
nulresultaten gelijk mét tijdelijke brede `Files.Read.All`. Breder consent heeft
daar niets opgelost. Dat is geen bewijs dat het hier ook zo gaat — de Copilot-route
gebruikt een andere index — maar het is wel een reden om vooraf af te spreken
wanneer we stoppen in plaats van verder te verbreden.

## 4. Beslissing C — indexgereedheid en semantische fixtures

Twee harde voorwaarden die uit de bouw naar voren kwamen.

**C-1. Indexgereedheid apart vaststellen.** De Copilot-route leest uit de
lexicale en semantische index, niet uit het bestandssysteem. Een fixture die net
is geüpload kan nog niet geïndexeerd zijn. Een lege basisreeks is dan geen
kwaliteitsoordeel maar een meetfout. Stel indexgereedheid daarom vóór de
vergelijkingsreeks vast, net als bij #403.

**C-2. De semantische fixtures zijn gebouwd; uploaden en indexeren staat nog open.**
Het ticket eist minimaal twee scenario's waarin de relevante passage geen
letterlijke term uit de vraag bevat. De #385-fixtures konden dat niet leveren: de
generator zet daar de canaryterm, de vraag én het antwoordfeit letterlijk in het
document.

`PGB407-DOC-101` en `PGB407-DOC-102` vullen dat gat. Ze staan in het manifest, hun
bytes zijn gepind en drie guards bewaken op de **daadwerkelijk gegenereerde**
DOCX-inhoud dat:

1. de body geen enkel token deelt met de vaste scenarioset (S02, S03, S04, S04H,
   SEM01, SEM02), stopwoorden meegerekend;
2. diezelfde tokens er ook niet als deelreeks in voorkomen — de lexicale
   passagekeuze toetst met `includes()`, dus "geen" zou al op het vraagwoord "een"
   scoren;
3. er nergens een vraagregel in het document staat.

Dat sluit **kunstmatige** lexicale lekkage uit. Het legt uitdrukkelijk niet vooraf
vast dat DriveItem Search of Microsoft Search nul zal vinden: dat bepaalt de live
meting. Exclusieve semantische recallwinst is pas aangetoond wanneer Copilot de
exacte verwachte bron levert en de andere routes dat niet doen.

Wat nog open staat vóór de live meting: de twee bestanden uploaden naar de
PGB-bibliotheek volgens het resetrunbook, en indexgereedheid aantonen op de
canaryterm (`Zandloperbaken 12`, `Nevelanker 30`). Die canaries dienen uitsluitend
daarvoor en komen in geen enkele scenariovraag of zoekterm voor.

Zolang die twee stappen openstaan, kan acceptatiecriterium *"minimaal twee
semantische scenario's tonen aantoonbare recallwinst"* niet worden afgevinkt — ook
niet als alle andere metingen groen zijn.

## 5. Wat ik nodig heb om T3 te starten

1. **Licentie/verbruik:** add-on of pay-as-you-go, met kostendrager en plafond (§2).
2. **Consent:** akkoord voor een tijdelijke, uitsluitend op de PGB-testidentiteit
   gerichte grant van `Files.Read.All` **én** `Sites.Read.All` — beide zijn
   vereist, er valt hier niets te kiezen (§3). Inclusief de afspraak dat beide na
   het meetvenster aantoonbaar worden ingetrokken.
3. **Fixtures:** de twee semantische fixtures zijn gebouwd en gepind. Wat nog
   nodig is: uploaden naar de PGB-bibliotheek en indexgereedheid aantonen op de
   canaryterm (§4, C-2).
4. **Meetvenster:** wanneer de grants aan gaan en wanneer ze aantoonbaar weer weg
   zijn.

Zonder 1 en 2 kan T3 niet draaien. Zonder 3 draait T3 wel, maar levert hij geen
antwoord op de semantische vraag — en juist die vraag is de reden dat #407 naast
#403 bestaat.

## 6. Stopregels die hoe dan ook gelden

Stop vóór mutatiescenario's bij onverwachte inhoud, een hit buiten de root,
ongescopeerde uitvoering, ontbrekend permissionproof, een lege basisreeks,
indexdrift of niet-lokaliseerbare extracts. Zet de flag daarna direct terug op
`false`, verwijder beide brede grants en controleer tokenkluis én Entra-grants.
