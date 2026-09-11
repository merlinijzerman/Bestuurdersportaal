# Microsoft 365 — SharePoint fase 3 (read-only en browserpreview)

## Besluit en grens

Fase 3 (#321, besluit 0210) is alleen beschikbaar wanneer het fondsprofiel `microsoft` is, de fase-1-pilotvlag aan staat en de afzonderlijke vlag `microsoft_sharepoint_fase3=true` is gezet. De vlag blijft standaard uit. Graph gebruikt uitsluitend delegated `Sites.Selected` op v1.0; de site-grant wordt buiten het portaal verleend en het portaal kan die alleen toetsen. Fondsen zonder de vlag houden exact hun bestaande UI en gedrag.

Deel A (PR-A, #323) levert toestemming en bronselectie; deel B (PR-B) levert documentenlijst, browserpreview, bibliotheek en CSP.

## Toestemmingsmodel

- Iedere fondsgebruiker verleent zijn eigen SharePoint-toestemming (`profile.manage.own`); de documentenlijst en preview lopen straks met het token van die gebruiker zelf, zodat SharePointrechten leidend blijven en ingetrokken toegang bij de eerstvolgende request faalt.
- Een incrementele consent vraagt de unie van al verleende en nieuwe scopes: de vault vervangt de scopes van een verbinding bij elke consent, en Outlook en SharePoint mogen elkaar niet uitschakelen. De toegestane verzameling is `MICROSOFT_TOEGESTANE_SCOPES`; iedere andere scope wordt vóór en na de OAuth-transactie geweigerd.
- Het stille token wordt per scope aangevraagd (`Sites.Selected`), zonder terugval naar een bredere scope.

## Bronselectie (fondsbeheer)

1. Kandidaatsites (hostnaam en serverrelatief pad) staan in `microsoft_private.sharepoint_kandidaatsites`, per runbook gevuld; er bestaat bewust geen vaultfunctie om kandidaten te schrijven.
2. `GET kandidaten` verifieert elke kandidaat met het token van de beheerder (`GET /sites/{hostnaam}:/{pad}`) en geeft alleen een lokaal kandidaat-id, weergavenaam, hostnaam en toegankelijkheid terug; de site-id blijft server-side. De hostnaam in de Graph-site-id en `webUrl` moet gelijk zijn aan de geregistreerde kandidaat.
3. `GET drives` toont uitsluitend drives met `driveType = documentLibrary` van de geverifieerde site; `GET mappen` toont alleen mappen die aantoonbaar in die drive liggen, met kruimelpad tot een diepte van acht.
4. `POST bron` valideert de hele keten opnieuw: kandidaat → site → drive in de drives-lijst → elke map als kind van de vorige. De databasefunctie bindt de keuze aan een verbinding van hetzelfde fonds met `Sites.Selected` en aan een kandidaat van hetzelfde fonds, en hoogt `configuratieversie` op bij herkeuze.
5. `POST bron/controle` toetst site en rootitem met de actuele rechten en registreert `actief`, `toestemming_nodig` of `fout`; `DELETE bron` ontkoppelt lokaal zonder de rij of audit te verwijderen.

## Adapter-contract

`core/lib/microsoft-sharepoint-graph-core.ts` is puur en testbaar: alleen `https://graph.microsoft.com/v1.0`, `redirect: "error"`, `AbortSignal.timeout` per call (10 s), maximaal twee retries op 429/503/504 met begrensde `Retry-After`, maximaal 5 MiB responsinhoud óók zonder `Content-Length`, plafond op pagina's en items, en een `@odata.nextLink` wordt uitsluitend gevolgd als het pad gelijk is aan de oorspronkelijke opvraag. Fouten worden genormaliseerd naar vaste categorieën (`toestemming_of_token`, `niet_gevonden`, `graph_ratelimit`, `graph_timeout`, `graph_paginering`, `graph_response`, `site_niet_toegankelijk`, `drive_niet_toegankelijk`, `map_niet_toegankelijk`, …). De adapter kent geen `/content`- of `downloadUrl`-pad.

## Database

`microsoft_private.sharepoint_kandidaatsites` en `microsoft_private.sharepoint_bronnen` zijn RLS-on en zonder browser- of vaultrechten; vijf gepinde `SECURITY DEFINER`-functies zijn alleen uitvoerbaar voor `microsoft_vault`. De bron bewaart fonds, kandidaat, verbinding, gebruiker, tenant, site-id en -naam, hostnaam, drive-id en -naam, rootitem, weergavepad, weergavenaam, status, configuratieversie en controlemoment. Externe id's verlaten de server nooit richting browser, behalve drive- en map-id's die de beheerder tijdens de keuze uit een verse serverlijst kiest en die bij de POST opnieuw tegen die lijst worden getoetst.

Forwardmigratie `2026_09_04_microsoft_sharepoint_fase3.sql`, check `supabase/checks/2026_09_04_microsoft_sharepoint_fase3.sql` (structuur plus gedrag: fondsbinding, versie-ophoging, cross-fonds dicht, niet-destructief ontkoppelen), rollback `supabase/rollbacks/2026_09_04_microsoft_sharepoint_fase3_ROLLBACK.sql`.

## Audit en privacy

Wrapper-handelingen: `microsoft.sharepoint.toestemming-uitbreiden`, `bron-kiezen`, `bron-ontkoppelen`, `bron-controleren`. Private audit: `microsoft.sharepoint.bron_gekozen`, `controle.geslaagd|mislukt`, `bron_ontkoppeld`, met alleen bron-id, versie en foutcategorie. Geen tokens, Graph-bodies, site-, drive- of item-id's in audit of logs.

## Deel B — documentenlijst, referentieregister en preview

### Documentenlijst

`GET /api/microsoft/sharepoint/documenten` (`documents.view`) haalt met het token van de ingelogde gebruiker de volledige boom onder het rootitem op via delta-enumeratie (`GET /drives/{driveId}/items/{rootItemId}/delta`), ongeacht diepte, met plafond 5000 items en 30 pagina's en een `afgekapt`-vlag. Werkt delta niet onder de verleende scope, dan volgt automatisch een begrensde recursieve `children`-listing (diepte 10, zelfde plafond); beide zijn read-only metadata-calls. Er wordt nooit een content- of download-URL opgevraagd. Het weergavepad wordt via de ouderketen tot het rootitem herleid; items buiten die keten, verwijderde items en items uit een andere drive vallen af. Alleen bestaande ondersteunde typen (PDF, Word, PowerPoint, Excel) krijgen een Preview-actie; andere typen tonen "Geen preview".

### Referentieregister

`microsoft_private.sharepoint_documenten` vertaalt een lokale uuid naar `(bron, drive, item)` en bewaart naam, type, mime, grootte, gewijzigd, eTag/cTag, oudermap, weergavepad, `webUrl` (alleen `https://*.sharepoint.com`), status en configuratieversie. Eén referentie per `(bron, item)`: rename, move en versie werken de bestaande rij bij. Een read of gelijktijdige write met een oudere configuratieversie of andere drive faalt gesloten. Het register is nooit een autorisatiebron; de opzoeking is fondsgebonden en zichtbaarheid komt uitsluitend uit de live Graph-respons van de gebruiker. Geen bestand, tekst, chunks, embeddings of preview-URL. Deze velden zijn tevens de minimale documentidentiteit en versie voor later bronbewijs (fase 4/5).

### Preview

`POST /api/microsoft/sharepoint/documenten/{ref}/preview` (`documents.view`): fondsgebonden opzoeking van de referentie → eigen token → item opnieuw ophalen (404 markeert `verwijderd`) → rootitem ophalen en controleren dat het item in dezelfde drive én onder het rootpad ligt (anders `ontoegankelijk`, 410) → `POST …/preview` → `getUrl` alleen na hostvalidatie op `https://*.sharepoint.com`. De URL komt uitsluitend in de `no-store`-JSON-respons; niet in register, logs of audit. De private audit-functie weigert details met URL's, tokens of externe id's. Pagina `/bibliotheek/sharepoint/{ref}` zet de URL alleen als iframe-bron (`sandbox="allow-scripts allow-same-origin allow-forms allow-popups"`, `referrerpolicy="no-referrer"`, `allow=""`) en krijgt als enige route een CSP met `frame-src … https://*.sharepoint.com` en `Referrer-Policy: no-referrer` (`next.config.ts`, pad-specifiek na de algemene regel). `frame-ancestors 'none'` blijft overal gelden.

### Bibliotheek

De fonds-tab toont onder de bestaande tabel een aparte kaart met badge "SharePoint", bronnaam, "Vernieuwen", kruimelpad en mapnavigatie (client-side over het weergavepad), per document type, naam, omvang, gewijzigd, Preview en "Openen in Microsoft 365" (`webUrl`, `rel="noopener noreferrer"`). Zonder vlag rendert de kaart niets: de eigen variant blijft byte-voor-byte gelijk. Een ontbrekende consent geeft een begrijpelijke melding met verwijzing naar het profiel.

### Audit

Wrapper-handeling `microsoft.sharepoint.documenten.previewen`; private gebeurtenissen `microsoft.sharepoint.lijst.geslaagd|mislukt` (bron-id, aantallen, afgekapt, latency, correlation-id) en `preview.geslaagd|mislukt` (document-referentie, categorie, latency, correlation-id).
