-- ============================================================================
--  ROLLBACK 2026-07-31 — R6: default privileges
--
--  ⚠️  Dit zet de Supabase-standaard terug voor TOEKOMSTIGE objecten: elke
--  nieuwe tabel in `public` geeft anon weer alle rechten (incl. INSERT en
--  TRUNCATE, dat RLS niet afdekt), en elke nieuwe functie is weer uitvoerbaar
--  door de publieke anon-key — ook een SECURITY DEFINER-functie, die RLS
--  volledig omzeilt.
--
--  Bestaande objecten worden hier niet geraakt; daarvoor is de R4-rollback.
--
--  Draai dit alleen als aantoonbaar blijkt dat een nieuw aangemaakt object
--  daardoor onbruikbaar is, en geef dan gericht terug in plaats van deze
--  toestand te laten staan.
-- ============================================================================

begin;

alter default privileges in schema public
  grant execute on functions to anon;

alter default privileges in schema public
  grant insert, update, delete, truncate, references, trigger on tables to anon;

alter default privileges in schema public
  grant truncate, references, trigger on tables to authenticated;

do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'alter default privileges in schema public grant maintain on tables to anon';
  end if;
end $$;

commit;
