-- P4 tranche 4 (#169) — status-feitenmatrix: I1 voorwaarts gesloten.
-- HAND-APPLIED. Rollback: 2026_08_29_p4_04_status_feitenmatrix_ROLLBACK.sql
begin;

create table if not exists public.besluitstatus_vereist_feit (
  doelstatus text primary key check (doelstatus in (
    'concept','in_onderbouwing','in_validatie','in_review','geagendeerd',
    'in_bespreking','besloten','voorwaardelijk_besloten','afgewezen',
    'aangehouden','geescaleerd','teruggezet','in_uitvoering','in_evaluatie',
    'afgesloten','heropend','geannuleerd','beeindigd'
  )),
  vereist_feit text not null check (vereist_feit in (
    'geen','agendapunt_gepland','agendapunt_vandaag_of_eerder',
    'gebonden_approval','gebonden_approval_met_voorwaarde',
    'vastgelegd_afwijzend_besluit','vastgelegde_aanhouding',
    'escalatie_met_geadresseerde','terugzet_motivering_en_doel',
    'eerder_besloten','eerder_besloten_met_geplande_evaluatie',
    'alle_besluitmomenten_gebonden_besluit',
    'heropen_motivering_en_terminale_status',
    'beeindiging_met_reden_en_actor','niet_kiesbaar'
  )),
  toelichting text not null
);
comment on table public.besluitstatus_vereist_feit is
  'P4 (#169), I1: per doelstatus het feit dat vóór de omslag moet bestaan.';
alter table public.besluitstatus_vereist_feit enable row level security;
revoke all on public.besluitstatus_vereist_feit from public, anon, authenticated;
grant select, insert, update, delete on public.besluitstatus_vereist_feit to service_role;

insert into public.besluitstatus_vereist_feit (doelstatus, vereist_feit, toelichting) values
  ('concept','geen','Werktoestand.'),
  ('in_onderbouwing','geen','Werktoestand.'),
  ('in_validatie','geen','Werktoestand.'),
  ('in_review','geen','Werktoestand.'),
  ('geagendeerd','agendapunt_gepland','Gekoppeld agendapunt op geplande vergadering.'),
  ('in_bespreking','agendapunt_vandaag_of_eerder','Gekoppeld agendapunt op vergadering van vandaag of eerder.'),
  ('besloten','gebonden_approval','Formeel besluit gebonden aan approval-vereiste.'),
  ('voorwaardelijk_besloten','gebonden_approval_met_voorwaarde','Gebonden approval plus vastgelegde voorwaarde.'),
  ('afgewezen','vastgelegd_afwijzend_besluit','Formeel vastgelegd besluit.'),
  ('aangehouden','vastgelegde_aanhouding','Aanhoudingsreden wordt atomair vastgelegd.'),
  ('geescaleerd','escalatie_met_geadresseerde','Escalatieactie met geadresseerde.'),
  ('teruggezet','terugzet_motivering_en_doel','Motivering en bestaande doelstatus.'),
  ('in_uitvoering','eerder_besloten','Volgt op vastgesteld besluit.'),
  ('in_evaluatie','eerder_besloten_met_geplande_evaluatie','Vastgesteld besluit met geplande evaluatie.'),
  ('afgesloten','alle_besluitmomenten_gebonden_besluit','Ieder besluitmoment draagt een formeel besluit.'),
  ('heropend','heropen_motivering_en_terminale_status','Motivering plus terminale bronstatus.'),
  ('geannuleerd','niet_kiesbaar','Verborgen legacy-opslagwaarde.'),
  ('beeindigd','beeindiging_met_reden_en_actor','Beëindigingsevent met reden en actor.')
on conflict (doelstatus) do update set vereist_feit = excluded.vereist_feit, toelichting = excluded.toelichting;

create or replace function public.fn_toets_besluitstatus_feit(
  p_decision_id uuid, p_doelstatus text, p_reden text default null, p_motivering text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_feit text; v_dec public.decision_objects; v_ok boolean := false;
  v_tekst_ok boolean := coalesce(length(btrim(coalesce(p_reden, p_motivering, ''))), 0) >= 10;
begin
  select vereist_feit into v_feit from public.besluitstatus_vereist_feit where doelstatus = p_doelstatus;
  if not found then raise exception 'I1: doelstatus "%" ontbreekt in besluitstatus_vereist_feit.', p_doelstatus using errcode='23514'; end if;
  select * into v_dec from public.decision_objects where id = p_decision_id;
  if not found then raise exception 'I1: Decision Object niet gevonden.' using errcode='23514'; end if;
  case v_feit
    when 'geen' then v_ok := true;
    when 'agendapunt_gepland' then select exists (
      select 1 from public.agendapunten ap join public.procedure_stappen ps on ps.id=ap.procedure_stap_id
      join public.vergaderingen vg on vg.id=ap.vergadering_id
      where ps.procedure_id=v_dec.procedure_id and ap.verwijderd_op is null and vg.status='gepland') into v_ok;
    when 'agendapunt_vandaag_of_eerder' then select exists (
      select 1 from public.agendapunten ap join public.procedure_stappen ps on ps.id=ap.procedure_stap_id
      join public.vergaderingen vg on vg.id=ap.vergadering_id
      where ps.procedure_id=v_dec.procedure_id and ap.verwijderd_op is null and vg.datum::date<=current_date) into v_ok;
    when 'gebonden_approval', 'gebonden_approval_met_voorwaarde' then
      select exists (select 1 from public.procedure_besluiten pb join public.procedure_requirement_instance pri
        on pri.decision_id=v_dec.id
       and (pri.stap_volgorde::text || '|' || pri.requirement_type || '|' || coalesce(pri.documenttype,pri.label))=pb.requirement_sleutel
       and pri.requirement_type='approval'
        where pb.decision_id=v_dec.id and pb.requirement_sleutel is not null) into v_ok;
      if v_ok and v_feit='gebonden_approval_met_voorwaarde' then
        select exists (select 1 from public.decision_conditions where decision_id=v_dec.id) into v_ok;
      end if;
    when 'vastgelegd_afwijzend_besluit' then
      select exists (select 1 from public.procedure_besluiten where decision_id=v_dec.id) into v_ok;
    when 'vastgelegde_aanhouding', 'terugzet_motivering_en_doel' then v_ok := v_tekst_ok and v_dec.status is not null;
    when 'escalatie_met_geadresseerde' then select exists (select 1 from public.decision_actions
      where decision_id=v_dec.id and status='escalatie' and nullif(btrim(eigenaar_naam),'') is not null) into v_ok;
    when 'eerder_besloten' then v_ok := v_dec.status in ('besloten','voorwaardelijk_besloten');
    when 'eerder_besloten_met_geplande_evaluatie' then v_ok := v_dec.status in ('in_uitvoering','besloten','voorwaardelijk_besloten')
      and exists (select 1 from public.decision_evaluations where decision_id=v_dec.id);
    when 'alle_besluitmomenten_gebonden_besluit' then select not exists (
      select 1 from public.procedure_stappen ps where ps.procedure_id=v_dec.procedure_id and ps.vereist_besluit
        and not exists (select 1 from public.procedure_besluiten pb where pb.decision_id=v_dec.id and pb.stap_id=ps.id)) into v_ok;
    when 'heropen_motivering_en_terminale_status' then v_ok := v_tekst_ok and v_dec.status in ('besloten','voorwaardelijk_besloten','in_evaluatie','afgesloten','beeindigd');
    when 'beeindiging_met_reden_en_actor' then select exists (select 1 from public.governance_events
      where decision_id=v_dec.id and event_type='procedure_beeindigd' and actor_id is not null and nullif(btrim(reden),'') is not null) into v_ok;
    when 'niet_kiesbaar' then v_ok := false;
    else raise exception 'I1: vereist_feit "%" heeft geen controlefunctie.', v_feit using errcode='23514';
  end case;
  if not v_ok then raise exception 'I1: status "%" vereist feit "%"; feit ontbreekt of is niet geldig.', p_doelstatus,v_feit using errcode='PC001'; end if;
end $$;
revoke all on function public.fn_toets_besluitstatus_feit(uuid,text,text,text) from public, anon, authenticated, service_role;

-- Cascade is geen expliciet starten: vrijgeven eindigt op niet_begonnen.
create or replace function public.fn_stap_vrijgeven(p_stap_id uuid, p_procedure_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid:=auth.uid(); v_actorfonds uuid; v_proc record; v_stap record;
begin
  if v_actor is null then raise exception 'Niet ingelogd.' using errcode='42501'; end if;
  select fonds_id into v_actorfonds from public.profielen where id=v_actor;
  select id,fonds_id into v_proc from public.procedures where id=p_procedure_id;
  if not found then raise exception 'Procedure niet gevonden (fail-closed).' using errcode='23514'; end if;
  if v_actorfonds is distinct from v_proc.fonds_id then raise exception 'Fondsgrens: vrijgeven niet in het eigen fonds.' using errcode='42501'; end if;
  select id,status into v_stap from public.procedure_stappen where id=p_stap_id and procedure_id=p_procedure_id for update;
  if not found then raise exception 'Stap niet gevonden bij deze procedure.' using errcode='PC002'; end if;
  if v_stap.status='niet_begonnen' then return jsonb_build_object('ok',true,'onveranderd',true); end if;
  if v_stap.status is distinct from 'open' and v_stap.status is distinct from 'geblokkeerd' then raise exception 'Alleen een open of geblokkeerde stap kan worden vrijgegeven.' using errcode='PC002'; end if;
  update public.procedure_stappen set status='niet_begonnen' where id=p_stap_id;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.fn_stap_vrijgeven(uuid,uuid) from public, anon, service_role;
grant execute on function public.fn_stap_vrijgeven(uuid,uuid) to authenticated;
commit;
