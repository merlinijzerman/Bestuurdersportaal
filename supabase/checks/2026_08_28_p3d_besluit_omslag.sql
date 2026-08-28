-- ============================================================================
-- Gedragstoets 2026-08-28 — fn_besluit_status_omslag (P3/PR-D, #168, 0193)
-- ----------------------------------------------------------------------------
-- Bewijst de reviewfix: de statusomslag + de vastlegging landen ATOMAIR (één
-- transactie), zodat een besluit met openstaande vereisten niet kan bestaan zónder
-- het append-only besluit_genomen_met_openstaande_vereisten-event. Plus: I2
-- (motivering-minimumlengte) DB-afgedwongen, en het eigen slot (rol-in-fonds).
-- Zelf-seedend, in transacties met ROLLBACK.
--
-- ROL: postgres voor structuur en seed; de gedragsscenario's zetten
-- request.jwt.claim.sub (auth.uid()) op de handelende actor. De functie is SECURITY
-- DEFINER met een eigen slot; #4 meet dat slot rechtstreeks.
-- Uitvoeren: psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand.
-- ============================================================================

-- DEEL 1 — STRUCTUUR
do $$
begin
  if not exists (select 1 from pg_proc where proname='fn_besluit_status_omslag') then
    raise exception 'DEEL 1 FAALT: fn_besluit_status_omslag ontbreekt.';
  end if;
  if has_function_privilege('service_role','public.fn_besluit_status_omslag(uuid,text,text,text,jsonb)','execute') then
    raise exception 'DEEL 1 FAALT: service_role heeft execute (geen mens erachter).';
  end if;
  if not has_function_privilege('authenticated','public.fn_besluit_status_omslag(uuid,text,text,text,jsonb)','execute') then
    raise exception 'DEEL 1 FAALT: authenticated mist execute.';
  end if;
  raise notice 'DEEL 1 OK: functie aanwezig, grants correct.';
end $$;

-- DEEL 2 — GEDRAG. begin ... rollback.
begin;

insert into public.fondsen (id, naam, slug)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd','PD Testfonds','pd-testfonds');
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('dddddddd-0000-0000-0000-0000000000a1'::uuid,'authenticated','authenticated','vz@pd.local','{"naam":"Voorzitter"}',now(),now()),
       ('dddddddd-0000-0000-0000-0000000000b1'::uuid,'authenticated','authenticated','x@vreemd.local','{"naam":"Vreemd"}',now(),now());
insert into public.profielen (id, fonds_id, naam, rol)
values ('dddddddd-0000-0000-0000-0000000000a1'::uuid,'dddddddd-dddd-dddd-dddd-dddddddddddd','Voorzitter','voorzitter');
-- Vreemde actor in een ANDER fonds.
insert into public.fondsen (id, naam, slug) values ('dddddddd-eeee-eeee-eeee-dddddddddddd','Ander','pd-ander');
insert into public.profielen (id, fonds_id, naam, rol)
values ('dddddddd-0000-0000-0000-0000000000b1'::uuid,'dddddddd-eeee-eeee-eeee-dddddddddddd','Vreemd','voorzitter');
insert into public.procedures (id, fonds_id, template_code, template_versie, titel)
values ('dddddddd-0000-0000-0000-0000000000f1','dddddddd-dddd-dddd-dddd-dddddddddddd','pd_test_template','1.0.0','PD-procedure');
-- Vier besluiten, elk 'in_bespreking' — één per scenario (de I4-transitietrigger
-- valideert óók directe updates, dus resetten kan niet; een vers besluit per test).
insert into public.decision_objects (id, procedure_id, fonds_id, besluit_code, titel, besluitvraag, is_primary_decision, status)
values ('dddddddd-0000-0000-0000-0000000000d1','dddddddd-0000-0000-0000-0000000000f1',
        'dddddddd-dddd-dddd-dddd-dddddddddddd','PD-0001','PD1','Vraag?', true, 'in_bespreking'),
       ('dddddddd-0000-0000-0000-0000000000d2','dddddddd-0000-0000-0000-0000000000f1',
        'dddddddd-dddd-dddd-dddd-dddddddddddd','PD-0002','PD2','Vraag?', false, 'in_bespreking'),
       ('dddddddd-0000-0000-0000-0000000000d3','dddddddd-0000-0000-0000-0000000000f1',
        'dddddddd-dddd-dddd-dddd-dddddddddddd','PD-0003','PD3','Vraag?', false, 'in_bespreking'),
       ('dddddddd-0000-0000-0000-0000000000d4','dddddddd-0000-0000-0000-0000000000f1',
        'dddddddd-dddd-dddd-dddd-dddddddddddd','PD-0004','PD4','Vraag?', false, 'in_bespreking');

-- #1 geldige besluit-met-open: status → besloten, atomair mét beide events.
do $$
declare v_ev1 int; v_ev2 int; v_status text;
begin
  perform set_config('request.jwt.claim.sub','dddddddd-0000-0000-0000-0000000000a1',true);
  perform public.fn_besluit_status_omslag(
    'dddddddd-0000-0000-0000-0000000000d1', 'besloten', 'reden', 'Termijndruk DNB',
    '{"kritiek":[{"label":"K","requirement_sleutel":"1|document|K"}],"vereist":[]}'::jsonb);
  select status into v_status from public.decision_objects where id='dddddddd-0000-0000-0000-0000000000d1';
  select count(*) into v_ev1 from public.governance_events
    where decision_id='dddddddd-0000-0000-0000-0000000000d1' and event_type='besluit_genomen_met_openstaande_vereisten';
  select count(*) into v_ev2 from public.governance_events
    where decision_id='dddddddd-0000-0000-0000-0000000000d1' and event_type='status_gewijzigd';
  if v_status <> 'besloten' or v_ev1 <> 1 or v_ev2 <> 1 then
    raise exception 'FAALT #1: atomaire omslag niet compleet (status=%, besluit_event=%, status_event=%).', v_status, v_ev1, v_ev2;
  end if;
  raise notice 'OK #1: status + besluit_genomen + status_gewijzigd atomair geschreven.';
end $$;

-- #2 besluit-met-open zonder (voldoende) motivering → PC002 (I2), niets gewijzigd.
do $$
declare v_status text;
begin
  perform set_config('request.jwt.claim.sub','dddddddd-0000-0000-0000-0000000000a1',true);
  begin
    perform public.fn_besluit_status_omslag(
      'dddddddd-0000-0000-0000-0000000000d2', 'besloten', null, 'kort',
      '{"kritiek":[{"label":"K","requirement_sleutel":"1|document|K"}],"vereist":[]}'::jsonb);
    raise exception 'FAALT #2: te korte motivering geaccepteerd.';
  exception when sqlstate 'PC002' then null;
  end;
  select status into v_status from public.decision_objects where id='dddddddd-0000-0000-0000-0000000000d2';
  if v_status <> 'in_bespreking' then
    raise exception 'FAALT #2: status wijzigde ondanks de PC002-weigering (%).', v_status;
  end if;
  raise notice 'OK #2: I2 DB-afgedwongen — te korte motivering weigert, status onveranderd.';
end $$;

-- #3 gewone overgang zonder iets open (p_openstaand null): update + status_gewijzigd,
--    GEEN besluit_genomen_met_openstaande_vereisten.
do $$
declare v_ev int;
begin
  perform set_config('request.jwt.claim.sub','dddddddd-0000-0000-0000-0000000000a1',true);
  perform public.fn_besluit_status_omslag(
    'dddddddd-0000-0000-0000-0000000000d3', 'besloten', 'gewoon', null, null);
  select count(*) into v_ev from public.governance_events
    where decision_id='dddddddd-0000-0000-0000-0000000000d3'
      and event_type='besluit_genomen_met_openstaande_vereisten'
      and nieuwe_waarde->>'target_status' is not null;
  if v_ev <> 0 then
    raise exception 'FAALT #3: een besluit ZONDER open vereisten schreef toch een openstaande-vereisten-event (%).', v_ev;
  end if;
  raise notice 'OK #3: overgang zonder open vereisten schrijft geen openstaande-vereisten-event.';
end $$;

-- #4 eigen slot: een actor uit een VREEMD fonds → 42501.
do $$
begin
  perform set_config('request.jwt.claim.sub','dddddddd-0000-0000-0000-0000000000b1',true);
  begin
    perform public.fn_besluit_status_omslag(
      'dddddddd-0000-0000-0000-0000000000d4', 'besloten', 'x', 'Ruime motivering hier', null);
    raise exception 'FAALT #4: vreemd-fonds actor mocht de omslag doen.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK #4: eigen slot — vreemd-fonds actor geweigerd (42501).';
end $$;

rollback;

do $$ begin raise notice 'Besluit-omslag-gedragstoets afgerond — alle checks groen.'; end $$;
