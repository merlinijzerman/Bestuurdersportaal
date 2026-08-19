-- ============================================================================
--  2026_08_08_p4b_signalen_seed.sql — drie nieuwe monitoringsignalen (P4-light B)
-- ----------------------------------------------------------------------------
--  DATA, GEEN DATAMODEL. Uitsluitend rijen in platform_signaal_config:
--    * rate_limit_fail_open      (blok B3) — mislukte limietchecks (fail-open)
--    * ingest_stilstand          (blok C2) — oudste openstaande ingest-job
--    * ingest_doorlooptijd_p95   (blok C3) — p95 doorlooptijd afgeronde jobs
--  Plus één UPDATE op de toelichting van rate_limit_incidenten (429-herdefinitie,
--  besluit 0143). GEEN schemawijziging, GEEN policy, GEEN grant, GEEN nieuwe
--  eenheidswaarde (de twee tijdsduursignalen slaan op in 'milliseconden',
--  architectuurpunt 9). De CHECK chk_signaal_n_drempel bijt niet: de nieuwe
--  signalen staan niet in de lijst van gebruikssignalen en dragen n_drempel = null.
--
--  GATE-IMPACT: geen. Deze migratie raakt schema/policies/grants/functies niet;
--  de structurele gates A–H zijn niet vereist (impactklasse "data-seed").
--
--  VOLGORDE (verplicht): draai deze migratie EERST in de Supabase SQL-editor,
--  DÁN pas de code-deploy. Anders schrijft de snapshot-cron een signaal weg
--  waarvoor nog geen configregel bestaat en draait het op de registry-fallback
--  (besluit 0105). Na de deploy: één snapshot-run afwachten en controleren dat er
--  rijen voor de drie nieuwe signalen verschijnen.
--
--  Waarden zijn IDENTIEK aan de typed registry (platform/lib/monitoring-signalen.ts);
--  de sanity-driftcheck bewaakt dat. on conflict do nothing: een latere handmatige
--  bijstelling in de SQL-editor wordt door een herdraai NIET teruggezet.
-- ============================================================================

insert into public.platform_signaal_config
  (signaal, label, eenheid, interval_minuten, venster_minuten,
   drempel_oranje, drempel_rood, richting, n_drempel, toelichting)
values
  ('rate_limit_fail_open', 'Rate-limit fail-open (limietcheck uitgevallen)', 'aantal', 15, 1440,
   1, 2, 'hoger_is_slechter', null,
   'Aantal mislukte limietchecks in 24 uur: de rem viel wég (fail-open). Het tegenovergestelde van een 429, waar de rem juist wérkte.'),

  ('ingest_stilstand', 'Ingest-stilstand (oudste openstaande job)', 'milliseconden', 15, 0,
   1800000, 7200000, 'hoger_is_slechter', null,
   'Momentopname: de leeftijd van de oudste openstaande ingest-job (wachtend of bezig). Een lege wachtrij is groen — niets te doen is een gezonde toestand.'),

  ('ingest_doorlooptijd_p95', 'Ingest-doorlooptijd (p95)', 'milliseconden', 60, 1440,
   1800000, 7200000, 'hoger_is_slechter', null,
   'p95 van de tijd tussen aanmaken en afronden van ingest-jobs over 24 uur (eind - aangemaakt, inclusief wachttijd).')
on conflict (signaal) do nothing;

-- 429-herdefinitie (besluit 0143): rate_limit_incidenten telt voortaan uitsluitend
-- 429-responses; fail-open verhuist naar het eigen signaal hierboven. De drempels
-- (20/40) en de meetcadans blijven ongewijzigd; alleen de toelichting wordt eerlijk.
update public.platform_signaal_config
set toelichting = '429-responses in 24 uur: verzoeken die zijn afgeremd (de rem wérkte). Mislukte limietchecks staan apart in rate_limit_fail_open.',
    bijgewerkt   = now()
where signaal = 'rate_limit_incidenten';
