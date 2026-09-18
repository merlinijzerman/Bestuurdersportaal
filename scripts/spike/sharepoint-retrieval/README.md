# #353/#403/#407 — lokale live SharePoint-retrievalspike

Deze tooling is niet aan chat, zoeken, vergelijken of de AI-gateway gekoppeld. Naast de expliciete lokale CLI bestaat één serverbrug voor de PGB Preview-smoke. Die brug is alleen bereikbaar via `/beheer/microsoft-sharepoint-retrieval` en weigert buiten Vercel Preview, buiten fonds `pgb`, zonder de bestaande Microsoft-/SharePoint-poorten, zonder de extra vlag `microsoft_sharepoint_retrieval_spike=true` of zonder de beheerder-capability. De statische gate `npm run test:spike-boundary` bewaakt dat geen ander productiepad de spike importeert. De lokale CLI blijft `M365_RETRIEVAL_SPIKE=local` eisen en weigert CI, Vercel en productie.

De browser stuurt uitsluitend een vaste scenario-, route- en rondecode. De server kiest de vooraf vastgelegde synthetische vraag en het expliciete `actualiteitsbeleid` uit #385. Scenario S00 voert uitsluitend de vaste inhoudsloze permissionprobe uit. Tokens, passages, lokale refs en private site-/drive-/item-id's verlaten de server niet. De respons bevat alleen categorieën, veilige foutcodes, tellingen, timing, bytes, fixturecodes, korte versiehashes en de vaste platte afwijstellingvelden.

Iedere vaste fixturecode heeft daarnaast een serververtrouwde status `actueel` of `historisch`. Die status wordt uitsluitend met een exacte fixturecode opgezocht, is onderdeel van de bronvingerafdruk en wordt nooit afgeleid uit browserinvoer, pad, titel, bestandsnaam, eTag of cTag. Een onbekende status of meerdere mappings met een conflicterende status vallen fail-closed af voordat een item-, content- of previewcall plaatsvindt.

## Wat de drie kandidaatstrategieën meten

- `microsoft_search`: één of enkele vaste, server-side varianten via `POST /v1.0/search/query`. De normale meetarm gebruikt KQL-`path:` naar de geconfigureerde root. De beperkte S02-diagnostiek kan daarnaast exact één keer tenantbreed en één keer met de querybare `SiteID`- en `ListID`-properties zoeken. `SiteID` komt uit de serververtrouwde Graph-sitebinding; `ListID` wordt live via de gebonden drive gelezen. Geen van beide komt uit browserinvoer. Quotes, haakjes en andere KQL-syntaxis worden uit de zoektekst verwijderd; de gereserveerde operatorwoorden `AND`, `OR`, `NOT`, `NEAR`, `ONEAR` en `XRANK` worden geneutraliseerd. Daardoor kan de invoer de vaste scope-expressie niet wijzigen. `summary` en highlights worden niet bewaard of gebruikt. Iedere gemapte hit doorloopt daarna dezelfde DriveItem-download en eigen extractie als de Drive-route.
- `drive_search_extract`: één `GET /v1.0/drives/{drive}/items/{root}/search(...)` per vaste, korte server-side zoekterm, stabiel ontdubbeld, daarna voor maximaal de bekende kandidaten een versiegebonden `/content`-download. De volledige natuurlijke vraag wordt niet als DriveItem-query gebruikt. DOCX, digitaal doorzoekbare PDF en PPTX worden alleen in memory verwerkt. De buffer wordt na extractie overschreven en nooit opgeslagen.
- `candidate_union`: uitsluitend een meetarm. Zij verenigt beide kandidaatsets, ontdubbelt vóór downloads op item-id en rangschikt deterministisch met reciprocal-rank fusion. Daarna loopt per uniek item exact één gedeelde verificatie- en extractieketen. Deze route is niet aan productieverkeer gekoppeld.

Alle drie strategieën volgen per kandidaat dezelfde vaste toelatingsvolgorde:

1. actuele bronconfiguratie en lokale fondsreferenties uit de Microsoft-vault;
2. delegated token voor de testgebruiker;
3. zoeken binnen de server-side bron;
4. exacte documentmapping en serververtrouwde fixturestatus;
5. filtering volgens het expliciete `actualiteitsbeleid`;
6. eerste live `driveItem`-controle op binding, root en versie;
7. begrensde download en eigen contentextractie; een Search-summary is nooit bewijs;
8. tweede live `driveItem`-controle op rechten, binding, root en dezelfde eTag/cTag;
9. actuele herlezing van bronconfiguratie en documentmapping;
10. live previewcheck;
11. laatste configuratieherlezing vóór toelating.

Iedere afgewezen kandidaat telt precies één categorie, bepaald door de eerste mislukte fase in deze volgorde: `mapping`, `actualiteit`, `binding`, `root`, `versie`, `extractie`, `rechten_configuratie` of `preview`. De auditprojectie gebruikt exact de platte velden `afwijzing_mapping`, `afwijzing_binding`, `afwijzing_root`, `afwijzing_rechten_configuratie`, `afwijzing_versie`, `afwijzing_extractie`, `afwijzing_preview` en `afwijzing_actualiteit`; alle waarden zijn niet-negatieve gehele getallen.

Actor-/tenantmismatch, bronconfiguratiedrift, timeout en cancellation zijn fataal voor het hele verzoek en worden nooit door een kandidaatfout ingeslikt. Lokale kandidaatfouten kunnen andere kandidaten niet blokkeren. Intrekking, verwijdering, verplaatsing buiten de bron, versiedrift of onvolledig bewijs laat de betrokken kandidaat fail-closed afvallen. Er is geen fallback naar Supabase of een andere provider.

Rootlidmaatschap wordt uitsluitend vastgesteld met de live Graph-`driveId`, de parent-itemreferentie en het canonieke `parentReference.path` ten opzichte van de opnieuw gelezen root. De `webUrl` van een kandidaat is daarvoor geen bewijs: Word en PowerPoint kunnen geldige Office-weergave-URL's met `/:w:/…` en `/:p:/…` teruggeven die niet het documentbibliotheekpad volgen. Ook het veilige relatieve locatorpad wordt daarom uit de parentreferentie opgebouwd. Ontbrekend, conflicterend of buiten de root vallend parentbewijs wijst de kandidaat vóór content of preview af onder `root`.

De contentroute volgt redirects niet automatisch. De eerste Graph-call verwacht exact een `302`, waarna alleen de eigen geconfigureerde SharePoint-host of een Microsoft `*.files.1drv.com`-downloadhost wordt geaccepteerd. De tweede call bevat geen Graph-token en weigert verdere redirects. Microsoft documenteert dat deze tijdelijke URL vooraf geautoriseerd is en geen `Authorization`-header nodig heeft: [Download driveItem content](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0).

## Inhoudsvrije permissionprobe

De permissionprobe heeft geen fixtures of tweede identiteit nodig. Hij valideert fonds, bron, tenant en de exacte private Microsoft-object-id van de uitvoerende gebruiker, en doet daarna uitsluitend één drive/root-search met een vaste onwaarschijnlijke term. Eventuele hits worden genegeerd. De uitvoer bevat alleen `status`, een veilige `foutcode`, `latencyMs` en `microsoftCalls`. In Preview is dezelfde probe als S00 op de beheerpagina beschikbaar.

Kopieer de minimale voorbeeldconfig, vul de bestaande lokale fonds- en gebruiker-id in en zet modus 0600:

```bash
cp scripts/spike/sharepoint-retrieval/permission-probe.example.json .m365-permission-probe.local.json
chmod 600 .m365-permission-probe.local.json
npm run spike:m365-permission-probe -- --config=.m365-permission-probe.local.json
```

Gebruik uitsluitend de reeds verleende verbinding; deze branch wijzigt geen scope of consent. Houd de twee API-routes in het consentbesluit uit elkaar:

- DriveItem Search (`GET .../search(q=...)`) noemt delegated `Files.Read` als minst geprivilegieerde toestemming: [Search for DriveItems within a drive](https://learn.microsoft.com/en-us/graph/api/driveitem-search?view=graph-rest-1.0).
- Microsoft Search voor bestanden (`POST /search/query`) noemt `Files.Read.All` of `Sites.Read.All`; `Files.Read` dekt die route dus niet: [searchEntity: query](https://learn.microsoft.com/en-us/graph/api/search-query?view=graph-rest-1.0).

Een uitkomst `toestemming_geweigerd` is alleen bewijs om het afzonderlijke consentbesluit te openen, nooit toestemming om een van deze scopes automatisch toe te voegen.

Voor de Preview-ingang geldt aanvullend het runbook `security/MICROSOFT-365-F5-RETRIEVAL-SMOKE.md`. De extra vlag staat standaard uit en wordt na de meetronde direct weer uitgezet.

## Voorwaarden voor een live run

Issue #354 moet eerst de synthetische PGB-bibliotheek, vragen, rechtenmatrix en lokale refs opleveren. Er is geen consentwijziging in deze spike opgenomen. Begin met de bestaande delegated verbinding en registreer de werkelijke Graph-uitkomst. Als zoeken 403 geeft, stop: voeg niet zelf `Files.Read`, `Files.Read.All` of `Sites.Read.All` toe. Beoordeel een eventueel consentverzoek per API-route zoals hierboven; het spike-rapport beschrijft de beslisroute.

Kopieer `acceptatieset.example.json` naar bijvoorbeeld `.m365-retrieval-acceptatie.local.json`, vul alleen de door #354 vastgestelde waarden in en scherm het bestand af:

```bash
cp scripts/spike/sharepoint-retrieval/acceptatieset.example.json .m365-retrieval-acceptatie.local.json
chmod 600 .m365-retrieval-acceptatie.local.json
```

Laad lokaal dezelfde server-secrets die de bestaande Microsoft-vault en connector nodig hebben. Print ze niet. Start daarna:

```bash
npm run spike:m365-retrieval -- --config=.m365-retrieval-acceptatie.local.json > .m365-retrieval-meting.local.json
```

De uitvoer bevat geen zoekvraag, passage, token, accountgegevens, lokale refs of private site-/drive-/item-id's. Wel opgenomen: fixturecode, exacte-bronsetstatus, recall, kandidaatprecision vóór verificatie, MRR, nDCG, locator-, versie- en previewdekking, aantal verificatiekandidaten, downloads, timing, Graph-callcount, bytes, throttles, retries en een korte SHA-256-vingerafdruk van eTag/cTag. Voor `precision` is de noemer `kandidatenVoorVerificatie`, niet de uiteindelijke toegelaten bronset. Een positieve meting is alleen `geslaagd` wanneer de gevonden fixturecodes exact gelijk zijn aan de vooraf vastgelegde bronset; een ontbrekende of extra fixture wordt `acceptatie_afwijking/onverwachte_bronset`.

## #407 — Copilot Retrieval als vierde meetarm

`scripts/spike/sharepoint-retrieval/copilot-retrieval.ts` voegt een vierde arm toe:
`POST https://graph.microsoft.com/v1.0/copilot/retrieval` met `dataSource = sharePoint`.
Deze arm heeft **geen serverbrug**. Hij is uitsluitend bereikbaar via de lokale CLI en de
hermetische tests; de beheerpagina, de Preview-smoke en elk ander productiepad kennen hem
niet, en de boundarygate faalt zodra dat verandert.

Vaste grenzen, alle server-side afgedwongen vóór de netwerkcall:

- alleen het v1.0-endpoint; geen beta;
- **beide** delegated scopes zijn vereist — `Files.Read.All` **én**
  `Sites.Read.All` samen, niet één van beide. Dat is breder dan de
  Microsoft Search-route uit #403/#405, waar één van de twee volstond:
  [Copilot Retrieval API](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/ai-services/retrieval/copilotroot-retrieval);
- `dataSource` staat vast op `sharePoint`; één databron per call, geen interleaving en geen
  fallback naar een andere arm wanneer de route leeg of onbeschikbaar is;
- `queryString` is één begrensde zin van maximaal 1.500 tekens, zonder stuurtekens;
- `maximumNumberOfResults` is expliciet en wordt hard op 25 geclampt;
- de `filterExpression` wordt volledig uit de opnieuw gelezen root opgebouwd. Hij wordt
  getoetst op de **gedecodeerde** betekenis, niet alleen op de vorm: `new URL()` codeert een
  aanhalingsteken stilzwijgend tot `%22`, wat aan de Microsoft-kant alsnog als quote kan
  worden gelezen. Een pad met quote, backslash, wildcard, `%`, `#`, `?` of stuurteken wordt
  geweigerd, waarna de scope opnieuw wordt gecodeerd vanuit de gecontroleerde vorm. Faalt de
  toets, dan vertrekt er **geen** call;
- een eigen lokaal requestbudget bovenop de Microsoft-grens van 200 requests per gebruiker
  per uur. Dat budget begrenst de **feitelijke netwerkpogingen**, backoff-herhalingen
  meegerekend: de standaard is 1, dus er vertrekt precies één request en een 429 is een
  stopresultaat in plaats van een retry. Een aanroeper mag hooguit 3 vragen.

### Waarom een Copilot-extract geen bewijs is

De Retrieval API levert per hit een `webUrl` en `extracts` — geen DriveItem-id. De arm
behandelt beide als onbetrouwbaar kandidaatsignaal en bewijst alles zelf:

1. **locator-prefilter** — de hit-URL moet op de geconfigureerde host staan én binnen het pad
   van de opnieuw gelezen root vallen. Alles daarbuiten valt af onder `root`, vóór élke
   vervolgstap: geen registeropbouw, geen download, geen preview;
2. **exacte match tegen het read-only locatorregister** — zie hieronder. Geen match is
   `mapping`, en daar komt geen enkele netwerkcall aan te pas;
3. **de bestaande, ongewijzigde keten** — actualiteitsbeleid, eerste bindings- en
   rootcontrole, begrensde in-memory download met eigen extractie, tweede rechten-/binding-/
   versiecontrole op dezelfde eTag/cTag, configherlezing en previewbewijs;
4. **extractlokalisatie** — het Microsoft-extract wordt genormaliseerd (Unicode, witruimte,
   typografische aanhalingstekens en streepjes) en moet **precies één keer** in onze eigen,
   zojuist uitgelezen tekst voorkomen. Ontbrekend, te kort, gewijzigd of meervoudig
   voorkomend: fail-closed onder de negende categorie `lokalisatie`.

### Het locatorregister is read-only, en de richting is omgedraaid

`POST /v1.0/copilot/retrieval` levert per hit een `webUrl` en `extracts` — geen
DriveItem-id. De voor de hand liggende oplossing, `GET /shares/{token}/driveItem`, is
**bewust verworpen**: Microsoft noemt daarvoor minimaal delegated `Files.ReadWrite`
([shares: get](https://learn.microsoft.com/en-us/graph/api/shares-get?view=graph-rest-1.0)),
en deze spike mag geen schrijfrecht nodig hebben.

In plaats daarvan lezen we de items die al in het private fixture-register staan op hun
vertrouwde item-id — een gewone `GET /drives/{drive}/items/{item}`, die met
`Files.Read.All`/`Sites.Read.All` volstaat — en gebruiken we de door Graph zelf geleverde
`webUrl` van elk item als sleutel. Een hit mag daar alleen **exact** op matchen, na
canonicalisatie van host, codering en trailing slash.

Daarmee bepalen wíj welke URL's bestaan. Een URL die wij niet zelf hebben opgehaald,
bestaat voor deze arm niet. Het register wordt eenmalig per meting opgebouwd en pas
wanneer er een hit binnen de root is, dus een 401/402/403/429 of timeout kost geen enkele
item-read.

Bekende beperking, bewust geaccepteerd: Word- en PowerPoint-weergave-URL's (`/:w:/…`,
`/:p:/…`) volgen het bibliotheekpad niet en matchen dus niet. Ze vallen fail-closed af
onder `mapping`. De teller laat dat zien; het is geen stille afwijzing.

De passage die de arm oplevert komt altijd uit de eigen extractie, nooit uit de
Microsoft-tekst. `lokalisatie` staat bewust naast `extractie`, zodat het rapport onderscheid
maakt tussen "wij konden de tekst niet lezen" en "Microsoft bood iets aan dat niet in de
actuele inhoud staat". Die negende categorie leeft alleen in de spike; de auditprojectie van
de Preview-brug houdt exact de acht vaste platte `afwijzing_*`-velden.

### De vergelijking (T2)

`vergelijking.ts` draait vier armen op dezelfde vaste scenario's uit
`vergelijking-scenarios.ts`: `drive_search_extract`, `microsoft_search`, `copilot_retrieval`
en `candidate_union`. Die laatste is uitdrukkelijk **geen** vierde strategie maar een
meetarm: zij verenigt centraal de kandidaatsets die de drie primaire armen al volledig
fail-closed hebben geverifieerd, ontdubbelt op fixturecode en rangschikt deterministisch met
reciprocal-rank fusion. De unie doet zelf geen enkele Graph-call; haar latency, calls,
downloads en bytes zijn de som van de bijdragende armen.

Gemeten worden: exacte bronset, recall, kandidaatprecision vóór verificatie, MRR, nDCG,
locator-, passage-, versie-, preview- en extractlokalisatiedekking, actualiteitscorrectheid,
mediaan/p95-latency, Graph-calls, downloads, bytes, throttles, retries en het afval per
controle — inclusief `lokalisatie`.

**Semantische winst** telt alleen zonder bronsetvervuiling: `bronsetvervuiling` telt de
semantische runs waarin een arm iets toeliet dat niet exact de vooraf vastgelegde bronset
was. Staat die teller niet op 0, dan is de winst voor het besluit waardeloos.

> **Voorwaarde voor een live semantische meting.** De #385-fixtures zijn volledig rond unieke
> canary-termen gebouwd; er staat geen parafrase- of synoniemtekst in. SEM01 en SEM02 zijn
> daarom nu uitsluitend hermetisch meetbaar. Live meten vereist eerst twee nieuwe synthetische
> fixtures (`PGB407-DOC-101`, `PGB407-DOC-102`) in het manifest én in SharePoint. Zie
> `COPILOT-RETRIEVAL-407-LICENTIE-EN-CONSENT.md` §4.

Let ook op: de eigen passagekeuze van de lexicale armen is puur lexicaal. Bij een semantische
vraag scoort elk segment 0 en valt de kandidaat af onder `extractie`. Dat is geen defect maar
precies het verschil dat #407 meet.

### Draaien

```bash
cp scripts/spike/sharepoint-retrieval/vergelijking.example.json .m365-copilot-vergelijking.local.json
chmod 600 .m365-copilot-vergelijking.local.json
npm run spike:m365-copilot-vergelijking -- --config=.m365-copilot-vergelijking.local.json > .m365-copilot-vergelijking.local.result.json
```

Dezelfde harde grendel als de #353-runner: `M365_RETRIEVAL_SPIKE=local`, en weigeren in CI,
Vercel en productie. De uitvoer bevat geen vraag, passage, extract, token, lokale ref of
private site-/drive-/item-id.

**Een live run mag pas na het expliciete licentie-, kosten- en consentbesluit.** Een
weigering is niet zelf te duiden: 401 en 403 krijgen daarom de neutrale code
`toestemming_geweigerd/copilot_toegang_geweigerd` — het kan een ontbrekende licentie zijn,
maar net zo goed ontbrekend of ingetrokken consent. Alleen 402 (Payment Required) krijgt
`copilot_licentie_of_billing`. Beide zijn stopresultaten, nooit een aanleiding om zelf
scope of billing te zetten.

## Permission- en live-rungrens van #403

Deze branch wijzigt geen Entra-appregistratie, OAuth-scope, tenantconsent of SharePoint-permission. De hermetische tests bewijzen de volledige route zonder netwerk. Een live `microsoft_search`- of `candidate_union`-run blijft geblokkeerd totdat afzonderlijk en expliciet is besloten welke minimaal noodzakelijke delegated scope wordt verleend. Een 401/403 is een stopresultaat, geen aanleiding voor automatische scopeverbreding. Na een eventuele proef moet hetzelfde consentbesluit ook het intrekkings- of terugbrengpad vastleggen.

De S02-scopevergelijking is diagnostiek, geen vierde productiestrategie. Zij voert in vaste volgorde `tenant`, `site_list` en `path` uit. Tenantbrede hits die niet in het private fixture-register staan, tellen alleen als `mapping`-afwijzing en veroorzaken geen DriveItem-, content- of previewcall. Daardoor kan de vergelijking blootleggen waar de kandidaat verdwijnt zonder tenantbrede inhoud op te halen of aan de browser te tonen.

Vóór de live kwaliteitsvergelijking wordt indexgereedheid los vastgesteld: iedere fixture moet zowel op bestandsnaam als op de unieke inhoudsterm vindbaar zijn. Alleen bestandsnaamtreffers gelden als `index_niet_gereed`; zij tellen niet als adapter- of rechtenfout. De 24 vergelijkingsmetingen starten pas na een vastgelegd gereed indexmoment en bestaan uit S02, S03, S04 en S04H, twee rondes, over alle drie kandidaatstrategieën.

## Intrekking of configuratiewijziging tijdens een verzoek

Voeg voor één afzonderlijke run tijdelijk een `pauze` toe aan de lokale config:

```json
{
  "pauze": {
    "fase": "voor_laatste_rechtencheck",
    "fixtureCode": "PGB354-DOC-005",
    "instructie": "Trek nu in SharePoint alleen de testtoegang tot deze fixture in; bevestig daarna met Enter."
  }
}
```

De runner pauzeert één keer en noemt alleen de fixturecode. Na Enter moet de uitkomst `toestemming_geweigerd`, `buiten_scope` of `configuratiefout` zijn en moeten `gevondenFixtures` leeg blijven. Herstel de rechten of bronconfiguratie uitsluitend volgens het reset-runbook van #354. Herhaal voor `voor_toelating` om de laatste configherlezing te bewijzen.

## Verificatie

```bash
npm run test:spike:m365-retrieval
npm run typecheck
npm run security:secrets
```

`test:spike:m365-retrieval` draait sinds #407 zowel `prototype.test.ts` als
`copilot-retrieval.test.ts`, gevolgd door de boundarygate.

De hermetische suite gebruikt geen netwerk of database en dekt het echte adaptercontract, delegated proofvorm inclusief same-tenant/wrong-OID, handmatige tokenvrije contentredirect, abort-listener-opruiming, de inhoudsvrije permissionprobe, dubbele rechten-/versiecontrole, previewbewijs, echte DOCX-, PPTX- en PDF-extractie, actuele én historische toelating, uitsluiting van historie zonder content- of previewcall, exacte afwijscategorieën, status- en configuratiedrift, throttling, timeout, cancellation, vreemde identifiers, onveilige paginering, move-out, ontbrekende versie en intrekking. De timeout- en cancellationproeven bewijzen bovendien dat daarna geen nieuwe Graph-calls starten.
