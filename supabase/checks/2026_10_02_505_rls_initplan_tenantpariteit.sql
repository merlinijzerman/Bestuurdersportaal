-- ============================================================================
-- #505 — tenantpariteit van de InitPlan-herschrijving op documenten en
-- document_chunks.
-- ----------------------------------------------------------------------------
-- De migratie 2026_10_02_505_rls_auth_uid_initplan.sql verandert uitsluitend
-- de expressievorm van zes policies: `auth.uid()` → `(select auth.uid())`.
-- Deze check bewijst onder ECHTE RLS dat de tenanttoegang daardoor exact
-- gelijk blijft, en dat de check zelf een verruiming zou zien.
--
--   P0 — de database staat in de verwachte vorm: in CI 'na' (zes policies,
--        geen kale `auth.uid()` meer); voor de rollbacktest
--        `-v f505_verwacht=voor` (de oude vorm, geen omhulsel).
--   P1 — toegangsmatrix in de HUIDIGE stand, per actor:
--        eigen fonds (A), ander fonds (B), gebruiker zonder profiel,
--        authenticated zonder sub, anon, anon mét sub van A, service_role en
--        portaal_beperkt (sub van A). Per actor: zichtbare documenten en
--        chunks (SELECT), het resultaat van `zoek_chunks`, en per doel
--        (fonds A / fonds B / generiek) de uitkomst van INSERT, UPDATE
--        (gelijk, en verhuizen naar fonds B) en DELETE op beide tabellen.
--        Elke schrijfpoging rolt terug (subtransactie); vastgelegd wordt het
--        aantal geraakte rijen of de SQLSTATE. Plus een semantische
--        ondergrens (A ziet A+generiek en nooit B, anon en zonder-sub zien
--        niets, schrijven alleen in het eigen fonds), zodat een lege of
--        zinloze matrix niet als "gelijk" kan slagen.
--   P2 — de ANDERE stand wordt in dezelfde transactie gezet (vanuit 'na' de
--        letterlijke VÓÓR-teksten zoals Productie en Preview ze op 02-10-2026
--        droegen; vanuit 'voor' de letterlijke migratieteksten); de matrix
--        moet EXACT gelijk zijn aan P1.
--   P3 — catalogusvergelijking: per policy zijn naam, cmd, permissive en
--        rollen gelijk, en zijn USING en WITH CHECK na normalisatie
--        (`( SELECT auth.uid() AS uid)` → `auth.uid()`) tekstueel identiek.
--   N  — negatieve controles: drie opzettelijk verruimde varianten
--        (anon leest generiek; fonds A leest chunks van fonds B; fonds A
--        schrijft chunks onder een generiek document) moeten ELK zowel de
--        matrix als de catalogusvergelijking rood maken.
--
-- Self-seeding in één transactie met ROLLBACK — laat geen data en geen
-- policywijziging achter.
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw, policywissels en afbraak; de matrix zelf wordt per
--      actor gemeten als authenticated, anon, service_role en portaal_beperkt
--      (set_config('role', …) + request.jwt.claims), want alleen onder die
--      rollen staat RLS werkelijk tussen de aanroeper en de data — als
--      postgres (BYPASSRLS) zou elke matrix triviaal gelijk zijn.
-- ----------------------------------------------------------------------------

\set ON_ERROR_STOP on
-- In CI is de verwachte stand 'na' (de migratie is toegepast). Voor de
-- rollbacktest: `-v f505_verwacht=voor` na het rollbackscript.
\if :{?f505_verwacht}
\else
\set f505_verwacht na
\endif

begin;
select set_config('f505.verwacht', :'f505_verwacht', true);

-- ── Fixture ─────────────────────────────────────────────────────────────────
insert into public.fondsen (id, naam, slug) values
  ('05050000-1111-1111-1111-111111111111', '#505 fonds A', 'f505-fonds-a'),
  ('05050000-2222-2222-2222-222222222222', '#505 fonds B', 'f505-fonds-b');

insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at) values
  ('05050000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'authenticated', 'authenticated', 'f505-a@test.local',
   '{"naam":"F505 A","fonds_id":"05050000-1111-1111-1111-111111111111"}', now(), now()),
  ('05050000-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'authenticated', 'authenticated', 'f505-b@test.local',
   '{"naam":"F505 B","fonds_id":"05050000-2222-2222-2222-222222222222"}', now(), now());

do $$
begin
  if (select fonds_id from public.profielen where id = '05050000-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
       is distinct from '05050000-1111-1111-1111-111111111111'::uuid
     or (select fonds_id from public.profielen where id = '05050000-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
       is distinct from '05050000-2222-2222-2222-222222222222'::uuid then
    raise exception 'SEED FAALT: profielen A/B niet aan hun fonds gekoppeld (trigger maak_profiel).';
  end if;
  -- "Zonder profiel": een sub die geen profielrij heeft (bv. een verwijderd
  -- account met een nog geldige JWT).
  if exists (select 1 from public.profielen where id = '05050000-cccc-cccc-cccc-cccccccccccc') then
    raise exception 'SEED FAALT: de zonder-profiel-sub heeft toch een profiel.';
  end if;
end $$;

insert into public.documenten (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief) values
  ('05050000-0000-0000-0000-0000000000a1', '05050000-1111-1111-1111-111111111111', 'fonds', 'Intern',
   'F505 A1 transitieplan', 'vastgesteld', 'actief', true),
  ('05050000-0000-0000-0000-0000000000a2', '05050000-1111-1111-1111-111111111111', 'fonds', 'Intern',
   'F505 A2 transitieplan', 'concept', 'actief', true),
  ('05050000-0000-0000-0000-0000000000b1', '05050000-2222-2222-2222-222222222222', 'fonds', 'Intern',
   'F505 B1 transitieplan', 'vastgesteld', 'actief', true),
  ('05050000-0000-0000-0000-0000000000e1', null, 'generiek', 'Extern',
   'F505 G1 transitieplan', 'van_kracht', 'actief', true),
  ('05050000-0000-0000-0000-0000000000e2', null, 'generiek', 'Extern',
   'F505 G2 transitieplan', 'concept', 'actief', true);

insert into public.document_chunks (id, document_id, chunk_index, pagina, tekst)
select ('05050000-0000-0000-0000-' || substr(d.id::text, 34, 3) || 'c0000000' || i)::uuid,
       d.id, i, 1, 'F505 transitieplan pensioen fonds tekst ' || d.titel || ' deel ' || i
  from public.documenten d, generate_series(1, 2) i
 where d.id::text like '05050000-0000-0000-0000-0000000000%';

-- ── Hulpfuncties ────────────────────────────────────────────────────────────
-- Normalisatie: `(select auth.uid())` deparseert als `( SELECT auth.uid() AS uid)`.
create function pg_temp.f505_norm(t text) returns text language sql immutable as $$
  select regexp_replace(t, '\( SELECT auth\.uid\(\) AS uid\)', 'auth.uid()', 'g')
$$;

create function pg_temp.f505_catalogus() returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(tablename || '.' || policyname, jsonb_build_object(
           'cmd', cmd, 'permissive', permissive, 'roles', roles::text,
           'qual', qual, 'with_check', with_check)), '{}'::jsonb)
    from pg_catalog.pg_policies
   where schemaname = 'public' and tablename in ('documenten', 'document_chunks')
$$;

-- Verschillen tussen twee catalogusstanden na normalisatie (lege tekst = gelijk).
create function pg_temp.f505_catalogus_verschil(a jsonb, b jsonb) returns text language plpgsql stable as $$
declare
  v text := '';
  k text;
begin
  for k in select x from (select jsonb_object_keys(a) x union select jsonb_object_keys(b)) s order by 1 loop
    if a->k is null or b->k is null then
      v := v || format(E'    %s: alleen in één stand\n', k);
    elsif (a->k->>'cmd') is distinct from (b->k->>'cmd')
       or (a->k->>'permissive') is distinct from (b->k->>'permissive')
       or (a->k->>'roles') is distinct from (b->k->>'roles') then
      v := v || format(E'    %s: cmd/permissive/rollen verschillen\n', k);
    elsif pg_temp.f505_norm(a->k->>'qual') is distinct from pg_temp.f505_norm(b->k->>'qual')
       or pg_temp.f505_norm(a->k->>'with_check') is distinct from pg_temp.f505_norm(b->k->>'with_check') then
      v := v || format(E'    %s: predicaat verschilt (meer dan de expressievorm)\n', k);
    end if;
  end loop;
  return v;
end $$;

-- Eén poging, altijd teruggedraaid: 'rijen:N' of 'fout:SQLSTATE'.
create function pg_temp.f505_poging(stmt text) returns text language plpgsql as $$
declare
  n bigint;
begin
  begin
    execute stmt;
    get diagnostics n = row_count;
    raise exception using errcode = 'P0505', message = 'rijen:' || n;
  exception when others then
    if sqlstate = 'P0505' then return sqlerrm; end if;
    return 'fout:' || sqlstate;
  end;
end $$;

-- De toegangsmatrix onder de policies die NU in de catalogus staan.
create function pg_temp.f505_matrix() returns jsonb language plpgsql as $$
declare
  c_a  constant text := '05050000-1111-1111-1111-111111111111';
  c_b  constant text := '05050000-2222-2222-2222-222222222222';
  c_ua constant text := '05050000-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  c_ub constant text := '05050000-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  c_un constant text := '05050000-cccc-cccc-cccc-cccccccccccc';
  doelen constant jsonb := jsonb_build_object(
    'A', '05050000-0000-0000-0000-0000000000a1',
    'B', '05050000-0000-0000-0000-0000000000b1',
    'G', '05050000-0000-0000-0000-0000000000e1');
  chunkdoelen constant jsonb := jsonb_build_object(
    'A', '05050000-0000-0000-0000-0a1c00000001',
    'B', '05050000-0000-0000-0000-0b1c00000001',
    'G', '05050000-0000-0000-0000-0e1c00000001');
  actor record;
  d text;
  uit jsonb := '{}'::jsonb;
  r jsonb;
begin
  for actor in
    select * from (values
      ('eigen_fonds_A',            'authenticated',   jsonb_build_object('sub', c_ua, 'role', 'authenticated')),
      ('ander_fonds_B',            'authenticated',   jsonb_build_object('sub', c_ub, 'role', 'authenticated')),
      ('zonder_profiel',           'authenticated',   jsonb_build_object('sub', c_un, 'role', 'authenticated')),
      ('authenticated_zonder_sub', 'authenticated',   jsonb_build_object('role', 'authenticated')),
      ('anon',                     'anon',            jsonb_build_object('role', 'anon')),
      ('anon_met_sub_A',           'anon',            jsonb_build_object('sub', c_ua, 'role', 'anon')),
      ('service_role',             'service_role',    jsonb_build_object('role', 'service_role')),
      ('portaal_beperkt_A',        'portaal_beperkt', jsonb_build_object('sub', c_ua, 'role', 'portaal_beperkt'))
    ) v(naam, rol, claims)
  loop
    perform set_config('request.jwt.claims', actor.claims::text, true);
    perform set_config('role', actor.rol, true);
    r := '{}'::jsonb;

    -- SELECT (beperkt tot de fixture, zodat andere testdata niet meetelt).
    begin
      r := r || jsonb_build_object('select_documenten', (
        select coalesce(jsonb_agg(id order by id), '[]') from public.documenten
         where id::text like '05050000-0000-0000-0000-0000000000%'));
    exception when others then
      r := r || jsonb_build_object('select_documenten', 'fout:' || sqlstate);
    end;
    begin
      r := r || jsonb_build_object('select_chunks', (
        select coalesce(jsonb_agg(id order by id), '[]') from public.document_chunks
         where id::text like '05050000-0000-0000-0000-0%'));
    exception when others then
      r := r || jsonb_build_object('select_chunks', 'fout:' || sqlstate);
    end;
    begin
      r := r || jsonb_build_object('zoek_chunks', (
        select coalesce(jsonb_agg(z.id order by z.id), '[]')
          from public.zoek_chunks('F505 transitieplan', 200) z
         where z.id::text like '05050000-0000-0000-0000-0%'));
    exception when others then
      r := r || jsonb_build_object('zoek_chunks', 'fout:' || sqlstate);
    end;

    -- Schrijven op documenten, per doel.
    r := r || jsonb_build_object(
      'insert_documenten_A', pg_temp.f505_poging(format(
        $f$insert into public.documenten (fonds_id, bibliotheek, bron, titel, status, bronstatus, actief)
           values (%L, 'fonds', 'Intern', 'F505 nieuw', 'concept', 'actief', true)$f$, c_a)),
      'insert_documenten_B', pg_temp.f505_poging(format(
        $f$insert into public.documenten (fonds_id, bibliotheek, bron, titel, status, bronstatus, actief)
           values (%L, 'fonds', 'Intern', 'F505 nieuw', 'concept', 'actief', true)$f$, c_b)),
      'insert_documenten_G', pg_temp.f505_poging(
        $f$insert into public.documenten (fonds_id, bibliotheek, bron, titel, status, bronstatus, actief)
           values (null, 'generiek', 'Extern', 'F505 nieuw', 'concept', 'actief', true)$f$));
    for d in select jsonb_object_keys(doelen) loop
      r := r || jsonb_build_object(
        'update_documenten_' || d, pg_temp.f505_poging(format(
          'update public.documenten set titel = titel where id = %L', doelen->>d)),
        'update_documenten_' || d || '_naar_B', pg_temp.f505_poging(format(
          $f$update public.documenten set fonds_id = %L, bibliotheek = 'fonds' where id = %L$f$, c_b, doelen->>d)),
        'delete_documenten_' || d, pg_temp.f505_poging(format(
          'delete from public.documenten where id = %L', doelen->>d)));
    end loop;

    -- Schrijven op document_chunks, per doel.
    for d in select jsonb_object_keys(doelen) loop
      r := r || jsonb_build_object(
        'insert_chunks_' || d, pg_temp.f505_poging(format(
          $f$insert into public.document_chunks (document_id, chunk_index, pagina, tekst)
             values (%L, 99, 1, 'F505 nieuw')$f$, doelen->>d)),
        'update_chunks_' || d, pg_temp.f505_poging(format(
          'update public.document_chunks set tekst = tekst where id = %L', chunkdoelen->>d)),
        'update_chunks_' || d || '_naar_B', pg_temp.f505_poging(format(
          'update public.document_chunks set document_id = %L where id = %L', doelen->>'B', chunkdoelen->>d)),
        'delete_chunks_' || d, pg_temp.f505_poging(format(
          'delete from public.document_chunks where id = %L', chunkdoelen->>d)));
    end loop;

    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
    uit := uit || jsonb_build_object(actor.naam, r);
  end loop;
  return uit;
end $$;

-- Matrixverschil als leesbare tekst (lege tekst = gelijk).
create function pg_temp.f505_matrix_verschil(a jsonb, b jsonb) returns text language sql immutable as $$
  select coalesce(string_agg(format('    %s.%s: %s ≠ %s', x.actor, x.k, x.va, x.vb), E'\n' order by x.actor, x.k), '')
    from (
      select ak.actor, kk.k, a->ak.actor->kk.k as va, b->ak.actor->kk.k as vb
        from (select jsonb_object_keys(a) actor union select jsonb_object_keys(b)) ak,
             lateral (select jsonb_object_keys(coalesce(a->ak.actor, '{}')) k
                      union select jsonb_object_keys(coalesce(b->ak.actor, '{}'))) kk
    ) x
   where x.va is distinct from x.vb
$$;

-- Zet de VÓÓR-stand (exact de tekst van vóór #505) terug.
create function pg_temp.f505_zet_voor() returns void language plpgsql as $$
begin
  drop policy if exists "documenten select" on public.documenten;
  create policy "documenten select" on public.documenten
    for select using (
      auth.uid() is not null
      and (fonds_id = (select fonds_id from public.profielen where id = auth.uid())
           or bibliotheek = 'generiek'));
  drop policy if exists "documenten insert eigen fonds" on public.documenten;
  create policy "documenten insert eigen fonds" on public.documenten
    for insert with check (
      fonds_id = (select fonds_id from public.profielen where id = auth.uid())
      and bibliotheek = 'fonds');
  drop policy if exists "documenten update eigen fonds" on public.documenten;
  create policy "documenten update eigen fonds" on public.documenten
    for update using (
      fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    ) with check (
      fonds_id = (select fonds_id from public.profielen where id = auth.uid())
      and bibliotheek = 'fonds');
  drop policy if exists "documenten delete eigen fonds" on public.documenten;
  create policy "documenten delete eigen fonds" on public.documenten
    for delete using (
      fonds_id = (select fonds_id from public.profielen where id = auth.uid()));
  drop policy if exists "chunks select" on public.document_chunks;
  create policy "chunks select" on public.document_chunks
    for select using (
      auth.uid() is not null
      and document_id in (
        select id from public.documenten
         where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
            or bibliotheek = 'generiek'));
  drop policy if exists "chunks write eigen fonds" on public.document_chunks;
  create policy "chunks write eigen fonds" on public.document_chunks
    for all using (
      document_id in (select id from public.documenten where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
        and bibliotheek = 'fonds')
    ) with check (
      document_id in (select id from public.documenten where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
        and bibliotheek = 'fonds'));
end $$;

-- Zet de NA-stand (exact de tekst van de migratie) terug.
create function pg_temp.f505_zet_na() returns void language plpgsql as $$
begin
  drop policy if exists "documenten select" on public.documenten;
  create policy "documenten select" on public.documenten
    as permissive for select to public
    using ((select auth.uid()) is not null
           and (fonds_id = (select profielen.fonds_id from public.profielen
                             where profielen.id = (select auth.uid()))
                or bibliotheek = 'generiek'));
  drop policy if exists "documenten insert eigen fonds" on public.documenten;
  create policy "documenten insert eigen fonds" on public.documenten
    as permissive for insert to public
    with check (fonds_id = (select profielen.fonds_id from public.profielen
                             where profielen.id = (select auth.uid()))
                and bibliotheek = 'fonds');
  drop policy if exists "documenten update eigen fonds" on public.documenten;
  create policy "documenten update eigen fonds" on public.documenten
    as permissive for update to public
    using (fonds_id = (select profielen.fonds_id from public.profielen
                        where profielen.id = (select auth.uid())))
    with check (fonds_id = (select profielen.fonds_id from public.profielen
                             where profielen.id = (select auth.uid()))
                and bibliotheek = 'fonds');
  drop policy if exists "documenten delete eigen fonds" on public.documenten;
  create policy "documenten delete eigen fonds" on public.documenten
    as permissive for delete to public
    using (fonds_id = (select profielen.fonds_id from public.profielen
                        where profielen.id = (select auth.uid())));
  drop policy if exists "chunks select" on public.document_chunks;
  create policy "chunks select" on public.document_chunks
    as permissive for select to public
    using ((select auth.uid()) is not null
           and document_id in (
             select documenten.id from public.documenten
              where documenten.fonds_id = (select profielen.fonds_id from public.profielen
                                            where profielen.id = (select auth.uid()))
                 or documenten.bibliotheek = 'generiek'));
  drop policy if exists "chunks write eigen fonds" on public.document_chunks;
  create policy "chunks write eigen fonds" on public.document_chunks
    as permissive for all to public
    using (document_id in (
             select documenten.id from public.documenten
              where documenten.fonds_id = (select profielen.fonds_id from public.profielen
                                            where profielen.id = (select auth.uid()))
                and documenten.bibliotheek = 'fonds'))
    with check (document_id in (
             select documenten.id from public.documenten
              where documenten.fonds_id = (select profielen.fonds_id from public.profielen
                                            where profielen.id = (select auth.uid()))
                and documenten.bibliotheek = 'fonds'));
end $$;

create temp table f505_stand (naam text primary key, catalogus jsonb, matrix jsonb) on commit drop;

-- ── P0 — de verwachte vorm staat er (CI: 'na'; rollbacktest: 'voor') ──────
do $$
declare
  v_cat jsonb := pg_temp.f505_catalogus();
  v_verwacht text := current_setting('f505.verwacht');
  k text;
  v_kaal boolean;
  v_omhuld boolean;
begin
  if v_verwacht not in ('na', 'voor') then
    raise exception 'P0 FAALT: f505_verwacht=% (toegestaan: na, voor).', v_verwacht;
  end if;
  if (select count(*) from jsonb_object_keys(v_cat)) <> 6 then
    raise exception 'P0 FAALT: % policies op documenten/document_chunks (verwacht 6).',
      (select count(*) from jsonb_object_keys(v_cat));
  end if;
  for k in select jsonb_object_keys(v_cat) loop
    v_kaal := position('auth.uid()' in regexp_replace(
                coalesce(v_cat->k->>'qual', '') || coalesce(v_cat->k->>'with_check', ''),
                '\( SELECT auth\.uid\(\) AS uid\)', '', 'g')) > 0;
    v_omhuld := (coalesce(v_cat->k->>'qual', '') || coalesce(v_cat->k->>'with_check', ''))
                ~ 'SELECT auth\.uid\(\) AS uid';
    if v_verwacht = 'na' and (v_kaal or not v_omhuld) then
      raise exception 'P0 FAALT: % staat niet in de #505-vorm (kale auth.uid() of geen omhulsel) — migratie niet toegepast?', k;
    end if;
    if v_verwacht = 'voor' and (v_omhuld or not v_kaal) then
      raise exception 'P0 FAALT: % staat niet in de vorm van vóór #505 — rollback niet toegepast?', k;
    end if;
  end loop;
  raise notice 'P0 OK: zes policies in de verwachte stand ''%''.', v_verwacht;
end $$;

-- ── P1 — matrix in de HUIDIGE stand + semantische ondergrens ────────────────
insert into f505_stand select 'huidig', pg_temp.f505_catalogus(), pg_temp.f505_matrix();

do $$
declare
  m jsonb := (select matrix from f505_stand where naam = 'huidig');
  c_a  constant jsonb := '["05050000-0000-0000-0000-0000000000a1","05050000-0000-0000-0000-0000000000a2"]';
  c_g  constant jsonb := '["05050000-0000-0000-0000-0000000000e1","05050000-0000-0000-0000-0000000000e2"]';
  fout text := '';
  procedure_eis text;
begin
  -- Zichtbaarheid documenten.
  if m->'eigen_fonds_A'->'select_documenten' <> (
       select jsonb_agg(x order by x) from jsonb_array_elements(c_a || c_g) x) then
    fout := fout || E'  A ziet niet precies eigen fonds + generiek\n';
  end if;
  if m->'ander_fonds_B'->'select_documenten' @> '["05050000-0000-0000-0000-0000000000a1"]' then
    fout := fout || E'  B ziet een document van A\n';
  end if;
  if m->'zonder_profiel'->'select_documenten' <> c_g then
    fout := fout || E'  zonder profiel ziet niet precies generiek\n';
  end if;
  if m->'anon'->'select_documenten' <> '[]' or m->'anon'->'select_chunks' <> '[]' then
    fout := fout || E'  anon ziet rijen\n';
  end if;
  if m->'authenticated_zonder_sub'->'select_documenten' <> '[]' or m->'authenticated_zonder_sub'->'select_chunks' <> '[]' then
    fout := fout || E'  authenticated zonder sub ziet rijen\n';
  end if;
  if jsonb_array_length(m->'service_role'->'select_documenten') <> 5 or jsonb_array_length(m->'service_role'->'select_chunks') <> 10 then
    fout := fout || E'  service_role ziet niet alles (BYPASSRLS)\n';
  end if;
  if jsonb_array_length(m->'eigen_fonds_A'->'select_chunks') <> 8 then
    fout := fout || E'  A ziet niet 8 chunks (2×A + 2×generiek, à 2)\n';
  end if;
  if (m->'eigen_fonds_A'->'zoek_chunks') @> '["05050000-0000-0000-0000-0b1c00000001"]'
     or jsonb_array_length(m->'eigen_fonds_A'->'zoek_chunks') < 4 then
    fout := fout || E'  zoek_chunks voor A lekt fonds B of vindt niets\n';
  end if;
  -- Schrijven: alleen in het eigen fonds.
  if m->'eigen_fonds_A'->>'insert_documenten_A' <> 'rijen:1' then fout := fout || E'  A kan niet in eigen fonds inserten\n'; end if;
  if m->'eigen_fonds_A'->>'insert_documenten_B' not like 'fout:%' then fout := fout || E'  A kan in fonds B inserten\n'; end if;
  if m->'eigen_fonds_A'->>'insert_documenten_G' not like 'fout:%' then fout := fout || E'  A kan generiek inserten\n'; end if;
  if m->'eigen_fonds_A'->>'update_documenten_A' <> 'rijen:1' then fout := fout || E'  A kan eigen document niet bijwerken\n'; end if;
  if m->'eigen_fonds_A'->>'update_documenten_B' <> 'rijen:0' then fout := fout || E'  A raakt document van B\n'; end if;
  if m->'eigen_fonds_A'->>'update_documenten_A_naar_B' not like 'fout:%' then fout := fout || E'  A kan document naar B verhuizen\n'; end if;
  if m->'eigen_fonds_A'->>'delete_documenten_B' <> 'rijen:0' then fout := fout || E'  A kan document van B verwijderen\n'; end if;
  if m->'eigen_fonds_A'->>'delete_documenten_G' <> 'rijen:0' then fout := fout || E'  A kan generiek verwijderen\n'; end if;
  if m->'eigen_fonds_A'->>'insert_chunks_A' <> 'rijen:1' then fout := fout || E'  A kan geen chunk in eigen fonds schrijven\n'; end if;
  if m->'eigen_fonds_A'->>'insert_chunks_B' not like 'fout:%' then fout := fout || E'  A kan chunk onder B schrijven\n'; end if;
  if m->'eigen_fonds_A'->>'insert_chunks_G' not like 'fout:%' then fout := fout || E'  A kan chunk onder generiek schrijven\n'; end if;
  if m->'eigen_fonds_A'->>'update_chunks_A_naar_B' not like 'fout:%' then fout := fout || E'  A kan chunk naar B verhuizen\n'; end if;
  if m->'eigen_fonds_A'->>'delete_chunks_G' <> 'rijen:0' then fout := fout || E'  A kan generieke chunk verwijderen\n'; end if;
  if m->'anon'->>'insert_documenten_A' not like 'fout:%' then fout := fout || E'  anon kan inserten\n'; end if;
  if m->'portaal_beperkt_A'->>'select_documenten' not like 'fout:%' then fout := fout || E'  portaal_beperkt leest documenten\n'; end if;
  if fout <> '' then
    raise exception E'P1 FAALT (semantische ondergrens, huidige stand):\n%', fout;
  end if;
  raise notice 'P1 OK: matrix huidige stand (8 actoren × % uitkomsten) voldoet aan de ondergrens.',
    (select count(*) from jsonb_object_keys(m->'eigen_fonds_A'));
end $$;

-- ── P2 + P3 — de ANDERE stand: matrix en catalogus gelijk ───────────────────
-- In CI (huidig = na) wordt de VÓÓR-stand teruggezet; in de rollbacktest
-- (huidig = voor) de NA-stand. Beide definities staan letterlijk hierboven.
do $$ begin
  if current_setting('f505.verwacht') = 'na' then
    perform pg_temp.f505_zet_voor();
  else
    perform pg_temp.f505_zet_na();
  end if;
end $$;
insert into f505_stand select 'ander', pg_temp.f505_catalogus(), pg_temp.f505_matrix();

do $$
declare
  h record;
  a record;
  d_m text;
  d_c text;
  v_voor jsonb;
begin
  select * into h from f505_stand where naam = 'huidig';
  select * into a from f505_stand where naam = 'ander';
  v_voor := case when current_setting('f505.verwacht') = 'na' then a.catalogus else h.catalogus end;
  -- De VÓÓR-catalogus moet echt de oude vorm zijn (anders vergelijkt P2 niets).
  if v_voor::text ~ 'SELECT auth\.uid\(\) AS uid' then
    raise exception 'P2 FAALT: de VÓÓR-stand draagt (select auth.uid()).';
  end if;
  d_m := pg_temp.f505_matrix_verschil(h.matrix, a.matrix);
  if d_m <> '' then
    raise exception E'LEK/REGRESSIE P2: tenanttoegang VÓÓR ≠ NA:\n%', d_m;
  end if;
  d_c := pg_temp.f505_catalogus_verschil(h.catalogus, a.catalogus);
  if d_c <> '' then
    raise exception E'P3 FAALT: catalogus verschilt meer dan de expressievorm:\n%', d_c;
  end if;
  if h.catalogus = a.catalogus then
    raise exception 'P3 FAALT: VÓÓR- en NA-catalogus zijn letterlijk gelijk — er is niets herschreven.';
  end if;
  raise notice 'P2 OK: toegangsmatrix VÓÓR = NA (8 actoren, % uitkomsten per actor).',
    (select count(*) from jsonb_object_keys(h.matrix->'eigen_fonds_A'));
  raise notice 'P3 OK: 6 policies — naam/cmd/permissive/rollen gelijk, predicaten genormaliseerd identiek.';
end $$;

-- Bewijsregel per actor in de CI-log (gelijk in beide standen, P2).
do $$
declare
  m jsonb := (select matrix from f505_stand where naam = 'huidig');
  a text;
begin
  for a in select jsonb_object_keys(m) order by 1 loop
    raise notice 'MATRIX %: docs=% chunks=% zoek=% | ins_doc A/B/G=%/%/% | ins_chunk A/B/G=%/%/% | upd_doc A/B/G=%/%/% | del_chunk A/B/G=%/%/%',
      rpad(a, 24),
      case when jsonb_typeof(m->a->'select_documenten') = 'array' then jsonb_array_length(m->a->'select_documenten')::text else m->a->>'select_documenten' end,
      case when jsonb_typeof(m->a->'select_chunks') = 'array' then jsonb_array_length(m->a->'select_chunks')::text else m->a->>'select_chunks' end,
      case when jsonb_typeof(m->a->'zoek_chunks') = 'array' then jsonb_array_length(m->a->'zoek_chunks')::text else m->a->>'zoek_chunks' end,
      m->a->>'insert_documenten_A', m->a->>'insert_documenten_B', m->a->>'insert_documenten_G',
      m->a->>'insert_chunks_A', m->a->>'insert_chunks_B', m->a->>'insert_chunks_G',
      m->a->>'update_documenten_A', m->a->>'update_documenten_B', m->a->>'update_documenten_G',
      m->a->>'delete_chunks_A', m->a->>'delete_chunks_B', m->a->>'delete_chunks_G';
  end loop;
end $$;

-- ── N — negatieve controles: elke verruiming moet rood worden ───────────────
create function pg_temp.f505_negatief(label text) returns void language plpgsql as $$
declare
  n record;
  d_m text;
  d_c text;
begin
  select * into n from f505_stand where naam = 'huidig';
  d_m := pg_temp.f505_matrix_verschil(pg_temp.f505_matrix(), n.matrix);
  d_c := pg_temp.f505_catalogus_verschil(pg_temp.f505_catalogus(), n.catalogus);
  if d_m = '' then
    raise exception 'NEGATIEVE CONTROLE FAALT (%): verruimde variant gaf een GELIJKE matrix.', label;
  end if;
  if d_c = '' then
    raise exception 'NEGATIEVE CONTROLE FAALT (%): verruimde variant gaf een GELIJKE catalogus.', label;
  end if;
  raise notice E'N OK (%): matrix en catalogus rood, o.a.\n%', label, split_part(d_m, E'\n', 1);
  perform pg_temp.f505_zet_voor();
end $$;

-- N1: de auth-eis vervalt bij het lezen van documenten → anon leest generiek.
drop policy "documenten select" on public.documenten;
create policy "documenten select" on public.documenten
  for select using (
    fonds_id = (select profielen.fonds_id from public.profielen where profielen.id = (select auth.uid()))
    or bibliotheek = 'generiek');
select pg_temp.f505_negatief('N1 anon leest generiek');

-- N2: chunks select zonder documentbinding → A leest chunks van B.
-- (Een verruiming BINNEN de subquery op documenten lekt niet: die subquery
-- valt zelf onder de documenten-leespolicy. Deze variant laat de binding los.)
drop policy "chunks select" on public.document_chunks;
create policy "chunks select" on public.document_chunks
  for select using ((select auth.uid()) is not null);
select pg_temp.f505_negatief('N2 cross-tenant chunks lezen');

-- N3: schrijfpolicy WITH CHECK laat generiek toe → A schrijft onder generiek.
drop policy "chunks write eigen fonds" on public.document_chunks;
create policy "chunks write eigen fonds" on public.document_chunks
  for all using (
    document_id in (select documenten.id from public.documenten
                     where documenten.fonds_id = (select profielen.fonds_id from public.profielen
                                                   where profielen.id = (select auth.uid()))
                       and documenten.bibliotheek = 'fonds'))
  with check (
    document_id in (select documenten.id from public.documenten
                     where (documenten.fonds_id = (select profielen.fonds_id from public.profielen
                                                    where profielen.id = (select auth.uid()))
                            and documenten.bibliotheek = 'fonds')
                        or documenten.bibliotheek = 'generiek'));
select pg_temp.f505_negatief('N3 chunk schrijven onder generiek');

do $$ begin
  raise notice '#505 tenantpariteit GROEN: P0–P3 en N1–N3.';
end $$;

rollback;
