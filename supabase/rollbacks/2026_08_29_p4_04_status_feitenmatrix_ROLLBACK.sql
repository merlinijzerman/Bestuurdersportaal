-- ROLLBACK P4 tranche 4; zet eerst de aanroepen van de matrix terug.
begin;
revoke all on function public.fn_stap_vrijgeven(uuid,uuid) from public, anon, authenticated, service_role;
drop function if exists public.fn_stap_vrijgeven(uuid,uuid);
revoke all on function public.fn_toets_besluitstatus_feit(uuid,text,text,text) from public, anon, authenticated, service_role;
drop function if exists public.fn_toets_besluitstatus_feit(uuid,text,text,text);
drop table if exists public.besluitstatus_vereist_feit;
commit;
