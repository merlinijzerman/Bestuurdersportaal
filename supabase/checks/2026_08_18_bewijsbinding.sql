-- ============================================================================
-- Gedragstoets 2026-08-18 — expliciete bewijs↔vereiste-binding
-- ----------------------------------------------------------------------------
-- Draai dit ná migraties 2026_08_18_bewijs_requirement_binding.sql en
-- 2026_08_22_bewijs_requirement_binding_hardening.sql tegen de
-- doeldatabase. Toetst de BINDING (requirement_sleutel) zelf — niet de vervulling-
-- reflectie, die sinds de readiness-ontmanteling (PR-D #168/0187) in het D10-model
-- zit (2026_08_27_p3c_afwijking.sql via fn_stap_open_per_zwaarte). Gedekt:
--   • de bindingskolom + de niet-unieke opzoekindex (#160-correctie);
--   • de validatie- en atomische audittrigger, geen EXECUTE voor API-rollen;
--   • de write-weigeringen: verkeerd type (#5), andere stap (#6), dubbele
--     vereistesleutel (#8a/#8b) — fail-closed bij de write;
--   • de niet-unieke index staat meerdere gebonden stukken per vereiste toe (#8c);
--   • de snapshotbron (fn_build_decision_dossier) draagt bewijs en stappen, en
--     GEEN readiness-key meer (#0b);
--   • tenant-isolatie op de kolom onder échte RLS (DEEL 3).
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

-- (1b/1c vervielen met de readiness-ontmanteling, PR-D #168/0187: de gate
--  fn_decision_readiness_check bestaat niet meer. De vervulling-REFLECTIE van de
--  binding — dat een gebonden stuk de juiste vereiste vervult en een ongebonden
--  niets — wordt nu getoetst in supabase/checks/2026_08_27_p3c_afwijking.sql via
--  het D10-model fn_stap_open_per_zwaarte. Deze check houdt de BINDING zelf:
--  kolom+index, triggers, atomische audit, write-weigering en tenant-isolatie.)

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
     or dossier->'steps' is null then
    raise exception 'FAALT #0b: dossier-snapshotbron mist bewijsbinding of stappen (%).', dossier;
  end if;
  -- PR-D (#168/0187): de snapshot draagt geen 'readiness'-key meer.
  if dossier ? 'readiness' then
    raise exception 'FAALT #0b: de dossier-snapshot draagt nog een readiness-key na de ontmanteling (%).', dossier;
  end if;
  raise notice 'OK #0b: dossier-snapshotbron bevat bewijsbinding en stappen, geen readiness.';
end $$;

-- (De vervulling-REFLECTIE-scenario's #1–#5/#7 — dat één gebonden stuk precies zijn
--  vereiste vervult, dat een ongebonden stuk niets vervult, en dat external_submission/
--  documenttype op de eigen identiteit binden — draaiden via fn_decision_readiness_check.
--  Die functie is met de readiness-ontmanteling weg (PR-D). Dezelfde reflectie wordt nu
--  in het D10-model getoetst: 2026_08_27_p3c_afwijking.sql #1 (snapshot per zwaarte:
--  min_aantal>1 vervuld, instantie/uitsluiting, labels) en #9 (alle 8 bronnen). Hier
--  houden we uitsluitend de BINDING zelf: de write-weigeringen (#5-type, #6-stap,
--  #8a-dubbel), de atomische audit (#0a), de niet-unieke index (#8c) en tenant-isolatie.)

-- #5 — external_submission bindt op zijn eigen type: een 'document'-sleutel op een
-- external_submission-vereiste wordt bij de write geweigerd.
do $$
begin
  begin
    insert into public.procedure_bewijs (stap_id, titel, requirement_sleutel)
    values ('33333333-0000-0000-0000-000000000019'::uuid, 'DNB-indiening',
            '9|document|DNB-indiening');
    raise exception 'FAALT #5: DB-trigger accepteerde een sleutel met het verkeerde type.';
  exception
    when check_violation then null;
  end;
  -- De correcte binding wordt wél geaccepteerd (write slaagt).
  insert into public.procedure_bewijs (stap_id, titel, requirement_sleutel)
  values ('33333333-0000-0000-0000-000000000019'::uuid, 'DNB-indiening',
          '9|external_submission|DNB-indiening');
  raise notice 'OK #5: external_submission bindt op het eigen requirement_type (verkeerd type geweigerd).';
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

-- (#7 — documenttype-identiteit in de vervulling — draaide via readiness en is nu
--  gedekt door het sleutelformaat in het D10-model (p3c-check). Vervallen hier.)

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

-- #8b — ook bij legacy-drift (twee identieke vereistesleutels, via een tijdelijk
--  uitgezette trigger geplaatst) weigert de bewijs-validatietrigger een nieuwe
--  binding aan die ambigue sleutel fail-closed. (De vervulling-kant hiervan —
--  ambiguïteit → fail-closed niet-vervuld — zit in de p3c-check #10.)
do $$
begin
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
  raise notice 'OK #8b: legacy-dubbele sleutel faalt gesloten bij de bewijswrite.';
end $$;

-- #8c — sinds de #160-correctie (niet-uniek, 0189 §6.2) mag één vereiste door
-- MEER dan één bewijsstuk gedekt worden: vervulling = count(gebonden feiten) >=
-- min_aantal, en de kolomvorm borgt nog steeds "één artefact vervult hoogstens
-- één vereiste". De DB weigert de tweede binding dus niet meer.
do $$
declare v_na int;
begin
  -- TWEE bewijsstukken op dezelfde vereistesleutel: een unieke index zou het
  -- tweede weigeren; de #160-correctie (niet-uniek) staat beide toe.
  insert into public.procedure_bewijs (stap_id, titel, requirement_sleutel)
  values ('33333333-0000-0000-0000-000000000011'::uuid,
          'Eerste stuk zelfde vereiste', '1|document|Formeel invaarverzoek'),
         ('33333333-0000-0000-0000-000000000011'::uuid,
          'Tweede stuk zelfde vereiste', '1|document|Formeel invaarverzoek');
  select count(*) into v_na from public.procedure_bewijs
   where requirement_sleutel = '1|document|Formeel invaarverzoek';
  if v_na <> 2 then
    raise exception 'FAALT #8c: tweede binding aan dezelfde vereiste geweigerd — de #160-correctie (niet-uniek, min_aantal) ontbreekt (%).', v_na;
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
