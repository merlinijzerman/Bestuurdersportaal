-- ============================================================================
-- Gedragstoets 2026-08-12 (T7) — semantische laag + reproduceerbaarheid
-- ----------------------------------------------------------------------------
-- Draai dit ná migratie 2026_08_12_t7_semantische_laag.sql tegen de doeldatabase.
-- Dekt de toetsbare acceptatiecriteria uit de werkopdracht:
--   • RLS-test: fonds B ziet geen semantic_units van fonds A; concepts is voor
--     beide leesbaar.
--   • Waardetypering afgedwongen: een percentage-unit zonder value_num wordt
--     geweigerd (+ denorm-lock op (concept_id, type) + niet-lege evidence).
--   • extraction_run / comparison_run / difference_judgements zijn append-only.
--   • De pijplijn-tabellen hebben geen authenticated-schrijfpad (service-role-only).
--   • difference_judgements: auteur-scoped + private-aware lezen; alleen eigen
--     oordeel binnen eigen fonds schrijven.
--   • Startcatalogus met de juiste status.
--
-- Zelf-seedend (2 fondsen + 3 users via de auth-trigger). Alles in één
-- transactie met ROLLBACK: de database blijft ongewijzigd. psql exit 0 + de
-- "OK #"-notices = groen; elke "LEK:"/"FAALT" → raise exception → non-zero exit.
-- ============================================================================

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 1 — STRUCTUUR (als eigenaar)                                        ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- 1a. Vijf tabellen bestaan mét RLS.
do $$
declare
  t text;
  tabellen text[] := array['concepts','semantic_units','extraction_run',
                           'comparison_run','difference_judgements'];
begin
  foreach t in array tabellen loop
    if not exists (select 1 from pg_class c
                     where c.relnamespace='public'::regnamespace
                       and c.relname=t and c.relkind='r') then
      raise exception 'DEEL 1a FAALT: tabel public.% ontbreekt.', t;
    end if;
    if not (select relrowsecurity from pg_class
              where relnamespace='public'::regnamespace and relname=t) then
      raise exception 'DEEL 1a FAALT: RLS staat uit op public.%.', t;
    end if;
  end loop;
  raise notice 'DEEL 1a OK: 5 tabellen aanwezig met RLS aan.';
end $$;

-- 1b. Zes append-only triggers (2 per append-only tabel).
do $$
declare
  t text;
  ontbreekt text := '';
begin
  foreach t in array array['extraction_run','comparison_run','difference_judgements'] loop
    if not exists (select 1 from pg_trigger
                     where tgrelid = ('public.'||t)::regclass
                       and tgname = 'trg_'||t||'_no_update' and not tgisinternal) then
      ontbreekt := ontbreekt || '  - '||t||' (no_update)'||chr(10);
    end if;
    if not exists (select 1 from pg_trigger
                     where tgrelid = ('public.'||t)::regclass
                       and tgname = 'trg_'||t||'_no_delete' and not tgisinternal) then
      ontbreekt := ontbreekt || '  - '||t||' (no_delete)'||chr(10);
    end if;
  end loop;
  if ontbreekt <> '' then
    raise exception E'DEEL 1b FAALT: ontbrekende append-only triggers:\n%', ontbreekt;
  end if;
  raise notice 'DEEL 1b OK: extraction_run/comparison_run/difference_judgements append-only afgedwongen.';
end $$;

-- 1c. Startcatalogus met de juiste status.
do $$
declare v text;
begin
  select string_agg(key||'='||status, ', ' order by key) into v
    from public.concepts
   where key in ('solidariteitsreserve.bovengrens','franchise','invaarmethodiek','transitiedatum');
  if (select status from public.concepts where key='solidariteitsreserve.bovengrens') <> 'actief'
     or (select status from public.concepts where key='franchise')        <> 'actief'
     or (select status from public.concepts where key='invaarmethodiek')  <> 'conditioneel'
     or (select status from public.concepts where key='transitiedatum')   <> 'uitgesteld' then
    raise exception 'DEEL 1c FAALT: startcatalogus-status onjuist (%).', coalesce(v,'<leeg>');
  end if;
  raise notice 'DEEL 1c OK: startcatalogus met correcte status (%).', v;
end $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 2 — GEDRAG (constraints + RLS + append-only). begin ... rollback.   ║
-- ╚════════════════════════════════════════════════════════════════════════╝
begin;

-- Seed 2 fondsen (RLS omzeild als eigenaar). slug is NOT NULL + UNIQUE.
insert into public.fondsen (id, naam, slug)
values ('11111111-1111-1111-1111-111111111111','T7 Testfonds A','t7-fonds-a'),
       ('22222222-2222-2222-2222-222222222222','T7 Testfonds B','t7-fonds-b');

-- 3 users via de auth-trigger maak_profiel(): A + A2 in fonds A, B in fonds B.
insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','t7-a@test.local',
   '{"naam":"Test A","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2','authenticated','authenticated','t7-a2@test.local',
   '{"naam":"Test A2","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','t7-b@test.local',
   '{"naam":"Test B","fonds_id":"22222222-2222-2222-2222-222222222222"}', now(), now());

-- Documenten + extraction_run per fonds (als eigenaar = het service-role-pad).
insert into public.documenten (id, fonds_id, bibliotheek, bron, titel, context)
values ('d1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','fonds','Intern','transitieplan_v4 (A)','algemeen'),
       ('d2222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222','fonds','Intern','transitieplan_v4 (B)','algemeen');

insert into public.extraction_run (id, fonds_id, document_id, model, prompt_version, extractor_version, catalog_version, status, finished_at)
values ('e1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','d1111111-1111-1111-1111-111111111111','haiku','p1','x1','c1','geslaagd', now()),
       ('e2222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222','d2222222-2222-2222-2222-222222222222','haiku','p1','x1','c1','geslaagd', now());

-- ── Constraint-toetsen (als eigenaar; CHECK/FK vuren rolonafhankelijk) ────────

-- NEGATIEF #1: waardetypering — percentage zonder value_num → check-violation.
do $$
begin
  insert into public.semantic_units
    (fonds_id, document_id, concept_id, type, statement, value_raw, evidence, extraction_run_id)
  values ('11111111-1111-1111-1111-111111111111','d1111111-1111-1111-1111-111111111111',
          (select id from public.concepts where key='solidariteitsreserve.bovengrens'),
          'percentage','De bovengrens bedraagt 6,0%','6,0%',
          'De bovengrens bedraagt 6,0%','e1111111-1111-1111-1111-111111111111');
  raise exception 'LEK #1: percentage-unit zonder value_num TOEGESTAAN — waardetypering-check werkt niet.';
exception
  when check_violation then raise notice 'OK #1: percentage zonder value_num geweigerd (waardetypering).';
  when others then if sqlstate='23514' then raise notice 'OK #1: percentage zonder value_num geweigerd (waardetypering).'; else raise; end if;
end $$;

-- NEGATIEF #2: denorm-lock — concept is percentage, unit-type 'date' → FK-violation.
do $$
begin
  insert into public.semantic_units
    (fonds_id, document_id, concept_id, type, statement, value_raw, value_date, evidence, extraction_run_id)
  values ('11111111-1111-1111-1111-111111111111','d1111111-1111-1111-1111-111111111111',
          (select id from public.concepts where key='solidariteitsreserve.bovengrens'),
          'date','x','2027-01-01', '2027-01-01','bron','e1111111-1111-1111-1111-111111111111');
  raise exception 'LEK #2: type≠concept.type TOEGESTAAN — denorm-lock (composite-FK) werkt niet.';
exception
  when foreign_key_violation then raise notice 'OK #2: type≠concept.type geweigerd (denorm-lock).';
  when others then if sqlstate='23503' then raise notice 'OK #2: type≠concept.type geweigerd (denorm-lock).'; else raise; end if;
end $$;

-- NEGATIEF #3: lege evidence → check-violation.
do $$
begin
  insert into public.semantic_units
    (fonds_id, document_id, concept_id, type, statement, value_raw, value_num, evidence, extraction_run_id)
  values ('11111111-1111-1111-1111-111111111111','d1111111-1111-1111-1111-111111111111',
          (select id from public.concepts where key='solidariteitsreserve.bovengrens'),
          'percentage','x','6,0%',0.06, '   ','e1111111-1111-1111-1111-111111111111');
  raise exception 'LEK #3: lege evidence TOEGESTAAN — evidence-check werkt niet.';
exception
  when check_violation then raise notice 'OK #3: lege evidence geweigerd.';
  when others then if sqlstate='23514' then raise notice 'OK #3: lege evidence geweigerd.'; else raise; end if;
end $$;

-- POSITIEF: het uitgewerkte voorbeeld uit de werkopdracht (fonds A + fonds B).
insert into public.semantic_units
  (id, fonds_id, document_id, concept_id, type, statement, value_raw, value_num, value_unit,
   page, evidence, evidence_verified, document_status, extraction_run_id)
values
  ('11111111-aaaa-aaaa-aaaa-111111111111','11111111-1111-1111-1111-111111111111','d1111111-1111-1111-1111-111111111111',
   (select id from public.concepts where key='solidariteitsreserve.bovengrens'),
   'percentage','De bovengrens bedraagt 6,0%','6,0%',0.06,'%',37,
   'De bovengrens bedraagt 6,0%',true,'van_kracht','e1111111-1111-1111-1111-111111111111'),
  ('22222222-bbbb-bbbb-bbbb-222222222222','22222222-2222-2222-2222-222222222222','d2222222-2222-2222-2222-222222222222',
   (select id from public.concepts where key='solidariteitsreserve.bovengrens'),
   'percentage','De bovengrens bedraagt 5,5%','5,5%',0.055,'%',37,
   'De bovengrens bedraagt 5,5%',true,'van_kracht','e2222222-2222-2222-2222-222222222222');

-- Oordelen (als eigenaar): A2 een privé én een publiek oordeel in fonds A; B een publiek in fonds B.
insert into public.difference_judgements (id, fonds_id, finding_key, user_id, judgement, private)
values
  ('0a000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','f.bovengrens','a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2','twijfel', true),
  ('0a000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','f.bovengrens','a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2','begrepen', false),
  ('0b000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','f.bovengrens','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','begrepen', false);

-- ── Impersoneer user A (fonds A) ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

-- #4 (leesisolatie): A ziet zijn eigen unit, NIET die van fonds B.
do $$
declare n_eigen int; n_b int;
begin
  select count(*) into n_eigen from public.semantic_units where fonds_id='11111111-1111-1111-1111-111111111111';
  select count(*) into n_b     from public.semantic_units where fonds_id='22222222-2222-2222-2222-222222222222';
  if n_eigen < 1 then raise exception 'REGRESSIE: A ziet eigen semantic_units niet (RLS te streng).'; end if;
  if n_b <> 0 then raise exception 'LEK #4: A ziet semantic_units van fonds B (leesisolatie kapot).'; end if;
  raise notice 'OK #4: A ziet eigen units, B-units onzichtbaar (RLS).';
end $$;

-- #5: concepts is voor A leesbaar.
do $$
declare n int;
begin
  select count(*) into n from public.concepts;
  if n < 4 then raise exception 'LEK #5: A ziet de canonieke catalogus niet (concepts read-only-policy kapot).'; end if;
  raise notice 'OK #5: concepts leesbaar voor A (% rijen).', n;
end $$;

-- #6 (private-aware): A ziet A2's PUBLIEKE oordeel, niet A2's PRIVÉ oordeel, niet B's oordeel.
do $$
declare n_pub int; n_priv int; n_b int;
begin
  select count(*) into n_pub  from public.difference_judgements where id='0a000000-0000-0000-0000-0000000000a2';
  select count(*) into n_priv from public.difference_judgements where id='0a000000-0000-0000-0000-0000000000a1';
  select count(*) into n_b    from public.difference_judgements where id='0b000000-0000-0000-0000-0000000000b1';
  if n_pub <> 1 then raise exception 'REGRESSIE: A ziet een publiek oordeel binnen eigen fonds niet.'; end if;
  if n_priv <> 0 then raise exception 'LEK #6a: A ziet het PRIVÉ oordeel van een ander (privacy kapot).'; end if;
  if n_b <> 0 then raise exception 'LEK #6b: A ziet een oordeel van fonds B (tenant-isolatie kapot).'; end if;
  raise notice 'OK #6: private-aware + tenant-isolatie op difference_judgements.';
end $$;

-- #7: A mag zijn EIGEN oordeel schrijven (policy niet over-restrictief).
do $$
begin
  insert into public.difference_judgements (fonds_id, finding_key, user_id, judgement)
  values ('11111111-1111-1111-1111-111111111111','f.franchise','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','oneens');
exception when others then
  raise exception 'REGRESSIE: eigen-oordeel insert geweigerd (sqlstate %). Policy te streng.', sqlstate;
end $$;

-- #8: A mag GEEN oordeel op naam van een ander schrijven.
do $$
begin
  insert into public.difference_judgements (fonds_id, finding_key, user_id, judgement)
  values ('11111111-1111-1111-1111-111111111111','f.x','a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2','risico');
  raise exception 'LEK #8: A schreef een oordeel op naam van A2 — WITH CHECK (user_id) werkt niet.';
exception
  when insufficient_privilege then raise notice 'OK #8: oordeel-insert op andermans naam geweigerd.';
  when others then if sqlstate='42501' then raise notice 'OK #8: oordeel-insert op andermans naam geweigerd.'; else raise; end if;
end $$;

-- #9: A heeft GEEN schrijfpad op de pijplijn-tabellen (service-role-only).
do $$
begin
  insert into public.semantic_units
    (fonds_id, document_id, concept_id, type, statement, value_raw, value_num, evidence, extraction_run_id)
  values ('11111111-1111-1111-1111-111111111111','d1111111-1111-1111-1111-111111111111',
          (select id from public.concepts where key='solidariteitsreserve.bovengrens'),
          'percentage','x','6,0%',0.06,'bron','e1111111-1111-1111-1111-111111111111');
  raise exception 'LEK #9: authenticated schreef in semantic_units — er hoort geen INSERT-grant te zijn.';
exception
  when insufficient_privilege then raise notice 'OK #9: authenticated kan niet in semantic_units schrijven (service-role-only).';
  when others then if sqlstate='42501' then raise notice 'OK #9: authenticated kan niet in semantic_units schrijven (service-role-only).'; else raise; end if;
end $$;

reset role;

-- #10 (append-only): een extraction_run is niet muteerbaar (ook niet als eigenaar).
do $$
begin
  update public.extraction_run set status='mislukt' where id='e1111111-1111-1111-1111-111111111111';
  raise exception 'LEK #10: UPDATE op extraction_run SLAAGDE — append-only-trigger werkt niet.';
exception
  when others then
    if sqlstate='P0001' and sqlerrm like 'LEK:%' then raise; end if;
    raise notice 'OK #10: UPDATE op extraction_run geblokkeerd (append-only).';
end $$;

-- #11 (append-only): een difference_judgement is niet muteerbaar.
do $$
begin
  update public.difference_judgements set promoted_to_dossier=true
   where id='0a000000-0000-0000-0000-0000000000a2';
  raise exception 'LEK #11: UPDATE op difference_judgements SLAAGDE — append-only-trigger werkt niet.';
exception
  when others then
    if sqlstate='P0001' and sqlerrm like 'LEK:%' then raise; end if;
    raise notice 'OK #11: UPDATE op difference_judgements geblokkeerd (append-only).';
end $$;

rollback;

-- ============================================================================
-- Groen als psql exit 0 gaf en je de "OK #1..#11"-notices + de DEEL 1-OK's zag.
-- Elke "LEK:"/"FAALT" doet raise exception → non-zero exit → CI faalt.
-- ============================================================================
