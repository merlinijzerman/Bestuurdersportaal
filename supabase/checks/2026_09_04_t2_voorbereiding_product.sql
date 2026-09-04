-- ============================================================================
-- Gedragstoets 2026-09-04 — voorbereidingen als bewaard product (T2, #304)
-- ----------------------------------------------------------------------------
-- Met dit ticket schrijft `/api/chat` voor het eerst naar een DOMEINtabel:
-- tot nu toe raakte die route alleen `governance_log` en `gesprekken`. Drie
-- dingen moeten daarom aantoonbaar zijn en niet aangenomen:
--
--   #1 De RLS-policy "eigen voorbereiding" staat insert én update door de
--      bestuurder zélf toe. De migratie schrijft `for all`, maar een migratie
--      bewijst niets over een draaiende database (CLAUDE.md): we meten hier het
--      resultaat, met de echte browserrol.
--   #2 De unique-constraint (agendapunt_id, gebruiker_id) doet het
--      overschrijven. "Opnieuw opstellen" mag geen tweede rij opleveren; er
--      ontstaan bewust geen versies (de vorige uitvoer staat in het gesprek).
--   #3 DE UPSERT WIST DE AANTEKENINGEN NIET. De notities-route deelt deze rij
--      en schrijft `eigen_notities` / `vrije_notities`. Een schrijfpad dat die
--      kolommen niet meestuurt hoort ze te laten staan — dat is het gedrag
--      waarop de chat-route steunt, dus het hoort hier gemeten en niet
--      verondersteld. Zou het misgaan, dan verliest een bestuurder zijn eigen
--      aantekeningen doordat hij zijn voorbereiding opnieuw laat opstellen: een
--      stil verlies van eigen werk, precies wat niemand ontdekt.
--
-- Zelf-seedend en volledig rollbackbaar.
-- ROL: postgres meet in DEEL 1 de catalogus (RLS-vlag, unique-constraint,
-- kolommen, policy-vorm) — dat zijn eigenaarsvragen die een browserrol niet kan
-- stellen. DEEL 2 en DEEL 3 draaien onder de echte browserrol `authenticated`
-- met `request.jwt.claim.sub`, want alleen die meting bewijst wat een bestuurder
-- in productie werkelijk mag: zijn eigen product schrijven en overschrijven, en
-- niets van een ander zien of op andermans naam wegschrijven. Een meting als
-- postgres zou hier alles laten slagen en dus niets bewijzen.
-- ============================================================================

-- ── DEEL 1 — structuur ────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_class c
     where c.oid = 'public.voorbereidingen'::regclass and c.relrowsecurity
  ) then
    raise exception 'DEEL 1 FAALT: RLS staat niet aan op voorbereidingen.';
  end if;

  -- De unique-constraint is het mechanisme achter "opnieuw opstellen
  -- overschrijft". Verdwijnt hij, dan levert elke herhaling een tweede rij op en
  -- toont de kaart willekeurig één ervan.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.voorbereidingen'::regclass
       and contype = 'u'
       and conkey @> array[
             (select attnum from pg_attribute
               where attrelid='public.voorbereidingen'::regclass and attname='agendapunt_id'),
             (select attnum from pg_attribute
               where attrelid='public.voorbereidingen'::regclass and attname='gebruiker_id')
           ]::smallint[]
  ) then
    raise exception 'DEEL 1 FAALT: unique(agendapunt_id, gebruiker_id) ontbreekt.';
  end if;

  -- De twee kolommen die dit ticket in gebruik neemt.
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='voorbereidingen'
       and column_name in ('ai_output','bronnen_meta')
    having count(*) = 2
  ) then
    raise exception 'DEEL 1 FAALT: ai_output en/of bronnen_meta ontbreekt.';
  end if;

  -- #1, structurele helft: de policy dekt schrijven, niet alleen lezen.
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='voorbereidingen'
       and cmd = 'ALL'
       and with_check is not null
  ) then
    raise exception
      'DEEL 1 FAALT: geen ALL-policy MET with_check op voorbereidingen — dan kan de bestuurder zijn eigen product niet wegschrijven.';
  end if;

  raise notice 'DEEL 1 OK: RLS aan, unique-constraint aanwezig, kolommen aanwezig, schrijf-policy met WITH CHECK.';
end $$;

-- ── DEEL 2 — de bestuurder schrijft zijn eigen product, en overschrijft het ──
begin;

insert into public.fondsen (id, naam, slug)
values ('72000000-0000-0000-0000-000000000001', 'T2 fonds A', 't2-fonds-a');
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('72000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated',
        't2-bestuurder@test.local', '{"naam":"T2 Bestuurder"}', now(), now());
insert into public.profielen (id, fonds_id, naam, rol)
values ('72000000-0000-0000-0000-0000000000a1', '72000000-0000-0000-0000-000000000001',
        'T2 Bestuurder', 'bestuurder');
insert into public.vergaderingen (id, fonds_id, titel, datum)
values ('72000000-0000-0000-0000-000000000011', '72000000-0000-0000-0000-000000000001',
        'T2 bestuursvergadering', current_date);
insert into public.agendapunten (id, vergadering_id, volgorde, titel)
values ('72000000-0000-0000-0000-000000000021', '72000000-0000-0000-0000-000000000011',
        1, 'Vaststellen jaarverslag');

set local role authenticated;
set local request.jwt.claim.sub to '72000000-0000-0000-0000-0000000000a1';

-- #1: de bestuurder kan zijn eigen voorbereiding INSERTEN.
do $$
begin
  insert into public.voorbereidingen (agendapunt_id, gebruiker_id, ai_output, bronnen_meta)
  values ('72000000-0000-0000-0000-000000000021', '72000000-0000-0000-0000-0000000000a1',
          '{"tekst":"eerste versie"}'::jsonb, '{"aantal":2}'::jsonb);
  raise notice 'OK #1a: bestuurder kan zijn eigen voorbereiding wegschrijven.';
exception when insufficient_privilege then
  raise exception
    'FAALT #1a: RLS blokkeert de INSERT van de eigen voorbereiding — het schrijfpad van de chat-route werkt dan niet in productie.';
end $$;

-- #2: opnieuw opstellen OVERSCHRIJFT; er komt geen tweede rij bij.
do $$
declare v_n integer; v_tekst text;
begin
  insert into public.voorbereidingen (agendapunt_id, gebruiker_id, ai_output, bronnen_meta)
  values ('72000000-0000-0000-0000-000000000021', '72000000-0000-0000-0000-0000000000a1',
          '{"tekst":"tweede versie"}'::jsonb, '{"aantal":5}'::jsonb)
  on conflict (agendapunt_id, gebruiker_id) do update
     set ai_output = excluded.ai_output,
         bronnen_meta = excluded.bronnen_meta;

  select count(*) into v_n from public.voorbereidingen
   where agendapunt_id='72000000-0000-0000-0000-000000000021';
  if v_n <> 1 then
    raise exception 'FAALT #2a: % rijen na opnieuw opstellen; verwacht precies 1.', v_n;
  end if;

  select ai_output->>'tekst' into v_tekst from public.voorbereidingen
   where agendapunt_id='72000000-0000-0000-0000-000000000021';
  if v_tekst <> 'tweede versie' then
    raise exception 'FAALT #2b: de nieuwe uitvoer overschreef de oude niet (%).', v_tekst;
  end if;
  raise notice 'OK #2: opnieuw opstellen overschrijft, zonder tweede rij.';
end $$;

-- #3: DE KERNTOETS. Een aantekening van de notities-route overleeft een upsert
-- die alleen de AI-kolommen meestuurt.
do $$
declare v_eigen jsonb; v_vrij text; v_tekst text;
begin
  update public.voorbereidingen
     set eigen_notities = '{"lens":"Vragen naar de termijn."}'::jsonb,
         vrije_notities = 'Vorig kwartaal ook toegezegd.'
   where agendapunt_id='72000000-0000-0000-0000-000000000021';

  -- Exact de kolommen die het chat-schrijfpad meestuurt — niet meer.
  insert into public.voorbereidingen
    (agendapunt_id, gebruiker_id, ai_output, bronnen_meta, gegenereerd_op, bijgewerkt_op)
  values ('72000000-0000-0000-0000-000000000021', '72000000-0000-0000-0000-0000000000a1',
          '{"tekst":"derde versie"}'::jsonb, '{"aantal":7}'::jsonb, now(), now())
  on conflict (agendapunt_id, gebruiker_id) do update
     set ai_output = excluded.ai_output,
         bronnen_meta = excluded.bronnen_meta,
         gegenereerd_op = excluded.gegenereerd_op,
         bijgewerkt_op = excluded.bijgewerkt_op;

  select eigen_notities, vrije_notities, ai_output->>'tekst'
    into v_eigen, v_vrij, v_tekst
    from public.voorbereidingen
   where agendapunt_id='72000000-0000-0000-0000-000000000021';

  if v_eigen->>'lens' is distinct from 'Vragen naar de termijn.' then
    raise exception
      'FAALT #3a: opnieuw opstellen wiste eigen_notities — een bestuurder verliest zijn eigen aantekening zonder het te merken.';
  end if;
  if v_vrij is distinct from 'Vorig kwartaal ook toegezegd.' then
    raise exception 'FAALT #3b: opnieuw opstellen wiste vrije_notities.';
  end if;
  if v_tekst <> 'derde versie' then
    raise exception 'FAALT #3c: de AI-uitvoer is niet bijgewerkt (%).', v_tekst;
  end if;
  raise notice 'OK #3: de upsert vernieuwt de AI-kolommen en laat de aantekeningen staan.';
end $$;

rollback;

-- ── DEEL 3 — de voorbereiding is en blijft privé ──────────────────────────
begin;

insert into public.fondsen (id, naam, slug)
values
  ('72000000-0000-0000-0000-0000000000a0', 'T2 fonds A', 't2-fonds-a2'),
  ('72000000-0000-0000-0000-0000000000b0', 'T2 fonds B', 't2-fonds-b2');
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('72000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 't2-eigenaar@test.local', '{"naam":"Eigenaar"}', now(), now()),
  ('72000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 't2-collega@test.local', '{"naam":"Collega"}', now(), now()),
  ('72000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 't2-anders@test.local', '{"naam":"Ander fonds"}', now(), now());
insert into public.profielen (id, fonds_id, naam, rol)
values
  ('72000000-0000-0000-0000-0000000000a1', '72000000-0000-0000-0000-0000000000a0', 'Eigenaar', 'bestuurder'),
  ('72000000-0000-0000-0000-0000000000a2', '72000000-0000-0000-0000-0000000000a0', 'Collega', 'voorzitter'),
  ('72000000-0000-0000-0000-0000000000b1', '72000000-0000-0000-0000-0000000000b0', 'Ander fonds', 'bestuurder');
insert into public.vergaderingen (id, fonds_id, titel, datum)
values ('72000000-0000-0000-0000-000000000031', '72000000-0000-0000-0000-0000000000a0', 'T2 RLS-vergadering', current_date);
insert into public.agendapunten (id, vergadering_id, volgorde, titel)
values ('72000000-0000-0000-0000-000000000041', '72000000-0000-0000-0000-000000000031', 1, 'RLS-agendapunt');
insert into public.voorbereidingen (id, agendapunt_id, gebruiker_id, ai_output, bronnen_meta)
values ('72000000-0000-0000-0000-000000000051', '72000000-0000-0000-0000-000000000041',
        '72000000-0000-0000-0000-0000000000a1',
        '{"tekst":"Prive voorbereiding van de eigenaar"}'::jsonb, '{"aantal":1}'::jsonb);

set local role authenticated;

-- Een COLLEGA in hetzelfde fonds ziet de voorbereiding niet. Ook een voorzitter
-- niet: dit is persoonlijk werk, geen bestuursstuk (besluit 0017, FR-5/G10).
set local request.jwt.claim.sub to '72000000-0000-0000-0000-0000000000a2';
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.voorbereidingen
   where agendapunt_id='72000000-0000-0000-0000-000000000041';
  if v_n <> 0 then
    raise exception 'LEK #4: een collega (voorzitter) ziet % voorbereiding(en) van een ander.', v_n;
  end if;
  raise notice 'OK #4: de voorbereiding is privé binnen het eigen fonds.';
end $$;

-- Een gebruiker van een ANDER fonds ziet niets en kan niets injecteren.
set local request.jwt.claim.sub to '72000000-0000-0000-0000-0000000000b1';
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.voorbereidingen
   where agendapunt_id='72000000-0000-0000-0000-000000000041';
  if v_n <> 0 then
    raise exception 'LEK #5a: cross-tenant lees op voorbereidingen (% rijen).', v_n;
  end if;

  -- Een voorbereiding op naam van een ander schrijven moet stuklopen op de
  -- WITH CHECK; zonder die grendel kon iemand tekst in andermans kaart zetten.
  begin
    insert into public.voorbereidingen (agendapunt_id, gebruiker_id, ai_output)
    values ('72000000-0000-0000-0000-000000000041', '72000000-0000-0000-0000-0000000000a1',
            '{"tekst":"geinjecteerd"}'::jsonb);
    raise exception 'LEK #5b: voorbereiding op naam van een andere gebruiker geaccepteerd.';
  exception when insufficient_privilege then null; end;

  raise notice 'OK #5: geen cross-tenant lees en geen injectie op andermans naam.';
end $$;

rollback;

do $$ begin raise notice 'T2 voorbereiding-product: alle onderdelen groen.'; end $$;
