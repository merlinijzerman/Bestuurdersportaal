# 0143 — `rate_limit_incidenten` telt uitsluitend 429's; fail-open wordt een eigen signaal

- **Status:** Geaccepteerd
- **Datum:** 2026-08-08
- **Omschakeldatum (definitie_versie 2):** 2026-08-08 (de P4b-deploy)
- **Betrokkenen:** Merlin IJzerman (product/opdrachtgever)
- **Raakt:** `platform/lib/monitoring-queries.ts` (`meetRateLimitIncidenten`, nieuw `meetRateLimitFailOpen`), `platform/lib/monitoring-signalen.ts`, `supabase/seeds/schema/2026_08_08_p4b_signalen_seed.sql`

## Context

Het signaal `rate_limit_incidenten` telde twee grootheden die het **tegenovergestelde** betekenen (voorstel §4.1 regel 4):

- een **429**-response = de rem wérkte (een verzoek is netjes afgeremd) — hoog is niet per se slecht;
- een **mislukte limietcheck** (fail-open, `severity = 'hoog'`) = de rem viel wég (een verzoek is NIET afgeremd doordat de check zelf faalde) — al één is alarmerend.

Met drempels van 20/40 per dag domineren de 429's, en zouden drie fail-opens — het enige echt alarmerende geval — in de ruis verdwijnen. Het fail-open-getal werd al berekend en in `meta.limietchecks_mislukt` gezet, maar was nergens als eigen stoplicht zichtbaar.

## Besluit

1. **`rate_limit_incidenten` telt voortaan uitsluitend 429-responses** (`http_status = 429`). De drempels (oranje 20 / rood 40 per 24 u) en de meetcadans blijven ongewijzigd.
2. **Nieuw signaal `rate_limit_fail_open`** telt de mislukte limietchecks (`severity = 'hoog'`), met drempels **oranje 1 / rood 2** per 24 u. Zelfde bron (`app_errors`, categorie `rate_limiting`), geen nieuwe bron.
3. **De definitiebreuk wordt gemarkeerd**, niet verstopt. De meting draagt `meta.definitie_versie = 2`; historische snapshots (versie 1) telden ook fail-open mee. Omdat het dashboard een trend van zeven dagen toont, **heelt de breuk zichzelf binnen een week**. De drempels zijn meegestempeld in de snapshot; alleen de definitie wijzigt, en die staat hier vast met de omschakeldatum.
4. **Geen schemawijziging**: één INSERT (fail_open) plus één UPDATE op de toelichting van `rate_limit_incidenten` in `platform_signaal_config`.

## Overwogen alternatieven

- **Eén getal houden en fail-open alleen in `meta`.** Verworpen: een fail-open met eigen drempel (≥1 rood) verdrinkt anders in de 429-ruis — precies het gevaar dat regel 4 adresseert.
- **Een aparte `definitie_versie`-kolom op de snapshottabel.** Verworpen als te duur: `meta` draagt het versienummer prima, zonder schemawijziging.

## Gevolg

De detaillaag toont geen trend over de definitiebreuk heen zonder markering. Na 2026-08-15 (zeven dagen na de omschakeling) is de trend van `rate_limit_incidenten` volledig op de nieuwe definitie.
