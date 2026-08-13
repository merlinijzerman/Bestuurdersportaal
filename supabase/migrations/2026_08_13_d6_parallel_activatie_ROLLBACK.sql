-- ============================================================
--  ROLLBACK — 2026_08_13_d6_parallel_activatie.sql
--
--  LET OP: het herstellen van de 3-waarden-CHECK faalt zolang er nog
--  stappen met status 'geblokkeerd'/'heropend' bestaan. Map die eerst terug
--  (bv. 'geblokkeerd' → 'open') voordat je de constraint terugzet, of laat
--  de superset-CHECK staan. Alleen draaien bij volledige terugdraai.
-- ============================================================

begin;

-- Optioneel: statussen terugmappen zodat de oude CHECK weer past.
update public.procedure_stappen set status = 'open'    where status = 'geblokkeerd';
update public.procedure_stappen set status = 'actief'  where status = 'heropend';

alter table public.procedure_stappen
  drop constraint if exists procedure_stappen_status_check;
alter table public.procedure_stappen
  add constraint procedure_stappen_status_check
  check (status in ('open','actief','afgerond'));

alter table public.procedure_stappen
  drop column if exists blokkerende_afhankelijkheden,
  drop column if exists herbevestiging_nodig,
  drop column if exists heropend_op,
  drop column if exists fase_code;

commit;
