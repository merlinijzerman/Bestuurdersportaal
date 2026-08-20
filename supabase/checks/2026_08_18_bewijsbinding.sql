-- ============================================================================
-- Gedragstoets 2026-08-18 — expliciete bewijs↔vereiste-binding
-- ----------------------------------------------------------------------------
-- Draai dit ná migratie 2026_08_18_bewijs_requirement_binding.sql tegen de
-- doeldatabase. Toetst de gate (fn_decision_readiness_check) op exact dezelfde
-- fixture als de TS-sanity core/lib/decision.sanity.ts, zodat weergave en gate
-- aantoonbaar hetzelfde oordeel geven:
--
--   3 blokkerende document-vereisten op één stap, alle zónder documenttype
--   (zoals in de invaarseed v2) + 1 gebonden bewijsstuk
--     ⇒ 2 ontbrekend, blokkerend = true, voldoet = false
--
-- Verder gedekt:
--   • een ONgebonden bewijsstuk vervult niets (ook niet met kloppende titel) —
--     de oude wildcard/titel-like is weg;
--   • één bewijsstuk vervult nooit meer dan één vereiste;
--   • de sleutel die de functie bouwt is exact stap|type|coalesce(dt,label);
--   • external_submission bindt op zijn eigen type, niet op 'document';
--   • kolom + index bestaan en de EXECUTE-hygiëne (gate H) staat goed.
--
-- Zelf-seedend (1 fonds, eigen template_code). Alles in één transactie met
-- ROLLBACK: de database blijft ongewijzigd. psql exit 0 + de "OK #"-notices =
-- groen; elke "FAALT" → raise exception → non-zero exit.
--
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
--             (draait in scripts/cross-tenant-ci.sh)
--          OF: hele bestand plakken in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 1 — STRUCTUUR (als eigenaar)                                       ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- 1a. Kolom + index aanwezig.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='procedure_bewijs'
       and column_name='requirement_sleutel'
  ) then
    raise exception 'DEEL 1a FAALT: kolom procedure_bewijs.requirement_sleutel ontbreekt.';
  end if;
  if not exists (
    select 1 from pg_class where relname='idx_procbewijs_req_sleutel'
      and relnamespace='public'::regnamespace
  ) then
    raise exception 'DEEL 1a FAALT: index idx_procbewijs_req_sleutel ontbreekt.';
  end if;
  raise notice 'DEEL 1a OK: bindingskolom + index aanwezig.';
end $$;

-- 1b. De oude wildcard mag niet meer in de functiebody staan.
do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p
   where p.pronamespace='public'::regnamespace
     and p.proname='fn_decision_readiness_check';
  if src is null then
    raise exception 'DEEL 1b FAALT: fn_decision_readiness_check bestaat niet.';
  end if;
  if src not like '%requirement_sleutel%' then
    raise exception 'DEEL 1b FAALT: de functie gebruikt de bewijsbinding niet — draai de migratie.';
  end if;
  if src like '%rij.documenttype is null%' then
    raise exception 'DEEL 1b FAALT: de wildcard "rij.documenttype is null" staat nog in de document-tak.';
  end if;
  -- Fail-closed: zonder de guard op de procedure-lookup levert een onvindbare
  -- procedure nul requirements op en antwoordt de gate `voldoet = true,
  -- ontbrekend = []`. Statisch getoetst — het gedrag zelf nabootsen zou een
  -- FK moeten loskoppelen, en dat is een te zware ingreep voor een check die
  -- ook tegen een productiedatabase kan draaien.
  if src not like '%procedure_not_found%' then
    raise exception 'DEEL 1b FAALT: de gate mist de fail-closed guard op een onvindbare procedure.';
  end if;
  raise notice 'DEEL 1b OK: document-tak matcht op de binding, wildcard weg, gate is fail-closed.';
end $$;

-- 1c. EXECUTE-hygiëne (gate H): anon niet, authenticated wel.
do $$
begin
  if has_function_privilege('anon','public.fn_decision_readiness_check(uuid,text)','execute') then
    raise exception 'DEEL 1c FAALT: anon mag fn_decision_readiness_check uitvoeren.';
  end if;
  if not has_function_privilege('authenticated','public.fn_decision_readiness_check(uuid,text)','execute') then
    raise exception 'DEEL 1c FAALT: authenticated mag fn_decision_readiness_check NIET uitvoeren.';
  end if;
  raise notice 'DEEL 1c OK: EXECUTE-hygiëne op fn_decision_readiness_check.';
end $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 2 — GEDRAG. begin ... rollback, dus niets blijft achter.           ║
-- ╚════════════════════════════════════════════════════════════════════════╝
begin;

insert into public.fondsen (id, naam, slug)
values ('33333333-3333-3333-3333-333333333333','BB Testfonds','bb-testfonds');

insert into public.procedures (id, fonds_id, template_code, titel)
values ('33333333-0000-0000-0000-000000000001'::uuid,
        '33333333-3333-3333-3333-333333333333',
        'bb_test_template', 'Bewijsbinding-testprocedure');

insert into public.procedure_stappen (id, procedure_id, volgorde, naam)
values ('33333333-0000-0000-0000-000000000011'::uuid,
        '33333333-0000-0000-0000-000000000001'::uuid, 1, 'Stap 1'),
       ('33333333-0000-0000-0000-000000000019'::uuid,
        '33333333-0000-0000-0000-000000000001'::uuid, 9, 'Stap 9');

insert into public.decision_objects
  (id, procedure_id, fonds_id, besluit_code, titel, besluitvraag)
values ('33333333-0000-0000-0000-0000000000d1'::uuid,
        '33333333-0000-0000-0000-000000000001'::uuid,
        '33333333-3333-3333-3333-333333333333',
        'BB-TEST-0001', 'Bewijsbinding', 'Toetsvraag?');

-- Drie blokkerende document-vereisten zonder documenttype — exact het patroon
-- van stap 1 in de invaarseed v2 — plus één external_submission op stap 9.
insert into public.procedure_requirements
  (template_code, stap_volgorde, requirement_type, label, documenttype,
   veld_pad, verplicht, blokkerend, min_aantal)
values
  ('bb_test_template', 1, 'document', 'Transitieplan',            null, null, true, true, 1),
  ('bb_test_template', 1, 'document', 'Formeel invaarverzoek',    null, null, true, true, 1),
  ('bb_test_template', 1, 'document', '(Gewijzigde) pensioenovereenkomst/-regeling en compensatieafspraken',     null, null, true, true, 1),
  ('bb_test_template', 9, 'external_submission', 'DNB-indiening', null, null, true, true, 1);

-- Eén bewijsstuk, gebonden aan de EERSTE vereiste.
insert into public.procedure_bewijs (id, stap_id, titel, requirement_sleutel)
values ('33333333-0000-0000-0000-0000000000b1'::uuid,
        '33333333-0000-0000-0000-000000000011'::uuid,
        'Transitieplan', '1|document|Transitieplan');

-- #1 — de kernassertie uit de werkopdracht.
do $$
declare r jsonb; n int;
begin
  r := public.fn_decision_readiness_check(
         '33333333-0000-0000-0000-0000000000d1'::uuid, 'onderbouwing_compleet');
  n := jsonb_array_length(r->'ontbrekend');
  if n <> 2 then
    raise exception 'FAALT #1: verwacht 2 ontbrekende vereisten na één gebonden stuk, kreeg % (%).', n, r;
  end if;
  if (r->>'blokkerend') <> 'true' or (r->>'voldoet') <> 'false' then
    raise exception 'FAALT #1: onderbouwing_compleet had geblokkeerd moeten blijven (%).', r;
  end if;
  raise notice 'OK #1: 3 vereisten, 1 gebonden stuk -> 2 ontbrekend en nog steeds blokkerend.';
end $$;

-- #2 — het gebonden stuk vervult precies de vereiste waaraan het hangt.
do $$
declare r jsonb;
begin
  r := public.fn_decision_readiness_check(
         '33333333-0000-0000-0000-0000000000d1'::uuid, 'onderbouwing_compleet');
  if exists (select 1 from jsonb_array_elements(r->'ontbrekend') e
              where e->>'label' = 'Transitieplan') then
    raise exception 'FAALT #2: de gebonden vereiste staat nog als ontbrekend (%).', r;
  end if;
  if not exists (select 1 from jsonb_array_elements(r->'ontbrekend') e
                  where e->>'label' = 'Formeel invaarverzoek')
  or not exists (select 1 from jsonb_array_elements(r->'ontbrekend') e
                  where e->>'label' = '(Gewijzigde) pensioenovereenkomst/-regeling en compensatieafspraken') then
    raise exception 'FAALT #2: de twee ongebonden vereisten ontbreken niet allebei (%).', r;
  end if;
  raise notice 'OK #2: precies de gebonden vereiste is vervuld, de andere twee niet.';
end $$;

-- #3 — een ONgebonden stuk vervult niets, ook niet met een titel die exact
-- gelijk is aan het label (dat was de oude titel-like-fallback).
do $$
declare r jsonb; n int;
begin
  insert into public.procedure_bewijs (stap_id, titel, requirement_sleutel)
  values ('33333333-0000-0000-0000-000000000011'::uuid, 'Formeel invaarverzoek', null);
  r := public.fn_decision_readiness_check(
         '33333333-0000-0000-0000-0000000000d1'::uuid, 'onderbouwing_compleet');
  n := jsonb_array_length(r->'ontbrekend');
  if n <> 2 then
    raise exception 'FAALT #3: een ongebonden stuk veranderde de uitkomst (% ontbrekend).', n;
  end if;
  raise notice 'OK #3: ongebonden bewijsstuk vervult niets.';
end $$;

-- #4 — één bewijsstuk kan nooit twee vereisten vervullen. Het stuk uit #3
-- alsnog binden zet er precies één bij, niet twee.
do $$
declare r jsonb; n int;
begin
  update public.procedure_bewijs
     set requirement_sleutel = '1|document|Formeel invaarverzoek'
   where stap_id = '33333333-0000-0000-0000-000000000011'::uuid
     and requirement_sleutel is null;
  r := public.fn_decision_readiness_check(
         '33333333-0000-0000-0000-0000000000d1'::uuid, 'onderbouwing_compleet');
  n := jsonb_array_length(r->'ontbrekend');
  if n <> 1 then
    raise exception 'FAALT #4: verwacht nog 1 ontbrekende vereiste, kreeg % (%).', n, r;
  end if;
  raise notice 'OK #4: elk gebonden stuk vervult precies één vereiste.';
end $$;

-- #5 — external_submission bindt op zijn eigen type, niet op 'document'.
-- (v_type mapt de tak naar document, maar de sleutel houdt het echte type.)
do $$
declare r jsonb;
begin
  insert into public.procedure_bewijs (stap_id, titel, requirement_sleutel)
  values ('33333333-0000-0000-0000-000000000019'::uuid, 'DNB-indiening',
          '9|document|DNB-indiening');
  r := public.fn_decision_readiness_check(
         '33333333-0000-0000-0000-0000000000d1'::uuid, 'verantwoordingsrijp');
  if not exists (select 1 from jsonb_array_elements(r->'ontbrekend') e
                  where e->>'label' = 'DNB-indiening') then
    raise exception 'FAALT #5: binding op het verkeerde type vervulde de vereiste toch (%).', r;
  end if;

  update public.procedure_bewijs
     set requirement_sleutel = '9|external_submission|DNB-indiening'
   where stap_id = '33333333-0000-0000-0000-000000000019'::uuid;
  r := public.fn_decision_readiness_check(
         '33333333-0000-0000-0000-0000000000d1'::uuid, 'verantwoordingsrijp');
  if exists (select 1 from jsonb_array_elements(r->'ontbrekend') e
              where e->>'label' = 'DNB-indiening') then
    raise exception 'FAALT #5: correcte binding op external_submission vervulde de vereiste niet (%).', r;
  end if;
  raise notice 'OK #5: external_submission bindt op het eigen requirement_type.';
end $$;

-- #6 — een bewijsstuk op een ándere stap telt niet mee, ook niet met dezelfde
-- sleutelstaart. De stap-scope blijft dus intact.
do $$
declare r jsonb; n int;
begin
  insert into public.procedure_bewijs (stap_id, titel, requirement_sleutel)
  values ('33333333-0000-0000-0000-000000000019'::uuid, '(Gewijzigde) pensioenovereenkomst/-regeling en compensatieafspraken',
          '1|document|Compensatieafspraken');
  r := public.fn_decision_readiness_check(
         '33333333-0000-0000-0000-0000000000d1'::uuid, 'onderbouwing_compleet');
  n := jsonb_array_length(r->'ontbrekend');
  if n <> 1 then
    raise exception 'FAALT #6: een stuk op de verkeerde stap telde mee (% ontbrekend).', n;
  end if;
  raise notice 'OK #6: bewijs op een andere stap vervult de vereiste niet.';
end $$;

-- #7 — een getagde vereiste bindt op documenttype, niet meer op de tag van het
-- bewijsstuk. Een stuk met de juiste pb.documenttype maar zonder binding telt
-- niet; met binding wel.
do $$
declare r jsonb;
begin
  insert into public.procedure_requirements
    (template_code, stap_volgorde, requirement_type, label, documenttype,
     veld_pad, verplicht, blokkerend, min_aantal)
  values ('bb_test_template', 9, 'document', 'ALM-analyse', 'alm_analyse',
          null, true, true, 1);

  insert into public.procedure_bewijs (id, stap_id, titel, documenttype, requirement_sleutel)
  values ('33333333-0000-0000-0000-0000000000b7'::uuid,
          '33333333-0000-0000-0000-000000000019'::uuid,
          'ALM-analyse 2026', 'alm_analyse', null);
  r := public.fn_decision_readiness_check(
         '33333333-0000-0000-0000-0000000000d1'::uuid, 'onderbouwing_compleet');
  if not exists (select 1 from jsonb_array_elements(r->'ontbrekend') e
                  where e->>'label' = 'ALM-analyse') then
    raise exception 'FAALT #7: pb.documenttype vervulde de vereiste zonder binding (%).', r;
  end if;

  update public.procedure_bewijs
     set requirement_sleutel = '9|document|alm_analyse'
   where id = '33333333-0000-0000-0000-0000000000b7'::uuid;
  r := public.fn_decision_readiness_check(
         '33333333-0000-0000-0000-0000000000d1'::uuid, 'onderbouwing_compleet');
  if exists (select 1 from jsonb_array_elements(r->'ontbrekend') e
              where e->>'label' = 'ALM-analyse') then
    raise exception 'FAALT #7: binding op documenttype-identiteit werkte niet (%).', r;
  end if;
  raise notice 'OK #7: getagde vereiste gebruikt coalesce(documenttype,label) als identiteit.';
end $$;

rollback;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 3 — TENANT-ISOLATIE op de nieuwe kolom, onder ÉCHTE RLS.           ║
-- ║ De policy "fonds proc bewijs" is rij-gebaseerd en zou de kolom dus      ║
-- ║ moeten dekken. DEEL 2 draait als eigenaar en bewijst dat niet — dit     ║
-- ║ deel impersoneert een gebruiker van een ánder fonds.                    ║
-- ╚════════════════════════════════════════════════════════════════════════╝
begin;

insert into public.fondsen (id, naam, slug)
values ('33333333-aaaa-aaaa-aaaa-333333333333','BB Fonds A','bb-fonds-a'),
       ('33333333-bbbb-bbbb-bbbb-333333333333','BB Fonds B','bb-fonds-b');

insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('33333333-aaaa-0000-0000-333333333333','authenticated','authenticated','bb-a@test.local',
   '{"naam":"BB A","fonds_id":"33333333-aaaa-aaaa-aaaa-333333333333"}', now(), now()),
  ('33333333-bbbb-0000-0000-333333333333','authenticated','authenticated','bb-b@test.local',
   '{"naam":"BB B","fonds_id":"33333333-bbbb-bbbb-bbbb-333333333333"}', now(), now());

-- Vangnet als de auth-trigger maak_profiel() niet actief is op deze DB.
insert into public.profielen (id, naam, fonds_id, rol)
values ('33333333-aaaa-0000-0000-333333333333','BB A','33333333-aaaa-aaaa-aaaa-333333333333','bestuurder'),
       ('33333333-bbbb-0000-0000-333333333333','BB B','33333333-bbbb-bbbb-bbbb-333333333333','bestuurder')
on conflict (id) do update
  set fonds_id = excluded.fonds_id, naam = excluded.naam, rol = excluded.rol;

insert into public.procedures (id, fonds_id, template_code, titel)
values ('33333333-aaaa-0000-0000-000000000001','33333333-aaaa-aaaa-aaaa-333333333333','bb_test_template','Proc A');
insert into public.procedure_stappen (id, procedure_id, volgorde, naam)
values ('33333333-aaaa-0000-0000-000000000011','33333333-aaaa-0000-0000-000000000001',1,'Stap 1');
insert into public.procedure_bewijs (id, stap_id, titel, requirement_sleutel)
values ('33333333-aaaa-0000-0000-0000000000b1','33333333-aaaa-0000-0000-000000000011',
        'Transitieplan A','1|document|Transitieplan');

-- ── Impersoneer gebruiker B (ander fonds) ───────────────────────────────────
set local role authenticated;
set local request.jwt.claim.sub to '33333333-bbbb-0000-0000-333333333333';

do $$
declare n int;
begin
  select count(*) into n from public.procedure_bewijs
   where id = '33333333-aaaa-0000-0000-0000000000b1';
  if n <> 0 then
    raise exception 'LEK #9: fonds B ziet het bewijsstuk (incl. requirement_sleutel) van fonds A.';
  end if;
  raise notice 'OK #9: fonds B leest geen bewijsstukken van fonds A.';
end $$;

do $$
declare n int;
begin
  update public.procedure_bewijs set requirement_sleutel = '1|document|Gekaapt'
   where id = '33333333-aaaa-0000-0000-0000000000b1';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'LEK #10: fonds B wijzigde de bewijsbinding van fonds A (% rijen).', n;
  end if;
  raise notice 'OK #10: fonds B kan de bewijsbinding van fonds A niet wijzigen.';
exception
  when insufficient_privilege then raise notice 'OK #10: update geweigerd (privilege).';
end $$;

do $$
begin
  insert into public.procedure_bewijs (stap_id, titel, requirement_sleutel)
  values ('33333333-aaaa-0000-0000-000000000011','Ingesloten','1|document|Transitieplan');
  raise exception 'LEK #11: fonds B voegde een gebonden bewijsstuk toe op een stap van fonds A.';
exception
  -- Een WITH CHECK-schending komt terug als SQLSTATE 42501, dat plpgsql als
  -- `insufficient_privilege` benoemt — dat is hier dus de RLS-weigering.
  when insufficient_privilege then
    raise notice 'OK #11: insert van een gebonden bewijsstuk op een vreemde stap geweigerd (RLS).';
end $$;

reset role;
rollback;

do $$ begin raise notice 'Bewijsbinding-gedragstoets afgerond — alle checks groen.'; end $$;
