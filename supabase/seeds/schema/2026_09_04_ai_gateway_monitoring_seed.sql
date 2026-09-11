-- #311/T5 — zichtbaar signaal voor mislukte private gateway-auditregels.
-- Data-seed: geen schema-, policy- of grantwijziging. Vóór de code-deploy draaien.
insert into public.platform_signaal_config
  (signaal, label, eenheid, interval_minuten, venster_minuten,
   drempel_oranje, drempel_rood, richting, n_drempel, toelichting)
values
  ('gateway_log_fouten', 'AI-gateway auditlogfouten', 'aantal', 15, 1440,
   1, 2, 'hoger_is_slechter', null,
   'Aantal providercalls waarvan de inhoudsvrije gateway-auditregel niet kon worden opgeslagen in de afgelopen 24 uur.')
on conflict (signaal) do nothing;

