-- ============================================================================
-- Gedragstoets 2026-08-30 — procedure_stap_notitie (P5c, §9.3)
-- ----------------------------------------------------------------------------
-- De aantekening is werkverkeer: zij verandert nooit de status van een stap,
-- maar is wél door de auteur te bewerken en te verwijderen. Deze toets bewaakt
-- daarnaast I5 (fonds/procedure/stap vormen één geheel) en RLS: een andere
-- fondsgebruiker ziet niets, een collega in hetzelfde fonds mag lezen maar
-- nooit de aantekening van de auteur wijzigen of verwijderen.
--
-- Zelf-seedend en volledig rollbackbaar. Draait onder postgres voor structuur
-- en seed, en onder de echte browserrol authenticated voor de RLS-scenario's.
-- ROL: postgres meet de catalogus, I5 en statusneutraliteit als eigenaar;
-- authenticated met request.jwt.claim.sub meet vervolgens de daadwerkelijke
-- browserrechten van auteur, collega en ander fonds. Alleen die tweede meting
-- kan RLS-isolatie en het auteurslot bewijzen.
-- ============================================================================

-- ── DEEL 1 — structuur ────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_class c
     where c.oid = 'public.procedure_stap_notitie'::regclass
       and c.relrowsecurity
  ) then
    raise exception 'DEEL 1 FAALT: RLS staat niet aan op procedure_stap_notitie.';
  end if;

  if (select count(*) from pg_policies
        where schemaname='public' and tablename='procedure_stap_notitie') <> 4 then
    raise exception 'DEEL 1 FAALT: verwacht precies vier aantekeningen-policies.';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid='public.procedure_stap_notitie'::regclass
       and tgname='trg_stap_notitie_validate' and not tgisinternal
  ) then
    raise exception 'DEEL 1 FAALT: I5-validatietrigger ontbreekt.';
  end if;

  if has_function_privilege('authenticated', 'public.fn_validate_stap_notitie()', 'execute')
     or has_function_privilege('anon', 'public.fn_validate_stap_notitie()', 'execute') then
    raise exception 'DEEL 1 FAALT: browserrol kan de I5-triggerfunctie rechtstreeks uitvoeren.';
  end if;

  raise notice 'DEEL 1 OK: RLS, vier policies, I5-trigger en functierechten correct.';
end $$;

-- ── DEEL 2 — kern- en I5-gedrag ───────────────────────────────────────────
begin;

insert into public.fondsen (id, naam, slug)
values ('5c000000-0000-0000-0000-000000000001', 'P5c kernfonds', 'p5c-kernfonds');
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('5c000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated',
        'p5c-kern@test.local', '{"naam":"P5c Auteur"}', now(), now());
insert into public.procedures (id, fonds_id, template_code, template_versie, titel, status)
values
  ('5c000000-0000-0000-0000-000000000011', '5c000000-0000-0000-0000-000000000001', 'p5c-test', '1.0.0', 'P5c procedure', 'lopend'),
  ('5c000000-0000-0000-0000-000000000012', '5c000000-0000-0000-0000-000000000001', 'p5c-test', '1.0.0', 'Andere P5c procedure', 'lopend');
insert into public.procedure_stappen (id, procedure_id, volgorde, naam, status)
values
  ('5c000000-0000-0000-0000-000000000021', '5c000000-0000-0000-0000-000000000011', 1, 'Kernstap', 'actief'),
  ('5c000000-0000-0000-0000-000000000022', '5c000000-0000-0000-0000-000000000012', 1, 'Vreemde stap', 'actief');

-- §4.2: een aantekening is geen voortgangs- of bewijsfeit en activeert dus niets.
do $$
declare v_voor text; v_na text;
begin
  select status into v_voor from public.procedure_stappen
   where id='5c000000-0000-0000-0000-000000000021';
  insert into public.procedure_stap_notitie
    (fonds_id, procedure_id, stap_id, tekst, auteur, auteur_naam)
  values
    ('5c000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-000000000011',
     '5c000000-0000-0000-0000-000000000021', 'Nog navragen bij de actuaris.',
     '5c000000-0000-0000-0000-0000000000a1', 'P5c Auteur');
  select status into v_na from public.procedure_stappen
   where id='5c000000-0000-0000-0000-000000000021';
  if v_na is distinct from v_voor then
    raise exception 'FAALT #1: een aantekening wijzigde de stapstatus van % naar %.', v_voor, v_na;
  end if;
  raise notice 'OK #1: aantekening verandert de stapstatus niet (%).', v_na;
end $$;

-- I5: zowel een vreemd fonds als een stap uit een andere procedure wordt geweigerd.
do $$
begin
  begin
    insert into public.procedure_stap_notitie (fonds_id, procedure_id, stap_id, tekst, auteur, auteur_naam)
    values ('11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-000000000011',
            '5c000000-0000-0000-0000-000000000021', 'x', '5c000000-0000-0000-0000-0000000000a1', 'P5c Auteur');
    raise exception 'FAALT #2a: fondsvreemde aantekening geaccepteerd.';
  exception when check_violation then null; end;
  begin
    insert into public.procedure_stap_notitie (fonds_id, procedure_id, stap_id, tekst, auteur, auteur_naam)
    values ('5c000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-000000000011',
            '5c000000-0000-0000-0000-000000000022', 'x', '5c000000-0000-0000-0000-0000000000a1', 'P5c Auteur');
    raise exception 'FAALT #2b: aantekening met stap uit andere procedure geaccepteerd.';
  exception when check_violation then null; end;
  raise notice 'OK #2: I5 weigert vreemd fonds én vreemde procedurestap.';
end $$;

rollback;

-- ── DEEL 3 — auteursrecht en tenant-isolatie onder echte RLS ───────────────
begin;

insert into public.fondsen (id, naam, slug)
values
  ('5c000000-0000-0000-0000-0000000000a0', 'P5c fonds A', 'p5c-fonds-a'),
  ('5c000000-0000-0000-0000-0000000000b0', 'P5c fonds B', 'p5c-fonds-b');
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('5c000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'p5c-auteur@test.local', '{"naam":"Auteur"}', now(), now()),
  ('5c000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'p5c-collega@test.local', '{"naam":"Collega"}', now(), now()),
  ('5c000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'p5c-anders@test.local', '{"naam":"Ander fonds"}', now(), now());
insert into public.profielen (id, fonds_id, naam, rol)
values
  ('5c000000-0000-0000-0000-0000000000a1', '5c000000-0000-0000-0000-0000000000a0', 'Auteur', 'bestuurder'),
  ('5c000000-0000-0000-0000-0000000000a2', '5c000000-0000-0000-0000-0000000000a0', 'Collega', 'bestuurder'),
  ('5c000000-0000-0000-0000-0000000000b1', '5c000000-0000-0000-0000-0000000000b0', 'Ander fonds', 'bestuurder');
insert into public.procedures (id, fonds_id, template_code, template_versie, titel, status)
values ('5c000000-0000-0000-0000-000000000031', '5c000000-0000-0000-0000-0000000000a0', 'p5c-test', '1.0.0', 'P5c RLS-procedure', 'lopend');
insert into public.procedure_stappen (id, procedure_id, volgorde, naam, status)
values ('5c000000-0000-0000-0000-000000000041', '5c000000-0000-0000-0000-000000000031', 1, 'RLS-stap', 'actief');
insert into public.procedure_stap_notitie (id, fonds_id, procedure_id, stap_id, tekst, auteur, auteur_naam)
values ('5c000000-0000-0000-0000-000000000051', '5c000000-0000-0000-0000-0000000000a0',
        '5c000000-0000-0000-0000-000000000031', '5c000000-0000-0000-0000-000000000041',
        'Notitie van de auteur', '5c000000-0000-0000-0000-0000000000a1', 'Auteur');

set local role authenticated;

-- Een collega mag binnen het fonds lezen, maar heeft geen mutatierecht.
set local request.jwt.claim.sub to '5c000000-0000-0000-0000-0000000000a2';
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.procedure_stap_notitie
   where id='5c000000-0000-0000-0000-000000000051';
  if v_n <> 1 then raise exception 'FAALT #3a: collega in hetzelfde fonds leest de aantekening niet.'; end if;
  update public.procedure_stap_notitie set tekst='Overgenomen'
   where id='5c000000-0000-0000-0000-000000000051';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'LEK #3b: niet-auteur wijzigde aantekening (% rijen).', v_n; end if;
  delete from public.procedure_stap_notitie where id='5c000000-0000-0000-0000-000000000051';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'LEK #3c: niet-auteur verwijderde aantekening (% rijen).', v_n; end if;
  raise notice 'OK #3: collega leest, maar kan niet wijzigen of verwijderen.';
end $$;

-- Een ander fonds ziet en muteert niets.
set local request.jwt.claim.sub to '5c000000-0000-0000-0000-0000000000b1';
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.procedure_stap_notitie
   where id='5c000000-0000-0000-0000-000000000051';
  if v_n <> 0 then raise exception 'LEK #4a: ander fonds ziet de aantekening.'; end if;
  update public.procedure_stap_notitie set tekst='Gekaapt'
   where id='5c000000-0000-0000-0000-000000000051';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'LEK #4b: ander fonds wijzigde de aantekening (% rijen).', v_n; end if;
  delete from public.procedure_stap_notitie where id='5c000000-0000-0000-0000-000000000051';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'LEK #4c: ander fonds verwijderde de aantekening (% rijen).', v_n; end if;
  raise notice 'OK #4: ander fonds leest, wijzigt en verwijdert niets.';
end $$;

-- De auteur zelf mag juist wél bewerken én verwijderen (bewust niet append-only).
set local request.jwt.claim.sub to '5c000000-0000-0000-0000-0000000000a1';
do $$
declare v_n integer;
begin
  update public.procedure_stap_notitie set tekst='Bijgewerkt door de auteur', bewerkt_op=now()
   where id='5c000000-0000-0000-0000-000000000051';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'FAALT #5a: auteur kan eigen aantekening niet bijwerken.'; end if;
  if not exists (select 1 from public.procedure_stap_notitie
                  where id='5c000000-0000-0000-0000-000000000051'
                    and tekst='Bijgewerkt door de auteur' and bewerkt_op is not null) then
    raise exception 'FAALT #5b: bewerking van auteur is niet vastgelegd.';
  end if;
  delete from public.procedure_stap_notitie where id='5c000000-0000-0000-0000-000000000051';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'FAALT #5c: auteur kan eigen aantekening niet verwijderen.'; end if;
  raise notice 'OK #5: auteur kan eigen aantekening bewerken en verwijderen.';
end $$;

reset role;
rollback;

do $$ begin raise notice 'P5c-aantekeningen: structuur, I5, statusneutraliteit en RLS zijn groen.'; end $$;
