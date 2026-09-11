-- Rollback #367 — herstel de wrappers zonder de nieuwe correlation-id-toevoeging.
-- De onderliggende meta_projectie uit de voorgaande migratie blijft leidend.

create or replace function public.meta_basisniveau(p_meta jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select public.meta_projectie(p_meta, false);
$$;

create or replace function public.meta_bronniveau(p_meta jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select public.meta_projectie(p_meta, true);
$$;

revoke all on function public.meta_basisniveau(jsonb) from public, anon;
revoke all on function public.meta_bronniveau(jsonb) from public, anon;
grant execute on function public.meta_basisniveau(jsonb) to authenticated;
grant execute on function public.meta_bronniveau(jsonb) to authenticated;
