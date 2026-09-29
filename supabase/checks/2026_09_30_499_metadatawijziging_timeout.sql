-- ============================================================================
-- #499 — generieke metadatawijziging op een document met ≥ 1.000 chunks.
-- ----------------------------------------------------------------------------
-- Doel: bewijzen, onder de ÉCHTE triggers en indexen (HNSW op embedding
-- vector(1024), GIN op zoek_vector, de btree-denorm-indexen), dat
--   M0  de RPC fn_platform_generiek_document_bijwerken een functie-eigen
--       statement_timeout draagt (door PostgREST gehesen; ruim boven de 8 s van
--       authenticator en onder maxDuration 300 s), SECURITY INVOKER is, alleen
--       door service_role uitvoerbaar is, en dat trg_chunk_denorm_refresh een
--       WHEN-clausule heeft;
--   M1  de productiewijziging (Pensioenwet: documenttype null→wetgeving,
--       wettelijk_regime null→pw, extern_url, geldig_vanaf) op 1.000 chunks
--       slaagt, ruim binnen het budget, met document- én chunkmetadata
--       consistent en precies één auditregel per gewijzigd veld;
--   M2  een wijziging zonder denorm-effect (niet-denormveld, of een denormveld
--       met dezelfde waarde) GEEN chunk herschrijft, en een echte wijziging
--       alleen de afwijkende chunks (M2b) — met NEGATIEVE CONTROLE:
--       met de oude trigger/functie (zonder WHEN en zonder IS DISTINCT FROM)
--       gaat dezelfde meting rood;
--   M3  een time-out (57014) midden in de chunk-denorm alles terugrolt:
--       document, chunks én auditregels (geen gedeeltelijke update);
--   M4  een ongeldige statusovergang P0001 geeft met de vaste melding
--       'statusovergang' (het contract met platform/lib/generiek-mutatie-fout.ts)
--       en niets wijzigt of logt;
--   M5  de RPC fonds-/onbekende documenten, niet-bewerkbare velden en een
--       auditset die de wijziging niet dekt weigert;
--   M6  authenticated en anon de RPC niet kunnen uitvoeren.
--
-- Timing: M1 meet de duur en eist < 30 s (¼ van het RPC-budget van 120 s). Op
-- een ontwikkellaptop kost M1 ~1,4 s; in productie (Pensioenwet, 968 chunks)
-- liep hetzelfde werk over de 8 s van de oude tabel-PATCH. De absolute
-- productieduur is lokaal niet te reproduceren zonder de rekenkracht te knijpen
-- (0,25 vCPU: 11–14 s) — zie de handover §#499 voor de meetreeks.
--
-- Self-seeding in één transactie met ROLLBACK — laat geen data achter.
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw, afbraak en de structurele catalogusvragen;
--      service_role voor M1–M5, want dat is de rol waarmee de platform-client
--      (withPlatform → createPlatformSupabase) de RPC via PostgREST aanroept;
--      authenticated en anon voor M6 (de weigering moet onder die rollen gelden).
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- ── M0: structuur ───────────────────────────────────────────────────────────
do $$
declare
  v_oid    regprocedure := 'public.fn_platform_generiek_document_bijwerken(uuid,jsonb,jsonb,uuid,text,text)'::regprocedure;
  v_cfg    text[];
  v_to     text;
  v_ms     bigint;
  v_def    boolean;
  v_qual   text;
begin
  select proconfig, prosecdef into v_cfg, v_def from pg_proc where oid = v_oid;
  select substring(c from '^statement_timeout=(.*)$') into v_to
    from unnest(v_cfg) c where c like 'statement_timeout=%';
  if v_to is null then
    raise exception 'LEK M0: RPC zonder functie-eigen statement_timeout — PostgREST hijst dan niets en de 8 s van authenticator geldt weer.';
  end if;
  -- Normaliseer via set_config: dezelfde GUC-parser als Postgres (ook voor een
  -- waarde zonder eenheid = ms). current_setting geeft bv. '2min' terug.
  perform set_config('statement_timeout', v_to, true);
  v_ms := (extract(epoch from current_setting('statement_timeout')::interval) * 1000)::bigint;
  perform set_config('statement_timeout', '0', true);
  if v_ms < 60000 or v_ms >= 300000 then
    raise exception 'LEK M0: statement_timeout van de RPC (% ms) moet ≥ 60 s en < 300 s (maxDuration curatiepagina) zijn.', v_ms;
  end if;
  if v_def then
    raise exception 'LEK M0: RPC is SECURITY DEFINER; bedoeld is SECURITY INVOKER (service_role).';
  end if;
  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('authenticated', v_oid, 'execute')
     or not has_function_privilege('service_role', v_oid, 'execute') then
    raise exception 'LEK M0: EXECUTE op de RPC hoort alleen bij service_role.';
  end if;
  -- tgqual verwijst naar OLD én NEW; pg_get_expr kan dat niet renderen, de
  -- volledige triggerdefinitie wel.
  select case when t.tgqual is not null then pg_get_triggerdef(t.oid) end into v_qual
    from pg_trigger t
   where t.tgrelid = 'public.documenten'::regclass
     and t.tgname = 'trg_chunk_denorm_refresh';
  if v_qual is null then
    raise exception 'LEK M0: trg_chunk_denorm_refresh zonder WHEN-clausule — vuurt ook bij een no-op-update.';
  end if;
  raise notice 'OK M0: RPC-budget % ms, SECURITY INVOKER, alleen service_role; trigger met WHEN.', v_ms;
end $$;

-- ── Seed: generiek document met 1.000 chunks + achtergrond in de HNSW-graaf ─
create or replace function pg_temp.rvec() returns vector
language sql volatile as
$$ select array_agg(random()::real - 0.5)::vector from generate_series(1, 1024) $$;

create or replace function pg_temp.rtekst(n int) returns text
language sql volatile as $$
  select string_agg((array['pensioenfonds','deelnemer','aanspraak','werkgever',
    'artikel','lid','toeslagverlening','dekkingsgraad','herstelplan','bestuur',
    'premie','beleggingsbeleid','ouderdomspensioen','waardeoverdracht','De',
    'Nederlandsche','Bank','toezicht','bepalingen','overeenkomstig','wordt',
    'regels','gesteld','onverminderd','pensioenuitvoerder','informatie'])
    [1 + floor(random() * 26)::int], ' ')
  from generate_series(1, n) $$;

insert into public.documenten
  (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief, normgewicht)
values
  ('0a4990cc-0000-0000-0000-000000000001', null, 'generiek', 'Extern',
   'Pensioenwet (regressietest #499)', 'van_kracht', 'actief', true, 'bindend'),
  ('0a4990cc-0000-0000-0000-000000000002', null, 'generiek', 'Extern',
   'Achtergrond HNSW-graaf (#499)', 'van_kracht', 'actief', true, 'informatief');

insert into public.document_chunks
  (document_id, chunk_index, tekst, context_prefix, embedding, embedding_model)
select '0a4990cc-0000-0000-0000-000000000001', c, pg_temp.rtekst(110),
       pg_temp.rtekst(30), pg_temp.rvec(), 'regressietest-499'
  from generate_series(0, 999) c;
insert into public.document_chunks
  (document_id, chunk_index, tekst, context_prefix, embedding, embedding_model)
select '0a4990cc-0000-0000-0000-000000000002', c, pg_temp.rtekst(110),
       pg_temp.rtekst(30), pg_temp.rvec(), 'regressietest-499'
  from generate_series(0, 499) c;

do $$
declare n int;
begin
  select count(*) into n from public.document_chunks
   where document_id = '0a4990cc-0000-0000-0000-000000000001'
     and embedding is not null and documenttype is null and wettelijk_regime is null;
  if n <> 1000 then
    raise exception 'OPBOUW M: verwacht 1.000 chunks zonder documenttype/regime, kreeg %', n;
  end if;
end $$;

-- Hulp: chunk-ctid's als vingerafdruk. Een herschreven chunk krijgt een nieuwe
-- tuple (ctid), ook als hij op dezelfde pagina belandt.
create temp table m499_ctid_voor(ctid_tekst text) on commit drop;
create or replace function pg_temp.chunks_herschreven() returns int
language sql as $$
  select count(*)::int from public.document_chunks dc
   where dc.document_id = '0a4990cc-0000-0000-0000-000000000001'
     and dc.ctid::text not in (select ctid_tekst from m499_ctid_voor) $$;
create or replace function pg_temp.leg_ctid_vast() returns void
language sql as $$
  delete from m499_ctid_voor;
  insert into m499_ctid_voor
    select ctid::text from public.document_chunks
     where document_id = '0a4990cc-0000-0000-0000-000000000001' $$;
grant all on m499_ctid_voor to service_role;

-- ── M1 (kern): de productiewijziging op 1.000 chunks ────────────────────────
set local role service_role;
do $$
declare
  t0 timestamptz := clock_timestamp();
  v_ms numeric;
  v_log int;
begin
  v_log := public.fn_platform_generiek_document_bijwerken(
    '0a4990cc-0000-0000-0000-000000000001',
    jsonb_build_object(
      'documenttype', 'wetgeving',
      'wettelijk_regime', 'pw',
      'extern_url', 'https://wetten.overheid.nl/BWBR0020809',
      'geldig_vanaf', '2026-07-01'),
    jsonb_build_array(
      jsonb_build_object('veld_naam','documenttype','oude_waarde',null,'nieuwe_waarde','wetgeving','wijzig_type','metadata','rag_impact',true),
      jsonb_build_object('veld_naam','wettelijk_regime','oude_waarde',null,'nieuwe_waarde','pw','wijzig_type','metadata','rag_impact',true),
      jsonb_build_object('veld_naam','extern_url','oude_waarde',null,'nieuwe_waarde','https://wetten.overheid.nl/BWBR0020809','wijzig_type','metadata','rag_impact',true),
      jsonb_build_object('veld_naam','geldig_vanaf','oude_waarde',null,'nieuwe_waarde','2026-07-01','wijzig_type','metadata','rag_impact',true)),
    null, 'regressietest #499', 'Pensioenwet als actuele normbron');
  v_ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if v_log <> 4 then
    raise exception 'LEK M1: verwacht 4 auditregels, RPC schreef er %', v_log;
  end if;
  if v_ms >= 30000 then
    raise exception 'LEK M1: wijziging op 1.000 chunks duurde % ms (≥ 30 s = ¼ van het RPC-budget).', round(v_ms);
  end if;
  raise notice 'OK M1a: 1.000-chunk-wijziging in % ms (budget RPC 120 s; oude PATCH-grens 8 s).', round(v_ms);
end $$;
reset role;

do $$
declare n_fout int; n_log int; v_titel text;
begin
  -- Document en ALLE chunks consistent (fn_chunk_denorm is de bron).
  select count(*) into n_fout
    from public.document_chunks dc
    cross join lateral public.fn_chunk_denorm(dc.document_id) v
   where dc.document_id = '0a4990cc-0000-0000-0000-000000000001'
     and (dc.documenttype, dc.wettelijk_regime, dc.extern_url, dc.geldig_vanaf,
          dc.bronstatus, dc.documentstatus)
         is distinct from
         (v.documenttype, v.wettelijk_regime, v.extern_url, v.geldig_vanaf,
          v.bronstatus, v.documentstatus);
  if n_fout <> 0 then
    raise exception 'LEK M1: % chunk(s) niet consistent met het document.', n_fout;
  end if;
  select count(*) into n_fout from public.document_chunks
   where document_id = '0a4990cc-0000-0000-0000-000000000001'
     and (documenttype is distinct from 'wetgeving' or wettelijk_regime is distinct from 'pw');
  if n_fout <> 0 then
    raise exception 'LEK M1: % chunk(s) zonder wetgeving/pw.', n_fout;
  end if;
  select count(*), min(document_titel_snapshot) into n_log, v_titel
    from public.document_metadata_log
   where document_id = '0a4990cc-0000-0000-0000-000000000001'
     and fonds_id is null and rag_impact
     and wijzig_reden = 'Pensioenwet als actuele normbron'
     and veld_naam in ('documenttype','wettelijk_regime','extern_url','geldig_vanaf');
  if n_log <> 4 or v_titel is distinct from 'Pensioenwet (regressietest #499)' then
    raise exception 'LEK M1: auditregels onjuist (aantal %, titel %).', n_log, v_titel;
  end if;
  raise notice 'OK M1b: document en 1.000 chunks consistent (wetgeving/pw); 4 auditregels met reden en titel.';
end $$;

-- ── M2: geen chunk-herschrijving zonder denorm-effect (+ negatieve controle) ─
select pg_temp.leg_ctid_vast();

set local role service_role;
select public.fn_platform_generiek_document_bijwerken(
  '0a4990cc-0000-0000-0000-000000000001',
  '{"eigenaar":"Team Juridisch"}'::jsonb,
  '[{"veld_naam":"eigenaar","oude_waarde":null,"nieuwe_waarde":"Team Juridisch","wijzig_type":"metadata","rag_impact":false}]'::jsonb,
  null, 'regressietest #499', null);
-- Denormkolom in de SET-lijst, maar met dezelfde waarde.
update public.documenten set documenttype = 'wetgeving', wettelijk_regime = 'pw'
 where id = '0a4990cc-0000-0000-0000-000000000001';
reset role;

do $$
declare n int := pg_temp.chunks_herschreven();
begin
  if n <> 0 then
    raise exception 'LEK M2: % chunk(s) herschreven bij een wijziging zonder denorm-effect (elk kost een HNSW-element).', n;
  end if;
  raise notice 'OK M2: niet-denormveld en gelijke denormwaarde herschrijven 0 van 1.000 chunks.';
end $$;

-- M2b: bij een échte wijziging herschrijft de functie alleen chunks die
-- afwijken (IS DISTINCT FROM). Simuleer 500 chunks die al kloppen (bv. na een
-- eerdere, deels doorgewerkte correctie) — alleen de andere 500 mogen nieuw.
savepoint m2b;
update public.document_chunks set wettelijk_regime = 'wvb'
 where document_id = '0a4990cc-0000-0000-0000-000000000001' and chunk_index < 500;
select pg_temp.leg_ctid_vast();
set local role service_role;
select public.fn_platform_generiek_document_bijwerken(
  '0a4990cc-0000-0000-0000-000000000001',
  '{"wettelijk_regime":"wvb"}'::jsonb,
  '[{"veld_naam":"wettelijk_regime","oude_waarde":"pw","nieuwe_waarde":"wvb","wijzig_type":"metadata","rag_impact":true}]'::jsonb,
  null, 'regressietest #499', null);
reset role;
do $$
declare n int := pg_temp.chunks_herschreven(); n_wvb int;
begin
  select count(*) into n_wvb from public.document_chunks
   where document_id = '0a4990cc-0000-0000-0000-000000000001' and wettelijk_regime = 'wvb';
  if n <> 500 or n_wvb <> 1000 then
    raise exception 'LEK M2b: % chunk(s) herschreven (verwacht 500), % op wvb (verwacht 1.000).', n, n_wvb;
  end if;
  raise notice 'OK M2b: echte wijziging herschrijft alleen de 500 afwijkende chunks; alle 1.000 consistent.';
end $$;
rollback to savepoint m2b;

-- Negatieve controle: met de OUDE trigger + functie (2026_08_12_t4_regime_borging,
-- zonder WHEN en zonder IS DISTINCT FROM) moet dezelfde meting rood zijn.
savepoint m2_negatief;
create or replace function public.fn_chunk_denorm_refresh()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  update public.document_chunks dc
     set procesmodel_id = v.procesmodel_id, procesinstantie_id = v.procesinstantie_id,
         vergadering_id = v.vergadering_id, agendapunt_id = v.agendapunt_id,
         documenttype = v.documenttype, documentstatus = v.documentstatus,
         documentdatum = v.documentdatum, periode = v.periode, bronstatus = v.bronstatus,
         geldig_vanaf = v.geldig_vanaf, geldig_tot = v.geldig_tot, bibliotheek = v.bibliotheek,
         bronorganisatie = v.bronorganisatie, normgewicht = v.normgewicht,
         extern_url = v.extern_url, wettelijk_regime = v.wettelijk_regime
    from public.fn_chunk_denorm(new.id) v
   where dc.document_id = new.id;
  return new;
end $$;
drop trigger trg_chunk_denorm_refresh on public.documenten;
create trigger trg_chunk_denorm_refresh
  after update of procesinstantie_id, vergadering_id, agendapunt_id, documenttype,
                  status, bronstatus, documentdatum, geldig_vanaf, geldig_tot,
                  bibliotheek, bronorganisatie, normgewicht, extern_url, wettelijk_regime
  on public.documenten for each row execute procedure public.fn_chunk_denorm_refresh();
select pg_temp.leg_ctid_vast();
update public.documenten set documenttype = 'wetgeving', wettelijk_regime = 'pw'
 where id = '0a4990cc-0000-0000-0000-000000000001';
do $$
declare n int := pg_temp.chunks_herschreven();
begin
  if n <> 1000 then
    raise exception 'NEGATIEVE CONTROLE M2 FAALT: oude trigger herschreef % i.p.v. 1.000 chunks — de meting onderscheidt oud van nieuw niet.', n;
  end if;
  raise notice 'OK M2-neg: oude trigger herschrijft alle 1.000 chunks bij een no-op → M2 zou rood zijn.';
end $$;
rollback to savepoint m2_negatief;

-- ── M3: time-out midden in de denorm → volledige rollback ───────────────────
-- De timer hoort bij het BUITENSTE statement en wordt bij de start ervan gezet;
-- de functie-eigen SET van de RPC verlengt een lopend statement niet — precies
-- waarom PostgREST de waarde vóór het statement hijst. Daarom hier een SET
-- LOCAL vóór het DO-blok.
select set_config('m499.log_voor', count(*)::text, true) from public.document_metadata_log
 where document_id = '0a4990cc-0000-0000-0000-000000000001';
set local statement_timeout = '150ms';
do $$
begin
  perform public.fn_platform_generiek_document_bijwerken(
    '0a4990cc-0000-0000-0000-000000000001',
    '{"wettelijk_regime":"wvb"}'::jsonb,
    '[{"veld_naam":"wettelijk_regime","oude_waarde":"pw","nieuwe_waarde":"wvb","wijzig_type":"metadata","rag_impact":true}]'::jsonb,
    null, 'regressietest #499', 'time-outproef');
  raise exception 'OPBOUW M3: geen time-out opgetreden — verlaag de grens of vergroot de seed.';
exception when query_canceled then
  raise notice 'M3: 57014 opgetreden zoals bedoeld.';
end $$;
set local statement_timeout = 0;
do $$
declare v_regime text; n_pw int; n_log_na int;
begin
  select wettelijk_regime into v_regime from public.documenten
   where id = '0a4990cc-0000-0000-0000-000000000001';
  select count(*) into n_pw from public.document_chunks
   where document_id = '0a4990cc-0000-0000-0000-000000000001' and wettelijk_regime = 'pw';
  select count(*) into n_log_na from public.document_metadata_log
   where document_id = '0a4990cc-0000-0000-0000-000000000001';
  if v_regime is distinct from 'pw' or n_pw <> 1000 or n_log_na <> current_setting('m499.log_voor')::int then
    raise exception 'LEK M3: gedeeltelijke update na time-out (document %, chunks pw %, auditregels % → %).',
      v_regime, n_pw, current_setting('m499.log_voor'), n_log_na;
  end if;
  raise notice 'OK M3: time-out (57014) rolt document, 1.000 chunks en auditregels volledig terug.';
end $$;

-- ── M4: ongeldige statusovergang → P0001 'statusovergang', niets gewijzigd ──
set local role service_role;
-- published → withdrawn (toegestaan) …
select public.fn_platform_generiek_document_bijwerken(
  '0a4990cc-0000-0000-0000-000000000002',
  '{"bronstatus":"uitgesloten"}'::jsonb,
  '[{"veld_naam":"bronstatus","oude_waarde":"actief","nieuwe_waarde":"uitgesloten","wijzig_type":"bronstatus","rag_impact":true}]'::jsonb,
  null, 'regressietest #499', 'intrekken');
do $$
declare v_state text; v_msg text; n_log int; n_chunks int;
begin
  -- … en withdrawn → published (niet toegestaan, T10).
  begin
    perform public.fn_platform_generiek_document_bijwerken(
      '0a4990cc-0000-0000-0000-000000000002',
      '{"bronstatus":"actief"}'::jsonb,
      '[{"veld_naam":"bronstatus","oude_waarde":"uitgesloten","nieuwe_waarde":"actief","wijzig_type":"bronstatus","rag_impact":true}]'::jsonb,
      null, 'regressietest #499', 'herstel');
    raise exception 'LEK M4: withdrawn → published aanvaard.';
  exception when raise_exception then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_msg like 'LEK M4:%' then raise; end if;
  end;
  if v_state <> 'P0001' or v_msg !~* 'statusovergang' then
    raise exception 'LEK M4: contract met generiek-mutatie-fout.ts gebroken (sqlstate %, melding zonder "statusovergang").', v_state;
  end if;
  select count(*) into n_log from public.document_metadata_log
   where document_id = '0a4990cc-0000-0000-0000-000000000002' and wijzig_reden = 'herstel';
  select count(*) into n_chunks from public.document_chunks
   where document_id = '0a4990cc-0000-0000-0000-000000000002' and bronstatus is distinct from 'uitgesloten';
  if n_log <> 0 or n_chunks <> 0 then
    raise exception 'LEK M4: geweigerde overgang liet sporen na (auditregels %, chunks niet-uitgesloten %).', n_log, n_chunks;
  end if;
  raise notice 'OK M4: ongeldige statusovergang → P0001 met "statusovergang"; geen auditregel, chunks ongemoeid.';
end $$;

-- ── M5: invoergrenzen van de RPC ────────────────────────────────────────────
do $$
declare v_state text;
begin
  -- Niet-bewerkbaar veld (fonds_id) → 22023.
  begin
    perform public.fn_platform_generiek_document_bijwerken(
      '0a4990cc-0000-0000-0000-000000000001', '{"fonds_id":null}'::jsonb,
      '[{"veld_naam":"fonds_id","wijzig_type":"metadata","rag_impact":false}]'::jsonb,
      null, 'x', null);
    raise exception 'LEK M5: niet-bewerkbaar veld fonds_id aanvaard.';
  exception when invalid_parameter_value then null;
  end;
  -- Auditregels dekken de wijziging niet → 22023 (geen ongelogde wijziging).
  begin
    perform public.fn_platform_generiek_document_bijwerken(
      '0a4990cc-0000-0000-0000-000000000001', '{"thema":"x","versie":"2"}'::jsonb,
      '[{"veld_naam":"thema","wijzig_type":"metadata","rag_impact":false}]'::jsonb,
      null, 'x', null);
    raise exception 'LEK M5: wijziging zonder volledige auditset aanvaard.';
  exception when invalid_parameter_value then null;
  end;
  -- Onbekend document → P0002.
  begin
    perform public.fn_platform_generiek_document_bijwerken(
      '0a4990cc-0000-0000-0000-0000000000ff', '{"thema":"x"}'::jsonb,
      '[{"veld_naam":"thema","wijzig_type":"metadata","rag_impact":false}]'::jsonb,
      null, 'x', null);
    raise exception 'LEK M5: onbekend document aanvaard.';
  exception when no_data_found then null;
  end;
  raise notice 'OK M5: niet-bewerkbaar veld, onvolledige auditset en onbekend document geweigerd.';
end $$;
reset role;

-- Fondsdocument → P0002 (de RPC is uitsluitend voor generieke content).
insert into public.fondsen (id, naam, slug)
values ('0a4990cc-0000-0000-0000-0000000000f0', 'Fonds #499', 'fonds-499');
insert into public.documenten (id, fonds_id, bibliotheek, bron, titel)
values ('0a4990cc-0000-0000-0000-0000000000f1', '0a4990cc-0000-0000-0000-0000000000f0',
        'fonds', 'Intern', 'Fondsdocument #499');
set local role service_role;
do $$
begin
  begin
    perform public.fn_platform_generiek_document_bijwerken(
      '0a4990cc-0000-0000-0000-0000000000f1', '{"thema":"x"}'::jsonb,
      '[{"veld_naam":"thema","wijzig_type":"metadata","rag_impact":false}]'::jsonb,
      null, 'x', null);
    raise exception 'LEK M5: fondsdocument via de generieke RPC gewijzigd.';
  exception when no_data_found then null;
  end;
  raise notice 'OK M5b: fondsdocument geweigerd (P0002).';
end $$;
reset role;

-- ── M6: authenticated/anon kunnen de RPC niet uitvoeren ─────────────────────
do $$
declare r text;
begin
  foreach r in array array['authenticated','anon'] loop
    execute format('set local role %I', r);
    begin
      perform public.fn_platform_generiek_document_bijwerken(
        '0a4990cc-0000-0000-0000-000000000001', '{"thema":"x"}'::jsonb,
        '[{"veld_naam":"thema","wijzig_type":"metadata","rag_impact":false}]'::jsonb,
        null, 'x', null);
      raise exception 'LEK M6: % kon de RPC uitvoeren.', r;
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;
  raise notice 'OK M6: authenticated en anon geweigerd (42501).';
end $$;

rollback;
