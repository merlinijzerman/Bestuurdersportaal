-- #256 / P5d — procedure beëindigen en heropenen: serverpad, audit en herstel.
--
-- Bewijst als echte browserrol dat alleen bestuurder/voorzitter dit proces kan
-- beëindigen of heropenen, dat een motivering en getypeerde heropenreden
-- verplicht zijn, en dat bij heropenen uitsluitend de bij beëindiging
-- vastgelegde niet-terminale stappen worden hersteld. Alles loopt in één
-- rollbackbare fixture op de wegwerp-testdatabase.
-- ROL: postgres seedt en rolt terug; `authenticated` meet het browserpad met
-- bestuurder als positief geval en beheerder als expliciete negatieve rolgate.

do $$
begin
  if to_regprocedure('public.fn_procedure_beeindigen(uuid,text)') is null
     or to_regprocedure('public.fn_procedure_heropenen(uuid,text,text)') is null
     or to_regprocedure('public.fn_procedure_heropenen(uuid,text)') is not null then
    raise exception 'P5d FAALT: procedure-RPC-signaturen onvolledig of oud ontsnappingspad nog aanwezig.';
  end if;
  raise notice 'P5d structuur OK: beëindigen + getypeerd heropenen zijn de enige procedurepaden.';
end $$;

begin;

insert into public.fondsen (id, naam, slug)
values ('d5d50000-0000-0000-0000-000000000001', 'P5d Testfonds', 'p5d-testfonds');

insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('d5d50000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'p5d-bestuurder@test.local', '{"naam":"P5d Bestuurder"}', now(), now()),
  ('d5d50000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'p5d-beheerder@test.local', '{"naam":"P5d Beheerder"}', now(), now());

insert into public.profielen (id, fonds_id, naam, rol)
values
  ('d5d50000-0000-0000-0000-000000000002', 'd5d50000-0000-0000-0000-000000000001', 'P5d Bestuurder', 'bestuurder'),
  ('d5d50000-0000-0000-0000-000000000003', 'd5d50000-0000-0000-0000-000000000001', 'P5d Beheerder', 'beheerder')
on conflict (id) do update set fonds_id = excluded.fonds_id, naam = excluded.naam, rol = excluded.rol;

insert into public.procedures (id, fonds_id, template_code, template_versie, titel)
values ('d5d50000-0000-0000-0000-000000000004', 'd5d50000-0000-0000-0000-000000000001', 'p5d_test', '1.0.0', 'P5d Testproces');

insert into public.decision_objects
  (id, fonds_id, procedure_id, besluit_code, titel, besluitvraag, is_primary_decision, status)
values
  ('d5d50000-0000-0000-0000-000000000005', 'd5d50000-0000-0000-0000-000000000001',
   'd5d50000-0000-0000-0000-000000000004', 'P5D-001', 'P5d besluit', 'Kan dit proces stoppen?', true, 'in_bespreking');

insert into public.procedure_stappen (id, procedure_id, volgorde, naam, status, vereist_besluit)
values
  ('d5d50000-0000-0000-0000-000000000011', 'd5d50000-0000-0000-0000-000000000004', 1, 'Actieve stap', 'actief', false),
  ('d5d50000-0000-0000-0000-000000000012', 'd5d50000-0000-0000-0000-000000000004', 2, 'Geblokkeerde stap', 'geblokkeerd', false),
  ('d5d50000-0000-0000-0000-000000000013', 'd5d50000-0000-0000-0000-000000000004', 3, 'Afgeronde stap', 'afgerond', false);

set local role authenticated;

-- Een beheerder ziet de UI-actie niet en kan het serverpad evenmin gebruiken.
set local request.jwt.claims to '{"sub":"d5d50000-0000-0000-0000-000000000003"}';
do $$
begin
  perform public.fn_procedure_beeindigen('d5d50000-0000-0000-0000-000000000004', 'Geldige motivering van de beheerder.');
  raise exception 'LEK: beheerder kon dit proces beëindigen.';
exception when insufficient_privilege then
  raise notice 'P5d OK: beheerder kan procedure-RPC niet gebruiken.';
end $$;

set local request.jwt.claims to '{"sub":"d5d50000-0000-0000-0000-000000000002"}';
do $$
begin
  perform public.fn_procedure_beeindigen('d5d50000-0000-0000-0000-000000000004', 'te kort');
  raise exception 'LEK: beëindigen zonder geldige motivering toegestaan.';
exception when sqlstate 'PC002' then
  raise notice 'P5d OK: beëindigen zonder voldoende motivering geweigerd.';
end $$;

do $$
declare
  v_resultaat jsonb;
  v_actief text;
  v_geblokkeerd text;
  v_afgerond text;
  v_besluitstatus text;
  v_payload jsonb;
begin
  v_resultaat := public.fn_procedure_beeindigen(
    'd5d50000-0000-0000-0000-000000000004',
    'Het bestuur stopt dit proces en archiveert de resterende werkzaamheden.'
  );

  select status into v_actief from public.procedure_stappen where id = 'd5d50000-0000-0000-0000-000000000011';
  select status into v_geblokkeerd from public.procedure_stappen where id = 'd5d50000-0000-0000-0000-000000000012';
  select status into v_afgerond from public.procedure_stappen where id = 'd5d50000-0000-0000-0000-000000000013';
  select status into v_besluitstatus from public.decision_objects where id = 'd5d50000-0000-0000-0000-000000000005';
  select payload into v_payload from public.procedure_log
   where procedure_id = 'd5d50000-0000-0000-0000-000000000004' and event_type = 'procedure_beeindigd'
   order by tijdstip desc limit 1;

  if v_resultaat->>'aantal_vervallen_stappen' <> '2'
     or v_actief <> 'vervallen' or v_geblokkeerd <> 'vervallen' or v_afgerond <> 'afgerond'
     or v_besluitstatus <> 'beeindigd' then
    raise exception 'P5d FAALT: beëindiging sloot niet precies de niet-terminale stappen (%, %, %, %).', v_actief, v_geblokkeerd, v_afgerond, v_besluitstatus;
  end if;
  if v_payload->>'rol_op_moment' <> 'bestuurder'
     or jsonb_array_length(v_payload->'vervallen_stappen') <> 2
     or not (v_payload ? 'openstaande_vereisten') then
    raise exception 'P5d FAALT: beëindigingssnapshot mist rol, stappen of open vereisten (%).', v_payload;
  end if;
  raise notice 'P5d OK: beëindigen vervalt precies twee open stappen en schrijft een volledige snapshot.';
end $$;

do $$
begin
  perform public.fn_procedure_heropenen(
    'd5d50000-0000-0000-0000-000000000004',
    'Het proces moet alsnog zorgvuldig worden voortgezet.',
    'andere_redencode'
  );
  raise exception 'LEK: heropenen met een onbekende reden is toegestaan.';
exception when sqlstate 'PC002' then
  raise notice 'P5d OK: onbekende heropenreden geweigerd.';
end $$;

do $$
declare
  v_actief text;
  v_geblokkeerd text;
  v_afgerond text;
  v_besluitstatus text;
  v_payload jsonb;
begin
  perform public.fn_procedure_heropenen(
    'd5d50000-0000-0000-0000-000000000004',
    'Het proces wordt hervat na gewijzigde omstandigheden.',
    'hervat_na_gewijzigde_omstandigheden'
  );
  set constraints trg_besluitstatus_feit immediate;

  select status into v_actief from public.procedure_stappen where id = 'd5d50000-0000-0000-0000-000000000011';
  select status into v_geblokkeerd from public.procedure_stappen where id = 'd5d50000-0000-0000-0000-000000000012';
  select status into v_afgerond from public.procedure_stappen where id = 'd5d50000-0000-0000-0000-000000000013';
  select status into v_besluitstatus from public.decision_objects where id = 'd5d50000-0000-0000-0000-000000000005';
  select payload into v_payload from public.procedure_log
   where procedure_id = 'd5d50000-0000-0000-0000-000000000004' and event_type = 'procedure_heropend'
   order by tijdstip desc limit 1;

  if v_actief <> 'actief' or v_geblokkeerd <> 'geblokkeerd' or v_afgerond <> 'afgerond'
     or v_besluitstatus <> 'heropend' then
    raise exception 'P5d FAALT: heropenen herstelde niet exact de snapshot (%, %, %, %).', v_actief, v_geblokkeerd, v_afgerond, v_besluitstatus;
  end if;
  if v_payload->>'reden_type' <> 'hervat_na_gewijzigde_omstandigheden'
     or v_payload->>'rol_op_moment' <> 'bestuurder'
     or v_payload->>'herstelde_stappen' <> '2' then
    raise exception 'P5d FAALT: heropen-audit mist reden, rol of herstelde stappen (%).', v_payload;
  end if;
  raise notice 'P5d OK: heropenen herstelt alleen de snapshot en schrijft reden plus rol.';
end $$;

rollback;

do $$ begin raise notice 'GROEN: P5d beëindigen/heropenen onder RLS volledig bewezen.'; end $$;
