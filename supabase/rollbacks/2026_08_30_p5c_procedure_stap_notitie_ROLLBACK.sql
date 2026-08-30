-- Rollback van 2026_08_30_p5c_procedure_stap_notitie.sql.
begin;
drop trigger if exists trg_stap_notitie_validate on public.procedure_stap_notitie;
drop function if exists public.fn_validate_stap_notitie();
drop table if exists public.procedure_stap_notitie;
commit;
