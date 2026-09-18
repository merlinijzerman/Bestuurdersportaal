# #403 — technische voorbereiding Microsoft Search (zonder permissionwijziging)

Status: **technisch voorbereid; live Microsoft Search bewust nog niet uitgevoerd**
Datum: 18 september 2026
Basis: `origin/preview` na #399

## Harde grens van deze tranche

Deze wijziging past geen Entra-appregistratie, OAuth-scope, tenantconsent,
SharePoint-permission, fondsconfiguratie of Preview-flag aan. Er is geen live
Microsoft Search-call uitgevoerd. De bestaande delegated verbinding blijft
ongewijzigd.

Microsoft beschrijft `POST /v1.0/search/query` met `driveItem` als de zoekingang
voor SharePoint- en OneDrive-inhoud. Path-scoping beperkt de kandidaatquery,
maar is geen autorisatiebewijs. Het concrete DriveItem blijft daarom na iedere
hit de verificatie- en inhoudslaag:

- [Microsoft Search voor OneDrive en SharePoint](https://learn.microsoft.com/en-us/graph/search-concept-files)
- [DriveItem opnieuw lezen](https://learn.microsoft.com/en-us/graph/api/driveitem-get?view=graph-rest-1.0)
- [DriveItem-inhoud downloaden](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0)

## Technisch gereed

- `microsoft_search` gebruikt een server-side `queryTemplate` met de opnieuw
  gelezen, geregistreerde root-URL. Quotes, haakjes en KQL-syntaxis worden uit
  vrije querytekst verwijderd; de gereserveerde operatorwoorden `AND`, `OR`,
  `NOT`, `NEAR`, `ONEAR` en `XRANK` worden geneutraliseerd. De invoer kan de
  vaste `path`-expressie daardoor niet wijzigen.
- De vaste scenario's leveren maximaal twee providerneutrale queryvarianten.
  De browser kan vragen, varianten, paden of Graph-identifiers niet invullen.
- `summary` en highlights uit Microsoft Search worden niet opgeslagen en nooit
  als passage, context of citaat gebruikt.
- Iedere gemapte Search-hit doorloopt: lokale fonds-/bronmapping, actuele
  DriveItem-binding, rootcontrole, eerste eTag/cTag, begrensde in-memory
  download/extractie, tweede DriveItem- en versiecontrole, configherlezing en
  previewbewijs.
- `candidate_union` verenigt DriveItem Search en Microsoft Search uitsluitend
  als meetarm, ontdubbelt vóór download en rangschikt deterministisch met RRF.
- De veilige meetprojectie bevat exacte-bronsetstatus, recall,
  kandidaatprecision vóór verificatie, MRR, nDCG,
  locator-/versie-/previewdekking, verificatiekandidaten, downloads, calls,
  bytes, retries, throttles en geaggregeerde afwijstellingen. Voor `precision`
  is de noemer `kandidatenVoorVerificatie`, niet de uiteindelijke bronset.
- De Preview-boundary blijft ongewijzigd: geen import vanuit chat, zoeken,
  vergelijken, retrievalorkestratie of AI-gateway; geen productiewiring.

## Hermetisch bewijs

De tests bewijzen zonder netwerk of Microsoft-account onder meer:

1. een aanvallende query kan het server-side KQL-pad niet wijzigen;
2. Search-summarytekst bereikt geen passage;
3. de meetunie ontdubbelt vóór downloads en verifieert ieder item één keer;
4. root-, drive-, mapping-, actor-, tenant-, rechten-, config- en versieafwijking
   vallen gesloten af;
5. timeout/cancellation start geen nieuwe call of fallback;
6. meetuitvoer bevat geen token, vraag, passage, lokale ref of private
   site-/drive-/itemidentifier;
7. een meting is alleen groen bij exacte gelijkheid met de verwachte bronset.

## Poorten vóór een live run

### 1. Indexgereedheid

Leg een read-only meetmoment vast waarop S02, S03, S04 en S04H per fixture op
bestandsnaam én unieke inhoudsterm vindbaar zijn. Alleen een bestandsnaamtreffer
wordt `index_niet_gereed`; trek daaruit geen adapter- of rechtenconclusie.

### 2. Afzonderlijk consentbesluit

Vul vóór de eerste live Microsoft Search-call een gereviewd besluit in met:

- de API-route en bijbehorende scope afzonderlijk: DriveItem Search noemt
  delegated `Files.Read` als minst geprivilegieerd, terwijl Microsoft Search
  voor bestanden via `POST /search/query` `Files.Read.All` of `Sites.Read.All`
  noemt;
- gekozen minimaal noodzakelijke delegated scope voor de te beproeven route;
- testidentiteit en bewijs dat deze functioneel alleen de PGB-testsite kan lezen;
- tenant en appregistratie waarop het besluit ziet;
- start- en eindmoment van de proef;
- verantwoordelijke actor voor verlening en intrekking;
- verificatie dat na intrekking de oorspronkelijke scopes exact zijn hersteld.

Een 401/403 tijdens de run is een stopresultaat. De runner verruimt nooit zelf
een scope en valt niet automatisch terug naar een andere provider.

Bronnen: [DriveItem Search-permissions](https://learn.microsoft.com/en-us/graph/api/driveitem-search?view=graph-rest-1.0) en [Microsoft Search-permissions](https://learn.microsoft.com/en-us/graph/api/search-query?view=graph-rest-1.0).

### 3. Tijdelijke Preview-flag

Zet de bestaande PGB-spikeflag alleen geauditeerd voor de meetreeks aan en
direct erna terug op `false`. Controleer de effectieve waarde vóór en na iedere
reeks. De code in deze branch wijzigt die waarde niet.

## Voorziene live reeks

1. S00 (bestaand, inhoudsloos) en indexgereedheidsbewijs.
2. Eén diagnostische DriveItem-ronde: S02, S03, S04, S04H.
3. Na expliciet consent: twee rondes × vier scenario's × drie strategieën =
   24 vergelijkingsmetingen.
4. Alleen bij exacte bronsets: S08, S09 en S08R.
5. Flag uit, auditprojectie controleren en consent terugbrengen/intrekken zoals
   vooraf besloten.

## Beslismatrix na live bewijs

| Optie | Minimale go-grens | Huidige status |
|---|---|---|
| Microsoft Search + DriveItem-verificatie | Alle vier bronsets exact; beter of gelijk op recall/rank binnen aanvaardbare calls, bytes en p95 | Nog te meten |
| DriveItem Search behouden | Microsoft Search verbetert kwaliteit niet aantoonbaar of permission-/kostenprofiel is niet proportioneel | Nog te meten |
| Azure AI Search-spike | Beide live routes halen de vaste bronsets niet reproduceerbaar na bewezen indexgereedheid | Nog te meten |

Er is in deze technische voorbereiding bewust nog geen voorkeursroute gekozen.
