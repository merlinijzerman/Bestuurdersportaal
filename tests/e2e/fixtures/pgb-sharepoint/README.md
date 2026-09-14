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
