-- ============================================================================
-- P4 tranche 4 (#169, 0193) — status-feitenmatrix (I1), structuur + gedrag.
-- ROL: postgres. Zelf-seedend; gedrag loopt in BEGIN … ROLLBACK.
-- ============================================================================

do $$
declare
  ontbrekend text;
  fn_def text;
begin
  if to_regclass('public.besluitstatus_vereist_feit') is null then
    raise exception 'FAALT: besluitstatus_vereist_feit ontbreekt.';
  end if;
  if (select count(*) from public.besluitstatus_vereist_feit) <> 18 then
    raise exception 'FAALT: de feitenmatrix bevat niet exact 18 statussen.';
  end if;
  select string_agg(e.status, ', ') into ontbrekend
    from (values
      ('concept'),('in_onderbouwing'),('in_validatie'),('in_review'),
      ('geagendeerd'),('in_bespreking'),('besloten'),('voorwaardelijk_besloten'),
      ('afgewezen'),('aangehouden'),('geescaleerd'),('teruggezet'),
      ('in_uitvoering'),('in_evaluatie'),('afgesloten'),('heropend'),
      ('beeindigd'),('geannuleerd')
    ) e(status)
   where not exists (
     select 1 from public.besluitstatus_vereist_feit m where m.doelstatus=e.status
   );
  if ontbrekend is not null then
    raise exception 'FAALT: statussen ontbreken in de feitenmatrix: %.', ontbrekend;
  end if;

  if not (select relrowsecurity from pg_class where oid='public.besluitstatus_vereist_feit'::regclass) then
    raise exception 'FAALT: RLS staat niet aan op de globale feitenmatrix.';
  end if;
  if not has_table_privilege('authenticated','public.besluitstatus_vereist_feit','select')
     or has_table_privilege('authenticated','public.besluitstatus_vereist_feit','insert')
     or has_table_privilege('authenticated','public.besluitstatus_vereist_feit','update')
     or has_table_privilege('authenticated','public.besluitstatus_vereist_feit','delete') then
    raise exception 'FAALT: feitenmatrix-grants zijn niet authenticated SELECT-only.';
  end if;
  if to_regprocedure('public.fn_toets_besluitstatus_feit(uuid,text)') is null
     or to_regprocedure('public.fn_guard_besluitstatus_feit()') is null then
    raise exception 'FAALT: feitenmatrixfuncties ontbreken.';
  end if;
  if has_function_privilege('authenticated','public.fn_toets_besluitstatus_feit(uuid,text)','execute')
     or has_function_privilege('service_role','public.fn_toets_besluitstatus_feit(uuid,text)','execute') then
    raise exception 'FAALT: de interne feitenfunctie heeft een client/service-grant.';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid='public.decision_objects'::regclass
       and tgname='trg_besluitstatus_feit'
       and tgdeferrable and tginitdeferred and not tgisinternal
  ) then
    raise exception 'FAALT: de uitgestelde constraint-trigger ontbreekt.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='procedure_besluiten' and column_name='uitkomst'
  ) then
    raise exception 'FAALT: procedure_besluiten.uitkomst ontbreekt.';
  end if;

  select pg_get_functiondef('public.fn_toets_besluitstatus_feit(uuid,text)'::regprocedure)
    into fn_def;
  select string_agg(m.vereist_feit, ', ') into ontbrekend
    from public.besluitstatus_vereist_feit m
   where m.vereist_feit <> 'geen'
     and position(quote_literal(m.vereist_feit) in fn_def) = 0;
  if ontbrekend is not null then
    raise exception 'FAALT: matrixsleutels zonder controle-arm: %.', ontbrekend;
  end if;
  raise notice 'OK structuur: 18 statussen, RLS/grants, alle controle-armen en uitgestelde trigger.';
end $$;

begin;

insert into public.fondsen (id, naam, slug)
values ('66000000-0000-0000-0000-0000000000fa','P4 Matrixfonds','p4-matrixfonds');
insert into public.procedures (id, fonds_id, template_code, titel)
values ('66000000-0000-0000-0000-00000000000a','66000000-0000-0000-0000-0000000000fa','p4_matrix','Matrixprocedure');
insert into public.decision_objects
  (id, procedure_id, fonds_id, besluit_code, titel, besluitvraag, status, is_primary_decision)
values
  ('66000000-0000-0000-0000-0000000000d1','66000000-0000-0000-0000-00000000000a','66000000-0000-0000-0000-0000000000fa','P4-M-1','Werkstatus','Vraag','concept',true),
  ('66000000-0000-0000-0000-0000000000d2','66000000-0000-0000-0000-00000000000a','66000000-0000-0000-0000-0000000000fa','P4-M-2','Agendering','Vraag','in_review',false);

-- Verborgen legacy-status is nooit een nieuwe overgang, ook niet voor owner.
do $$ begin
  update public.decision_objects set status='geannuleerd'
   where id='66000000-0000-0000-0000-0000000000d1';
  set constraints trg_besluitstatus_feit immediate;
  raise exception 'LEK: geannuleerd werd als nieuwe status toegelaten.';
exception when sqlstate 'PC004' then
  raise notice 'OK gedrag 1: legacy-status geannuleerd fail-closed geweigerd.';
end $$;

-- Een werkstatus heeft bewust geen extern feit nodig.
update public.decision_objects set status='in_onderbouwing'
 where id='66000000-0000-0000-0000-0000000000d1';
set constraints trg_besluitstatus_feit immediate;
set constraints trg_besluitstatus_feit deferred;

-- Geagendeerd zonder agendapunt faalt.
do $$ begin
  update public.decision_objects set status='geagendeerd'
   where id='66000000-0000-0000-0000-0000000000d2';
  set constraints trg_besluitstatus_feit immediate;
  raise exception 'LEK: geagendeerd zonder gepland agendapunt toegelaten.';
exception when sqlstate 'PC004' then
  raise notice 'OK gedrag 2: geagendeerd zonder feit geweigerd.';
end $$;

insert into public.procedure_stappen
  (id, procedure_id, volgorde, naam, status)
values ('66000000-0000-0000-0000-0000000000e1','66000000-0000-0000-0000-00000000000a',1,'Agenderen','niet_begonnen');
insert into public.vergaderingen
  (id, fonds_id, titel, datum, status)
values ('66000000-0000-0000-0000-0000000000b1','66000000-0000-0000-0000-0000000000fa','Vergadering',now()+interval '7 days','gepland');
insert into public.agendapunten
  (id, vergadering_id, titel, procedure_stap_id)
values ('66000000-0000-0000-0000-0000000000c1','66000000-0000-0000-0000-0000000000b1','Matrixpunt','66000000-0000-0000-0000-0000000000e1');
update public.decision_objects set status='geagendeerd'
 where id='66000000-0000-0000-0000-0000000000d2';
set constraints trg_besluitstatus_feit immediate;

rollback;

do $$ begin raise notice 'GROEN: P4 status-feitenmatrix is volledig en bijt op ontbrekende feiten.'; end $$;
