-- ============================================================================
-- Gedragstoets 2026-08-27 — afronden met afwijking (P3/PR-C, #168, besluit 0192)
-- ----------------------------------------------------------------------------
-- Toetst fn_stap_open_per_zwaarte (de snapshot, D10-model — dezelfde telling als
-- core/lib/decision.ts, NIET de per-type readiness-logica) en de atomaire kern
-- fn_stap_afronden_met_afwijking (§5.1). Zelf-seedend, in transacties met ROLLBACK.
--
-- SNAPSHOT-PIN (SQL-helft). De vervuldheidsvectoren hier — min_aantal>1, een
-- instantie-arm-vereiste, een uitgesloten vereiste, en een field-vereiste — zijn
-- de gedeelde fixtures met core/lib/afwijking-snapshot.sanity.ts (TS-helft). Beide
-- helften pinnen dezelfde open-per-zwaarte-uitkomst op dezelfde vectoren; zo kan de
-- SQL-telling niet stil van decision.ts weglopen (de fout die readiness fataal werd).
-- Er is bewust GEEN live TS↔SQL-vergelijking: de testketen heeft geen rauwe-DB-
-- node-client, dus de binding loopt via de gedeelde vector, niet via een aanroep.
--
-- ROL: postgres voor structuur en seed; de gedragsscenario's zetten
-- request.jwt.claim.sub (auth.uid()) op de handelende actor. De functie is
-- SECURITY DEFINER met een EIGEN SLOT (rol-in-fonds), dus zij toetst de bevoegdheid
-- zelf; de scenario's meten dat slot rechtstreeks (#5), niet alleen via de route.
-- Uitvoeren: psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand.
-- ============================================================================

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 1 — STRUCTUUR (als eigenaar)                                        ║
-- ╚════════════════════════════════════════════════════════════════════════╝
do $$
begin
  if (select count(*) from information_schema.columns
        where table_name='procedure_stappen'
          and column_name in ('afgerond_met_afwijking','afwijking_motivering','afwijking_snapshot','afwijking_door')) <> 4 then
    raise exception 'DEEL 1 FAALT: de vier afwijkingskolommen ontbreken op procedure_stappen.';
  end if;
  if not exists (select 1 from pg_proc where proname='fn_stap_open_per_zwaarte')
     or not exists (select 1 from pg_proc where proname='fn_stap_afronden_met_afwijking') then
    raise exception 'DEEL 1 FAALT: een van de twee functies ontbreekt.';
  end if;
  -- Eigen slot vereist dat de afrondfunctie NIET aan service_role hangt (geen
  -- achtergrondproces mag een verantwoordingshandeling doen).
  if has_function_privilege('service_role','public.fn_stap_afronden_met_afwijking(uuid,uuid,text,boolean)','execute') then
    raise exception 'DEEL 1 FAALT: service_role heeft execute op de afrondfunctie.';
  end if;
  if not has_function_privilege('authenticated','public.fn_stap_afronden_met_afwijking(uuid,uuid,text,boolean)','execute') then
    raise exception 'DEEL 1 FAALT: authenticated mist execute op de afrondfunctie.';
  end if;
  raise notice 'DEEL 1 OK: vier kolommen, twee functies, grants correct (authenticated, geen service_role).';
end $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 2 — GEDRAG. begin ... rollback.                                     ║
-- ╚════════════════════════════════════════════════════════════════════════╝
begin;

insert into public.fondsen (id, naam, slug)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc','PC Testfonds','pc-testfonds');
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('cccccccc-0000-0000-0000-0000000000a1'::uuid,'authenticated','authenticated','vz@test.local','{"naam":"Voorzitter"}',now(),now()),
       ('cccccccc-0000-0000-0000-0000000000b1'::uuid,'authenticated','authenticated','bh@test.local','{"naam":"Beheerder"}',now(),now());
insert into public.profielen (id, fonds_id, naam, rol)
values ('cccccccc-0000-0000-0000-0000000000a1'::uuid,'cccccccc-cccc-cccc-cccc-cccccccccccc','Voorzitter','voorzitter'),
       ('cccccccc-0000-0000-0000-0000000000b1'::uuid,'cccccccc-cccc-cccc-cccc-cccccccccccc','Beheerder','beheerder');
insert into public.procedures (id, fonds_id, template_code, template_versie, titel)
values ('cccccccc-0000-0000-0000-0000000000f1','cccccccc-cccc-cccc-cccc-cccccccccccc','pc_test_template','1.0.0','PC-procedure');
insert into public.procedure_stappen (id, procedure_id, volgorde, naam, status)
values ('cccccccc-0000-0000-0000-000000000011','cccccccc-0000-0000-0000-0000000000f1',1,'Stap 1','actief'),
       ('cccccccc-0000-0000-0000-000000000012','cccccccc-0000-0000-0000-0000000000f1',2,'Stap 2','actief');
insert into public.decision_objects (id, procedure_id, fonds_id, besluit_code, titel, besluitvraag, scope, is_primary_decision, status)
values ('cccccccc-0000-0000-0000-0000000000d1','cccccccc-0000-0000-0000-0000000000f1',
        'cccccccc-cccc-cccc-cccc-cccccccccccc','PC-0001','PC','Vraag?', null, true, 'concept');

-- Vereisten op stap 1 — de gedeelde snapshot-vectoren.
insert into public.procedure_requirements
  (template_code, template_versie, stap_volgorde, requirement_type, label, documenttype, veld_pad, zwaarte, min_aantal)
values
  ('pc_test_template','1.0.0',1,'document','K-doc',  null,null,'kritiek',  1), -- open  -> kritiek
  ('pc_test_template','1.0.0',1,'document','V-doc',  null,null,'vereist',  1), -- open  -> vereist
  ('pc_test_template','1.0.0',1,'document','O-doc',  null,null,'optioneel',1), -- open  -> optioneel
  ('pc_test_template','1.0.0',1,'document','Vv-doc', null,null,'vereist',  2), -- 2 bewijs -> vervuld (min_aantal>1)
  ('pc_test_template','1.0.0',1,'document','Vx-doc', null,null,'vereist',  1), -- uitgesloten -> weg
  ('pc_test_template','1.0.0',1,'field',   'Scope',  null,'decision.scope','vereist',1), -- scope null -> open
  ('pc_test_template','1.0.0',2,'document','S2-doc', null,null,'optioneel',1); -- stap 2: alleen optioneel open

-- Vv-doc vervuld: twee gebonden bewijsstukken op de stap.
insert into public.procedure_bewijs (id, stap_id, titel, requirement_sleutel)
values ('cccccccc-0000-0000-0000-0000000000e1','cccccccc-0000-0000-0000-000000000011','Bewijs 1','1|document|Vv-doc'),
       ('cccccccc-0000-0000-0000-0000000000e2','cccccccc-0000-0000-0000-000000000011','Bewijs 2','1|document|Vv-doc');

-- Vi-doc: instantie-arm vereiste (open).
insert into public.procedure_requirement_instance
  (decision_id, fonds_id, stap_volgorde, requirement_type, label, documenttype, zwaarte, min_aantal, actief, bron)
values ('cccccccc-0000-0000-0000-0000000000d1','cccccccc-cccc-cccc-cccc-cccccccccccc',
        1,'document','Vi-doc',null,'vereist',1,true,'handmatig');

-- Vx-doc uitgesloten voor dit besluit.
insert into public.procedure_requirement_uitsluiting
  (decision_id, fonds_id, stap_volgorde, requirement_type, label, match_sleutel, reden, actief, uitgesloten_door)
values ('cccccccc-0000-0000-0000-0000000000d1','cccccccc-cccc-cccc-cccc-cccccccccccc',
        1,'document','Vx-doc','Vx-doc','n.v.t. voor dit besluit',true,'cccccccc-0000-0000-0000-0000000000a1'::uuid);

-- #1 Snapshot correct: kritiek=[K], vereist=[V,Vi,Scope], optioneel=[O]; Vv/Vx weg.
do $$
declare s jsonb;
begin
  s := public.fn_stap_open_per_zwaarte('cccccccc-0000-0000-0000-000000000011');
  if jsonb_array_length(s->'kritiek') <> 1
     or jsonb_array_length(s->'vereist') <> 3
     or jsonb_array_length(s->'optioneel') <> 1 then
    raise exception 'FAALT #1: snapshot-tellingen kloppen niet: %', s;
  end if;
  if not (s->'kritiek' @> '[{"label":"K-doc"}]'
      and s->'vereist' @> '[{"label":"V-doc"}]'
      and s->'vereist' @> '[{"label":"Vi-doc"}]'
      and s->'vereist' @> '[{"label":"Scope"}]'
      and s->'optioneel' @> '[{"label":"O-doc"}]') then
    raise exception 'FAALT #1: verwachte labels ontbreken: %', s;
  end if;
  if s::text like '%Vv-doc%' or s::text like '%Vx-doc%' then
    raise exception 'FAALT #1: een vervulde (min_aantal>1) of uitgesloten vereiste staat in de snapshot: %', s;
  end if;
  raise notice 'OK #1: snapshot correct — min_aantal>1 vervuld, instantie-arm geteld, uitsluiting afgetrokken, field open.';
end $$;

-- #2 kritiek open, geen bevestiging -> PC001.
do $$
begin
  perform set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-0000000000a1',true);
  begin
    perform public.fn_stap_afronden_met_afwijking('cccccccc-0000-0000-0000-000000000011','cccccccc-0000-0000-0000-0000000000f1','Motivering',false);
    raise exception 'FAALT #2: kritiek-zonder-bevestiging geaccepteerd.';
  exception when sqlstate 'PC001' then null;
  end;
  raise notice 'OK #2: kritiek open zonder bevestiging geweigerd (PC001 -> 409).';
end $$;

-- #3 lege motivering -> 23514.
do $$
begin
  perform set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-0000000000a1',true);
  begin
    perform public.fn_stap_afronden_met_afwijking('cccccccc-0000-0000-0000-000000000011','cccccccc-0000-0000-0000-0000000000f1','   ',true);
    raise exception 'FAALT #3: lege motivering geaccepteerd.';
  exception when check_violation then null;
  end;
  raise notice 'OK #3: lege motivering geweigerd.';
end $$;

-- #4 eigen slot: beheerder roept de RPC DIRECT aan -> 42501 (niet alleen de route).
do $$
begin
  perform set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-0000000000b1',true);
  begin
    perform public.fn_stap_afronden_met_afwijking('cccccccc-0000-0000-0000-000000000011','cccccccc-0000-0000-0000-0000000000f1','Motivering',true);
    raise exception 'FAALT #4: beheerder mocht de afrondfunctie direct aanroepen (eigen slot ontbreekt).';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK #4: eigen slot — beheerder direct geweigerd (42501).';
end $$;

-- #5 geldige afwijking door de voorzitter -> stap afgerond + audit.
do $$
declare v_log int; v_gov int; v_stap record;
begin
  perform set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-0000000000a1',true);
  perform public.fn_stap_afronden_met_afwijking('cccccccc-0000-0000-0000-000000000011','cccccccc-0000-0000-0000-0000000000f1','Termijndruk DNB',true);
  select status, afgerond_met_afwijking, afwijking_motivering, afwijking_door, afwijking_snapshot into v_stap
    from public.procedure_stappen where id='cccccccc-0000-0000-0000-000000000011';
  if v_stap.status <> 'afgerond' or v_stap.afgerond_met_afwijking <> true
     or v_stap.afwijking_motivering <> 'Termijndruk DNB'
     or v_stap.afwijking_door <> 'cccccccc-0000-0000-0000-0000000000a1'::uuid
     or jsonb_array_length(v_stap.afwijking_snapshot->'kritiek') <> 1 then
    raise exception 'FAALT #5: stap/afwijkingskolommen niet correct gezet: %', v_stap;
  end if;
  select count(*) into v_log from public.procedure_log
    where procedure_id='cccccccc-0000-0000-0000-0000000000f1' and event_type='stap_afgerond_met_afwijking';
  select count(*) into v_gov from public.governance_events
    where decision_id='cccccccc-0000-0000-0000-0000000000d1' and event_type='stap_afgerond_met_afwijking';
  if v_log <> 1 or v_gov <> 1 then
    raise exception 'FAALT #5: audit ontbreekt (log=%, gov=%).', v_log, v_gov;
  end if;
  raise notice 'OK #5: afwijking vastgelegd — stap afgerond, snapshot opgeslagen, procedure_log + governance-event geschreven.';
end $$;

-- #6 overrulen is niet vervullen: de ontbrekende vereisten staan NA de afronding
--    nog steeds open (de snapshot markeerde niets als vervuld) — tussentoestand
--    onschadelijk (atomariteitsregel voorwaarde 3, data-kant).
do $$
declare s jsonb;
begin
  s := public.fn_stap_open_per_zwaarte('cccccccc-0000-0000-0000-000000000011');
  if jsonb_array_length(s->'kritiek') <> 1 or jsonb_array_length(s->'vereist') <> 3 then
    raise exception 'FAALT #6: afronden met afwijking heeft vereisten stil vervuld verklaard: %', s;
  end if;
  raise notice 'OK #6: overrulen is niet vervullen — de ontbrekende vereisten blijven open.';
end $$;

-- #7 tweede afwijking na heropenen: kolommen = laatste, procedure_log = beide.
do $$
declare v_log int; v_mot text;
begin
  update public.procedure_stappen set status='heropend' where id='cccccccc-0000-0000-0000-000000000011';
  perform set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-0000000000a1',true);
  perform public.fn_stap_afronden_met_afwijking('cccccccc-0000-0000-0000-000000000011','cccccccc-0000-0000-0000-0000000000f1','Tweede ronde',true);
  select afwijking_motivering into v_mot from public.procedure_stappen where id='cccccccc-0000-0000-0000-000000000011';
  select count(*) into v_log from public.procedure_log
    where procedure_id='cccccccc-0000-0000-0000-0000000000f1' and event_type='stap_afgerond_met_afwijking';
  if v_mot <> 'Tweede ronde' or v_log <> 2 then
    raise exception 'FAALT #7: kolom niet overschreven of log niet append-only (mot=%, log=%).', v_mot, v_log;
  end if;
  raise notice 'OK #7: tweede afwijking — kolommen dragen de laatste, procedure_log houdt beide.';
end $$;

-- #8 "niets open boven optioneel": stap 2 heeft alleen een optionele open vereiste.
do $$
begin
  perform set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-0000000000a1',true);
  begin
    perform public.fn_stap_afronden_met_afwijking('cccccccc-0000-0000-0000-000000000012','cccccccc-0000-0000-0000-0000000000f1','Motivering',true);
    raise exception 'FAALT #8: afwijking toegestaan terwijl niets boven optioneel openstond.';
  exception when check_violation then null;
  end;
  raise notice 'OK #8: niets open boven optioneel -> afwijking geweigerd (gebruik normale afronding).';
end $$;

rollback;

do $$ begin raise notice 'Afwijking-gedragstoets afgerond — alle checks groen.'; end $$;
