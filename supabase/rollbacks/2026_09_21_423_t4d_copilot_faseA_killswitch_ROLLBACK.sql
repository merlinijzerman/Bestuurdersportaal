-- ============================================================================
--  #423 T4-D — ROLLBACK FASE A: kill switch uit
-- ----------------------------------------------------------------------------
--  DIT IS HET HELE HERSTELPAD VOOR EEN INCIDENT. Fase B tot en met D zijn
--  alleen nodig bij een volledige terugbouw, en horen dagen later te kunnen
--  draaien — niet in dezelfde minuut.
--
--  Waarom vier losse bestanden en niet één: een gefaseerde rollback die je in
--  één keer kunt plakken is geen gefaseerde rollback. Tussen het herstellen van
--  de oude DB-signatuur, het terugzetten van de oude applicatiecode en het
--  verwijderen van de kolommen hoort een deploy en een waarneming te zitten.
--  Elke fase weigert daarom te draaien tot haar voorwaarde aantoonbaar is
--  vervuld; de reviewbevinding op PR #425 wees terecht op dat gat.
--
--  VOORWAARDE   geen.
--  GEVOLG       de arm is onmiddellijk inert, ongeacht fondsflag, billing of
--               consent. Daarom staat de kill switch vooraan in de
--               evaluatievolgorde en niet achteraan.
--
--  GEBRUIK
--    psql "$DB" -v ON_ERROR_STOP=1 \
--         -v actor='<naam>' -v reden='<incident>' \
--         -f supabase/rollbacks/2026_09_21_423_t4d_copilot_faseA_killswitch_ROLLBACK.sql
-- ============================================================================
\set ON_ERROR_STOP on
\if :{?actor} \else \set actor '' \endif
\if :{?reden} \else \set reden '' \endif

-- ── Preflight ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'microsoft_private' and p.proname = 'copilot_zet_rollout'
  ) then
    raise exception 'FASE A kan niet: copilot_zet_rollout bestaat niet. Migratie 423a is niet toegepast, of fase B is al gedraaid — er is dan geen kill switch om uit te zetten.';
  end if;
end $$;

-- De functie eist zelf een niet-lege actor en reden; een lege waarde faalt hier
-- met een duidelijke melding in plaats van een anoniem auditspoor.
select microsoft_private.copilot_zet_rollout(false, :'actor', :'reden');

-- ── Eindcontrole ────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from microsoft_private.copilot_rollout where aan) then
    raise exception 'FASE A mislukt: de kill switch staat nog aan';
  end if;
  if not exists (
    select 1 from microsoft_private.copilot_operator_log
     where handeling = 'copilot.rollout.uit'
  ) then
    raise exception 'FASE A mislukt: er is geen auditspoor van het uitzetten';
  end if;
  raise notice 'FASE A geslaagd: de Copilot-arm is inert. Fase B t/m D zijn alleen nodig bij een volledige terugbouw.';
end $$;
