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
  -- I2: de minimumlengte-CHECK op afwijking_motivering (DB-backstop).
  if not exists (
    select 1 from pg_constraint
     where conname = 'procedure_stappen_afwijking_motivering_minlengte'
       and conrelid = 'public.procedure_stappen'::regclass) then
    raise exception 'DEEL 1 FAALT: de I2-minimumlengte-CHECK op afwijking_motivering ontbreekt.';
  end if;
  raise notice 'DEEL 1 OK: vier kolommen, twee functies, I2-CHECK, grants correct (authenticated, geen service_role).';
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
    perform public.fn_stap_afronden_met_afwijking('cccccccc-0000-0000-0000-000000000011','cccccccc-0000-0000-0000-0000000000f1','Bewuste afwijking',false);
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
  exception when sqlstate 'PC002' then null;
  end;
  raise notice 'OK #3: lege motivering geweigerd.';
end $$;

-- #4 eigen slot: beheerder roept de RPC DIRECT aan -> 42501 (niet alleen de route).
do $$
begin
  perform set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-0000000000b1',true);
  begin
    perform public.fn_stap_afronden_met_afwijking('cccccccc-0000-0000-0000-000000000011','cccccccc-0000-0000-0000-0000000000f1','Bewuste afwijking',true);
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
    perform public.fn_stap_afronden_met_afwijking('cccccccc-0000-0000-0000-000000000012','cccccccc-0000-0000-0000-0000000000f1','Bewuste afwijking',true);
    raise exception 'FAALT #8: afwijking toegestaan terwijl niets boven optioneel openstond.';
  exception when sqlstate 'PC002' then null;
  end;
  raise notice 'OK #8: niets open boven optioneel -> afwijking geweigerd (gebruik normale afronding).';
end $$;

-- #12 I2 (route/functie): een te korte motivering (< 10 tekens) wordt geweigerd.
do $$
begin
  perform set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-0000000000a1',true);
  begin
    perform public.fn_stap_afronden_met_afwijking('cccccccc-0000-0000-0000-000000000011','cccccccc-0000-0000-0000-0000000000f1','te kort',true);
    raise exception 'FAALT #12: motivering korter dan de I2-minimumlengte geaccepteerd.';
  exception when sqlstate 'PC002' then null;
  end;
  raise notice 'OK #12: I2 — te korte motivering geweigerd (PC002).';
end $$;

-- #13 I2 (CHECK-backstop): een directe UPDATE met een te korte motivering valt op
--     de constraint, ook buiten de functie om.
do $$
begin
  begin
    update public.procedure_stappen
       set afwijking_motivering = 'kort'
     where id = 'cccccccc-0000-0000-0000-000000000011';
    raise exception 'FAALT #13: CHECK-constraint liet een te korte motivering toe.';
  exception when check_violation then null;
  end;
  raise notice 'OK #13: I2-CHECK-backstop weigert een te korte motivering ook bij directe UPDATE.';
end $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 3 — SNAPSHOT-PARITEIT HARDENING (sluit de vals-negatief-gaten die   ║
-- ║ de review vond: alle 8 bronnen, de v_dubbel-uitsluiting, besluitvraag=''). ║
-- ╚════════════════════════════════════════════════════════════════════════╝

insert into public.procedure_stappen (id, procedure_id, volgorde, naam, status)
values ('cccccccc-0000-0000-0000-000000000013','cccccccc-0000-0000-0000-0000000000f1',3,'Stap 3','actief'),
       ('cccccccc-0000-0000-0000-000000000014','cccccccc-0000-0000-0000-0000000000f1',4,'Stap 4','actief'),
       ('cccccccc-0000-0000-0000-000000000015','cccccccc-0000-0000-0000-0000000000f1',5,'Stap 5','actief');

-- #9-fixture: één vereiste MULTI met min_aantal=8, gevoed door EXACT één gebonden
-- feit in ELK van de acht bronnen. Laat de SQL één bron weg, dan telt hij ≤7 < 8 →
-- MULTI staat open → #9 valt. Zo bijt de test op een ontbrekende/dubbele bron.
insert into public.procedure_requirements
  (template_code, template_versie, stap_volgorde, requirement_type, label, documenttype, veld_pad, zwaarte, min_aantal)
values ('pc_test_template','1.0.0',3,'document','MULTI',null,null,'kritiek',8);

-- Validate-triggers tijdelijk uit: de test meet of fn_stap_open_per_zwaarte de feiten
-- TELT, niet of de binding geldig is (dat dekken de bindingstoetsen). Zo hoeven we de
-- per-bron type/I5-regels niet na te bootsen.
alter table public.procedure_bewijs           disable trigger trg_procedure_bewijs_validate_binding;
alter table public.decision_risks             disable trigger trg_risk_validate_binding;
alter table public.decision_assumptions       disable trigger trg_assumption_validate_binding;
alter table public.decision_conditions        disable trigger trg_kpi_validate_binding;
alter table public.decision_evaluations       disable trigger trg_evaluation_validate_binding;
alter table public.decision_ai_interactions   disable trigger trg_aivalidation_validate_binding;
alter table public.procedure_besluiten        disable trigger trg_approval_validate_binding;
alter table public.procedure_vaststelling     disable trigger trg_vaststelling_validate_binding;

insert into public.procedure_bewijs (id, stap_id, titel, requirement_sleutel)
  values (gen_random_uuid(),'cccccccc-0000-0000-0000-000000000013','MULTI-bewijs','3|document|MULTI');
insert into public.decision_risks (decision_id, beschrijving, requirement_sleutel)
  values ('cccccccc-0000-0000-0000-0000000000d1','MULTI-risk','3|document|MULTI');
insert into public.decision_assumptions (decision_id, tekst, requirement_sleutel)
  values ('cccccccc-0000-0000-0000-0000000000d1','MULTI-assumption','3|document|MULTI');
insert into public.decision_conditions (decision_id, voorwaarde, requirement_sleutel)
  values ('cccccccc-0000-0000-0000-0000000000d1','MULTI-condition','3|document|MULTI');
insert into public.decision_evaluations (decision_id, geplande_datum, requirement_sleutel)
  values ('cccccccc-0000-0000-0000-0000000000d1','2026-01-01','3|document|MULTI');
insert into public.decision_ai_interactions (decision_id, type, prompt, output, requirement_sleutel)
  values ('cccccccc-0000-0000-0000-0000000000d1','samenvatting','p','o','3|document|MULTI');
insert into public.procedure_besluiten (procedure_id, formulering, datum, requirement_sleutel)
  values ('cccccccc-0000-0000-0000-0000000000f1','MULTI-besluit','2026-01-01','3|document|MULTI');
insert into public.procedure_vaststelling (fonds_id, procedure_id, requirement_sleutel, soort, uitkomst, toelichting, actor)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc','cccccccc-0000-0000-0000-0000000000f1','3|document|MULTI','mandaatcheck','ok','t','cccccccc-0000-0000-0000-0000000000a1');

-- #10-fixture (v_dubbel-uitsluiting): een UITGESLOTEN template-vereiste + een ACTIEVE
-- instantie-vereiste met dezelfde sleutel, plus één gebonden bewijs. Vóór de fix
-- telde v_dubbel de uitgesloten template mee → COLLIDE ambigu → fail-closed open.
-- Ná de fix telt v_dubbel alleen de actieve/niet-uitgesloten set → COLLIDE vervuld.
-- Drift-volgorde (zoals de review beschrijft): eerst de instantie (de sleutel
-- bestaat nog niet als template, dus de uniciteitsguard op de instantie laat 'm
-- door), dán het botsende template (procedure_requirements heeft géén guard), dán
-- de uitsluiting van dat template.
insert into public.procedure_requirement_instance
  (decision_id, fonds_id, stap_volgorde, requirement_type, label, documenttype, zwaarte, min_aantal, actief, bron)
values ('cccccccc-0000-0000-0000-0000000000d1','cccccccc-cccc-cccc-cccc-cccccccccccc',4,'document','COLLIDE',null,'vereist',1,true,'handmatig');
insert into public.procedure_requirements
  (template_code, template_versie, stap_volgorde, requirement_type, label, documenttype, veld_pad, zwaarte, min_aantal)
values ('pc_test_template','1.0.0',4,'document','COLLIDE',null,null,'vereist',1);
insert into public.procedure_requirement_uitsluiting
  (decision_id, fonds_id, stap_volgorde, requirement_type, label, match_sleutel, reden, actief, uitgesloten_door)
values ('cccccccc-0000-0000-0000-0000000000d1','cccccccc-cccc-cccc-cccc-cccccccccccc',4,'document','COLLIDE','COLLIDE','test',true,'cccccccc-0000-0000-0000-0000000000a1');
insert into public.procedure_bewijs (id, stap_id, titel, requirement_sleutel)
  values (gen_random_uuid(),'cccccccc-0000-0000-0000-000000000014','COLLIDE-bewijs','4|document|COLLIDE');

alter table public.procedure_bewijs           enable trigger trg_procedure_bewijs_validate_binding;
alter table public.decision_risks             enable trigger trg_risk_validate_binding;
alter table public.decision_assumptions       enable trigger trg_assumption_validate_binding;
alter table public.decision_conditions        enable trigger trg_kpi_validate_binding;
alter table public.decision_evaluations       enable trigger trg_evaluation_validate_binding;
alter table public.decision_ai_interactions   enable trigger trg_aivalidation_validate_binding;
alter table public.procedure_besluiten        enable trigger trg_approval_validate_binding;
alter table public.procedure_vaststelling     enable trigger trg_vaststelling_validate_binding;

-- #9 alle 8 bronnen geteld: MULTI (min_aantal=8) is vervuld, dus niet open.
do $$
declare s jsonb;
begin
  s := public.fn_stap_open_per_zwaarte('cccccccc-0000-0000-0000-000000000013');
  if s::text like '%MULTI%' then
    raise exception 'FAALT #9: MULTI staat open — fn_stap_open_per_zwaarte telt niet alle 8 bronnen: %', s;
  end if;
  raise notice 'OK #9: alle acht gebonden-feit-bronnen worden geteld (min_aantal=8 vervuld).';
end $$;

-- #10 v_dubbel-uitsluiting: COLLIDE is vervuld (niet ambigu ondanks de uitgesloten
-- template-tweeling), dus niet open.
do $$
declare s jsonb;
begin
  s := public.fn_stap_open_per_zwaarte('cccccccc-0000-0000-0000-000000000014');
  if s::text like '%COLLIDE%' then
    raise exception 'FAALT #10: COLLIDE staat open — v_dubbel telt een uitgesloten template mee (ambiguïteit-fout): %', s;
  end if;
  raise notice 'OK #10: v_dubbel gebruikt de gefilterde set — uitgesloten tweeling maakt niet ambigu.';
end $$;

-- #11 besluitvraag = lege string telt als NIET ingevuld (spiegelt !!besluitvraag).
do $$
declare s jsonb;
begin
  update public.decision_objects set besluitvraag = '' where id = 'cccccccc-0000-0000-0000-0000000000d1';
  insert into public.procedure_requirements
    (template_code, template_versie, stap_volgorde, requirement_type, label, documenttype, veld_pad, zwaarte, min_aantal)
  values ('pc_test_template','1.0.0',5,'field','Besluitvraag-veld',null,'decision.besluitvraag','vereist',1);
  s := public.fn_stap_open_per_zwaarte('cccccccc-0000-0000-0000-000000000015');
  if not (s->'vereist' @> '[{"label":"Besluitvraag-veld"}]') then
    raise exception 'FAALT #11: besluitvraag='''' werd als vervuld gezien (moet open zijn, gelijk aan !!besluitvraag): %', s;
  end if;
  raise notice 'OK #11: besluitvraag='''' telt als niet ingevuld — field open.';
end $$;

rollback;

do $$ begin raise notice 'Afwijking-gedragstoets afgerond — alle checks groen.'; end $$;
