# #428 — Fase 1 artefacten en uitvoeringspoort

Status: repositoryvoorbereiding gereed voor review. Dit document autoriseert geen uitvoering tegen Preview of Productie.

## Bestuurlijke randvoorwaarden

- Operationeel eigenaar: Merlin IJzerman.
- Eerstvolgende herbeoordeling: 21 december 2026; daarna minimaal per kwartaal.
- Kostenlimiet: EUR 100 exclusief btw per kalendermaand voor alle app365-specifieke Microsoft-licenties en variabele Copilot-/Retrievalkosten samen.
- Bij ontbrekend of verlopen kostenbewijs blijven Copilot, Microsoft-login en retrieval uit.
- Eigen fonds: `m365-demo`; geen PGB-identiteit, PGB-app, PGB-bronroot of PGB-retrievalprofiel hergebruiken.

## Artefacten

De gedeelde migratie `supabase/migrations/2026_09_22_428_app365_demo_fonds_config.sql` bevat alleen fondsconfiguratie. Zij bevat geen host, projectref, callback, account of Microsoft-object.

Per omgeving bestaan drie afzonderlijke bestanden:

| Omgeving | Provision | Self-check | Rollback |
|---|---|---|---|
| Preview | `supabase/seeds/preview/2026_09_22_428_app365_preview_provision.sql` | `supabase/seeds/preview/2026_09_22_428_app365_preview_CHECK.sql` | `supabase/rollbacks/2026_09_22_428_app365_preview_ROLLBACK.sql` |
| Productie | `supabase/seeds/production/2026_09_22_428_app365_production_provision.sql` | `supabase/seeds/production/2026_09_22_428_app365_production_CHECK.sql` | `supabase/rollbacks/2026_09_22_428_app365_production_ROLLBACK.sql` |

De runner weigert vóór `psql` tenzij `APP365_DOELOMGEVING` en de projectref uit `APP365_DATABASE_URL` bij elkaar horen. `provision` en `rollback` vereisen bovendien een fasegebonden akkoordtoken. Die tokens zijn een technische grendel, geen vervanging van het schriftelijke akkoord.

## Stopmoment na Fase 1

Na merge van de repositorywijziging stopt het werk. Voer de gedeelde migratie, provisioning, self-check of rollback niet uit; wijzig geen DNS, Vercel-domain, `APP_HOST`, Auth-callback, account, Supabase-project, Microsoft-object of registryrecord. Eerst volgt review van de concrete diff en een afzonderlijk Fase 2-akkoord voor Preview. Productie vereist later een eigen Fase 3-akkoord.

## Preview-uitvoeringschecklist — pas na Fase 2-akkoord

1. Selecteer `portal_preview` en controleer projectref `swviwoytzvaqypieqgji` opnieuw.
2. Leg een herstelpunt en read-only nulmeting vast.
3. Test migratie, provision, self-check en rollback eerst in een ephemere database.
4. Bewijs dat Preview+Production-URL en Production+Preview-URL vóór `psql` rood eindigen.
5. Pas de gedeelde migratie via de normale Preview-migratieketen toe.
6. Voer uitsluitend Previewprovisioning en daarna Preview-self-check uit.
7. Maak uitsluitend synthetische Previewaccounts en data.
8. Voeg daarna pas de exacte Vercel-, DNS-, `APP_HOST`- en Auth-bindingen toe volgens de gereviewde providerdiff. Omdat beide zones een wildcard dragen, begint de DNS-wijziging met een exact TXT-tombstonerecord op de app365-host. Verifieer autoritatief dat een A-query `NOERROR` zonder antwoord geeft voordat het Vercel-domain wordt gekoppeld. Activeer de host pas als laatste door op exact dezelfde naam een expliciete Vercel-routingbinding toe te voegen; verwijder het tombstonerecord niet zolang nog geen expliciete routingbinding bestaat.
9. Smoke hostrouting, harde reload, login/logout/reset, badge, metadata, robots, sitemap, cross-hostweigering en RLS.
10. Bewijs nul Microsoft-tokenaanvragen en nul Copilotcalls.

## Productie-uitvoeringschecklist — afzonderlijk Fase 3-akkoord

Dezelfde volgorde geldt, maar uitsluitend voor `portal_production` met projectref `aebwiufuegsiwhwpdrfb`, Productionaccounts en `app365.bestuurdersportaal.com`. Een groen Previewbewijs autoriseert Productie niet automatisch.

## Providerrollback Preview

1. Zet Microsoft-/Copilotpoorten dicht en blokkeer uitsluitend Preview-app365-accounts.
2. Voer de Preview-databaserollback alleen met het aparte rollbackakkoord uit.
3. Verwijder uitsluitend de expliciete A-/AAAA-/ALIAS-/CNAME-routingbinding op `app365.preview.bestuurdersportaal.com` en herstel/behoud op die exacte naam een TXT-tombstone. Verwijder de naam niet: anders neemt de gedeelde wildcard de routing opnieuw over.
4. Wacht de hoogste nog relevante TTL af en verifieer autoritatief én via een onafhankelijke resolver dat een A-/AAAA-query `NOERROR` zonder antwoord geeft en nieuw verkeer niet meer naar Vercel routeert.
5. Geef pas daarna het domain van `preview-stable` vrij en controleer dat geen dangling claim resteert.
6. Verwijder uitsluitend de Previewhost uit `APP_HOST` en de exacte Preview Auth-callbacks via de normale releaseweg.

## Providerrollback Productie

1. Zet Microsoft-/Copilotpoorten dicht en blokkeer uitsluitend Productie-app365-accounts.
2. Voer de Productiedatabaserollback alleen met het aparte rollbackakkoord uit.
3. Verwijder uitsluitend de expliciete A-/AAAA-/ALIAS-/CNAME-routingbinding op `app365.bestuurdersportaal.com` en herstel/behoud op die exacte naam een TXT-tombstone. Verwijder de naam niet: anders neemt de gedeelde wildcard de routing opnieuw over.
4. Wacht de hoogste nog relevante TTL af en verifieer autoritatief én via een onafhankelijke resolver dat een A-/AAAA-query `NOERROR` zonder antwoord geeft en nieuw verkeer niet meer naar Vercel routeert.
5. Geef pas daarna het Production-domain vrij en controleer dat geen dangling claim resteert.
6. Verwijder uitsluitend de Productiehost uit `APP_HOST` en de exacte Production Auth-callbacks via de normale releaseweg.

De gedeelde rollback verwijdert het fonds niet: de configuratieaudit is append-only en mag nooit cascaderend verdwijnen. Na gebruik is uitschakelen en bewaren de standaard.
