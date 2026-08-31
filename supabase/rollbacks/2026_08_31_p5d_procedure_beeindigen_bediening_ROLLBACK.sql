-- #256 rollback. Alleen toepassen zolang geen beëindiging met de nieuwe
-- snapshotvorm is geregistreerd; anders zou heropenen haar herstelspoor verliezen.

begin;

do $$
begin
  if exists (
    select 1 from public.procedure_log
     where event_type = 'procedure_beeindigd'
       and payload ? 'vervallen_stappen'
  ) then
    raise exception 'Rollback #256 geweigerd: er bestaan beëindigingssnapshots.';
  end if;
end $$;

-- Herstel ook de oorspronkelijke P4-beëindigingsfunctie (zonder snapshot en
-- stapmutatie), zodat rollback niet half op het nieuwe contract blijft staan.
create or replace function public.fn_procedure_beeindigen(p_procedure_id uuid, p_reden text)
returns jsonb language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := auth.uid(); v_rol text; v_naam text; v_afonds uuid;
  v_proc record; v_dec_id uuid;
begin
  if v_actor is null then raise exception 'Niet ingelogd.' using errcode = '42501'; end if;
  select rol, naam, fonds_id into v_rol, v_naam, v_afonds from public.profielen where id = v_actor;
  select id, fonds_id into v_proc from public.procedures where id = p_procedure_id for update;
  if not found then raise exception 'Procedure niet gevonden (fail-closed).' using errcode = '23514'; end if;
  if v_rol is distinct from 'voorzitter' and v_rol is distinct from 'bestuurder' then raise exception 'Alleen voorzitter of bestuurder kan een procedure beëindigen.' using errcode = '42501'; end if;
  if v_afonds is distinct from v_proc.fonds_id then raise exception 'Fondsgrens: beëindigen niet in het eigen fonds.' using errcode = '42501'; end if;
  if p_reden is null or length(btrim(p_reden)) < 10 then raise exception 'Beëindigen vereist een motivering van minimaal 10 tekens.' using errcode = 'PC002'; end if;
  select id into v_dec_id from public.decision_objects where procedure_id = p_procedure_id and is_primary_decision = true limit 1;
  if v_dec_id is null then raise exception 'Geen primair Decision Object voor de procedure (fail-closed).' using errcode = '23514'; end if;
  update public.decision_objects set status = 'beeindigd' where id = v_dec_id;
  insert into public.governance_events (decision_id,event_type,actor_id,actor_naam,object_type,object_id,nieuwe_waarde,reden)
  values (v_dec_id,'procedure_beeindigd',v_actor,v_naam,'procedure',p_procedure_id,jsonb_build_object('status','beeindigd','rol_op_moment',v_rol),p_reden);
  insert into public.procedure_log (procedure_id,event_type,actor_id,actor_naam,payload)
  values (p_procedure_id,'procedure_beeindigd',v_actor,v_naam,jsonb_build_object('motivering',p_reden,'rol_op_moment',v_rol));
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.fn_procedure_beeindigen(uuid, text) from public, anon, service_role;
grant execute on function public.fn_procedure_beeindigen(uuid, text) to authenticated;

drop function if exists public.fn_procedure_heropenen(uuid, text, text);

-- Herstel de P4-signatuur. De volledige implementatie blijft bewust identiek
-- aan tranche 6; een rollback herstelt dus ook het eerdere contract.
create function public.fn_procedure_heropenen(
  p_procedure_id uuid,
  p_reden text
) returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := auth.uid(); v_rol text; v_naam text; v_afonds uuid;
  v_proc record; v_dec record;
begin
  if v_actor is null then raise exception 'Niet ingelogd.' using errcode = '42501'; end if;
  select rol, naam, fonds_id into v_rol, v_naam, v_afonds from public.profielen where id = v_actor;
  select id, fonds_id into v_proc from public.procedures where id = p_procedure_id for update;
  if not found then raise exception 'Procedure niet gevonden (fail-closed).' using errcode = '23514'; end if;
  if v_rol is distinct from 'voorzitter' and v_rol is distinct from 'bestuurder' then raise exception 'Alleen voorzitter of bestuurder kan een procedure heropenen.' using errcode = '42501'; end if;
  if v_afonds is distinct from v_proc.fonds_id then raise exception 'Fondsgrens: heropenen niet in het eigen fonds.' using errcode = '42501'; end if;
  if p_reden is null or length(btrim(p_reden)) < 10 then raise exception 'Heropenen vereist een motivering van minimaal 10 tekens.' using errcode = 'PC002'; end if;
  select id, status into v_dec from public.decision_objects where procedure_id = p_procedure_id and is_primary_decision = true limit 1;
  if v_dec.id is null then raise exception 'Geen primair Decision Object voor de procedure (fail-closed).' using errcode = '23514'; end if;
  if v_dec.status is distinct from 'beeindigd' then raise exception 'Alleen een beëindigde procedure kan worden heropend.' using errcode = 'PC002'; end if;
  update public.decision_objects set status = 'heropend' where id = v_dec.id;
  insert into public.governance_events (decision_id,event_type,actor_id,actor_naam,object_type,object_id,oude_waarde,nieuwe_waarde,reden)
  values (v_dec.id,'procedure_heropend',v_actor,v_naam,'procedure',p_procedure_id,jsonb_build_object('status','beeindigd'),jsonb_build_object('status','heropend','rol_op_moment',v_rol),p_reden);
  insert into public.procedure_log (procedure_id,event_type,actor_id,actor_naam,payload)
  values (p_procedure_id,'procedure_heropend',v_actor,v_naam,jsonb_build_object('motivering',p_reden,'rol_op_moment',v_rol));
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.fn_procedure_heropenen(uuid, text) from public, anon, service_role;
grant execute on function public.fn_procedure_heropenen(uuid, text) to authenticated;

commit;
