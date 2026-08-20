# 0185 — GitHub-notificaties als goedgekeurd back-upalertkanaal

- **Status:** Geaccepteerd
- **Datum:** 2026-08-20
- **Betrokkenen:** opdrachtgever, technisch beheer

## Context

De P0-back-upketen (#29) is aantoonbaar herstelbaar: de managed restore-oefening is end-to-end groen (run 32345486528). Eén punt uit de Definition of Done stond nog open — een geconfigureerd en getest alertkanaal. De bewaking verwachtte daarvoor `BACKUP_ALERT_WEBHOOK_URL`, en zolang dat secret ontbrak bleef de job `Alertkanaalconfiguratie controleren` rood.

Bij het invullen bleek er nog geen meldkanaal te bestaan. Elke externe optie (Slack, Teams, Discord, een eigen endpoint) betekent een nieuw account, een nieuwe afhankelijkheid of nieuwe code in precies het pad dat betrouwbaar moet zijn wanneer al het andere stuk is.

Doorslaggevend was dat detectie en melding feitelijk al werkten. Iedere inhoudelijke afwijking in de bewaking roept `send-backup-alert.mjs` aan én sluit af met `exit 1`. De run wordt dus rood, en GitHub stuurt bij een mislukte scheduled run een notificatie naar de eigenaar van de workflow. Het ontbrekende webhookkanaal was daarmee geen gat in de detectie, maar de afwezigheid van een tweede, toegewijd kanaal.

## Besluit

De rode workflowrun plus de GitHub-notificatie is het goedgekeurde alertkanaal voor de back-upketen. Het kanaal wordt expliciet in de workflow vastgelegd als `ALERT_CHANNEL: github-native`; `BACKUP_ALERT_WEBHOOK_URL` wordt optioneel en is alleen vereist wanneer het kanaal op `webhook` staat.

## Overwogen alternatieven

- **Slack met een gratis workspace** — technisch de beste optie: de bestaande payload werkt ongewijzigd, geen regel nieuwe code in het alertpad. Niet gekozen omdat er geen workspace is en er voor deze omvang geen aanleiding is er een in te richten. Blijft de aangewezen route zodra er een team of dienstdoend rooster komt.
- **Eigen endpoint op Vercel dat naar e-mail doorzet** — kost niets extra, maar voegt zelfgeschreven code en een mailverzender toe aan het pad dat juist moet werken als er iets stuk is. Niet gekozen.
- **Teams of Discord** — vereisen een adapter, omdat de payload het veld `text` gebruikt. Niet gekozen; zie hierboven.
- **De job simpelweg verwijderen of op non-blocking zetten** — verworpen. Dat haalt een poort weg in plaats van hem te verplaatsen, en maakt niet zichtbaar wanneer de aanname onder dit besluit niet meer klopt.

## Gevolgen

De job `Alertkanaalconfiguratie controleren` is groen bij een gezonde toestand, maar niet leeg: bij `github-native` draait `scripts/verify-watchdog-fail-closed.mjs`. Die controleert dat beide inhoudelijke controlejobs nog bestaan, dat elke stap die een afwijking vaststelt eindigt met `exit 1`, en dat nergens `continue-on-error` staat. Verdwijnt één van die eigenschappen, dan zou een echte afwijking de run groen laten — en dan wordt juist deze job rood. Een onbekende of lege `ALERT_CHANNEL` faalt eveneens.

De veilige negatieve test blijft bestaan en past zich aan het kanaal aan. Bij `webhook` verstuurt hij een synthetische waarschuwing; bij `github-native` maakt hij de run met opzet rood, want alleen dan bewijst hij dat een afwijking daadwerkelijk gemeld wordt. In beide gevallen wordt geen back-up, completion marker of B2-object aangeraakt.

Bewust geaccepteerde beperkingen, en de reden om dit besluit te herzien zodra één ervan gaat knellen:

- Back-upalarmering landt in dezelfde inbox als alle overige GitHub-meldingen en heeft geen eigen urgentie, geen ontvangstbevestiging en geen escalatie bij uitblijven.
- GitHub stuurt notificaties over scheduled workflows naar de gebruiker die de workflow heeft aangemaakt; wijzigt iemand anders de cron-expressie, dan verschuift de ontvanger. Dat is een stille single point of failure in de meldketen.
- Er is één ontvanger en geen dienstdoend rooster. Bij afwezigheid van die persoon blijft een mislukte back-up onopgemerkt tot terugkeer.
- Het kanaal werkt alleen zolang GitHub Actions zelf draait. Een storing bij GitHub maakt zowel de back-up als de melding erover onzichtbaar.

Geen impact op RLS, tenant-isolatie, het datamodel of migraties. Geen impact op het restorecontract of het bewijsformaat van de restore-oefening.

## Referenties

- `.github/workflows/supabase-backup-watchdog.yml` — `ALERT_CHANNEL` en de kanaalafhankelijke jobs
- `scripts/verify-watchdog-fail-closed.mjs` en de bijbehorende tests
- `scripts/send-backup-alert.mjs` — de drie alertcategorieën
- `BACKUP-P0-RUNBOOK.md` — §Retry en alarmering, §Escalatie
- Besluit 0179 — dagelijkse offsite back-up, PITR en uitwijk
- GitHub-issue #29
