# #353 — lokale live SharePoint-retrievalspike

Deze tooling is niet aan chat, zoeken, vergelijken of de AI-gateway gekoppeld. Naast de expliciete lokale CLI bestaat één serverbrug voor de PGB Preview-smoke. Die brug is alleen bereikbaar via `/beheer/microsoft-sharepoint-retrieval` en weigert buiten Vercel Preview, buiten fonds `pgb`, zonder de bestaande Microsoft-/SharePoint-poorten, zonder de extra vlag `microsoft_sharepoint_retrieval_spike=true` of zonder de beheerder-capability. De statische gate `npm run test:spike-boundary` bewaakt dat geen ander productiepad de spike importeert. De lokale CLI blijft `M365_RETRIEVAL_SPIKE=local` eisen en weigert CI, Vercel en productie.

De browser stuurt uitsluitend een vaste scenario-, route- en rondecode. De server kiest de vooraf vastgelegde synthetische vraag en het expliciete `actualiteitsbeleid` uit #385. Scenario S00 voert uitsluitend de vaste inhoudsloze permissionprobe uit. Tokens, passages, lokale refs en private site-/drive-/item-id's verlaten de server niet. De respons bevat alleen categorieën, veilige foutcodes, tellingen, timing, bytes, fixturecodes, korte versiehashes en de vaste platte afwijstellingvelden.

Iedere vaste fixturecode heeft daarnaast een serververtrouwde status `actueel` of `historisch`. Die status wordt uitsluitend met een exacte fixturecode opgezocht, is onderdeel van de bronvingerafdruk en wordt nooit afgeleid uit browserinvoer, pad, titel, bestandsnaam, eTag of cTag. Een onbekende status of meerdere mappings met een conflicterende status vallen fail-closed af voordat een item-, content- of previewcall plaatsvindt.

## Wat de twee routes meten

- `microsoft_search`: `POST /v1.0/search/query`, path-scoped naar de geconfigureerde root. De route gebruikt alleen de security-trimmed summary als passage. Een lege summary is geen kandidaat.
- `drive_search_extract`: één `GET /v1.0/drives/{drive}/items/{root}/search(...)` per vaste, korte server-side zoekterm, stabiel ontdubbeld, daarna voor maximaal de bekende kandidaten een versiegebonden `/content`-download. De volledige natuurlijke vraag wordt niet als DriveItem-query gebruikt. DOCX, digitaal doorzoekbare PDF en PPTX worden alleen in memory verwerkt. De buffer wordt na extractie overschreven en nooit opgeslagen.

Beide routes volgen per kandidaat dezelfde vaste toelatingsvolgorde:

1. actuele bronconfiguratie en lokale fondsreferenties uit de Microsoft-vault;
2. delegated token voor de testgebruiker;
3. zoeken binnen de server-side bron;
4. exacte documentmapping en serververtrouwde fixturestatus;
5. filtering volgens het expliciete `actualiteitsbeleid`;
6. eerste live `driveItem`-controle op binding, root en versie;
7. passagebepaling of contentextractie;
8. tweede live `driveItem`-controle op rechten, binding, root en dezelfde eTag/cTag;
9. actuele herlezing van bronconfiguratie en documentmapping;
10. live previewcheck;
11. laatste configuratieherlezing vóór toelating.

Iedere afgewezen kandidaat telt precies één categorie, bepaald door de eerste mislukte fase in deze volgorde: `mapping`, `actualiteit`, `binding`, `root`, `versie`, `extractie`, `rechten_configuratie` of `preview`. De auditprojectie gebruikt exact de platte velden `afwijzing_mapping`, `afwijzing_binding`, `afwijzing_root`, `afwijzing_rechten_configuratie`, `afwijzing_versie`, `afwijzing_extractie`, `afwijzing_preview` en `afwijzing_actualiteit`; alle waarden zijn niet-negatieve gehele getallen.

Actor-/tenantmismatch, bronconfiguratiedrift, timeout en cancellation zijn fataal voor het hele verzoek en worden nooit door een kandidaatfout ingeslikt. Lokale kandidaatfouten kunnen andere kandidaten niet blokkeren. Intrekking, verwijdering, verplaatsing buiten de bron, versiedrift of onvolledig bewijs laat de betrokken kandidaat fail-closed afvallen. Er is geen fallback naar Supabase of een andere provider.

De contentroute volgt redirects niet automatisch. De eerste Graph-call verwacht exact een `302`, waarna alleen de eigen geconfigureerde SharePoint-host of een Microsoft `*.files.1drv.com`-downloadhost wordt geaccepteerd. De tweede call bevat geen Graph-token en weigert verdere redirects. Microsoft documenteert dat deze tijdelijke URL vooraf geautoriseerd is en geen `Authorization`-header nodig heeft: [Download driveItem content](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0).

## Inhoudsvrije permissionprobe

De permissionprobe heeft geen fixtures of tweede identiteit nodig. Hij valideert fonds, bron, tenant en de exacte private Microsoft-object-id van de uitvoerende gebruiker, en doet daarna uitsluitend één drive/root-search met een vaste onwaarschijnlijke term. Eventuele hits worden genegeerd. De uitvoer bevat alleen `status`, een veilige `foutcode`, `latencyMs` en `microsoftCalls`. In Preview is dezelfde probe als S00 op de beheerpagina beschikbaar.

Kopieer de minimale voorbeeldconfig, vul de bestaande lokale fonds- en gebruiker-id in en zet modus 0600:

```bash
cp scripts/spike/sharepoint-retrieval/permission-probe.example.json .m365-permission-probe.local.json
chmod 600 .m365-permission-probe.local.json
npm run spike:m365-permission-probe -- --config=.m365-permission-probe.local.json
```

Gebruik uitsluitend de reeds verleende `Sites.Selected`-verbinding. Een uitkomst `toestemming_geweigerd` is bewijs om eerst een afzonderlijk consentbesluit voor delegated `Files.Read` voor te leggen, geen toestemming om scopes automatisch te wijzigen.

Voor de Preview-ingang geldt aanvullend het runbook `security/MICROSOFT-365-F5-RETRIEVAL-SMOKE.md`. De extra vlag staat standaard uit en wordt na de meetronde direct weer uitgezet.

## Voorwaarden voor een live run

Issue #354 moet eerst de synthetische PGB-bibliotheek, vragen, rechtenmatrix en lokale refs opleveren. Er is geen consentwijziging in deze spike opgenomen. Begin met de bestaande delegated `Sites.Selected`-verbinding en registreer de werkelijke Graph-uitkomst. Als zoeken 403 geeft, stop: voeg niet zelf `Files.Read`, `Files.Read.All` of `Sites.Read.All` toe. Het spike-rapport beschrijft de beslisroute.

Kopieer `acceptatieset.example.json` naar bijvoorbeeld `.m365-retrieval-acceptatie.local.json`, vul alleen de door #354 vastgestelde waarden in en scherm het bestand af:

```bash
cp scripts/spike/sharepoint-retrieval/acceptatieset.example.json .m365-retrieval-acceptatie.local.json
chmod 600 .m365-retrieval-acceptatie.local.json
```

Laad lokaal dezelfde server-secrets die de bestaande Microsoft-vault en connector nodig hebben. Print ze niet. Start daarna:

```bash
npm run spike:m365-retrieval -- --config=.m365-retrieval-acceptatie.local.json > .m365-retrieval-meting.local.json
```

De uitvoer bevat geen zoekvraag, passage, token, accountgegevens, lokale refs of private site-/drive-/item-id's. Wel opgenomen: fixturecode, resultaatcategorie, recall, locator-, versie- en previewdekking, timing, Graph-callcount, bytes, throttles, retries en een korte SHA-256-vingerafdruk van eTag/cTag.

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

De hermetische suite gebruikt geen netwerk of database en dekt het echte adaptercontract, delegated proofvorm inclusief same-tenant/wrong-OID, handmatige tokenvrije contentredirect, abort-listener-opruiming, de inhoudsvrije permissionprobe, dubbele rechten-/versiecontrole, previewbewijs, echte DOCX-, PPTX- en PDF-extractie, actuele én historische toelating, uitsluiting van historie zonder content- of previewcall, exacte afwijscategorieën, status- en configuratiedrift, throttling, timeout, cancellation, vreemde identifiers, onveilige paginering, move-out, ontbrekende versie en intrekking. De timeout- en cancellationproeven bewijzen bovendien dat daarna geen nieuwe Graph-calls starten.
