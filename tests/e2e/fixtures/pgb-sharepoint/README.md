# PGB SharePoint retrievalacceptatieset

Deze map bevat het vaste synthetische corpus voor uitvoeringsticket #385 onder #354. De inhoud is bedoeld voor de `PGB Preview-pilot` en bevat geen klantgegevens, persoonsgegevens, geheimen of private Microsoft-identifiers.

## Inhoud

- `manifest.json` is de machineleesbare bron voor fixturecodes, verwachte feiten, locators, rollen en scenario's.
- `rechtenmatrix.md` beschrijft de SharePoint-rechten zonder accounts of object-id's te noemen.
- `bibliotheek/` spiegelt de mappen die rechtstreeks onder de bestaande SharePointmap `PGB` moeten worden geüpload.
- `mutaties/` bevat alleen vervangende inhoud voor scenario S07 en wordt niet als aparte bibliotheekbron geüpload.
- `private-mapping.example.json` is een leeg schema voor de lokale, genegeerde mapping.
- `checksums.sha256` pint de beginstaat van alle upload- en mutatiebestanden.
- `bron/` bevat de leesbare generators van de Office- en PDF-fixtures.

Het uitvoer- en resetproces staat in [`security/MICROSOFT-365-PGB-RETRIEVAL-ACCEPTATIESET.md`](../../../../security/MICROSOFT-365-PGB-RETRIEVAL-ACCEPTATIESET.md).

## Veilig gebruik

Upload uitsluitend de inhoud van `bibliotheek/`. Vul site-, drive-, item- en accountreferenties alleen in `.pgb-sharepoint-fixtures.local.json`, nadat `npm run fixtures:pgb:init` het bestand met modus `0600` heeft aangemaakt. Bewaar meetbewijs uitsluitend in het eveneens lokale `.pgb-sharepoint-bewijs.local.ndjson`.

Controleer de repo-uitvoer met:

```bash
npm run fixtures:pgb:check
npm run fixtures:pgb:local-check
npm run fixtures:pgb:ready
npm run test:e2e:guard
npm run security:secrets
```

`local-check` valideert alleen het schema en de bestandsrechten. `ready` is de harde live-runpoort en slaagt pas nadat de private site-, account-, item- en versievelden lokaal zijn ingevuld.

De generators zijn niet nodig voor een testronde. Gebruik ze alleen om de corpus bewust te herzien; actualiseer daarna de checksums en laat alle visuele controles opnieuw lopen.

> **Let op bij `genereer-docx.py`.** python-docx schrijft een tijdstempel in `docProps`, dus twee runs leveren nooit bit-identieke bytes. Een kale run herschrijft álle Word-fixtures en laat de gepinde hashes van bestanden driften waar inhoudelijk niets aan veranderde. Werk je één fixture bij, gebruik dan het filter en werk daarna uitsluitend de gewijzigde checksumregels bij:
>
> ```bash
> python3 bron/genereer-docx.py --only PGB407
> ```

### Semantische fixtures (#407)

`PGB407-DOC-101` en `PGB407-DOC-102` horen bij de semantische scenario's SEM01 en SEM02 van de Copilot Retrieval-meetarm. Ze wijken bewust af van de #354-opzet:

- de body deelt **geen enkel token** met de vaste vergelijkingsscenario's (S02, S03, S04, S04H, SEM01, SEM02), stopwoorden meegerekend, en bevat die tokens ook niet als deelreeks. Zo kan de lexicale arm hier niet kunstmatig scoren;
- er staat **geen vraagregel** in het document; de metadatatabel met de letterlijke vraag uit `make_simple_doc` is hier niet hergebruikt;
- de canaryterm dient **uitsluitend** als indexgereedheidsprobe en komt in geen enkele scenariovraag of zoekterm voor.

Dit is geen voorspelling dat DriveItem Search of Microsoft Search niets zal vinden — dat bepaalt de live meting. De fixtures sluiten alleen kunstmatige lexicale lekkage uit. `scripts/spike/sharepoint-retrieval/fixturestatus.test.ts` bewaakt alle drie de eigenschappen op de daadwerkelijk gegenereerde DOCX-inhoud.
