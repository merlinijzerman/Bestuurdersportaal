-- #462 PR-5 — herstel de vorige (#368/#434) bronprojectie.
create or replace function public.meta_bronniveau(p_meta jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select public.meta_basisniveau(p_meta)
    || public.meta_projectie(p_meta, true);
$$;

revoke all on function public.meta_bronniveau(jsonb) from public, anon;
grant execute on function public.meta_bronniveau(jsonb) to authenticated;

drop function if exists public.meta_agendapunt_sharepoint_projectie(jsonb);
