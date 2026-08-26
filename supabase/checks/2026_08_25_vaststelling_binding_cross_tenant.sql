-- ============================================================================
-- Gedragstoets 2026-08-25 — procedure_vaststelling: binding, I1 en tenant-isolatie
-- ----------------------------------------------------------------------------
-- Draai ná 2026_08_24_p2a_09_procedure_vaststelling.sql en
-- 2026_08_25_p2b_01_i1_ontkoppelslot.sql tegen de doeldatabase. Bewijst GEDRAG
-- (niet alleen de RLS-vorm die de structurele gates dekken) voor de enige
-- brontabel waar het feit bij het binden ONTSTAAT:
--
--   • geldige mandaatcheck-vaststelling bindt op zijn eigen type;
--   • type-mismatch (dissent-sleutel op een mandaatcheck) wordt geweigerd;
--   • I5: een fonds_id die niet bij de procedure hoort wordt geweigerd;
--   • cross-procedure: een sleutel die geen vereiste van de procedure is faalt;
--   • I1 (0189): onder een besloten besluit worden DELETE én ontkoppelen/herbinden
--     van de gebonden vaststelling geweigerd; een eerste binding mag wél;
--   • tenant-isolatie onder ÉCHTE RLS: fonds B ziet/insert/delete geen
--     vaststelling van fonds A.
--
-- Zelf-seedend, alles in transacties met ROLLBACK. psql exit 0 + "OK"-notices =
-- groen; elke "FAALT"/"LEK" → raise exception → non-zero exit.
-- Uitvoeren: psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand (in cross-tenant-ci.sh).
-- ============================================================================

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 1 — STRUCTUUR (als eigenaar)                                       ║
-- ╚════════════════════════════════════════════════════════════════════════╝
do $$
begin
  if not exists (
    select 1 from pg_class c
     where c.relname='procedure_vaststelling'
       and c.relnamespace='public'::regnamespace
       and c.relrowsecurity = true
  ) then
    raise exception 'DEEL 1 FAALT: RLS staat niet aan op procedure_vaststelling.';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='procedure_vaststelling'
       and policyname='fonds proc vaststelling'
  ) then
    raise exception 'DEEL 1 FAALT: expliciete fonds-policy ontbreekt.';
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_vaststelling_validate_binding' and not tgisinternal)
  or not exists (select 1 from pg_trigger where tgname='trg_vaststelling_audit_binding' and not tgisinternal)
  or not exists (select 1 from pg_trigger where tgname='trg_vaststelling_i1' and not tgisinternal) then
    raise exception 'DEEL 1 FAALT: validate-, audit- of I1-trigger ontbreekt.';
  end if;
  if has_function_privilege('authenticated','public.fn_validate_vaststelling_binding()','execute')
  or has_function_privilege('authenticated','public.fn_assert_gebonden_feit(uuid,uuid,text,text)','execute')
  or has_function_privilege('authenticated','public.fn_assert_feit_ontgrendeld(uuid)','execute') then
    raise exception 'DEEL 1 FAALT: authenticated kan een triggerfunctie direct uitvoeren.';
  end if;
  raise notice 'DEEL 1 OK: RLS aan, expliciete policy, drie triggers, geen EXECUTE voor authenticated.';
end $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 2 — GEDRAG (als eigenaar). begin ... rollback.                     ║
-- ╚════════════════════════════════════════════════════════════════════════╝
begin;

insert into public.fondsen (id, naam, slug)
values ('44444444-4444-4444-4444-444444444444','VS Testfonds','vs-testfonds');
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('44444444-0000-0000-0000-4444444444a0','authenticated','authenticated','vs@test.local',
        '{"naam":"VS Actor"}', now(), now());
insert into public.procedures (id, fonds_id, template_code, template_versie, titel)
values ('44444444-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444444','vs_test_template','1.0.0','VS-procedure');
insert into public.procedure_stappen (id, procedure_id, volgorde, naam)
values ('44444444-0000-0000-0000-000000000011','44444444-0000-0000-0000-000000000001',9,'Stap 9');
insert into public.procedure_requirements
  (template_code, template_versie, stap_volgorde, requirement_type, label, documenttype, veld_pad, verplicht, blokkerend, min_aantal)
values
  ('vs_test_template', '1.0.0', 9, 'mandate_check',  'Mandaatcheck', null, null, true, true, 1),
  ('vs_test_template', '1.0.0', 9, 'dissent_review', 'Dissentronde', null, null, true, true, 1);
-- Direct als 'besloten' ingevoerd: de statusovergangsmachine blokkeert een
-- UPDATE concept→besloten, maar #5 heeft een besloten besluit nodig. Een INSERT
-- van een vaststelling is niet I1-bewaakt (de I1-trigger vuurt op delete/update),
-- dus #1 bindt hier gewoon; #5 toetst dat delete/ontkoppel daarna geweigerd worden.
insert into public.decision_objects (id, procedure_id, fonds_id, besluit_code, titel, besluitvraag, is_primary_decision, status)
values ('44444444-0000-0000-0000-0000000000d1','44444444-0000-0000-0000-000000000001',
        '44444444-4444-4444-4444-444444444444','VS-0001','VS','Vraag?', true, 'besloten');

-- #1 geldige mandaatcheck-vaststelling bindt op zijn eigen type.
do $$
begin
  insert into public.procedure_vaststelling
    (id, fonds_id, procedure_id, stap_id, requirement_sleutel, soort, uitkomst, toelichting, actor)
  values ('44444444-0000-0000-0000-0000000000f1','44444444-4444-4444-4444-444444444444',
          '44444444-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000011',
          '9|mandate_check|Mandaatcheck','mandaatcheck','geslaagd','ok','44444444-0000-0000-0000-4444444444a0');
  raise notice 'OK #1: geldige mandaatcheck-vaststelling geaccepteerd.';
end $$;

-- #2 type-mismatch: een mandaatcheck met een dissent-sleutel geweigerd.
do $$
begin
  begin
    insert into public.procedure_vaststelling
      (fonds_id, procedure_id, stap_id, requirement_sleutel, soort, uitkomst, toelichting, actor)
    values ('44444444-4444-4444-4444-444444444444','44444444-0000-0000-0000-000000000001',
            '44444444-0000-0000-0000-000000000011','9|dissent_review|Dissentronde',
            'mandaatcheck','x','y','44444444-0000-0000-0000-4444444444a0');
    raise exception 'FAALT #2: type-mismatch (dissent-sleutel op mandaatcheck) geaccepteerd.';
  exception when check_violation then null;
  end;
  raise notice 'OK #2: type-mismatch geweigerd.';
end $$;

-- #3 I5: een fonds_id die niet bij de procedure hoort geweigerd.
do $$
begin
  begin
    insert into public.procedure_vaststelling
      (fonds_id, procedure_id, stap_id, requirement_sleutel, soort, uitkomst, toelichting, actor)
    values ('11111111-1111-1111-1111-111111111111','44444444-0000-0000-0000-000000000001',
            '44444444-0000-0000-0000-000000000011','9|mandate_check|Mandaatcheck',
            'mandaatcheck','x','y','44444444-0000-0000-0000-4444444444a0');
    raise exception 'FAALT #3: fondsvreemde vaststelling (I5) geaccepteerd.';
  exception when check_violation then null;
        when foreign_key_violation then null;
  end;
  raise notice 'OK #3: fondsgrens (I5) afgedwongen.';
end $$;

-- #4 cross-procedure: een sleutel die geen vereiste van de procedure is faalt.
do $$
begin
  begin
    insert into public.procedure_vaststelling
      (fonds_id, procedure_id, stap_id, requirement_sleutel, soort, uitkomst, toelichting, actor)
    values ('44444444-4444-4444-4444-444444444444','44444444-0000-0000-0000-000000000001',
            '44444444-0000-0000-0000-000000000011','9|mandate_check|Bestaat niet',
            'mandaatcheck','x','y','44444444-0000-0000-0000-4444444444a0');
    raise exception 'FAALT #4: onbekende vereistesleutel geaccepteerd.';
  exception when check_violation then null;
  end;
  raise notice 'OK #4: onbekende/cross-procedure sleutel geweigerd.';
end $$;

-- #5 I1: onder een besloten besluit is delete én ontkoppelen/herbinden geweigerd.
do $$
begin
  begin
    delete from public.procedure_vaststelling where id='44444444-0000-0000-0000-0000000000f1';
    raise exception 'FAALT #5a: delete van gebonden vaststelling onder besloten besluit toegestaan.';
  exception when check_violation then null;
  end;
  begin
    update public.procedure_vaststelling set requirement_sleutel=null
     where id='44444444-0000-0000-0000-0000000000f1';
    raise exception 'FAALT #5b: ontkoppelen onder besloten besluit toegestaan.';
  exception when check_violation then null;
  end;
  raise notice 'OK #5: I1 weigert delete én ontkoppelen onder een besloten besluit.';
end $$;

rollback;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 3 — TENANT-ISOLATIE onder ÉCHTE RLS (fonds B ziet fonds A niet).   ║
-- ╚════════════════════════════════════════════════════════════════════════╝
begin;

insert into public.fondsen (id, naam, slug)
values ('44444444-aaaa-aaaa-aaaa-444444444444','VS Fonds A','vs-fonds-a'),
       ('44444444-bbbb-bbbb-bbbb-444444444444','VS Fonds B','vs-fonds-b');
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('44444444-aaaa-0000-0000-444444444444','authenticated','authenticated','vs-a@test.local',
   '{"naam":"VS A","fonds_id":"44444444-aaaa-aaaa-aaaa-444444444444"}', now(), now()),
  ('44444444-bbbb-0000-0000-444444444444','authenticated','authenticated','vs-b@test.local',
   '{"naam":"VS B","fonds_id":"44444444-bbbb-bbbb-bbbb-444444444444"}', now(), now());
insert into public.profielen (id, naam, fonds_id, rol)
values ('44444444-aaaa-0000-0000-444444444444','VS A','44444444-aaaa-aaaa-aaaa-444444444444','bestuurder'),
       ('44444444-bbbb-0000-0000-444444444444','VS B','44444444-bbbb-bbbb-bbbb-444444444444','bestuurder')
on conflict (id) do update set fonds_id=excluded.fonds_id, naam=excluded.naam, rol=excluded.rol;

insert into public.procedures (id, fonds_id, template_code, template_versie, titel)
values ('44444444-aaaa-0000-0000-000000000001','44444444-aaaa-aaaa-aaaa-444444444444','vs_test_template','1.0.0','Proc A');
insert into public.procedure_stappen (id, procedure_id, volgorde, naam)
values ('44444444-aaaa-0000-0000-000000000011','44444444-aaaa-0000-0000-000000000001',9,'Stap 9');
insert into public.procedure_requirements
  (template_code, template_versie, stap_volgorde, requirement_type, label, documenttype, veld_pad, verplicht, blokkerend, min_aantal)
values ('vs_test_template', '1.0.0', 9, 'mandate_check', 'Mandaatcheck', null, null, true, true, 1)
on conflict do nothing;
insert into public.procedure_vaststelling
  (id, fonds_id, procedure_id, stap_id, requirement_sleutel, soort, uitkomst, toelichting, actor)
values ('44444444-aaaa-0000-0000-0000000000f1','44444444-aaaa-aaaa-aaaa-444444444444',
        '44444444-aaaa-0000-0000-000000000001','44444444-aaaa-0000-0000-000000000011',
        '9|mandate_check|Mandaatcheck','mandaatcheck','geslaagd','ok','44444444-aaaa-0000-0000-444444444444');

-- Impersoneer gebruiker B (ander fonds).
set local role authenticated;
set local request.jwt.claim.sub to '44444444-bbbb-0000-0000-444444444444';

do $$
declare n int;
begin
  select count(*) into n from public.procedure_vaststelling
   where id='44444444-aaaa-0000-0000-0000000000f1';
  if n <> 0 then
    raise exception 'LEK #9: fonds B ziet de vaststelling van fonds A.';
  end if;
  raise notice 'OK #9: fonds B leest geen vaststelling van fonds A.';
end $$;

do $$
declare n int;
begin
  update public.procedure_vaststelling set uitkomst='gekaapt'
   where id='44444444-aaaa-0000-0000-0000000000f1';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'LEK #10: fonds B wijzigde de vaststelling van fonds A (% rijen).', n;
  end if;
  raise notice 'OK #10: fonds B kan de vaststelling van fonds A niet wijzigen.';
exception when insufficient_privilege then raise notice 'OK #10: update geweigerd (privilege).';
end $$;

do $$
begin
  insert into public.procedure_vaststelling
    (fonds_id, procedure_id, stap_id, requirement_sleutel, soort, uitkomst, toelichting, actor)
  values ('44444444-aaaa-aaaa-aaaa-444444444444','44444444-aaaa-0000-0000-000000000001',
          '44444444-aaaa-0000-0000-000000000011','9|mandate_check|Mandaatcheck',
          'mandaatcheck','ingesloten','x','44444444-bbbb-0000-0000-444444444444');
  raise exception 'LEK #11: fonds B voegde een vaststelling toe in een procedure van fonds A.';
exception
  when insufficient_privilege then
    raise notice 'OK #11: insert van een vaststelling in een vreemd fonds geweigerd (RLS WITH CHECK).';
end $$;

reset role;
rollback;

do $$ begin raise notice 'Vaststelling-binding-gedragstoets afgerond — alle checks groen.'; end $$;
