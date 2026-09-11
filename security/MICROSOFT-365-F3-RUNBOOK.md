# Microsoft 365 — SharePoint fase 3 Preview-runbook

> Deel A (bronregistratie, PR-A) en deel B (documentenlijst, browserpreview, bibliotheek,
> CSP, PR-B) van #321. Vereist een geslaagde fase-1-smoke (`MICROSOFT-365-F1-RUNBOOK.md`);
> fase 2A hoeft niet actief te zijn.

## Vooraf

0. Breng de featurebranch via PR naar `preview` en controleer de `preview-stable`-build. De databasewijziging is additief; de fase-3-vlag blijft standaard uit.
1. **Entra:** voeg aan de bestaande single-tenant app uitsluitend delegated `Sites.Selected` toe en verleen daarvoor admin consent voor onze eigen tenant. Voeg géén `Files.*`, `Sites.Read.All`, application permissions of schrijfrechten toe. De portaalcode weigert elke andere site-scope (`microsoft-connector-contract`).
2. **Site-grant (buiten het portaal):** een SharePoint-beheerder verleent de app de rol `read` op precies de testsite. Via Graph vereist dit `Sites.FullControl.All` van de aanroeper:

   ```http
   POST https://graph.microsoft.com/v1.0/sites/{siteId}/permissions
   { "roles": ["read"], "grantedToIdentities": [{ "application": { "id": "<MICROSOFT_CLIENT_ID>", "displayName": "<app-naam>" } }] }
   ```

   Gelijkwaardig via PnP PowerShell: `Grant-PnPAzureADAppSitePermission -AppId <clientId> -DisplayName <app-naam> -Site <site-url> -Permissions Read`. Het portaal kan deze grant alleen toetsen door de site op te vragen; het kan zichzelf geen ruimere toegang geven.
3. Pas de migraties `2026_09_04_microsoft_sharepoint_fase3.sql` en `2026_09_04_microsoft_sharepoint_fase3b_documenten.sql` toe en voer daarna beide checks (`…_fase3.sql`, `…_fase3b_documenten.sql`) uit als database-eigenaar. Verifieer dat `microsoft_vault` precies de vijf plus vier SharePoint-functies mag uitvoeren, geen tabelrechten heeft en dat er geen kandidaat-schrijffunctie bestaat.
4. **Kandidaatsite registreren (alleen PGB):** controleer eerst de doelrij en registreer daarna id-gebonden, als database-eigenaar, buiten de browser:

   ```sql
   select f.id, f.slug, i.integratieprofiel, i.microsoft_koppeling_pilot
   from public.fondsen f join public.fonds_integratie_profielen i on i.fonds_id = f.id
   where f.slug = 'pgb';

   insert into microsoft_private.sharepoint_kandidaatsites (fonds_id, hostnaam, server_relatief_pad, weergavenaam)
   values ('<gecontroleerde-pgb-fonds-id>', '<tenant>.sharepoint.com', '/sites/<testsite>', 'PGB testsite')
   returning id, hostnaam, server_relatief_pad;
   ```

   Hostnaam is kleine letters en eindigt op `.sharepoint.com`; het pad begint met `/` en bevat geen `//` of `..`. Een kandidaat uitschakelen: `update … set actief = false`.
5. **Vlag:** zet uitsluitend voor de gecontroleerde PGB-rij `integratieprofiel = 'microsoft'` (zoals bij 2A) en `fonds_feature_flags` `microsoft_sharepoint_fase3` op JSON-boolean `true`. Leg de wijziging buiten de browser vast. Rollback: eerst de vlag uit, daarna bron ontkoppelen, daarna zo nodig de rollback-SQL.

## Smoke deel A (PGB, synthetische site)

1. Laat een fondsbeheerder op de PGB-previewhost **SharePoint-toestemming verlenen**. Controleer in Entra dat alleen `Sites.Selected` bijkomt en dat een al verleende `Calendars.Read.Shared` behouden blijft (de consent vraagt de unie).
2. **Scopeverificatie (beslismoment besluit 0210).** Kies **Bron kiezen** en noteer per stap of de call slaagt onder `Sites.Selected`:

   | Stap | Graph-call | Uitkomst |
   |---|---|---|
   | Kandidaat verifiëren | `GET /sites/{hostnaam}:/{pad}` | |
   | Bibliotheken | `GET /sites/{siteId}/drives` | |
   | Rootitem | `GET /drives/{driveId}/root` | |
   | Mappen | `GET /drives/{driveId}/items/{id}/children` | |

   Een 403 op een stap verschijnt als `toestemming_of_token` of `site_niet_toegankelijk` bij de kandidaat. Val niet stil terug op een bredere scope: leg de uitkomst vast en leg het besluit (`Files.Read`, daarna pas `Sites.Read.All`) aan de opdrachtgever voor.
3. Kies bibliotheek en een map, bevestig. Controleer in `microsoft_private.sharepoint_bronnen` dat fonds, verbinding, tenant, site, drive en rootitem gevuld zijn met `configuratieversie = 1`; kies opnieuw en controleer versie 2 in dezelfde rij. Een eerder uitgegeven documentreferentie moet daarna 404 geven totdat de nieuwe bron opnieuw is ingelezen.
4. **Bron controleren** slaagt; trek daarna in Entra of SharePoint de toegang in en controleer dat de status naar `toestemming_nodig` of `fout` gaat zonder geheimlek in log of audit.
5. Negatief: een gewone bestuurder ziet de toestemmingsknop wel, maar krijgt 403 op kandidaten, drives, mappen, bron en controle. Een gebruiker van een fonds zonder vlag krijgt 404 op alle SharePoint-routes en ziet de kaart niet. Een gemanipuleerd kandidaat-id, drive-id of map-id uit een andere site wordt geweigerd (`kandidaat_onbekend`, `drive_niet_toegankelijk`, `map_niet_toegankelijk`).
6. **Bron ontkoppelen** zet de status op `ontkoppeld`; de rij en audit blijven bestaan.

Leg alleen tellingen, statussen, foutcategorieën en correlation-id's vast; geen tokens, site-, drive- of item-id's, en (in deel B) geen preview-URL's.

## Smoke deel B (PGB, synthetische PDF, Word, PowerPoint en Excel)

1. Plaats in de gekoppelde map een synthetische PDF, Word, PowerPoint en Excel, plus een subm map met minstens twee niveaus en één niet-ondersteund type (bijv. PNG). Geen vertrouwelijke inhoud.
2. Open als beheerder én als gewone bestuurder (beide met eigen SharePoint-toestemming) de bibliotheek. Noteer in de scopematrix of `…/items/{root}/delta` slaagt; bij een fout moet de lijst via de children-terugval alsnog verschijnen (`microsoft_private.audit_log` toont `lijst.geslaagd` met aantallen en latency, zonder id's).
3. Controleer: mapnavigatie tot de diepste map, aantallen kloppen, PNG toont "Geen preview", `Openen in Microsoft 365` opent de SharePoint-pagina in een nieuw tabblad.
4. Open de vier documenttypen via **Preview**. Noteer of `POST …/preview` slaagt onder `Sites.Selected` en op welke host de `getUrl` landt (verwacht `<tenant>.sharepoint.com`). Blokkeert de browser het iframe, controleer dan de CSP-header op de previewpagina (`frame-src` moet `https://*.sharepoint.com` bevatten) en of de preview-host binnen `*.sharepoint.com` valt; verruim niets zonder besluit.
5. Bewijs dat de preview-URL nergens wordt bewaard: `select count(*) from microsoft_private.audit_log where details::text ilike '%embed%' or details::text ilike '%http%'` moet 0 zijn; runtime-logs bevatten geen `sharepoint.com`-URL's; `microsoft_private.sharepoint_documenten` bevat geen inhoud- of URL-kolom behalve `web_url`.
6. Hernoem en verplaats een document binnen de map: dezelfde referentie blijft (één rij per item), de naam volgt. Verplaats een document buiten de map: Preview geeft 410 en het register markeert `ontoegankelijk`. Verwijder een document: Preview geeft 404 en markeert `verwijderd`.
7. Negatief: gebruiker B zonder SharePoint-rechten op een submap ziet die stukken niet (MS-05). Trek de site-grant of consent in: de eerstvolgende lijst-/previewrequest faalt gesloten (MS-06); meet en accepteer de resterende levensduur van een al uitgegeven preview-URL. Een fonds zonder vlag krijgt `beschikbaar: false` en ziet geen SharePoint-kaart. Een referentie van fonds A geeft voor fonds B 404.
8. CSP/redirect: controleer dat alleen `/bibliotheek/sharepoint/<ref>` de verruimde `frame-src` draagt, dat andere pagina's de strikte CSP houden, en dat een preview-URL met een niet-SharePoint-host door de server wordt geweigerd (409).
