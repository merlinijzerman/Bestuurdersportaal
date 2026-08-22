-- ============================================================================
-- Gedragstoets 2026-08-12 (T8) — async semantische extractie: schrijfcontract.
-- ----------------------------------------------------------------------------
-- Draai dit ná migratie 2026_08_12_t8_semantische_extractie.sql tegen de
-- doeldatabase. Dekt de DB-toetsbare acceptatiecriteria; de extractie-KWALITEIT
-- (negatie, normalisatie, ontdubbeling) zit in de pure sanity-tests
-- (core/lib/semantische-concepten.sanity.ts) en de twee interne poorten (echt dossier).
--
-- Getoetst hier:
--   • stap-CHECK accepteert 'semantische_extractie'.
--   • fn_schrijf_semantische_extractie: EXECUTE alleen service_role (gate H).
--   • Catalogus-hints (omschrijving) op de 3 actieve concepten aanwezig; skip-index bestaat.
--   • Atomische schrijf: geslaagde run + units in één keer; her-run VERVANGT de units
--     (semantic_units niet append-only) en APPENDT een run (append-only).
--   • Een 'mislukt'-run laat bestaande units met rust en is puur provenance.
--
-- Zelf-seedend (1 fonds + 1 document). Alles in één transactie met ROLLBACK: de
-- database blijft ongewijzigd. psql exit 0 + de "OK #"-notices = groen; elke
-- "FAALT" → raise exception → non-zero exit.
-- ============================================================================

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 1 — STRUCTUUR                                                       ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- 1a. stap-CHECK accepteert de nieuwe waarde.
-- ----------------------------------------------------------------------------
-- ROL: postgres — DEEL 1 vraagt met has_function_privilege(<rol>, ...) NAAR de
--      rechten van anon/authenticated/service_role (gate H) en meet dus OVER
--      die rollen; DEEL 2 schrijft via de service-role-functie. Geen rolwissel
--      nodig, en een beperkte rol zou de catalogus niet compleet zien.
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def
    from pg_constraint
   where conrelid = 'public.document_processing_jobs'::regclass and contype='c'
     and pg_get_constraintdef(oid) ilike '%stap%validatie%';
  if def is null or def not ilike '%semantische_extractie%' then
    raise exception 'DEEL 1a FAALT: stap-CHECK bevat ''semantische_extractie'' niet (%).', coalesce(def,'<geen>');
  end if;
  raise notice 'DEEL 1a OK: stap-CHECK accepteert semantische_extractie.';
end $$;

-- 1b. Functie-grants (gate H): anon/authenticated GEEN execute, service_role WEL.
do $$
declare sig text := 'public.fn_schrijf_semantische_extractie(uuid,uuid,text,text,text,text,text,jsonb)';
begin
  if has_function_privilege('anon', sig, 'EXECUTE') then
    raise exception 'DEEL 1b FAALT: anon kan fn_schrijf_semantische_extractie aanroepen (gate H).';
  end if;
  if has_function_privilege('authenticated', sig, 'EXECUTE') then
    raise exception 'DEEL 1b FAALT: authenticated kan fn_schrijf_semantische_extractie aanroepen (gate H).';
  end if;
  if not has_function_privilege('service_role', sig, 'EXECUTE') then
    raise exception 'DEEL 1b FAALT: service_role kan de schrijffunctie NIET aanroepen.';
  end if;
  raise notice 'DEEL 1b OK: EXECUTE alleen voor service_role.';
end $$;

-- 1c. Catalogus-hints + skip-index.
-- Eigen begin/rollback: deze toets heeft de catalogus nodig, en de seed mag
-- niets achterlaten. DEEL 1 draaide tot nu toe zonder transactie.
begin;

-- ── CATALOGUS-SEED (#84) ────────────────────────────────────────────────────
-- De concepts-catalogus wordt door MIGRATIES gevuld:
--   2026_08_12_t7_semantische_laag.sql       de vier basisrijen
--   2026_08_12_t8_semantische_extractie.sql  de normalization-hints
-- Beide zijn PRE-CUTOFF en dus gesquasht in de schema-only baseline
-- (besluit 0046), die data-INSERTs strípt. In de ephemere test-DB en in CI is
-- `concepts` daardoor LEEG — niet omdat er iets stuk is, maar omdat referentie-
-- data per constructie niet in een schema-dump zit.
--
-- De keten kan dit niet oplossen: scripts/testdb-apply-migrations.sh past
-- helemaal GEEN seeds toe (supabase/seeds/* wordt alleen in een foutmelding
-- genoemd). Daarom zaait deze suite zelf wat zij nodig heeft, binnen haar eigen
-- transactie, en laat niets achter.
--
-- LET OP: dit is een KOPIE. Wijzigt de catalogus in een migratie en niet hier,
-- dan toetst deze suite een catalogus die nergens meer bestaat. De assertie
-- direct hieronder maakt dat zichtbaar in plaats van stil.
insert into public.concepts (key, label, type, status) values
  ('solidariteitsreserve.bovengrens', 'Bovengrens solidariteitsreserve', 'percentage',    'actief'),
  ('franchise',                       'Franchise',                       'amount',        'actief'),
  ('invaarmethodiek',                 'Invaarmethodiek',                 'policy_choice', 'conditioneel'),
  ('transitiedatum',                  'Transitiedatum',                  'date',          'uitgesteld')
on conflict (key) do nothing;

update public.concepts set normalization = jsonb_build_object(
  'omschrijving', 'Percentage van het collectieve vermogen dat maximaal in de solidariteitsreserve mag zitten.',
  'eenheid', 'procent') where key = 'solidariteitsreserve.bovengrens';
update public.concepts set normalization = jsonb_build_object(
  'omschrijving', 'Bedrag dat op het pensioengevend salaris in mindering wordt gebracht.',
  'eenheid', 'euro') where key = 'franchise';
update public.concepts set normalization = jsonb_build_object(
  'omschrijving', 'De gekozen methodiek voor het invaren van bestaande aanspraken.',
  'eenheid', 'keuze') where key = 'invaarmethodiek';

do $$
declare n int;
begin
  select count(*) into n from public.concepts
   where key in ('solidariteitsreserve.bovengrens','franchise','invaarmethodiek')
     and normalization->>'omschrijving' is not null;
  if n <> 3 then
    raise exception
      'SEED-DRIFT (#84): de catalogus-seed in deze suite levert % van 3 hints. '
      'Waarschijnlijk is de catalogus in een migratie gewijzigd zonder deze '
      'kopie bij te werken.', n;
  end if;
end $$;
-- ── einde catalogus-seed ────────────────────────────────────────────────────

do $$
declare n int;
begin
  select count(*) into n from public.concepts
   where key in ('solidariteitsreserve.bovengrens','franchise','invaarmethodiek')
     and normalization->>'omschrijving' is not null;
  if n <> 3 then raise exception 'DEEL 1c FAALT: omschrijving-hints ontbreken (% van 3).', n; end if;
  if not exists (select 1 from pg_indexes
                   where schemaname='public' and indexname='idx_extraction_run_doc_catalog') then
    raise exception 'DEEL 1c FAALT: skip-index idx_extraction_run_doc_catalog ontbreekt.';
  end if;
  raise notice 'DEEL 1c OK: catalogus-hints (3) + skip-index aanwezig.';
end $$;

rollback;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 2 — SCHRIJFGEDRAG. begin ... rollback.                             ║
-- ╚════════════════════════════════════════════════════════════════════════╝
begin;

-- ── CATALOGUS-SEED (#84) ────────────────────────────────────────────────────
-- De concepts-catalogus wordt door MIGRATIES gevuld:
--   2026_08_12_t7_semantische_laag.sql       de vier basisrijen
--   2026_08_12_t8_semantische_extractie.sql  de normalization-hints
-- Beide zijn PRE-CUTOFF en dus gesquasht in de schema-only baseline
-- (besluit 0046), die data-INSERTs strípt. In de ephemere test-DB en in CI is
-- `concepts` daardoor LEEG — niet omdat er iets stuk is, maar omdat referentie-
-- data per constructie niet in een schema-dump zit.
--
-- De keten kan dit niet oplossen: scripts/testdb-apply-migrations.sh past
-- helemaal GEEN seeds toe (supabase/seeds/* wordt alleen in een foutmelding
-- genoemd). Daarom zaait deze suite zelf wat zij nodig heeft, binnen haar eigen
-- transactie, en laat niets achter.
--
-- LET OP: dit is een KOPIE. Wijzigt de catalogus in een migratie en niet hier,
-- dan toetst deze suite een catalogus die nergens meer bestaat. De assertie
-- direct hieronder maakt dat zichtbaar in plaats van stil.
insert into public.concepts (key, label, type, status) values
  ('solidariteitsreserve.bovengrens', 'Bovengrens solidariteitsreserve', 'percentage',    'actief'),
  ('franchise',                       'Franchise',                       'amount',        'actief'),
  ('invaarmethodiek',                 'Invaarmethodiek',                 'policy_choice', 'conditioneel'),
  ('transitiedatum',                  'Transitiedatum',                  'date',          'uitgesteld')
on conflict (key) do nothing;

update public.concepts set normalization = jsonb_build_object(
  'omschrijving', 'Percentage van het collectieve vermogen dat maximaal in de solidariteitsreserve mag zitten.',
  'eenheid', 'procent') where key = 'solidariteitsreserve.bovengrens';
update public.concepts set normalization = jsonb_build_object(
  'omschrijving', 'Bedrag dat op het pensioengevend salaris in mindering wordt gebracht.',
  'eenheid', 'euro') where key = 'franchise';
update public.concepts set normalization = jsonb_build_object(
  'omschrijving', 'De gekozen methodiek voor het invaren van bestaande aanspraken.',
  'eenheid', 'keuze') where key = 'invaarmethodiek';

do $$
declare n int;
begin
  select count(*) into n from public.concepts
   where key in ('solidariteitsreserve.bovengrens','franchise','invaarmethodiek')
     and normalization->>'omschrijving' is not null;
  if n <> 3 then
    raise exception
      'SEED-DRIFT (#84): de catalogus-seed in deze suite levert % van 3 hints. '
      'Waarschijnlijk is de catalogus in een migratie gewijzigd zonder deze '
      'kopie bij te werken.', n;
  end if;
end $$;
-- ── einde catalogus-seed ────────────────────────────────────────────────────


insert into public.fondsen (id, naam, slug)
values ('33333333-3333-3333-3333-333333333333','T8 Testfonds','t8-fonds');

insert into public.documenten (id, fonds_id, bibliotheek, bron, titel, context)
values ('d3333333-3333-3333-3333-333333333333','33333333-3333-3333-3333-333333333333',
        'fonds','Intern','implementatieplan_v2 (T8)','algemeen');

-- Eén bovengrens-unit (6,0%) wegschrijven via de functie.
do $$
declare v_boven uuid := (select id from public.concepts where key='solidariteitsreserve.bovengrens');
declare v_run uuid;
begin
  v_run := public.fn_schrijf_semantische_extractie(
    '33333333-3333-3333-3333-333333333333','d3333333-3333-3333-3333-333333333333',
    'haiku','t8-extract-v1','t8-v1','cat-test','geslaagd',
    jsonb_build_array(jsonb_build_object(
      'concept_id', v_boven, 'type','percentage',
      'statement','De bovengrens bedraagt 6,0%','value_raw','6,0%',
      'value_num', 0.06, 'value_unit','%', 'page', 37,
      'evidence','De bovengrens bedraagt 6,0%','evidence_verified', true,
      'confidence_signals', jsonb_build_object('evidence_literal', true),
      'document_status','van_kracht'))
  );
  if v_run is null then raise exception 'DEEL 2 FAALT: functie gaf geen run-id terug.'; end if;
end $$;

do $$
declare n_u int; n_r int; v numeric;
begin
  select count(*) into n_u from public.semantic_units where document_id='d3333333-3333-3333-3333-333333333333';
  select count(*) into n_r from public.extraction_run where document_id='d3333333-3333-3333-3333-333333333333';
  select value_num into v from public.semantic_units where document_id='d3333333-3333-3333-3333-333333333333';
  if n_u <> 1 or n_r <> 1 or v <> 0.06 then
    raise exception 'OK #1 FAALT: verwacht 1 unit (6%%) + 1 run, kreeg % unit(s)/% run(s)/waarde %.', n_u, n_r, v;
  end if;
  raise notice 'OK #1: geslaagde run schreef 1 unit (6,0%%) + 1 run atomisch.';
end $$;

-- Her-run met een ANDERE waarde (5,5%): units worden VERVANGEN, run APPENDED.
do $$
declare v_boven uuid := (select id from public.concepts where key='solidariteitsreserve.bovengrens');
begin
  perform public.fn_schrijf_semantische_extractie(
    '33333333-3333-3333-3333-333333333333','d3333333-3333-3333-3333-333333333333',
    'haiku','t8-extract-v1','t8-v1','cat-test-2','geslaagd',
    jsonb_build_array(jsonb_build_object(
      'concept_id', v_boven, 'type','percentage',
      'statement','De bovengrens bedraagt 5,5%','value_raw','5,5%',
      'value_num', 0.055, 'value_unit','%', 'page', 37,
      'evidence','De bovengrens bedraagt 5,5%','evidence_verified', true,
      'confidence_signals','{}'::jsonb,'document_status','van_kracht'))
  );
end $$;

do $$
declare n_u int; n_r int; v numeric;
begin
  select count(*) into n_u from public.semantic_units where document_id='d3333333-3333-3333-3333-333333333333';
  select count(*) into n_r from public.extraction_run where document_id='d3333333-3333-3333-3333-333333333333';
  select value_num into v from public.semantic_units where document_id='d3333333-3333-3333-3333-333333333333';
  if n_u <> 1 or v <> 0.055 then
    raise exception 'OK #2 FAALT: units niet vervangen (% unit(s), waarde %).', n_u, v;
  end if;
  if n_r <> 2 then raise exception 'OK #2 FAALT: run niet ge-append (% runs).', n_r; end if;
  raise notice 'OK #2: her-run verving de units (5,5%%) en appendde de run (2 runs).';
end $$;

-- Een 'mislukt'-run laat de units met rust en appendt alleen provenance.
do $$
begin
  perform public.fn_schrijf_semantische_extractie(
    '33333333-3333-3333-3333-333333333333','d3333333-3333-3333-3333-333333333333',
    'haiku','t8-extract-v1','t8-v1','cat-test-3','mislukt', '[]'::jsonb);
end $$;

do $$
declare n_u int; n_r int; v numeric;
begin
  select count(*) into n_u from public.semantic_units where document_id='d3333333-3333-3333-3333-333333333333';
  select count(*) into n_r from public.extraction_run where document_id='d3333333-3333-3333-3333-333333333333';
  select value_num into v from public.semantic_units where document_id='d3333333-3333-3333-3333-333333333333';
  if n_u <> 1 or v <> 0.055 then
    raise exception 'OK #3 FAALT: mislukte run raakte de units aan (% unit(s), waarde %).', n_u, v;
  end if;
  if n_r <> 3 then raise exception 'OK #3 FAALT: mislukte run niet als provenance ge-append (% runs).', n_r; end if;
  raise notice 'OK #3: mislukte run liet units met rust en appendde provenance (3 runs).';
end $$;

-- Append-only borging blijft: een run muteren is geblokkeerd (T7-trigger).
do $$
begin
  update public.extraction_run set status='mislukt'
   where document_id='d3333333-3333-3333-3333-333333333333';
  raise exception 'OK #4 FAALT: UPDATE op extraction_run SLAAGDE — append-only kapot.';
exception
  when others then
    if sqlstate='P0001' and sqlerrm like '%FAALT%' then raise; end if;
    raise notice 'OK #4: extraction_run blijft append-only (UPDATE geblokkeerd).';
end $$;

rollback;

-- ============================================================================
-- Groen als psql exit 0 gaf en je de DEEL 1-OK's + "OK #1..#4"-notices zag.
-- Elke "FAALT" doet raise exception → non-zero exit → CI faalt.
-- ============================================================================
