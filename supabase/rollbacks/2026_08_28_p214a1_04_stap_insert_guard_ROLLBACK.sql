-- ROLLBACK van 2026_08_28_p214a1_04 (#214-a1 / 0194). Verwijdert de INSERT-poort.
-- LET OP: heropent de INSERT-omzeiling (nieuwe stap direct als afgerond aanmaken).
begin;
drop trigger if exists trg_guard_stap_insert on public.procedure_stappen;
drop function if exists public.fn_guard_stap_insert();
commit;
