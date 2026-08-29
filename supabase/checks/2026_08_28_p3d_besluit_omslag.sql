-- ============================================================================
-- Gedragstoets 2026-08-28 — fn_besluit_status_omslag (P3/PR-D, #168, 0193)
-- ----------------------------------------------------------------------------
-- Bewijst drie dingen:
--  A. De statusomslag + de vastlegging landen ATOMAIR (één transactie): een besluit
--     met openstaande vereisten kan niet bestaan zónder het append-only
--     besluit_genomen_met_openstaande_vereisten-event.
--  B. "Open" wordt door de FUNCTIE in SQL berekend (besluitmoment-scoped), niet
--     meegegeven — de motiveringseis (I2) is dus niet te ontlopen door de aanroeper.
--     Het event draagt open_voor_besluitmoment (SQL) én de actor-rol (momentopname).
--  C. Het directe pad is dicht: als `authenticated` faalt een rechtstreekse
--     UPDATE op decision_objects.status met een privilegefout (kolom-revoke, p3d_03);
--     de RPC (SECURITY DEFINER, owner) is het enige pad.
-- Zelf-seedend, in transacties met ROLLBACK.
--
-- ROL: postgres voor structuur en seed; de gedragsscenario's zetten
-- request.jwt.claim.sub (auth.uid()) op de handelende actor. #4 meet het eigen slot,
-- #5 zet expliciet `role authenticated` om de kolom-revoke te meten.
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
  -- Kolom-revoke (p3d_03): authenticated mag status NIET direct schrijven.
  if has_column_privilege('authenticated','public.decision_objects','status','update') then
    raise exception 'DEEL 1 FAALT: authenticated heeft UPDATE op decision_objects.status (kolom-revoke mist).';
  end if;
  if not has_column_privilege('authenticated','public.decision_objects','titel','update') then
    raise exception 'DEEL 1 FAALT: authenticated mist UPDATE op titel (her-grant te breed ingetrokken).';
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_decision_insert_status_slot') then
    raise exception 'DEEL 1 FAALT: trg_decision_insert_status_slot (INSERT-slot) ontbreekt.';
  end if;
  raise notice 'DEEL 1 OK: functie aanwezig, grants correct, status-kolom-revoke + INSERT-slot actief.';
end $$;

-- DEEL 2 — GEDRAG. begin ... rollback.
begin;

insert into public.fondsen (id, naam, slug)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd','PD Testfonds','pd-testfonds'),
       ('dddddddd-eeee-eeee-eeee-dddddddddddd','Ander','pd-ander');
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('dddddddd-0000-0000-0000-0000000000a1'::uuid,'authenticated','authenticated','vz@pd.local','{"naam":"Voorzitter"}',now(),now()),
       ('dddddddd-0000-0000-0000-0000000000b1'::uuid,'authenticated','authenticated','x@vreemd.local','{"naam":"Vreemd"}',now(),now());
insert into public.profielen (id, fonds_id, naam, rol)
values ('dddddddd-0000-0000-0000-0000000000a1'::uuid,'dddddddd-dddd-dddd-dddd-dddddddddddd','Voorzitter','voorzitter'),
       ('dddddddd-0000-0000-0000-0000000000b1'::uuid,'dddddddd-eeee-eeee-eeee-dddddddddddd','Vreemd','voorzitter');

-- Vijf procedures, elk met een besluitmoment-stap (volgorde 5, vereist_besluit),
-- elk een eigen primair besluit (in_bespreking). fn_stap_open_per_zwaarte leest de
-- instance-arm van het PRIMAIRE besluit; daarom één procedure per scenario.
insert into public.procedures (id, fonds_id, template_code, template_versie, titel)
values ('dddddddd-0000-0000-0000-0000000000f1','dddddddd-dddd-dddd-dddd-dddddddddddd','pd_tpl','1.0.0','P1'),
       ('dddddddd-0000-0000-0000-0000000000f2','dddddddd-dddd-dddd-dddd-dddddddddddd','pd_tpl','1.0.0','P2'),
       ('dddddddd-0000-0000-0000-0000000000f3','dddddddd-dddd-dddd-dddd-dddddddddddd','pd_tpl','1.0.0','P3'),
       ('dddddddd-0000-0000-0000-0000000000f4','dddddddd-dddd-dddd-dddd-dddddddddddd','pd_tpl','1.0.0','P4'),
       ('dddddddd-0000-0000-0000-0000000000f5','dddddddd-dddd-dddd-dddd-dddddddddddd','pd_tpl','1.0.0','P5');
insert into public.procedure_stappen (procedure_id, volgorde, naam, vereist_besluit)
select id, 5, 'Besluitmoment', true from public.procedures
 where id in ('dddddddd-0000-0000-0000-0000000000f1','dddddddd-0000-0000-0000-0000000000f2',
              'dddddddd-0000-0000-0000-0000000000f3','dddddddd-0000-0000-0000-0000000000f4',
              'dddddddd-0000-0000-0000-0000000000f5');
insert into public.decision_objects (id, procedure_id, fonds_id, besluit_code, titel, besluitvraag, is_primary_decision, status)
values ('dddddddd-0000-0000-0000-0000000000d1','dddddddd-0000-0000-0000-0000000000f1','dddddddd-dddd-dddd-dddd-dddddddddddd','PD-0001','PD1','Vraag?', true, 'in_bespreking'),
       ('dddddddd-0000-0000-0000-0000000000d2','dddddddd-0000-0000-0000-0000000000f2','dddddddd-dddd-dddd-dddd-dddddddddddd','PD-0002','PD2','Vraag?', true, 'in_bespreking'),
       ('dddddddd-0000-0000-0000-0000000000d3','dddddddd-0000-0000-0000-0000000000f3','dddddddd-dddd-dddd-dddd-dddddddddddd','PD-0003','PD3','Vraag?', true, 'in_bespreking'),
       ('dddddddd-0000-0000-0000-0000000000d4','dddddddd-0000-0000-0000-0000000000f4','dddddddd-dddd-dddd-dddd-dddddddddddd','PD-0004','PD4','Vraag?', true, 'in_bespreking'),
       ('dddddddd-0000-0000-0000-0000000000d5','dddddddd-0000-0000-0000-0000000000f5','dddddddd-dddd-dddd-dddd-dddddddddddd','PD-0005','PD5','Vraag?', true, 'in_bespreking');

-- Procedure P6 voor de is_primary-flip-/secundair-scenario's: een ECHT besluit d6
-- (open kritiek) én een schone lokvogel d7 (secundair, niets open) op DEZELFDE
-- procedure.
insert into public.procedures (id, fonds_id, template_code, template_versie, titel)
values ('dddddddd-0000-0000-0000-0000000000f6','dddddddd-dddd-dddd-dddd-dddddddddddd','pd_tpl','1.0.0','P6');
insert into public.procedure_stappen (procedure_id, volgorde, naam, vereist_besluit)
values ('dddddddd-0000-0000-0000-0000000000f6', 5, 'Besluitmoment', true);
insert into public.decision_objects (id, procedure_id, fonds_id, besluit_code, titel, besluitvraag, is_primary_decision, status)
values ('dddddddd-0000-0000-0000-0000000000d6','dddddddd-0000-0000-0000-0000000000f6','dddddddd-dddd-dddd-dddd-dddddddddddd','PD-0006','PD6','Vraag?', true,  'in_bespreking'),
       ('dddddddd-0000-0000-0000-0000000000d7','dddddddd-0000-0000-0000-0000000000f6','dddddddd-dddd-dddd-dddd-dddddddddddd','PD-0007','PD7','Vraag?', false, 'in_bespreking');

-- Open KRITIEK vereiste op de besluitmoment-stap van P1, P2, P5 en op d6 (instance-arm,
-- ongebonden → open). P3 krijgt niets (geen open). d7 (lokvogel) krijgt niets.
insert into public.procedure_requirement_instance
  (decision_id, stap_volgorde, requirement_type, label, min_aantal, actief, fonds_id, zwaarte)
values ('dddddddd-0000-0000-0000-0000000000d1',5,'document','Kritiek stuk',1,true,'dddddddd-dddd-dddd-dddd-dddddddddddd','kritiek'),
       ('dddddddd-0000-0000-0000-0000000000d2',5,'document','Kritiek stuk',1,true,'dddddddd-dddd-dddd-dddd-dddddddddddd','kritiek'),
       ('dddddddd-0000-0000-0000-0000000000d5',5,'document','Kritiek stuk',1,true,'dddddddd-dddd-dddd-dddd-dddddddddddd','kritiek'),
       ('dddddddd-0000-0000-0000-0000000000d6',5,'document','Kritiek stuk',1,true,'dddddddd-dddd-dddd-dddd-dddddddddddd','kritiek');

-- P4/I1: de geldige besluitpaden dragen elk een formeel, gebonden approval-feit.
-- Zonder dit feit hoort de matrix de omslag al vóór de I2-open-check te weigeren.
insert into public.procedure_requirement_instance
  (decision_id, stap_volgorde, requirement_type, label, min_aantal, actief, fonds_id, zwaarte)
values ('dddddddd-0000-0000-0000-0000000000d1',5,'approval','Goedkeuring',1,true,'dddddddd-dddd-dddd-dddd-dddddddddddd','vereist'),
       ('dddddddd-0000-0000-0000-0000000000d2',5,'approval','Goedkeuring',1,true,'dddddddd-dddd-dddd-dddd-dddddddddddd','vereist'),
       ('dddddddd-0000-0000-0000-0000000000d3',5,'approval','Goedkeuring',1,true,'dddddddd-dddd-dddd-dddd-dddddddddddd','vereist'),
       ('dddddddd-0000-0000-0000-0000000000d6',5,'approval','Goedkeuring',1,true,'dddddddd-dddd-dddd-dddd-dddddddddddd','vereist');
insert into public.procedure_besluiten
  (procedure_id, stap_id, decision_id, requirement_sleutel, formulering, datum)
select d.procedure_id, ps.id, d.id, '5|approval|Goedkeuring', 'Formeel vastgelegd besluit', current_date
  from public.decision_objects d
  join public.procedure_stappen ps on ps.procedure_id=d.procedure_id and ps.volgorde=5
 where d.id in ('dddddddd-0000-0000-0000-0000000000d1','dddddddd-0000-0000-0000-0000000000d2',
                'dddddddd-0000-0000-0000-0000000000d3','dddddddd-0000-0000-0000-0000000000d6');

-- #1 geldige besluit-met-open (motivering ok): status → besloten, atomair mét beide
--    events; het event draagt open_voor_besluitmoment (SQL, niet leeg) én actor_rol.
do $$
declare v_ev1 int; v_ev2 int; v_status text; v_payload jsonb;
begin
  perform set_config('request.jwt.claim.sub','dddddddd-0000-0000-0000-0000000000a1',true);
  perform public.fn_besluit_status_omslag(
    'dddddddd-0000-0000-0000-0000000000d1', 'besloten', 'reden', 'Termijndruk DNB dwingt tot besluit');
  select status into v_status from public.decision_objects where id='dddddddd-0000-0000-0000-0000000000d1';
  select count(*) into v_ev1 from public.governance_events
    where decision_id='dddddddd-0000-0000-0000-0000000000d1' and event_type='besluit_genomen_met_openstaande_vereisten';
  select nieuwe_waarde into v_payload from public.governance_events
    where decision_id='dddddddd-0000-0000-0000-0000000000d1' and event_type='besluit_genomen_met_openstaande_vereisten'
    limit 1;
  select count(*) into v_ev2 from public.governance_events
    where decision_id='dddddddd-0000-0000-0000-0000000000d1' and event_type='status_gewijzigd';
  if v_status <> 'besloten' or v_ev1 <> 1 or v_ev2 <> 1 then
    raise exception 'FAALT #1: atomaire omslag niet compleet (status=%, besluit_event=%, status_event=%).', v_status, v_ev1, v_ev2;
  end if;
  if jsonb_array_length(v_payload->'open_voor_besluitmoment'->'kritiek') <> 1 then
    raise exception 'FAALT #1: open_voor_besluitmoment niet SQL-gevuld (%).', v_payload->'open_voor_besluitmoment';
  end if;
  if v_payload->>'actor_rol' <> 'voorzitter' then
    raise exception 'FAALT #1: actor_rol niet vastgelegd (%).', v_payload->>'actor_rol';
  end if;
  raise notice 'OK #1: atomair; open_voor_besluitmoment SQL-berekend (1 kritiek); actor_rol=voorzitter.';
end $$;

-- #2 besluit-met-open zonder (voldoende) motivering → PC002 (I2), niets gewijzigd.
--    Bewijst dat "open" NIET meegegeven wordt: de aanroeper kan de eis niet ontlopen.
do $$
declare v_status text;
begin
  perform set_config('request.jwt.claim.sub','dddddddd-0000-0000-0000-0000000000a1',true);
  begin
    perform public.fn_besluit_status_omslag(
      'dddddddd-0000-0000-0000-0000000000d2', 'besloten', null, 'kort');
    raise exception 'FAALT #2: te korte motivering geaccepteerd terwijl er open kritiek is.';
  exception when sqlstate 'PC002' then null;
  end;
  select status into v_status from public.decision_objects where id='dddddddd-0000-0000-0000-0000000000d2';
  if v_status <> 'in_bespreking' then
    raise exception 'FAALT #2: status wijzigde ondanks de PC002-weigering (%).', v_status;
  end if;
  raise notice 'OK #2: I2 DB-afgedwongen op SQL-berekende open — te korte motivering weigert, status onveranderd.';
end $$;

-- #3 gewone overgang zonder iets open (geen vereisten gekoppeld): update +
--    status_gewijzigd, GEEN besluit_genomen_met_openstaande_vereisten.
do $$
declare v_ev int;
begin
  perform set_config('request.jwt.claim.sub','dddddddd-0000-0000-0000-0000000000a1',true);
  perform public.fn_besluit_status_omslag(
    'dddddddd-0000-0000-0000-0000000000d3', 'besloten', 'gewoon', null);
  select count(*) into v_ev from public.governance_events
    where decision_id='dddddddd-0000-0000-0000-0000000000d3'
      and event_type='besluit_genomen_met_openstaande_vereisten';
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
      'dddddddd-0000-0000-0000-0000000000d4', 'besloten', 'x', 'Ruime motivering hier aanwezig');
    raise exception 'FAALT #4: vreemd-fonds actor mocht de omslag doen.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK #4: eigen slot — vreemd-fonds actor geweigerd (42501).';
end $$;

-- #5 directe PostgREST-tegenhanger: als `authenticated` faalt een RECHTSTREEKSE
--    UPDATE op status (kolom-revoke), terwijl de RPC het wél kan. Bewijst dat de
--    RPC het enige pad is en de motiveringseis niet te omzeilen valt.
do $$
begin
  perform set_config('request.jwt.claim.sub','dddddddd-0000-0000-0000-0000000000a1',true);
  set local role authenticated;
  begin
    update public.decision_objects set status='aangehouden'
     where id='dddddddd-0000-0000-0000-0000000000d5';
    reset role;
    raise exception 'FAALT #5: directe status-update door authenticated werd toegestaan.';
  exception when insufficient_privilege then
    reset role;
    raise notice 'OK #5: directe status-update door authenticated geweigerd (42501) — RPC is het enige pad.';
  end;
end $$;

-- #6 decision-scoped open (reviewbevinding #2/#3): verwissel de primary-vlag naar de
--    schone lokvogel d7 en beslis het ECHTE besluit d6 (open kritiek) zonder motivering.
--    De open-check moet d6's EIGEN open zien (niet de nu-primaire lokvogel) → PC002.
do $$
declare v_status text;
begin
  perform set_config('request.jwt.claim.sub','dddddddd-0000-0000-0000-0000000000a1',true);
  -- Verwissel de primary (een gewone, toegestane UPDATE op is_primary_decision).
  update public.decision_objects set is_primary_decision = false where id='dddddddd-0000-0000-0000-0000000000d6';
  update public.decision_objects set is_primary_decision = true  where id='dddddddd-0000-0000-0000-0000000000d7';
  begin
    perform public.fn_besluit_status_omslag(
      'dddddddd-0000-0000-0000-0000000000d6', 'besloten', null, null);
    raise exception 'FAALT #6: d6 met open kritiek ging besloten zonder motivering (open-check keek naar de lokvogel).';
  exception when sqlstate 'PC002' then null;
  end;
  select status into v_status from public.decision_objects where id='dddddddd-0000-0000-0000-0000000000d6';
  if v_status <> 'in_bespreking' then
    raise exception 'FAALT #6: d6 wijzigde status ondanks PC002 (%).', v_status;
  end if;
  raise notice 'OK #6: open-check is decision-scoped — primary-flip misleidt de motiveringseis niet.';
end $$;

-- #7 INSERT-slot (reviewbevinding #1): als authenticated een decision direct met
--    status='besloten' INSERTen faalt (42501) — een besluit-status ontstaat alleen
--    via de RPC, niet bij het aanmaken.
do $$
begin
  perform set_config('request.jwt.claim.sub','dddddddd-0000-0000-0000-0000000000a1',true);
  set local role authenticated;
  begin
    insert into public.decision_objects (procedure_id, fonds_id, besluit_code, titel, besluitvraag, is_primary_decision, status)
    values ('dddddddd-0000-0000-0000-0000000000f3','dddddddd-dddd-dddd-dddd-dddddddddddd','PD-9001','Verzonnen','Vraag?', false, 'besloten');
    reset role;
    raise exception 'FAALT #7: authenticated kon een rij direct met status=besloten INSERTen.';
  exception when insufficient_privilege then
    reset role;
    raise notice 'OK #7: directe INSERT met status=besloten geweigerd (42501) — besluit-status alleen via de RPC.';
  end;
end $$;

rollback;

do $$ begin raise notice 'Besluit-omslag-gedragstoets afgerond — alle checks groen.'; end $$;
