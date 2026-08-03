# 0115 — HMAC-SHA-256 als integriteitszegel over de verwijderbare chatinhoud

- **Status:** Geaccepteerd
- **Datum:** 2026-08-04
- **Betrokkenen:** IB, ontwikkeling

## Context

Doordat de chatinhoud verwijderbaar wordt ([[0107]]), verdwijnt ook het bewijs dát een bepaalde tekst er ooit stond. Voor een toezichtvraag of een geschil is dat een reëel gat: het spoor zegt dan wel dat er om 14:03 een vraag is gesteld, maar niet dat de tekst die iemand later voorlegt de oorspronkelijke was.

## Besluit

Bij elke interactie wordt een HMAC-SHA-256 berekend over een canonieke JSON-vorm `{schema_version, question, answer}` met NFC-normalisatie, en opgeslagen in `governance_log.inhoud_hmac`. Het zegel blijft staan als de inhoud is verwijderd. De sleutel leeft als omgevingsvariabele in de applicatielaag; de HMAC gaat als parameter naar de schrijf-RPC.

## Overwogen alternatieven

- **Sleutel in de database** (`current_setting()`) — had IB's voorkeur omdat de sleutel dan buiten de applicatiecode blijft. Verworpen: via de Supabase-pooler is een per-connectie-instelling niet betrouwbaar vast te houden, en de canonieke vorm zou dan niet in een TypeScript-sanitytest te bevriezen zijn. Die bevriezing is juist wat voorkomt dat een onopgemerkte wijziging alle bestaande zegels ongeldig maakt.
- **Kale sha256 zonder sleutel** — verworpen: dan kan iedereen die de tekst raadt het zegel reproduceren; bij korte vragen is dat triviaal.
- **Salt per rij** — voegt niets toe boven een geheime sleutel en maakt sleutelrotatie ingewikkelder.
- **Bronmetadata meenemen in het zegel** — verworpen: die leeft deels in het spoor en deels in de inhoud, en zou het zegel laten kantelen op een wijziging die de tekst onberoerd laat.

## Gevolgen

- **Bewijswaarde is genuanceerd en moet zo worden gepresenteerd.** Het zegel bevestigt een AANGEBODEN tekst; het reconstrueert niets en bewijst niets tegen wie de sleutel heeft. Het is een integriteitszegel, geen onweerlegbaar bewijsmiddel.
- **Sleutelbeheer wordt een operationele verplichting.** `hmac_sleutel_versie` maakt rotatie mogelijk zonder oude zegels ongeldig te maken; `hmac_schema_versie` doet hetzelfde voor de canonieke vorm.
- **Fail-open bij ontbrekende sleutel:** is de omgevingsvariabele niet uitgerold, dan wordt er géén zegel gezet en gaat de interactie gewoon door. Een chatgesprek mag niet mislukken op een ontbrekende env-var; de kolommen zijn daarom nullable.
- **Bewust geaccepteerde schuld:** zonder sleutelroulatiebeleid is de rotatiemogelijkheid theoretisch.

## Referenties

- `core/lib/audit-hmac.ts`, `core/lib/audit-hmac.sanity.ts` (bevroren uitkomsten)
- `supabase/migrations/2026_08_04_a1_governance_log_inhoud.sql`
- Omgevingsvariabelen: `AUDIT_HMAC_SLEUTEL`, `AUDIT_HMAC_SLEUTEL_VERSIE`
- [[0107]]
