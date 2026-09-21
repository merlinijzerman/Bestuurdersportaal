-- ============================================================================
--  #423 T4-D — ROLLBACK FASE 1 van 4: kill switch uit
-- ----------------------------------------------------------------------------
--  DIT IS HET HELE HERSTELPAD VOOR EEN INCIDENT. Fase 2 tot en met 4 zijn alleen
--  nodig bij een volledige terugbouw en horen dagen later te kunnen draaien.
--
--  VOLGORDE (gewijzigd na review op PR #425)
--      1 kill switch uit
--      2 oude bewaar_koppeling-signatuur terug
--      → OUDE APPLICATIECODE DEPLOYEN EN WAARNEMEN
--      3 rolloutpoorten weg
--      4 kolommen weg
--
--    De poorten gaan BEWUST pas in fase 3, ná de deploy. Zou fase 3 vóór de
--    deploy draaien, dan verdwijnt `copilot_lees_readiness` onder draaiende
--    nieuwe code — juist de functie waarmee die code vaststelt dat de kill
--    switch uit staat. Elke retrievalbeurt zou dan falen op een ontbrekend
--    leespad in plaats van netjes inert te zijn.
--
--  SQL-EDITORVAST: geen psql-metacommando's. Dit bestand is te plakken in de
--    Supabase SQL Editor én te draaien met psql. Het draait in één transactie,
--    dus een mislukte preflight laat niets half achter.
--
--  VUL IN: vervang hieronder VUL_IN door de naam van de operator en de reden.
-- ============================================================================
begin;

select set_config('t4d.actor', 'VUL_IN', true),
       set_config('t4d.reden', 'VUL_IN', true);

-- ── Preflight ───────────────────────────────────────────────────────────────
do $$
declare
  v_actor text := coalesce(current_setting('t4d.actor', true), '');
  v_reden text := coalesce(current_setting('t4d.reden', true), '');
begin
  if v_actor in ('', 'VUL_IN') or v_reden in ('', 'VUL_IN') then
    raise exception 'FASE 1 geweigerd: vul bovenaan dit bestand actor en reden in. Ze landen in het operatorauditspoor; een anonieme rem is geen rem die je later kunt verantwoorden.';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'microsoft_private' and p.proname = 'copilot_zet_rollout'
  ) then
    raise exception 'FASE 1 kan niet: copilot_zet_rollout bestaat niet. Migratie 423a is niet toegepast, of fase 3 is al gedraaid — er is dan geen kill switch om uit te zetten.';
  end if;
end $$;

-- ── De rem ──────────────────────────────────────────────────────────────────
do $$
begin
  perform microsoft_private.copilot_zet_rollout(
    false,
    current_setting('t4d.actor', true),
    current_setting('t4d.reden', true));
end $$;

-- ── Eindcontrole ────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from microsoft_private.copilot_rollout where aan) then
    raise exception 'FASE 1 mislukt: de kill switch staat nog aan';
  end if;
  if not exists (
    select 1 from microsoft_private.copilot_operator_log where handeling = 'copilot.rollout.uit'
  ) then
    raise exception 'FASE 1 mislukt: er is geen auditspoor van het uitzetten';
  end if;
  raise notice 'FASE 1 geslaagd: de Copilot-arm is inert. Bij een incident stopt het hier; fase 2 t/m 4 zijn alleen nodig bij een volledige terugbouw.';
end $$;

commit;
