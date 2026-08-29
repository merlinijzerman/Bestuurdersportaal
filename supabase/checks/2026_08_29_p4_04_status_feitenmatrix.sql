-- P4 tranche 4 (#169) — gedragstoets I1, zelf-seedend en terugrolbaar.
-- Bewijst dat een voorzitter `besloten` niet kan claimen zonder een gebonden
-- approval-feit, en na vastlegging via exact hetzelfde RPC-pad wel kan.
-- ROL: postgres seeding/structuur; binnen de test wordt auth.uid() op een
-- voorzitter gezet, zodat juist het bevoegde browserpad I1 niet kan omzeilen.
do $$
begin
  if (select count(*) from public.besluitstatus_vereist_feit) <> 18 then
    raise exception 'P4/I1 FAALT: matrix moet exact 18 statusrijen dragen.';
  end if;
  if (select pg_get_functiondef('public.fn_besluit_status_omslag(uuid,text,text,text,jsonb)'::regprocedure))
       not like '%fn_toets_besluitstatus_feit%' then
    raise exception 'P4/I1 FAALT: fn_besluit_status_omslag roept de matrix niet aan.';
  end if;
end $$;

begin;
insert into public.fondsen (id,naam,slug) values
  ('e4e40000-0000-0000-0000-000000000001','P4 matrix-fonds','p4-matrix-fonds');
insert into auth.users (id,aud,role,email,raw_user_meta_data,created_at,updated_at) values
  ('e4e40000-0000-0000-0000-000000000002','authenticated','authenticated','p4-matrix@test.local','{"naam":"Voorzitter"}',now(),now());
insert into public.profielen (id,fonds_id,naam,rol) values
  ('e4e40000-0000-0000-0000-000000000002','e4e40000-0000-0000-0000-000000000001','Voorzitter','voorzitter');
insert into public.procedures (id,fonds_id,template_code,template_versie,titel) values
  ('e4e40000-0000-0000-0000-000000000003','e4e40000-0000-0000-0000-000000000001','p4_matrix','1.0.0','Matrixprocedure');
insert into public.procedure_stappen (id,procedure_id,volgorde,naam,vereist_besluit) values
  ('e4e40000-0000-0000-0000-000000000004','e4e40000-0000-0000-0000-000000000003',5,'Besluitmoment',true);
insert into public.decision_objects (id,procedure_id,fonds_id,besluit_code,titel,besluitvraag,is_primary_decision,status) values
  ('e4e40000-0000-0000-0000-000000000005','e4e40000-0000-0000-0000-000000000003','e4e40000-0000-0000-0000-000000000001','P4-I1','Matrix','Vraag?',true,'in_bespreking');
insert into public.procedure_requirement_instance
  (decision_id,stap_volgorde,requirement_type,label,min_aantal,actief,fonds_id,zwaarte)
values
  ('e4e40000-0000-0000-0000-000000000005',5,'approval','Goedkeuring',1,true,'e4e40000-0000-0000-0000-000000000001','vereist');

do $$
declare v_status text;
begin
  perform set_config('request.jwt.claim.sub','e4e40000-0000-0000-0000-000000000002',true);
  begin
    perform public.fn_besluit_status_omslag('e4e40000-0000-0000-0000-000000000005','besloten','vastleggen',null);
    raise exception 'P4/I1 FAALT: besloten zonder gebonden approval-feit toegestaan.';
  exception when sqlstate 'PC001' then null;
  end;
  select status into v_status from public.decision_objects where id='e4e40000-0000-0000-0000-000000000005';
  if v_status <> 'in_bespreking' then raise exception 'P4/I1 FAALT: geweigerde omslag wijzigde toch status (%).',v_status; end if;
end $$;

insert into public.procedure_besluiten
  (procedure_id,stap_id,decision_id,requirement_sleutel,formulering,datum)
values
  ('e4e40000-0000-0000-0000-000000000003','e4e40000-0000-0000-0000-000000000004',
   'e4e40000-0000-0000-0000-000000000005','5|approval|Goedkeuring','Formeel vastgesteld',current_date);

do $$
declare v_status text;
begin
  perform set_config('request.jwt.claim.sub','e4e40000-0000-0000-0000-000000000002',true);
  perform public.fn_besluit_status_omslag('e4e40000-0000-0000-0000-000000000005','besloten','vastleggen',null);
  select status into v_status from public.decision_objects where id='e4e40000-0000-0000-0000-000000000005';
  if v_status <> 'besloten' then raise exception 'P4/I1 FAALT: besloten met gebonden approval-feit geweigerd (%).',v_status; end if;
  raise notice 'OK P4/I1: statusclaim zonder feit geweigerd; met gebonden approval-feit toegelaten.';
end $$;
rollback;
