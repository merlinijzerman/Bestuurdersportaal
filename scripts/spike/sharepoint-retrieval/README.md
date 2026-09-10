# #353 — lokale live SharePoint-retrievalspike

Deze tooling is niet aan chat, zoeken, vergelijken, de AI-gateway of een Next-route gekoppeld. De enige ingang is een expliciete lokale CLI met `M365_RETRIEVAL_SPIKE=local`; CI, Vercel en `NODE_ENV=production` worden geweigerd. De statische gate `npm run test:spike-boundary` bewaakt dat productiecode de spike niet importeert. De prototypefactory implementeert wel het definitieve `RetrievalAdapter`-contract uit gemergde PR #352, zodat de mapping compile-time en hermetisch bewezen is zonder hem te wiren.

## Wat de twee routes meten

- `microsoft_search`: `POST /v1.0/search/query`, path-scoped naar de geconfigureerde root. De route gebruikt alleen de security-trimmed summary als passage. Een lege summary is geen kandidaat.
- `drive_search_extract`: `GET /v1.0/drives/{drive}/items/{root}/search(...)`, daarna voor maximaal de bekende kandidaten een versiegebonden `/content`-download. DOCX, digitaal doorzoekbare PDF en PPTX worden alleen in memory verwerkt. De buffer wordt na extractie overschreven en nooit opgeslagen.

Beide routes volgen dezelfde toelatingsvolgorde:

1. actuele bronconfiguratie en lokale fondsreferenties uit de Microsoft-vault;
2. delegated token voor de testgebruiker;
3. zoeken binnen de server-side bron;
4. eerste live `driveItem`-controle;
5. passagebepaling;
6. tweede live `driveItem`-controle met dezelfde eTag/cTag;
7. actuele herlezing van bronconfiguratie en documentmapping;
8. live previewcheck;
9. laatste configuratieherlezing vóór toelating.

Intrekking, verwijdering, verplaatsing buiten de bron, versiedrift, configuratiedrift, timeout, annulering, throttling of onvolledig bewijs levert nul toegelaten kandidaten op. Er is geen fallback naar Supabase of een andere provider.

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
    "fixtureCode": "PGB-PDF-01",
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

De hermetische suite gebruikt geen netwerk of database en dekt het echte adaptercontract, delegated proofvorm, dubbele rechten-/versiecontrole, previewbewijs, in-memory PPTX-extractie, throttling, timeout, cancellation, vreemde identifiers, onveilige paginering, move-out, ontbrekende versie, intrekking en configuratiedrift.
