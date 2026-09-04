# 0209 — SharePoint read-only (fase 3): `Sites.Selected`, per-gebruiker delegatie en server-geregistreerde kandidaatsites

- **Status:** Geaccepteerd (deel A gebouwd; scopedekking wordt in de eerste PGB-smoke empirisch bevestigd)
- **Datum:** 2026-09-04
- **Betrokkenen:** Merlin (opdrachtgever/productowner), Claude (onderzoek en uitwerking, issue #321)

## Context

Besluit 0208 maakt SharePoint binnen de Microsoftvariant de bron voor vergaderstukken. Fase 3 (#321) moet een fondsbeheerder één begrensde SharePoint-site, documentbibliotheek of map read-only laten koppelen, zodat bestuurders toegestane documenten in het archief zien en in de browser previewen zonder bestandskopie, tekstextractie, chunks of embeddings in Supabase. Het ticket eist least privilege en vraagt om vóór implementatie vast te leggen of delegated `Sites.Selected` alle benodigde list-, metadata- en previewcalls dekt.

Randvoorwaarden: fonds, gebruiker en tenant komen uitsluitend uit sessie en private vault; de actuele Microsoftrechten van de gebruiker gelden bij iedere request; externe identifiers en preview-URL's zijn niet browserleesbaar; geen application permissions, geen schrijfrechten, geen tenantbrede crawler.

## Besluit

1. **Scope.** Fase 3 gebruikt uitsluitend delegated `Sites.Selected`, incrementeel toegevoegd aan de fase-1-koppeling. `Files.Read`, `Files.Read.All` en `Sites.Read.All` zijn geen stil alternatief: alleen na een expliciet besluit van de opdrachtgever tijdens de smoke, met gedocumenteerde reden en securityreview, in die volgorde van oplopende breedte.
2. **Per-gebruiker delegatie.** Iedere fondsgebruiker verleent zijn eigen SharePoint-toestemming; lijst en preview lopen met het token van de gebruiker zelf. Alleen fondsbeheer (`fonds.config.manage`) kiest, controleert of ontkoppelt de bron. Een incrementele consent vraagt de unie van al verleende en nieuwe scopes, omdat de vault de scopes van een verbinding bij elke consent vervangt.
3. **Kandidaatsites server-side.** Onder `Sites.Selected` bestaat geen site-enumeratie en de site-grant wordt buiten het portaal door een SharePoint-beheerder verleend. Kandidaatsites (hostnaam plus serverrelatief pad) worden daarom per runbook in `microsoft_private.sharepoint_kandidaatsites` geregistreerd; het portaal heeft bewust geen schrijffunctie voor kandidaten en kan zichzelf geen sites toewijzen. De beheerder kiest uitsluitend uit kandidaten die de server met zijn eigen token zojuist heeft geverifieerd, daarna uit de drives van die site en de mappen daaronder; de POST valideert de hele keten opnieuw.
4. **Referentieregister, geen autorisatiebron.** De gekozen bron en (in deel B) de documentreferenties leven in `microsoft_private` achter de bestaande `microsoft_vault`-rol. Het register vertaalt lokale uuid's naar externe id's; toegang wordt altijd live via Graph met het token van de gebruiker bepaald.
5. **Preview als tijdelijk toegangsbewijs (deel B).** De preview-URL wordt per verzoek opgehaald na een nieuwe server-side controle op fonds, bron, gebruiker en mapketen, alleen in een `no-store`-JSON-respons aan de browser gegeven, nooit opgeslagen, gelogd of geaudit, en getoond op een aparte pagina met een pad-specifieke CSP.

## Onderzoeksresultaat scopedekking (Graph-documentatie, 2026-09-04)

- Het overzicht *Selected permissions* stelt dat alle Selected-scopes delegated én application ondersteunen, en dat delegated toegang de doorsnede is van de app-grant en de eigen rechten van de gebruiker.
- De permissietabellen van `GET /sites/{id}`, `GET /sites/{id}/drives`, `GET /drives/{id}/items/{id}`, `GET …/children` en `POST …/preview` noemen `Sites.Selected` **niet**; least privileged delegated is daar `Files.Read` (site ophalen: `Sites.Read.All`).
- Conclusie: bouwen op `Sites.Selected`; de eerste PGB-smoke verifieert per call (site, drives, root, children, in deel B delta en preview) of de scope volstaat. Faalt een call, dan is dat een beslismoment voor de opdrachtgever, geen stille terugval.

## Overwogen alternatieven

- **`Files.Read.All` of `Sites.Read.All`** — gedocumenteerd voor alle calls, maar tenantbreed; verworpen als startpunt, alleen als expliciet besluit bereikbaar.
- **Lijst en preview via de verbinding van de beheerder** — eenvoudiger, maar de preview-URL handelt met de rechten van de aanvrager en bestuurders zouden meer zien dan hun eigen SharePointrechten toestaan; verworpen.
- **Vrije invoer van een site-URL door de beheerder** — verworpen: het ticket verbiedt clientinvoer van site-identiteit, en een geregistreerde kandidaat is auditeerbaar.
- **Documentinventaris als autorisatiebron (eenmalig gevuld door beheer)** — verworpen: ingetrokken rechten en per-gebruiker zichtbaarheid vereisen live Graph-toetsing.

## Gevolgen

- **RLS/tenant-isolatie:** nieuwe private tabellen zonder browser- of vaultrechten; vijf `SECURITY DEFINER`-functies alleen voor `microsoft_vault`; fondsbinding van kandidaat en verbinding wordt in de databasefunctie afgedwongen; cross-fonds gedrag zit in `supabase/checks/2026_09_04_microsoft_sharepoint_fase3.sql`.
- **Audit:** wrapper-handelingen `microsoft.sharepoint.*` plus private auditrijen met alleen bron-id, resultaatcategorie en versie; geen site-, drive- of item-id's in audit.
- **Datamodel:** migratie `2026_09_04_microsoft_sharepoint_fase3.sql` (deel A); deel B voegt het documentreferentieregister toe.
- **Beheer/gebruik:** één extra knop voor iedere gebruiker (toestemming) en een bronkiezer voor fondsbeheer op de profielkaart; fondsen zonder de vlag `microsoft_sharepoint_fase3` zien niets.
- **Bewust geaccepteerd:** de scopedekking is tot de smoke een documentair onderbouwde aanname; het `microsoft-connector-contract` pint sinds dit besluit dat alleen `Sites.Selected` als site-scope mag voorkomen.

## Referenties

- Issue #321; besluit 0208; `MICROSOFT-365-PILOT-FASE-0.md`
- `MICROSOFT-365-SHAREPOINT-F3-ONTWERP.md`, `security/MICROSOFT-365-F3-RUNBOOK.md`
- `core/lib/microsoft-sharepoint-graph-core.ts`, `core/lib/microsoft-sharepoint.ts`, `core/lib/microsoft-connector.ts`
- Microsoft Graph: Selected permissions overview; driveItem preview v1.0; driveItem list children v1.0; site post permissions v1.0
