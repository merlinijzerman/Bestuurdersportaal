# 0105 — Monitoringdrempels als data in `platform_signaal_config`

- **Status:** Geaccepteerd
- **Datum:** 2026-08-03
- **Betrokkenen:** Merlin (akkoord), Ontwikkeling (werkopdracht monitoringbasis P5/P4-light)

## Context

Elk monitoringsignaal heeft drempels (oranje/rood), een meetinterval, een tijdvenster en soms een n-drempel. TO §9 laat bewust open waar die leven: "in config (`platform_feature_flags` of een aparte `platform_signaal_config`-rij, implementatiekeuze)".

Dat is geen cosmetische keuze. Alerting is in deze tranche **buiten scope** — bewust, want de bestemming hangt aan de nog open maildomeinkeuze (compliance-gap 6). De alerting-tranche die volgt hoeft dan alleen een bestemming toe te voegen. Staat een drempel op dat moment hardcoded in een query, dan moet hij eerst worden verplaatst, en verplaatsen tijdens het bouwen van alerting is precies het moment waarop drempels stilletjes veranderen.

`platform_feature_flags` bestaat overigens niet; wat er wél is, is `fonds_feature_flags` — per tenant, met een tenant-schrijfpolicy. Monitoringdrempels zijn platformbreed en horen daar niet.

## Besluit

Een **eigen tabel `platform_signaal_config`**, met per signaal: label, eenheid, `interval_minuten`, `venster_minuten`, `drempel_oranje`, `drempel_rood`, `richting`, `n_drempel`, `actief` en een toelichting. Deny-by-default zoals de rest van de platformtabellen; wijzigen gebeurt in de SQL-editor.

De code houdt dezelfde waarden aan als **typed registry** (`platform/lib/monitoring-signalen.ts`), met twee rollen: seedbron voor de tabel, en **fallback** wanneer een rij ontbreekt of onbruikbaar is. Wijkt de tabel af van de registry, dan **wint de tabel** — anders zou "drempels als data" alsnog een lege huls zijn.

Eén veld komt expliciet **niet** uit de tabel: `platformbreed` (telt dit signaal per fonds of platformbreed). Dat is een eigenschap van de meetdefinitie, geen instelling, en mag niet met een SQL-update omgezet kunnen worden.

De toegepaste drempels worden bovendien **meegestempeld in elke snapshotrij** (`drempel_oranje`, `drempel_rood`). Zonder dat is historie niet interpreteerbaar zodra iemand een drempel bijstelt: een oude rode meting zou dan met de nieuwe drempel worden gelezen.

## Overwogen alternatieven

- **Drempels in een code-registry, zonder tabel** — afgewezen, hoewel het lichter is (twee nieuwe tabellen in plaats van drie). Een drempel bijstellen zou dan een deploy vergen, en de alerting-tranche zou de verplaatsing alsnog moeten doen. De werkopdracht vraagt expliciet om "drempels als data, niet als code".
- **Hergebruik van `fonds_feature_flags`** — afgewezen. Die tabel is per tenant en kent een tenant-schrijfpolicy (`voorzitter`/`beheerder`); een fondsbeheerder zou dan zijn eigen monitoringdrempels kunnen verzetten. Bovendien is een monitoringdrempel geen feature flag.
- **Drempels in `platform_feature_flags`** (zoals TO §9 als optie noemt) — vervalt: die tabel bestaat niet.
- **Alleen een tabel, zonder code-fallback** — afgewezen. Dan blokkeert één ontbrekende of kapotte configregel de hele meting van dat signaal, en valt de monitoring uit op het moment dat de database iets mankeert.

## Gevolgen

- **RLS/tenant-isolatie:** een derde nieuwe tabel, deny-by-default (RLS aan, geen policy, grants ingetrokken). Geen `fonds_id` — drempels zijn platformbreed — en daarom expliciet toegevoegd aan de `globaal`-array in `supabase/checks/2026_07_31_r1_structurele_gates.sql`. Zonder die registratie faalt gate A1 terecht.
- **Audit/reproduceerbaarheid:** een drempelwijziging wordt **niet** geaudit; `bijgewerkt` is de enige sporen-kolom. Bewust geaccepteerd: er is in deze fase geen UI voor, wijzigen vergt service-role-toegang tot de SQL-editor, en dat pad is al aan een eigen procedure gebonden. Zodra de alerting-tranche een beheer-UI toevoegt, hoort daar een auditregel bij — dan pas is er een handeling om te loggen.
- **Datamodel/migraties:** de tabel plus een seed van de acht signalen uit deze tranche (`on conflict do nothing`, zodat een handmatige bijstelling niet wordt teruggezet door een herdraai).
- **Beheerervaring:** het dashboard toont per signaal welke drempels golden op het moment van meten, niet de huidige — dat is bewust en voorkomt dat historie herschreven lijkt.
- **Bewust geaccepteerde schuld:** de registry in code en de seed in de migratie zijn twee plekken met dezelfde getallen. Ze kunnen uit elkaar lopen. De sanity-suite bewaakt de interne consistentie van de registry, maar niet de gelijkheid met de seed — die staat als comment op beide plekken vermeld.

## Referenties

- `supabase/migrations/2026_08_03_p5_monitoring.sql` — tabel + seed
- `platform/lib/monitoring-signalen.ts` — registry, `combineerConfig` (tabel wint), fallbackgedrag
- `platform/lib/monitoring-signalen.sanity.ts` — bewijst dat de tabel wint en dat een kapotte rij niets sloopt
- `supabase/checks/2026_07_31_r1_structurele_gates.sql` — `globaal`-registratie (gate A1)
- Besluiten [`0005`](./0005-rate-limiting-en-monitoring-in-stack-mvp.md), [`0055`](./0055-t11-suppressiedrempel-n10.md) (n-drempel), [`0104`](./0104-retentie-app-errors-en-snapshots-geen-auditspoor.md)
- FO Increment P §19 (signaalcatalogus met richtwaarden), TO Increment P §9
