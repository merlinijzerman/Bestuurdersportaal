-- ============================================================================
-- Gedragstoets 2026-08-18 — expliciete bewijs↔vereiste-binding
-- ----------------------------------------------------------------------------
-- Draai dit ná migraties 2026_08_18_bewijs_requirement_binding.sql en
-- 2026_08_22_bewijs_requirement_binding_hardening.sql tegen de
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
--   • unieke indexes, DB-validatie, atomische audit en snapshots staan goed;
--   • de EXECUTE-hygiëne (gate H) staat goed.
--
-- Zelf-seedend (1 fonds, eigen template_code). Alles in één transactie met
-- ROLLBACK: de database blijft ongewijzigd. psql exit 0 + de "OK #"-notices =
-- groen; elke "FAALT" → raise exception → non-zero exit.
--
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
--             (draait in scripts/cross-tenant-ci.sh)
--          OF: hele bestand plakken in Supabase Dashboard -> SQL Editor.
-- ROL: postgres voor structuur, seed en afbraak; authenticated in DEEL 3. De
-- catalogus-/gedragspoorten vragen eigenaarszicht, terwijl tenantisolatie juist
-- onder een echte browserrol met RLS moet worden gemeten.
-- ============================================================================

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 1 — STRUCTUUR (als eigenaar)                                       ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- 1a. Kolom + unieke indexen aanwezig.
do $$
declare v_uniek boolean;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='procedure_bewijs'
       and column_name='requirement_sleutel'
  ) then
    raise exception 'DEEL 1a FAALT: kolom procedure_bewijs.requirement_sleutel ontbreekt.';
  end if;
  -- P2/PR-A (#160-correctie, 0189 §6.2): de index is bewust NIET-uniek — uniciteit
  -- verbood min_aantal > 1. "Eén artefact vervult hoogstens één vereiste" borgt de
  -- kolomvorm (één requirement_sleutel per rij), niet de index.
  select i.indisunique into v_uniek
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where c.relname='idx_procbewijs_req_sleutel'
     and c.relnamespace='public'::regnamespace;
  if v_uniek is null then
    raise exception 'DEEL 1a FAALT: idx_procbewijs_req_sleutel ontbreekt.';
  end if;
  if v_uniek is distinct from false then
    raise exception 'DEEL 1a FAALT: idx_procbewijs_req_sleutel is uniek — de #160-correctie (niet-uniek, min_aantal) is niet toegepast.';
  end if;
  if not exists (
    select 1 from pg_class where relname='idx_procedure_stappen_volgorde_uniek'
      and relnamespace='public'::regnamespace
  ) then
    raise exception 'DEEL 1a FAALT: unieke stapvolgorde-index ontbreekt.';
  end if;
  raise notice 'DEEL 1a OK: bindingskolom aanwezig, opzoekindex niet-uniek (#160-correctie), stapvolgorde-index uniek.';
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
  if src not like '%v_sleutel_count = 1%' then
    raise exception 'DEEL 1b FAALT: dubbele vereistesleutels falen niet gesloten.';
  end if;
  raise notice 'DEEL 1b OK: binding exact, wildcard weg, ambiguïteit en ontbrekende procedure fail-closed.';
end $$;

-- 1d. Triggers aanwezig en niet direct uitvoerbaar door API-rollen.
do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgname='trg_procedure_bewijs_validate_binding'
                    and not tgisinternal)
  or not exists (select 1 from pg_trigger
                  where tgname='trg_procedure_bewijs_audit'
                    and not tgisinternal)
  or not exists (select 1 from pg_trigger
                  where tgname='trg_requirement_instance_validate_binding_sleutel'
                    and not tgisinternal) then
    raise exception 'DEEL 1d FAALT: requirement-/bewijsvalidatie- of audittrigger ontbreekt.';
  end if;
  if has_function_privilege('authenticated',
       'public.fn_validate_bewijs_requirement_binding()','execute')
  or has_function_privilege('authenticated',
       'public.fn_audit_procedure_bewijs_mutation()','execute')
  or has_function_privilege('authenticated',
       'public.fn_validate_requirement_instance_binding_sleutel()','execute') then
    raise exception 'DEEL 1d FAALT: authenticated kan een triggerfunctie direct uitvoeren.';
  end if;
  raise notice 'DEEL 1d OK: DB-validatie en atomische audittrigger staan; API-rollen hebben geen EXECUTE.';
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
  (template_code, template_versie, stap_volgorde, requirement_type, label, documenttype,
   veld_pad, zwaarte, min_aantal)
values
  ('bb_test_template', '1.0.0', 1, 'document', 'Transitieplan',            null, null, 'kritiek', 1),
  ('bb_test_template', '1.0.0', 1, 'document', 'Formeel invaarverzoek',    null, null, 'kritiek', 1),
  ('bb_test_template', '1.0.0', 1, 'document', '(Gewijzigde) pensioenovereenkomst/-regeling en compensatieafspraken',     null, null, 'kritiek', 1),
  ('bb_test_template', '1.0.0', 9, 'external_submission', 'DNB-indiening', null, null, 'kritiek', 1);

-- Eén bewijsstuk, gebonden aan de EERSTE vereiste.
insert into public.procedure_bewijs (id, stap_id, titel, requirement_sleutel)
values ('33333333-0000-0000-0000-0000000000b1'::uuid,
        '33333333-0000-0000-0000-000000000011'::uuid,
        'Transitieplan', '1|document|Transitieplan');

-- De auditregel komt uit de DB-trigger in dezelfde transactie; de test schrijft
-- bewust rechtstreeks, dus de Next-route kan dit resultaat niet veroorzaken.
do $$
begin
  if not exists (
    select 1 from public.procedure_log
     where procedure_id = '33333333-0000-0000-0000-000000000001'::uuid
       and event_type = 'bewijs_toegevoegd'
       and payload->>'bewijs_id' = '33333333-0000-0000-0000-0000000000b1'
       and payload->>'requirement_sleutel' = '1|document|Transitieplan'
  ) then
    raise exception 'FAALT #0a: directe bewijsinsert heeft geen atomische auditregel.';
  end if;
  raise notice 'OK #0a: directe bewijsinsert is atomair gelogd.';
end $$;

do $$
declare dossier jsonb;
begin
  dossier := public.fn_build_decision_dossier(
    '33333333-0000-0000-0000-0000000000d1'::uuid);
  if jsonb_array_length(dossier->'bewijs') <> 1
     or dossier#>>'{bewijs,0,requirement_sleutel}' <> '1|document|Transitieplan'
     or dossier->'steps' is null
     or dossier->'readiness' is null then
    raise exception 'FAALT #0b: dossier-snapshotbron mist bewijsbinding, stappen of readiness (%).', dossier;
  end if;
  raise notice 'OK #0b: dossier-snapshotbron bevat bewijsbinding, stappen en readiness.';
end $$;

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
  begin
    insert into public.procedure_bewijs (stap_id, titel, requirement_sleutel)
    values ('33333333-0000-0000-0000-000000000019'::uuid, 'DNB-indiening',
            '9|document|DNB-indiening');
    raise exception 'FAALT #5: DB-trigger accepteerde een sleutel met het verkeerde type.';
  exception
    when check_violation then null;
  end;

  insert into public.procedure_bewijs (stap_id, titel, requirement_sleutel)
  values ('33333333-0000-0000-0000-000000000019'::uuid, 'DNB-indiening',
          '9|external_submission|DNB-indiening');
  r := public.fn_decision_readiness_check(
         '33333333-0000-0000-0000-0000000000d1'::uuid, 'verantwoordingsrijp');
  if exists (select 1 from jsonb_array_elements(r->'ontbrekend') e
              where e->>'label' = 'DNB-indiening') then
    raise exception 'FAALT #5: correcte binding op external_submission vervulde de vereiste niet (%).', r;
  end if;
  raise notice 'OK #5: external_submission bindt op het eigen requirement_type.';
end $$;

-- #6 — een bewijsstuk op een ándere stap telt niet mee, ook niet met dezelfde
-- sleutelstaart. De DB-trigger weigert de dode binding al bij de write.
do $$
begin
  begin
    insert into public.procedure_bewijs (stap_id, titel, requirement_sleutel)
    values ('33333333-0000-0000-0000-000000000019'::uuid,
            '(Gewijzigde) pensioenovereenkomst/-regeling en compensatieafspraken',
            '1|document|(Gewijzigde) pensioenovereenkomst/-regeling en compensatieafspraken');
    raise exception 'FAALT #6: DB-trigger accepteerde een vereiste van een andere stap.';
  exception
    when check_violation then null;
  end;
  raise notice 'OK #6: binding naar een andere stap wordt bij de write geweigerd.';
end $$;

-- #7 — een getagde vereiste bindt op documenttype, niet meer op de tag van het
-- bewijsstuk. Een stuk met de juiste pb.documenttype maar zonder binding telt
-- niet; met binding wel.
do $$
declare r jsonb;
begin
  insert into public.procedure_requirements
    (template_code, template_versie, stap_volgorde, requirement_type, label, documenttype,
     veld_pad, zwaarte, min_aantal)
  values ('bb_test_template', '1.0.0', 9, 'document', 'ALM-analyse', 'alm_analyse',
          null, 'kritiek', 1);

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

-- #8 — een identieke sleutel in template- én instantie-arm wordt al bij de
-- configuratiewrite geweigerd. Daarna simuleren we legacy-/productiedrift door
-- als eigenaar de trigger tijdelijk uit te zetten: ook dán falen readiness en
-- een nieuwe bewijsbinding gesloten.
do $$
begin
  begin
    insert into public.procedure_requirement_instance
      (decision_id, stap_volgorde, requirement_type, label, documenttype,
       zwaarte, fonds_id)
    values
      ('33333333-0000-0000-0000-0000000000d1'::uuid,
       1, 'document', 'Transitieplan', null, 'kritiek',
       '33333333-3333-3333-3333-333333333333'::uuid);
    raise exception 'FAALT #8: DB-trigger accepteerde een dubbele vereistesleutel.';
  exception
    when unique_violation then null;
  end;
  raise notice 'OK #8a: nieuwe dubbele template/instantiesleutel wordt geweigerd.';
end $$;

alter table public.procedure_requirement_instance
  disable trigger trg_requirement_instance_validate_binding_sleutel;
insert into public.procedure_requirement_instance
  (decision_id, stap_volgorde, requirement_type, label, documenttype,
   zwaarte, fonds_id)
values
  ('33333333-0000-0000-0000-0000000000d1'::uuid,
   1, 'document', 'Transitieplan', null, 'kritiek',
   '33333333-3333-3333-3333-333333333333'::uuid);
alter table public.procedure_requirement_instance
  enable trigger trg_requirement_instance_validate_binding_sleutel;

do $$
declare r jsonb;
begin
  r := public.fn_decision_readiness_check(
         '33333333-0000-0000-0000-0000000000d1'::uuid, 'onderbouwing_compleet');
  if (select count(*) from jsonb_array_elements(r->'ontbrekend') e
       where e->>'label' = 'Transitieplan') <> 2 then
    raise exception 'FAALT #8: dubbele vereistesleutel faalde niet gesloten (%).', r;
  end if;

  update public.procedure_bewijs
     set requirement_sleutel = null
   where id = '33333333-0000-0000-0000-0000000000b1'::uuid;
  begin
    update public.procedure_bewijs
       set requirement_sleutel = '1|document|Transitieplan'
     where id = '33333333-0000-0000-0000-0000000000b1'::uuid;
    raise exception 'FAALT #8: validatietrigger accepteerde een dubbele vereistesleutel.';
  exception
    when check_violation then null;
  end;
  raise notice 'OK #8b: legacy-dubbele sleutel faalt gesloten in readiness én bij bewijswrite.';
end $$;

-- #8c — sinds de #160-correctie (niet-uniek, 0189 §6.2) mag één vereiste door
-- MEER dan één bewijsstuk gedekt worden: vervulling = count(gebonden feiten) >=
-- min_aantal, en de kolomvorm borgt nog steeds "één artefact vervult hoogstens
-- één vereiste". De DB weigert de tweede binding dus niet meer.
do $$
declare v_voor int; v_na int;
begin
  select count(*) into v_voor from public.procedure_bewijs
   where requirement_sleutel = '1|document|Formeel invaarverzoek';
  insert into public.procedure_bewijs (stap_id, titel, requirement_sleutel)
  values ('33333333-0000-0000-0000-000000000011'::uuid,
          'Tweede stuk zelfde vereiste', '1|document|Formeel invaarverzoek');
  select count(*) into v_na from public.procedure_bewijs
   where requirement_sleutel = '1|document|Formeel invaarverzoek';
  if v_na <> v_voor + 1 then
    raise exception 'FAALT #8c: tweede binding aan dezelfde vereiste geweigerd — de #160-correctie (niet-uniek, min_aantal) ontbreekt.';
  end if;
  raise notice 'OK #8c: niet-unieke index staat meerdere gebonden stukken per vereiste toe (min_aantal/oververvulling).';
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
insert into public.procedure_requirements
  (template_code, template_versie, stap_volgorde, requirement_type, label, documenttype,
   veld_pad, zwaarte, min_aantal)
values ('bb_test_template','1.0.0',1,'document','Transitieplan',null,null, 'kritiek', 1);
insert into public.procedure_bewijs (id, stap_id, titel, requirement_sleutel)
values ('33333333-aaaa-0000-0000-0000000000b1','33333333-aaaa-0000-0000-000000000011',
        'Transitieplan A','1|document|Transitieplan');

-- Echte authenticated/RLS-write, equivalent aan een directe PostgREST PATCH.
set local role authenticated;
set local request.jwt.claim.sub to '33333333-aaaa-0000-0000-333333333333';
update public.procedure_bewijs
   set requirement_sleutel = null
 where id = '33333333-aaaa-0000-0000-0000000000b1';
update public.procedure_bewijs
   set requirement_sleutel = '1|document|Transitieplan'
 where id = '33333333-aaaa-0000-0000-0000000000b1';
update public.procedure_bewijs
   set documenttype = 'transitieplan'
 where id = '33333333-aaaa-0000-0000-0000000000b1';
do $$
begin
  begin
    update public.procedure_bewijs
       set titel = 'Stil herschreven'
     where id = '33333333-aaaa-0000-0000-0000000000b1';
    raise exception 'LEK #8c: immutable bewijsinhoud kon rechtstreeks worden herschreven.';
  exception
    when check_violation then null;
  end;
end $$;
reset role;

do $$
begin
  if (select count(*) from public.procedure_log
       where procedure_id = '33333333-aaaa-0000-0000-000000000001'
         and event_type = 'bewijs_binding_gewijzigd'
         and actor_id = '33333333-aaaa-0000-0000-333333333333') <> 2 then
    raise exception 'LEK #8c: authenticated direct-write mist atomische bindingsaudit.';
  end if;
  if not exists (
    select 1 from public.procedure_log
     where procedure_id = '33333333-aaaa-0000-0000-000000000001'
       and event_type = 'bewijs_document_gekoppeld'
       and actor_id = '33333333-aaaa-0000-0000-333333333333'
       and payload->>'documenttype_nieuw' = 'transitieplan'
  ) then
    raise exception 'LEK #8c: documenttypewijziging mist atomische audit.';
  end if;
  raise notice 'OK #8c: authenticated direct-write onder RLS is geaudit; inhoud/herkomst immutable.';
end $$;

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
