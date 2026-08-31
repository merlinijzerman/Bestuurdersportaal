-- #212 — herstel de begrensde publieke contactstatus-RPC ná de Preview-baseline.
--
-- De gesquashte baseline van 14-08 bevatte per abuis nog de oude, onbegrensde
-- variant. De historische migratie van 12-07 blijft daarom onaangeroerd: deze
-- nieuwe forward-migratie is de enige driftvrije manier om Preview en later
-- Productie op dezelfde, beperkte uitvoering te brengen.
--
-- De RPC blijft bewust publiek (anon + authenticated), maar kan alleen de
-- mailstatus van een recente, nog niet gemarkeerde contactaanvraag zetten en
-- kapt fouttekst af. Er is geen leespad of tenantobject bereikbaar.

begin;

create or replace function public.contact_notificatie_status(
  p_id uuid,
  p_verzonden boolean,
  p_error text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.contact_aanvragen
  set notificatie_verzonden = p_verzonden,
      mail_error = left(p_error, 500)
  where id = p_id
    and aangemaakt_op >= now() - interval '1 hour'
    and notificatie_verzonden = false;
$$;

revoke all on function public.contact_notificatie_status(uuid, boolean, text)
  from public;
grant execute on function public.contact_notificatie_status(uuid, boolean, text)
  to anon, authenticated, service_role;

do $$
declare
  body text;
begin
  select lower(pg_get_functiondef('public.contact_notificatie_status(uuid,boolean,text)'::regprocedure))
    into body;

  if body !~ 'aangemaakt_op'
     or body !~ '1 hour'
     or body !~ 'notificatie_verzonden = false'
     or body !~ 'left\(p_error, 500\)'
     or not has_function_privilege('anon', 'public.contact_notificatie_status(uuid,boolean,text)'::regprocedure, 'execute')
     or not has_function_privilege('authenticated', 'public.contact_notificatie_status(uuid,boolean,text)'::regprocedure, 'execute')
     or has_function_privilege('public', 'public.contact_notificatie_status(uuid,boolean,text)'::regprocedure, 'execute') then
    raise exception '#212 contact_notificatie_status is niet aantoonbaar publiek-begrensd hersteld';
  end if;
end $$;

commit;
