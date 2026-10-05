-- ============================================================================
-- #548 — fn_document_chunks_vervangen onder ÉCHTE RLS en triggers.
-- ----------------------------------------------------------------------------
-- Bewijst:
--   V0  structuur: SECURITY INVOKER, functie-eigen statement_timeout (60–300 s),
--       vaste search_path; EXECUTE voor authenticated en service_role, niet anon.
--   V1  fonds A (authenticated) vervangt de chunks van een EIGEN document:
--       oude chunks weg, nieuwe erin (denormvelden gevuld door de trigger),
--       document → geindexeerd=false, verwerkingsstatus='embedding'.
--   V2  fonds A kan de chunks van fonds B NIET vervangen (42501) en ziet/raakt
--       daarbij niets; de chunks van B blijven ongewijzigd.
--   V3  fonds A kan een GENERIEK document niet vervangen (42501; generiek is
--       voor tenants read-only); service_role wel.
--   V4  atomisch: een ongeldige set (gat in chunk_index, lege tekst, ontbrekende
--       versie) wordt geweigerd (22023) en de bestaande chunkset blijft
--       volledig staan — er ontstaat nooit een gedeeltelijke set.
--   V5  anon kan de RPC niet uitvoeren.
-- NEGATIEVE CONTROLE: V2/V3 verwachten een fout; slaagt de aanroep, dan
-- 'LEK:'. V4 telt de chunks vóór en ná.
--
-- Self-seeding in één transactie met ROLLBACK — laat geen data achter.
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw, afbraak en de catalogusvragen (V0); authenticated
--      (fonds A, via request.jwt.claims) voor V1–V4, want de fonds-
--      herindexering roept de RPC met de anon-key onder RLS aan; service_role
--      voor V3b (worker/platform); anon voor V5.
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- ── V0: structuur ───────────────────────────────────────────────────────────
do $$
declare
  v_oid regprocedure := 'public.fn_document_chunks_vervangen(uuid,jsonb)'::regprocedure;
  v_cfg text[];
  v_def boolean;
  v_to  text;
  v_ms  bigint;
begin
  select proconfig, prosecdef into v_cfg, v_def from pg_proc where oid = v_oid;
  if v_def then raise exception 'LEK V0: SECURITY DEFINER; bedoeld is SECURITY INVOKER.'; end if;
  select substring(c from '^statement_timeout=(.*)$') into v_to from unnest(v_cfg) c where c like 'statement_timeout=%';
  if v_to is null then raise exception 'LEK V0: geen functie-eigen statement_timeout.'; end if;
  perform set_config('statement_timeout', v_to, true);
  v_ms := (extract(epoch from current_setting('statement_timeout')::interval) * 1000)::bigint;
  perform set_config('statement_timeout', '0', true);
  if v_ms < 60000 or v_ms >= 300000 then raise exception 'LEK V0: statement_timeout % ms buiten 60–300 s.', v_ms; end if;
  if not exists (select 1 from unnest(v_cfg) c where c like 'search_path=%') then
    raise exception 'LEK V0: search_path niet vastgezet.';
  end if;
  if has_function_privilege('anon', v_oid, 'execute') then raise exception 'LEK V0: anon heeft EXECUTE.'; end if;
  if not has_function_privilege('authenticated', v_oid, 'execute')
     or not has_function_privilege('service_role', v_oid, 'execute') then
    raise exception 'LEK V0: authenticated en service_role horen EXECUTE te hebben.';
  end if;
  raise notice 'OK V0: SECURITY INVOKER, budget % ms, search_path vast, EXECUTE authenticated+service_role.', v_ms;
end $$;

-- ── Fixture ─────────────────────────────────────────────────────────────────
insert into public.fondsen (id, naam, slug) values
  ('05480000-1111-1111-1111-111111111111', '#548 fonds A', 'f548-fonds-a'),
  ('05480000-2222-2222-2222-222222222222', '#548 fonds B', 'f548-fonds-b');

insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at) values
  ('05480000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'authenticated', 'authenticated', 'f548-a@test.local',
   '{"naam":"F548 A","fonds_id":"05480000-1111-1111-1111-111111111111"}', now(), now());

insert into public.documenten (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief, bestandstype) values
  ('05480000-0000-0000-0000-0000000000a1', '05480000-1111-1111-1111-111111111111', 'fonds', 'Intern',
   'F548 A1 beleggingsplan', 'vastgesteld', 'actief', true, 'docx'),
  ('05480000-0000-0000-0000-0000000000b1', '05480000-2222-2222-2222-222222222222', 'fonds', 'Intern',
   'F548 B1 beleggingsplan', 'vastgesteld', 'actief', true, 'pdf'),
  ('05480000-0000-0000-0000-0000000000e1', null, 'generiek', 'Extern',
   'F548 G1 amendement', 'van_kracht', 'actief', true, 'pdf');

insert into public.document_chunks (document_id, chunk_index, pagina, tekst, indexering_versie)
select d.id, i, 1, 'F548 oude tekst ' || d.titel || ' deel ' || i, 'r1-structuur-contextueel'
  from public.documenten d, generate_series(0, 2) i
 where d.id::text like '05480000-0000-0000-0000-0000000000%';

create function pg_temp.f548_set(n int) returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object(
    'chunk_index', i, 'tekst', 'Artikel ' || i || '. Nieuwe tekst', 'pagina', i + 1,
    'paragraaf', null, 'structuur_type', 'artikel', 'structuur_label', 'Artikel ' || i,
    'context_prefix', null, 'prefix_model', null, 'indexering_versie', 'r2-bronblokken'))
  from generate_series(0, n - 1) i
$$;

-- Fonds A als authenticated.
select set_config('request.jwt.claims',
  '{"sub":"05480000-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);

-- ── V1: eigen fondsdocument ────────────────────────────────────────────────
do $$
declare v_n int;
begin
  v_n := public.fn_document_chunks_vervangen('05480000-0000-0000-0000-0000000000a1', pg_temp.f548_set(4));
  if v_n <> 4 then raise exception 'LEK V1: % chunks ingevoegd, verwacht 4.', v_n; end if;
  if (select count(*) from public.document_chunks where document_id = '05480000-0000-0000-0000-0000000000a1') <> 4
     or exists (select 1 from public.document_chunks
                 where document_id = '05480000-0000-0000-0000-0000000000a1'
                   and (indexering_versie <> 'r2-bronblokken' or bibliotheek <> 'fonds' or documentstatus <> 'vastgesteld')) then
    raise exception 'LEK V1: chunkset of denormvelden kloppen niet na vervanging.';
  end if;
  if exists (select 1 from public.documenten
              where id = '05480000-0000-0000-0000-0000000000a1'
                and (geindexeerd is distinct from false or verwerkingsstatus is distinct from 'embedding')) then
    raise exception 'LEK V1: document niet als in verwerking gemarkeerd.';
  end if;
  raise notice 'OK V1: eigen fondsdocument atomisch vervangen (4 chunks, denorm gevuld, status embedding).';
end $$;

-- ── V2: document van fonds B ───────────────────────────────────────────────
do $$
begin
  begin
    perform public.fn_document_chunks_vervangen('05480000-0000-0000-0000-0000000000b1', pg_temp.f548_set(2));
    raise exception 'LEK V2: fonds A vervangt chunks van fonds B.';
  exception when insufficient_privilege then
    raise notice 'OK V2: fonds B geweigerd (42501).';
  end;
end $$;

-- ── V3: generiek document als tenant ───────────────────────────────────────
do $$
begin
  begin
    perform public.fn_document_chunks_vervangen('05480000-0000-0000-0000-0000000000e1', pg_temp.f548_set(2));
    raise exception 'LEK V3: tenant vervangt chunks van een generiek document.';
  exception when insufficient_privilege then
    raise notice 'OK V3: generiek document voor tenant geweigerd (42501).';
  end;
end $$;

-- ── V4: atomisch bij een ongeldige set ─────────────────────────────────────
do $$
declare v_voor int; v_na int;
begin
  select count(*) into v_voor from public.document_chunks where document_id = '05480000-0000-0000-0000-0000000000a1';
  foreach v_na in array array[1, 2, 3] loop
    begin
      perform public.fn_document_chunks_vervangen('05480000-0000-0000-0000-0000000000a1',
        case v_na
          when 1 then pg_temp.f548_set(3) - 1   -- gat: index 0 en 2
          when 2 then jsonb_set(pg_temp.f548_set(2), '{0,tekst}', '""')
          else jsonb_set(pg_temp.f548_set(2), '{1,indexering_versie}', 'null')
        end);
      raise exception 'LEK V4: ongeldige set % geaccepteerd.', v_na;
    exception when invalid_parameter_value then
      null;
    end;
  end loop;
  select count(*) into v_na from public.document_chunks where document_id = '05480000-0000-0000-0000-0000000000a1';
  if v_na <> v_voor then raise exception 'LEK V4: chunkset gewijzigd door een geweigerde vervanging (% → %).', v_voor, v_na; end if;
  raise notice 'OK V4: drie ongeldige sets geweigerd (22023), chunkset ongewijzigd (%).', v_na;
end $$;

-- ── V3b: service_role mag generiek vervangen ───────────────────────────────
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('role', 'service_role', true);
do $$
declare v_n int;
begin
  v_n := public.fn_document_chunks_vervangen('05480000-0000-0000-0000-0000000000e1', pg_temp.f548_set(2));
  if v_n <> 2 or (select count(*) from public.document_chunks
                   where document_id = '05480000-0000-0000-0000-0000000000e1' and bibliotheek = 'generiek') <> 2 then
    raise exception 'LEK V3b: service_role kon het generieke document niet vervangen.';
  end if;
  if (select count(*) from public.document_chunks where document_id = '05480000-0000-0000-0000-0000000000b1') <> 3 then
    raise exception 'LEK V2b: chunks van fonds B zijn veranderd.';
  end if;
  raise notice 'OK V3b: service_role vervangt generiek; fonds B onaangeroerd.';
end $$;

-- ── V5: anon ────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('role', 'anon', true);
do $$
begin
  begin
    perform public.fn_document_chunks_vervangen('05480000-0000-0000-0000-0000000000a1', pg_temp.f548_set(1));
    raise exception 'LEK V5: anon voert de RPC uit.';
  exception when insufficient_privilege then
    raise notice 'OK V5: anon geweigerd.';
  end;
end $$;

select set_config('role', 'postgres', true);
rollback;
