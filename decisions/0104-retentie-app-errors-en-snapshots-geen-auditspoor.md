# 0104 — Retentie voor `app_errors` en `platform_signal_snapshots`; monitoring is géén auditspoor

- **Status:** Geaccepteerd
- **Datum:** 2026-08-03
- **Betrokkenen:** Merlin (akkoord), Ontwikkeling (werkopdracht monitoringbasis P5/P4-light)

## Context

De P5-tranche voegt twee tabellen toe die zich vullen zonder dat iemand daar per rij een besluit over neemt: `app_errors` (elke gesaniteerde API-fout) en `platform_signal_snapshots` (elke vijf minuten een meting per signaal per fonds). Beide groeien monotoon.

Twee dingen moesten daarom vóór aanleg worden vastgelegd, niet erna:

1. **Bewaartermijn.** Projectbreed zijn bewaartermijnen nog niet gedefinieerd (compliance-gap 2, open). Een monitoringtranche die zelf twee onbegrensde tabellen achterlaat, vergroot precies de schuld die hij moet helpen verkleinen.
2. **Status van `app_errors`.** De repo kent een sterke conventie: `*_log`-tabellen zijn append-only, met triggers die UPDATE en DELETE blokkeren (`2026_07_08_t3_append_only_logs.sql`, `2026_06_23_platform_fundament.sql`). Zou `app_errors` daar stilzwijgend bij gaan horen, dan is elke opschoning technisch onmogelijk — en zou een operationele foutregel bovendien ten onrechte als bewijsmateriaal kunnen worden aangezien.

## Besluit

**`app_errors` en `platform_signal_snapshots` zijn OPERATIONELE tabellen, geen auditspoor.** Ze krijgen bewust géén append-only-trigger, en `app_errors` draagt bewust géén `_log`-suffix in de naam zodat hij niet als lid van de auditfamilie leest.

Bewaartermijnen: **`app_errors` 90 dagen**, **`platform_signal_snapshots` 180 dagen**. `platform_signaal_config` bevat configuratie en kent geen retentie.

De opschoning is **technisch geïmplementeerd**, niet alleen gedocumenteerd: een `delete … where tijdstip < now() - interval` aan het eind van elke snapshot-run (`app/api/platform/monitoring/snapshot/route.ts`), met de service-role die daar al is. Géén nieuwe `SECURITY DEFINER`-functie — dat zou het gate E/H-oppervlak vergroten zonder dat er iets mee gewonnen wordt — en géén `TRUNCATE`-recht, dat buiten RLS valt en nergens thuishoort.

## Overwogen alternatieven

- **`app_errors` append-only maken, net als de andere logtabellen** — afgewezen. Dan is retentie alleen mogelijk door de trigger tijdelijk te droppen, en dat is precies het soort operatie dat je nooit in een cron wilt hebben. Bovendien is de inhoud geen bewijs: een foutregel is een operationeel signaal, geen vastlegging van een handeling van een gebruiker of bestuurder.
- **`pg_cron` voor de opschoning** — afgewezen (nu). De extensie wordt nergens in dit project gebruikt; een tweede plek waar geplande taken leven maakt het beeld troebeler, terwijl de snapshot-cron toch al elke vijf minuten draait met precies de juiste rechten.
- **Retentie uitstellen tot compliance-gap 2 projectbreed is opgelost** — afgewezen. Dat is de klassieke manier waarop een gap groeit: elke tranche voegt een tabel toe en verwijst naar het nog te nemen besluit. Twee termijnen nu vastleggen sluit niets af voor later.
- **Langere termijnen (bv. 400 dagen snapshots voor jaar-op-jaarvergelijking)** — afgewezen voor v1. Bij de gekozen cadans levert 180 dagen al ±134.000 rijen; jaar-op-jaar vraagt eerder een rollup-laag (dagaggregaten) dan een langere bewaartermijn van ruwe metingen.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd. Beide tabellen zijn deny-by-default (RLS aan, géén policy, grants ingetrokken bij `anon` en `authenticated`). `app_errors` draagt wél een `fonds_id`, server-side afgeleid uit `auth.uid()`, zodat signalen per fonds gegroepeerd kunnen worden.
- **Audit/reproduceerbaarheid:** het bestaande auditspoor is niet geraakt. Monitoringgegevens gaan nadrukkelijk **niet** naar `governance_log`, `governance_events` of `platform_event_log`. Het onderscheid tussen "logtabel" en "auditspoor" is nu expliciet vastgelegd in het tabelcommentaar, in `schema.sql` en in een gedragscheck (`supabase/checks/2026_08_03_p5_monitoring.sql`) die aan één kant toetst dat `app_errors` opschoonbaar is, en aan de andere kant dat `platform_event_log` append-only blijft.
- **Datamodel/migraties:** `2026_08_03_p5_monitoring.sql` met rollback-tegenhanger.
- **Beheerervaring:** de trendlijn op het dashboard reikt maximaal 180 dagen terug; foutdetail maximaal 90 dagen. Voor het MVP-volume ruim.
- **Bewust geaccepteerde schuld:** (a) de opschoning hangt aan de snapshot-cron — draait die niet, dan groeit de tabel door. Dat is zichtbaar, want dezelfde stilstand maakt alle signalen grijs. (b) Er is geen volumebegrenzing op `app_errors`: een route die in een lus faalt kan de tabel vollopen, met retentie als enige backstop. Aanvaardbaar bij MVP-volume, te herzien bij opschaling.

## Referenties

- `supabase/migrations/2026_08_03_p5_monitoring.sql` (+ `_ROLLBACK.sql`)
- `supabase/checks/2026_08_03_p5_monitoring.sql` — secties 3 en 4 leggen het onderscheid gedragsmatig vast
- `app/api/platform/monitoring/snapshot/route.ts` — de opschoning
- Besluiten [`0001`](./0001-append-only-audit-geen-harddelete.md) (append-only audit), [`0005`](./0005-rate-limiting-en-monitoring-in-stack-mvp.md) (monitoring in-stack), [`0105`](./0105-drempelconfiguratie-in-platform-signaal-config.md)
- `MONITORING-P5-ONTWERP.md`
