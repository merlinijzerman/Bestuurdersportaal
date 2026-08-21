-- ============================================================================
--  Check 2026-08-05 (T1 plateau A) — ROLGRENZEN van de tenant-rol
--  `bestuursbureau`, onder échte RLS.
-- ----------------------------------------------------------------------------
--  WAAROM DEZE SUITE APART BESTAAT. De cross-tenant-suite (2026_07_08_t3, R1)
--  toetst TENANTgrenzen: fonds A tegen fonds B. Deze toetst een ROLgrens BINNEN
--  één fonds. RLS isoleert in dit schema op `fonds_id` en niet op rol, dus een
--  nieuwe rol ziet by default álles wat fondsbreed leesbaar is en mag by default
--  álles schrijven wat een fondslid mag. De afscherming uit migratie
--  2026_08_05_bestuursbureau_rol.sql is een ACTIEVE predicaat-uitbreiding —
--  zonder deze suite is ze een aanname en geen aantoonbaarheid (ontwerp §5.4).
--
--  DEKT: FR-1 (rol bestaat en is bevroren), FR-3 (0 rijen inbreng), FR-4
--  (0 rijen stemgedrag, uitslag wél leesbaar), FR-5 (privé-voorbereidingen),
--  FR-7 (niet stemmen/inbrengen/dissent) en G23 (nulgrens: de drie bestaande
--  rollen gedragen zich exact als vóór de migratie).
--
--  PATROON — gelijk aan 2026_08_04_a_rollen_capabilities.sql:
--    • DEEL 1 structureel, zonder seed.
--    • DEEL 2 in één `begin … rollback` — er blijft niets achter, ook niet bij
--      een fout.
--    • Een VERBODEN statement dat SLAAGT raise't 'LEK (…): …'. De exception-
--      handler vangt UITSLUITEND de sqlstate die de weigering hoort te geven
--      (42501 insufficient_privilege, of 23514 check_violation bij de CHECK-test).
--      Er is BEWUST geen `when others`-tak die een OK meldt: die zou zowel de
--      eigen LEK-exception als een schemafout (kolomhernoeming, NOT NULL-drift,
--      typefout in de seed) als "geslaagd" rapporteren. Alles wat niet de
--      verwachte weigering is, propageert en maakt de suite rood.
--    • Elke afscherming heeft een POSITIEVE TEGENHANGER met een bestuurder in
--      hetzelfde fonds. Zonder die tegenhanger zou een suite die alles blokkeert
--      ook groen zijn — en dan bewijst hij niets.
--
--  BEWIJS DAT EEN LEK ROOD WORDT: verwijder één `is distinct from
--  'bestuursbureau'` uit de migratie → de bijbehorende select levert rijen of de
--  insert slaagt → `raise exception 'LEK (…): …'` → non-zero exit → rode CI.
--
--  Uitvoeren — twee wegen:
--    • psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/checks/2026_08_05_bb_rolgrenzen.sql
--    • of plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--  Bewust GEEN `\set`/`\echo`: dat zijn psql-metacommando's die de SQL-editor
--  niet kent. Elke controle is een `do $$`-blok dat een exception raise't; zowel
--  psql als de editor breken de batch daarop af.
--
--  LET OP: deze suite seedt in `auth.users` en hoort dus op een TESTdatabase,
--  niet op productie. Alles staat binnen begin…rollback, maar het uitgangspunt
--  "geen schrijfacties op productie" gaat vóór.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
--  DEEL 1 — STRUCTUREEL (geen seed nodig)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. De CHECK kent de vierde rol ────────────────────────────────────────
-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw en afbraak, authenticated per scenario — de meting
--      gebeurt onder RLS, niet onder BYPASSRLS.
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

do $$
declare n int;
begin
  select count(*) into n
    from pg_constraint con
    join pg_class     rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public' and rel.relname = 'profielen' and con.contype = 'c'
     and pg_get_constraintdef(con.oid) like '%bestuursbureau%';
  if n <> 1 then
    raise exception
      'FAALT (FR-1): profielen.rol-CHECK kent de waarde bestuursbureau niet. '
      'Draai eerst 2026_08_05_bestuursbureau_rol.sql.';
  end if;
  raise notice 'OK 1: profielen.rol-CHECK kent bestuursbureau.';
end $$;

-- ── 2. Elf policies dragen de rol-uitsluiting ─────────────────────────────
-- Toetst de DRAAIENDE database, niet de migratiebestanden. Dat onderscheid is de
-- blijvende les van de review van 31-07-2026: drie objecten stonden in productie
-- zonder in enige migratie voor te komen.
do $$
declare
  verwacht text[][] := array[
    ['agendapunt_inbreng',  'fonds inbreng lezen'],
    ['agendapunt_inbreng',  'eigen inbreng schrijven'],
    ['agendapunt_inbreng',  'eigen inbreng wijzigen'],
    ['agendapunt_inbreng',  'eigen inbreng verwijderen'],
    ['stem_uitbrengingen',  'fonds stem select'],
    ['stem_uitbrengingen',  'fonds stem insert'],
    ['stem_uitbrengingen',  'fonds stem update'],
    ['stem_uitbrengingen',  'fonds stem delete'],
    ['stemmingen',          'fonds stemmingen insert'],
    ['stemmingen',          'fonds stemmingen update'],
    ['decision_dissent',    'dissent zichtbaarheid write']
  ];
  i int;
  fouten text := '';
  n int;
begin
  for i in 1 .. array_length(verwacht, 1) loop
    select count(*) into n
      from pg_policies
     where schemaname = 'public'
       and tablename  = verwacht[i][1]
       and policyname = verwacht[i][2]
       and coalesce(qual, '') || coalesce(with_check, '') like '%bestuursbureau%';
    if n <> 1 then
      fouten := fouten || format('  - %s / "%s" mist de rol-uitsluiting%s',
                                 verwacht[i][1], verwacht[i][2], chr(10));
    end if;
  end loop;
  if fouten <> '' then
    raise exception E'FAALT: niet alle elf policies schermen de bureau-rol af:\n%', fouten;
  end if;
  raise notice 'OK 2: elf policies dragen de bestuursbureau-uitsluiting.';
end $$;

-- ── 3. De uitslag blijft leesbaar; de dissent-LEESpolicy is ongemoeid ─────
-- Het onderscheid uit ontwerp §5.4: de RONDE en de UITSLAG (public.stemmingen)
-- zijn bestuurlijke informatie die in de notulen belandt en die het bureau nodig
-- heeft. Alleen het INDIVIDUELE stemgedrag gaat dicht.
do $$
declare fouten text := ''; n int;
begin
  select count(*) into n from pg_policies
   where schemaname='public' and tablename='stemmingen' and cmd='SELECT'
     and coalesce(qual,'') not like '%bestuursbureau%';
  if n <> 1 then
    fouten := fouten || '  - "fonds stemmingen select" ontbreekt of is ten onrechte afgeschermd (FR-4)'||chr(10);
  end if;

  select count(*) into n from pg_policies
   where schemaname='public' and tablename='decision_dissent' and cmd='SELECT'
     and coalesce(qual,'') not like '%bestuursbureau%';
  if n <> 1 then
    fouten := fouten || '  - "dissent zichtbaarheid select" ontbreekt of is ten onrechte afgeschermd (§5.4)'||chr(10);
  end if;

  if fouten <> '' then
    raise exception E'FAALT: te veel afgeschermd:\n%', fouten;
  end if;
  raise notice 'OK 3: stemronde/uitslag en de dissent-leesregel zijn ongemoeid.';
end $$;

-- ── 4. NULGRENS — de rolgebonden policies van de bestaande rollen ─────────
-- De bestaande `rol in ('voorzitter','beheerder')`-schrijfpolicies mogen door dit
-- increment niet zijn aangeraakt. Zou er één zijn verdwenen of verruimd, dan is
-- dat per definitie een doorbraak van G23.
do $$
declare n int;
begin
  select count(*) into n
    from pg_policies
   where schemaname = 'public'
     and coalesce(qual,'') || coalesce(with_check,'') like '%''voorzitter''%'
     and coalesce(qual,'') || coalesce(with_check,'') like '%''beheerder''%';
  if n < 20 then
    raise exception
      'REGRESSIE (G23): er zijn nog maar % policies met de privileged-rolcheck '
      '(voorzitter/beheerder). Verwacht: de volledige config-/stuurinfolaag plus '
      'dissent. Een verdwenen policy betekent dat een bestaande rol rechten heeft '
      'verloren of gekregen.', n;
  end if;
  raise notice 'OK 4 (G23): % privileged-rolpolicies onaangetast.', n;
end $$;

-- ── 5. De bevriezingstrigger staat er nog ─────────────────────────────────
-- `profielen.rol` moet bevroren blijven voor zelfservice; anders zet een bureau-
-- gebruiker zichzelf op 'beheerder' en is de hele afscherming zinloos.
do $$
declare n int;
begin
  select count(*) into n
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname='public' and c.relname='profielen'
     and t.tgname='trg_profiel_bevries_kolommen' and not t.tgisinternal;
  if n <> 1 then
    raise exception 'FAALT (FR-1): trg_profiel_bevries_kolommen ontbreekt — rol is zelf-muteerbaar.';
  end if;
  raise notice 'OK 5: de bevriezingstrigger op profielen.rol staat.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  DEEL 2 — GEDRAG (seed als eigenaar, impersonatie, rollback)
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- Eén fonds, drie gebruikers — de rolgrens loopt hier BINNEN het fonds.
--   user B (bb01…) — bestuurder      → de positieve tegenhanger
--   user V (bb02…) — voorzitter      → opent/sluit de stemronde
--   user U (bb03…) — bestuursbureau  → het onderwerp van deze suite
-- `slug` is NOT NULL UNIQUE — expliciet meegeven (conventie sinds R1).
insert into public.fondsen (id, naam, slug)
values ('bb000000-0000-0000-0000-0000000000f1', 'BB Testfonds', 'bb-testfonds');

insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
values
  ('bb000001-0000-0000-0000-000000000001','authenticated','authenticated','bb-bestuurder@test.local',
   '{"naam":"BB Bestuurder","fonds_id":"bb000000-0000-0000-0000-0000000000f1"}', now(), now()),
  ('bb000002-0000-0000-0000-000000000002','authenticated','authenticated','bb-voorzitter@test.local',
   '{"naam":"BB Voorzitter","fonds_id":"bb000000-0000-0000-0000-0000000000f1"}', now(), now()),
  ('bb000003-0000-0000-0000-000000000003','authenticated','authenticated','bb-bureau@test.local',
   '{"naam":"BB Bureau","fonds_id":"bb000000-0000-0000-0000-0000000000f1"}', now(), now());

-- De trigger maak_profiel() zet iedereen op 'bestuurder' (default). De hogere en
-- de zijtak-rol worden daarna gezet — exact het service-role-pad uit P3-B; in de
-- SQL-editor is auth.uid() NULL, dus de bevriezingstrigger laat dit door.
update public.profielen set rol = 'voorzitter'
 where id = 'bb000002-0000-0000-0000-000000000002';
update public.profielen set rol = 'bestuursbureau'
 where id = 'bb000003-0000-0000-0000-000000000003';

do $$
begin
  if (select rol from public.profielen where id='bb000003-0000-0000-0000-000000000003')
     <> 'bestuursbureau' then
    raise exception 'SEED FAALT (FR-1): de bureau-rol kon niet worden gezet.';
  end if;
  if (select count(*) from public.profielen
       where fonds_id='bb000000-0000-0000-0000-0000000000f1') <> 3 then
    raise exception 'SEED FAALT: niet alle drie de profielen zijn aangemaakt (trigger maak_profiel).';
  end if;
  raise notice 'OK seed: drie profielen, waarvan één bestuursbureau.';
end $$;

-- Een ongeldige rolwaarde moet hard worden geweigerd (whitelist-CHECK).
do $$
begin
  update public.profielen set rol = 'bureau'
   where id = 'bb000003-0000-0000-0000-000000000003';
  raise exception 'LEK (FR-1): een rolwaarde buiten de CHECK werd geaccepteerd.';
exception
  when check_violation then
    raise notice 'OK: een rolwaarde buiten de whitelist wordt geweigerd.';
  when others then
    raise;  -- elke andere fout is echt: schemadrift, typefout of een eigen LEK-melding
end $$;

-- Vergadering, agendapunt, inbreng van de bestuurder, een stemronde met stem,
-- een privé-voorbereiding en een dissent — alles als eigenaar geseed.
insert into public.vergaderingen (id, fonds_id, titel, datum, aangemaakt_door)
values ('bb000000-0000-0000-0000-0000000000e1',
        'bb000000-0000-0000-0000-0000000000f1', 'BB Vergadering',
        now() + interval '7 days', 'bb000002-0000-0000-0000-000000000002');

insert into public.agendapunten (id, vergadering_id, titel, categorie)
values ('bb000000-0000-0000-0000-0000000000a1',
        'bb000000-0000-0000-0000-0000000000e1', 'BB Agendapunt', 'besluitvorming');

insert into public.agendapunt_inbreng (id, agendapunt_id, gebruiker_id, gebruiker_naam, tekst)
values ('bb000000-0000-0000-0000-0000000000b1',
        'bb000000-0000-0000-0000-0000000000a1',
        'bb000001-0000-0000-0000-000000000001', 'BB Bestuurder',
        'INBRENG VAN EEN BESTUURSLID — mag het bureau NOOIT zien.');

insert into public.stemmingen (id, fonds_id, agendapunt_id, vraag, geopend_door)
values ('bb000000-0000-0000-0000-0000000000c1',
        'bb000000-0000-0000-0000-0000000000f1',
        'bb000000-0000-0000-0000-0000000000a1',
        'BB Besluitvraag', 'bb000002-0000-0000-0000-000000000002');

insert into public.stem_uitbrengingen
  (id, stemming_id, uitgebracht_door, stemgerechtigde_id, keuze, motivering)
values ('bb000000-0000-0000-0000-0000000000c2',
        'bb000000-0000-0000-0000-0000000000c1',
        'bb000001-0000-0000-0000-000000000001',
        'bb000001-0000-0000-0000-000000000001',
        'voor', 'INDIVIDUEEL STEMGEDRAG — mag het bureau NOOIT zien.');

insert into public.voorbereidingen (agendapunt_id, gebruiker_id, eigen_notities)
values ('bb000000-0000-0000-0000-0000000000a1',
        'bb000001-0000-0000-0000-000000000001',
        '{"notitie":"PRIVE-VOORBEREIDING VAN EEN ANDER"}'::jsonb);

insert into public.procedures (id, fonds_id, template_code, titel)
values ('bb000000-0000-0000-0000-0000000000e2',
        'bb000000-0000-0000-0000-0000000000f1', 'bb-test', 'BB Procedure');

insert into public.decision_objects (id, fonds_id, procedure_id, besluit_code, titel, besluitvraag)
values ('bb000000-0000-0000-0000-0000000000d1',
        'bb000000-0000-0000-0000-0000000000f1',
        'bb000000-0000-0000-0000-0000000000e2',
        'BB-001', 'BB Besluit', 'BB Besluitvraag');

-- ── FR-3 — het bureau leest 0 inbrengrijen ────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"bb000003-0000-0000-0000-000000000003"}';

do $$
declare n int;
begin
  select count(*) into n from public.agendapunt_inbreng;
  if n <> 0 then
    raise exception 'LEK (FR-3): het bureau leest % inbrengrij(en) in het eigen fonds.', n;
  end if;
  raise notice 'OK FR-3: het bureau leest 0 rijen op agendapunt_inbreng.';
end $$;

-- ── FR-4 — 0 rijen stemgedrag, maar de ronde en de uitslag WEL ────────────
do $$
declare n int;
begin
  select count(*) into n from public.stem_uitbrengingen;
  if n <> 0 then
    raise exception 'LEK (FR-4): het bureau leest % rij(en) individueel stemgedrag.', n;
  end if;

  select count(*) into n from public.stemmingen;
  if n <> 1 then
    raise exception
      'TE VEEL AFGESCHERMD (FR-4): het bureau ziet % stemronde(s), verwacht 1. De '
      'ronde en de uitslag zijn bestuurlijke informatie die het bureau nodig heeft.', n;
  end if;
  raise notice 'OK FR-4: 0 rijen stemgedrag, 1 stemronde zichtbaar.';
end $$;

-- ── FR-5 — privé-voorbereidingen van een ander blijven onzichtbaar ────────
-- Bestaande policy ("eigen voorbereiding"); hier als regressietest vastgelegd.
do $$
declare n int;
begin
  select count(*) into n from public.voorbereidingen;
  if n <> 0 then
    raise exception 'LEK (FR-5): het bureau leest % privé-voorbereiding(en) van een ander.', n;
  end if;
  raise notice 'OK FR-5: privé-voorbereidingen van anderen zijn onzichtbaar.';
end $$;

-- ── FR-7 — het bureau kan niet inbrengen ──────────────────────────────────
do $$
begin
  insert into public.agendapunt_inbreng (agendapunt_id, gebruiker_id, gebruiker_naam, tekst)
  values ('bb000000-0000-0000-0000-0000000000a1',
          'bb000003-0000-0000-0000-000000000003', 'BB Bureau', 'Poging tot inbreng');
  raise exception 'LEK (FR-7): het bureau kon inbreng plaatsen.';
exception
  when insufficient_privilege then
    raise notice 'OK FR-7: inbreng plaatsen door het bureau wordt door RLS geweigerd.';
end $$;

-- ── FR-7 — het bureau kan niet stemmen ────────────────────────────────────
do $$
begin
  insert into public.stem_uitbrengingen
    (stemming_id, uitgebracht_door, stemgerechtigde_id, keuze)
  values ('bb000000-0000-0000-0000-0000000000c1',
          'bb000003-0000-0000-0000-000000000003',
          'bb000003-0000-0000-0000-000000000003', 'voor');
  raise exception 'LEK (FR-7): het bureau kon een stem uitbrengen.';
exception
  when insufficient_privilege then
    raise notice 'OK FR-7: stemmen door het bureau wordt door RLS geweigerd.';
end $$;

-- ── FR-7 — het bureau kan geen stemronde openen ───────────────────────────
-- Belangrijk: het bureau bouwt in de praktijk de agenda en is dus vaak
-- `agendapunten.aangemaakt_door`. Zonder deze grens zou het via de aanmaker-tak
-- in de API alsnog een ronde kunnen openen.
do $$
begin
  insert into public.stemmingen (fonds_id, agendapunt_id, vraag, geopend_door)
  values ('bb000000-0000-0000-0000-0000000000f1',
          'bb000000-0000-0000-0000-0000000000a1',
          'Poging van het bureau', 'bb000003-0000-0000-0000-000000000003');
  raise exception 'LEK (FR-7): het bureau kon een stemronde openen.';
exception
  when insufficient_privilege then
    raise notice 'OK FR-7: stemronde openen door het bureau wordt door RLS geweigerd.';
end $$;

-- ── FR-7 — het bureau kan geen stemronde sluiten of intrekken ─────────────
do $$
declare n int;
begin
  update public.stemmingen set status = 'ingetrokken', ingetrokken_reden = 'poging'
   where id = 'bb000000-0000-0000-0000-0000000000c1';
  get diagnostics n = row_count;
  if n > 0 then
    raise exception 'LEK (FR-7): het bureau kon een stemronde wijzigen (% rij).', n;
  end if;
  raise notice 'OK FR-7: een stemronde wijzigen levert 0 geraakte rijen (RLS-filter).';
exception
  when insufficient_privilege then
    raise notice 'OK FR-7: een stemronde wijzigen wordt door RLS geweigerd.';
  when others then
    raise;  -- elke andere fout is echt: schemadrift, typefout of een eigen LEK-melding
end $$;

-- ── FR-7 — het bureau kan geen dissent vastleggen ─────────────────────────
-- Zonder de M5-uitbreiding zou het bureau hier binnenkomen via de tak
-- `bestuurder_id = auth.uid()` in "dissent zichtbaarheid write".
do $$
begin
  insert into public.decision_dissent
    (decision_id, bestuurder_id, bestuurder_naam, zichtbaarheid, standpunt)
  values ('bb000000-0000-0000-0000-0000000000d1',
          'bb000003-0000-0000-0000-000000000003', 'BB Bureau',
          'gedeelde_zorg', 'Poging tot dissent');
  raise exception 'LEK (FR-7): het bureau kon dissent vastleggen.';
exception
  when insufficient_privilege then
    raise notice 'OK FR-7: dissent vastleggen door het bureau wordt door RLS geweigerd.';
end $$;

-- ── FR-1 — het bureau kan de eigen rol niet muteren ───────────────────────
do $$
begin
  update public.profielen set rol = 'beheerder'
   where id = 'bb000003-0000-0000-0000-000000000003';
  raise exception 'LEK (FR-1): het bureau kon de eigen rol naar beheerder zetten.';
exception
  when insufficient_privilege then
    raise notice 'OK FR-1: rolescalatie geweigerd (bevriezingstrigger/RLS).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  NULGRENS G23 — dezelfde handelingen door een BESTUURDER en een VOORZITTER
--  in hetzelfde fonds. Zonder dit blok zou een suite die alles blokkeert ook
--  groen zijn, en dan bewijst hij niets.
-- ════════════════════════════════════════════════════════════════════════════

set local request.jwt.claims to '{"sub":"bb000001-0000-0000-0000-000000000001"}';

do $$
declare n int;
begin
  select count(*) into n from public.agendapunt_inbreng;
  if n <> 1 then
    raise exception
      'REGRESSIE (G23): een bestuurder leest % inbrengrij(en), verwacht 1. De '
      'afscherming van het bureau heeft de bestuurder geraakt.', n;
  end if;

  select count(*) into n from public.stem_uitbrengingen;
  if n <> 1 then
    raise exception
      'REGRESSIE (G23): een bestuurder leest % rij(en) stemgedrag, verwacht 1.', n;
  end if;

  select count(*) into n from public.voorbereidingen;
  if n <> 1 then
    raise exception
      'REGRESSIE (G23): een bestuurder ziet % eigen voorbereiding(en), verwacht 1.', n;
  end if;
  raise notice 'OK G23: de bestuurder leest inbreng, stemgedrag en de eigen voorbereiding onverminderd.';
end $$;

-- Een bestuurder kan nog steeds inbreng plaatsen.
do $$
begin
  insert into public.agendapunt_inbreng (agendapunt_id, gebruiker_id, gebruiker_naam, tekst)
  values ('bb000000-0000-0000-0000-0000000000a1',
          'bb000001-0000-0000-0000-000000000001', 'BB Bestuurder', 'Tweede inbreng');
  raise notice 'OK G23: een bestuurder kan onverminderd inbreng plaatsen.';
exception
  when others then
    raise exception
      'REGRESSIE (G23): een bestuurder kan GEEN inbreng meer plaatsen (sqlstate %, %). '
      'De rol-uitsluiting is te breed geformuleerd.', sqlstate, sqlerrm;
end $$;

-- Een stem met een VREEMDE uitbrenger blijft geweigerd (uitgebracht_door =
-- auth.uid()). Bestaand gedrag; hier meegenomen omdat de M3-uitbreiding precies
-- in dit predicaat ingrijpt en het niet mag verschuiven.
do $$
begin
  insert into public.stem_uitbrengingen
    (stemming_id, uitgebracht_door, stemgerechtigde_id, keuze)
  values ('bb000000-0000-0000-0000-0000000000c1',
          'bb000002-0000-0000-0000-000000000002',
          'bb000002-0000-0000-0000-000000000002', 'tegen');
  raise exception 'LEK: bestuurder B kon een stem namens voorzitter V registreren zonder volmachtpad.';
exception
  when insufficient_privilege then
    raise notice 'OK: een stem met een vreemde uitbrenger wordt geweigerd (uitgebracht_door = auth.uid()).';
end $$;

set local request.jwt.claims to '{"sub":"bb000002-0000-0000-0000-000000000002"}';

-- POSITIEVE TEGENHANGER: de voorzitter brengt zijn eigen stem uit. Zonder deze
-- test zou een te breed geformuleerde rol-uitsluiting (bijvoorbeeld `<>` met een
-- NULL-rol, of een uitsluiting op de verkeerde tak) onopgemerkt blijven — een
-- suite die alles blokkeert is óók groen.
do $$
begin
  insert into public.stem_uitbrengingen
    (stemming_id, uitgebracht_door, stemgerechtigde_id, keuze)
  values ('bb000000-0000-0000-0000-0000000000c1',
          'bb000002-0000-0000-0000-000000000002',
          'bb000002-0000-0000-0000-000000000002', 'tegen');
  raise notice 'OK G23: de voorzitter kan onverminderd een eigen stem uitbrengen.';
exception
  when others then
    raise exception
      'REGRESSIE (G23): de voorzitter kan GEEN stem meer uitbrengen (sqlstate %, %). '
      'De rol-uitsluiting is te breed geformuleerd.', sqlstate, sqlerrm;
end $$;

do $$
declare n int;
begin
  update public.stemmingen set vraag = 'BB Besluitvraag (bijgewerkt)'
   where id = 'bb000000-0000-0000-0000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception
      'REGRESSIE (G23): de voorzitter kan de stemronde niet meer wijzigen (% rij geraakt).', n;
  end if;
  raise notice 'OK G23: de voorzitter kan de stemronde onverminderd wijzigen/sluiten.';
end $$;

-- Quorumtelling: het bureau telt NIET mee, en de telling voor de bestaande
-- rollen is daardoor ongewijzigd. Dit is een applicatiefilter
-- (`rol in ('bestuurder','voorzitter')`), hier nagerekend op de data.
-- Tel als eigenaar: onder de nog actieve authenticated-impersonatie ziet RLS
-- terecht alleen het eigen profiel en zou deze fixture de quorumlogica niet
-- maar de profiel-leespolicy meten.
reset role;

do $$
declare n int;
begin
  select count(*) into n from public.profielen
   where fonds_id = 'bb000000-0000-0000-0000-0000000000f1'
     and rol in ('bestuurder','voorzitter');
  if n <> 2 then
    raise exception
      'REGRESSIE (G23): de quorumtelling levert %, verwacht 2 (bestuurder + '
      'voorzitter; het bureau telt niet mee).', n;
  end if;
  raise notice 'OK G23: het quorum verschuift niet door de bureau-gebruiker.';
end $$;

rollback;

-- ============================================================================
--  Groen = elke `raise notice` hierboven is verschenen en er is geen exception
--  opgetreden. Rood = één `LEK:`/`FAALT`/`REGRESSIE` → non-zero psql-exit.
--
--  Draai hierna ook supabase/checks/2026_07_31_r1_structurele_gates.sql: die
--  toetst het HELE schema (gates A1, A2, B, C, C2, E, F, G, H, D) en vangt af
--  dat de herschreven policies bijvoorbeeld de parenttabelverwijzing hebben
--  verloren (gate A2) of dat een FOR ALL-policy zonder with_check is ontstaan
--  (gate G).
-- ============================================================================
