# #407 — responsdiagnose en één canaryhertest op het PGB-lab

- Meting: 2026-09-23 17:59:04 UTC
- Registry: `bestuurdersportaal-integraties` `main` op `5e6fb6b`; profiel `pgb_m365_lab_copilot`
- Scenario: `CANARY_INDEX_101_ZIN`; verwachte fixture `PGB407-DOC-101`
- Vaste vraag: `In welk hersteldossier staat de aanduiding Zandloperbaken 12?`
- Budget: precies één Retrieval-netwerkpoging, geen retry

## Bewijs

De voorafgaande dry-run en de live run bevestigden beide dezelfde tenant,
testidentiteit, appregistratie en geregistreerde bronroot. De read-only
Graph-inhoudscan vond de canary 1/1 binnen de root, na een verse itemlezing.
De bestandsnaamscan vond de fixture eveneens 1/1 binnen de root. De dry-run
deed nul Retrieval-calls.

De live run deed één `POST` naar het vastgepinde v1.0-endpoint. De call werd
geaccepteerd en de respons had een `retrievalHits`-array van lengte **0**.
Er waren dus **0 ruwe hits**, **0 hits zonder locator** en **0 bruikbare
kandidaten**. Latency: 685 ms. Het inhoudsvrije lokale rapport is als
uitvoeringsbewijs bewaard; bovenstaande tellingen zijn hier duurzaam vastgelegd.

Dit is sterker dan de vorige meting met alleen de losse term: de kandidaatparser
kan nul niet verklaren door hits zonder `webUrl` weg te filteren. Het resultaat
bewijst nog niet welke van de overblijvende oorzaken geldt: de Copilot-specifieke
index, de server-side `Path`-filter, de toegangscontext van Copilot, of ranking.
De Graph-zoekindex is een afzonderlijke laag en zijn treffer bewijst geen
Copilot-grounding. Geen ongescopete of tweede Retrieval-call uitgevoerd.

## Verificatie van de wijziging

- `npm run typecheck`: groen.
- `npm run test:smoke-copilot-lab`: 108/108 groen.
- `node --import tsx --test tests/cross-tenant/copilot-client.test.ts`: 17/17 groen.
- `npm run test:spike-boundary`: 16/16 groen.
- `npm run gates`: groen, 1030/1030 app-laag. De lokale DB-laag is zonder
  `TEST_DATABASE_URL` niet gedraaid; deze wijziging bevat geen SQL.

De nieuwe responsdiagnostiek bevat uitsluitend een gesloten veldstatus en
gehele tellingen; geen providerbody, URL, bestandsnaam, extract of token.
De vaste vraag is een afzonderlijk scenario zodat de losse-termmeting
historisch herkenbaar blijft.

## Vervolggrens

Geen automatische vervolgcall. Voor een volgende kostbare meting is eerst een
afzonderlijk besluit nodig over de discriminatietest (bijvoorbeeld een andere,
nog steeds strikt gescopete `Path`-vorm of Microsoft-ondersteuning). Een
ongescopeerde proef is geen veilige diagnose van deze bron.
