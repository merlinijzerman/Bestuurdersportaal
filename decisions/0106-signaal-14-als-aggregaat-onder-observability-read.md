# 0106 — Signaal 14 (audit-volledigheid) als aggregaat onder `platform.observability.read`

- **Status:** Geaccepteerd
- **Datum:** 2026-08-03
- **Betrokkenen:** Merlin (akkoord), Ontwikkeling (werkopdracht monitoringbasis P5/P4-light)

## Context

Signaal 14 uit FO §19 telt **attempt-events zonder bijbehorend result-event** in `platform_event_log`: platformhandelingen waarvan de afloop nooit is vastgelegd. Het is het enige signaal in deze tranche dat rechtstreeks over de integriteit van het auditspoor zelf gaat, en de code benoemt de detectiejob al bij naam (`platform/lib/platform-audit.ts`, bij `logResultGegarandeerd`).

Er zit een spanning in de bronnen:

- **FO §19** kent signaal 14 de capability `platform.logs.read` toe en merkt de privacyklasse aan als **hoog**.
- **De werkopdracht** plaatst signaal 14 op het P4-light-dashboard, dat achter `platform.observability.read` hangt, en beperkt het expliciet tot "alleen het **aantal** onvolledige audit-paren, geen doorklik" — met de doorklik uitgesteld naar P6, omdat die AVG-zwaar is en aan de nog open retentie-/toegangsgate B14-3 hangt.

Wie `logs.read` als eis voor de **telling** neemt, verbergt het signaal voor het profiel `platformbeheer` — dat wél `observability.read` heeft maar géén `logs.read`. Juist die rol beheert de keten.

## Besluit

**De telling staat op het monitoringdashboard onder `platform.observability.read`. Doorklik naar de onderliggende logregels bestaat niet en vereist `platform.logs.read` (P6).**

De grens is scherp getrokken in de meting zelf: `platform/lib/monitoring-queries.ts` geeft uitsluitend een getal per `doel_fonds_id` terug. Correlatie-id's, identiteiten, capabilities en handelingen verlaten de functie niet en komen dus ook niet in `platform_signal_snapshots` of op het scherm.

Dit is een **bewuste, vastgelegde afwijking van FO §19**, geen omissie.

## Overwogen alternatieven

- **Signaal 14 achter `logs.read` zetten, zoals FO §19 zegt** — afgewezen. Het verbergt een ketenintegriteitssignaal voor de rol die de keten beheert, en de reden dat FO er `logs.read` bij zet is de doorklik naar logregels — en die is hier nu juist niet gebouwd.
- **Signaal 14 uit deze tranche laten tot P6** — afgewezen. Dan blijft de gap die de code zelf al benoemt onopgemerkt, terwijl het aantal juist het goedkoopste en minst privacygevoelige deel is.
- **Het aantal tonen mét doorklik voor wie `logs.read` heeft** — afgewezen voor nu. Cross-tenant loginzage is de kern van P6 en hangt aan gate B14-3 (retentie en toegang); die half vooruitschuiven levert een pad dat later opnieuw beoordeeld moet worden.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd. De meting leest `platform_event_log` met de service-role achter de snapshot-cron; het dashboard leest alleen de snapshot.
- **Audit/reproduceerbaarheid:** het auditspoor wordt uitsluitend **gelezen**, nooit geschreven of gewijzigd door dit signaal. De dashboardinzage zelf landt wél als result-event in `platform_event_log` (via `withPlatformRead`), met alleen tellingen als `effect`.
- **Privacy:** het getoonde getal is een aggregaat zonder n-drempel. Dat is verdedigbaar omdat het over **platformhandelingen** gaat, niet over gebruikersgedrag: er valt geen individuele bestuurder uit af te leiden. Signalen die wél op gebruik leunen (3, 4, 6) dragen de n-drempel uit besluit 0055.
- **Rollen/capabilities:** géén nieuwe capability. `platform.observability.read` bestond al en wordt gehouden door `platformbeheer`, `platform_support_viewer`, `platform_security_op` en `platform_audit_reader`.
- **Bewust geaccepteerde schuld:** een verhoogd aantal is zichtbaar, maar niet onderzoekbaar zonder `logs.read` en de SQL-editor. Dat is een bekende beperking tot P6 en staat in het risicoregister.

## Aanvullend vastgelegd (uit de reviews van 03-08-2026)

- **`duur_model_ms` en `tokens` landen in het append-only auditspoor** (`governance_log.retrieval_meta`) en zijn via de bestaande fondspolicy voor elke bestuurder van dat fonds leesbaar. Dat is **operationele telemetrie en uitdrukkelijk geen individuele prestatiemeting**; append-only betekent bovendien dat het niet meer te verwijderen is. Bewuste keuze — het signaal heeft de meting nodig — maar hij hoort expliciet te zijn.
- **`app_errors` is geen bewijsmateriaal.** Rate limiting is de compensating control onder de meldtermijn van art. 33/34, maar `app_errors` is 90 dagen, niet append-only en met de service-role verwijderbaar (besluit 0104). Een incident dat meldplichtig kán zijn, hoort dáárnaast een spoor in `platform_event_log` of `governance_log` te krijgen.
- **Openstaand, buiten deze tranche:** `app/api/agendapunten/[id]/voorbereiding` en `app/api/procedures/[id]/stappen/[stapId]/besluit-concept` schrijven géén `governance_log`-regel. Dat is een pre-existente breuk met de guardrail "elke AI-interactie blijft herleidbaar", door deze tranche blootgelegd doordat het tokensignaal die routes structureel mist. `besluit-concept` genereert besluittekst en is daarmee de meest besluitvormingsnabije AI-output in het product. Verdient een eigen tranche.

## Referenties

- `platform/lib/monitoring-queries.ts` — `meetAuditVolledigheid`, alleen tellingen
- `app/(platform)/platform/(beveiligd)/monitoring/page.tsx` — gating en de expliciete toelichting
- `platform/lib/platform-audit.ts` — waar de detectiejob bij naam wordt genoemd
- FO Increment P §19 (signaal 14, capability `logs.read`, privacyklasse hoog), §20.1 (no-regret-besluit 1)
- Besluiten [`0055`](./0055-t11-suppressiedrempel-n10.md), [`0104`](./0104-retentie-app-errors-en-snapshots-geen-auditspoor.md), [`0105`](./0105-drempelconfiguratie-in-platform-signaal-config.md)
