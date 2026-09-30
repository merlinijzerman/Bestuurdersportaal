-- ============================================================================
-- #504 — datumvelden in de generieke curatie (documentdatum, geldig_vanaf,
-- volgende_review) via de #499-RPC, onder de ÉCHTE triggers en indexen.
-- ----------------------------------------------------------------------------
-- Productie (Pensioenwet, 968 chunks, 29-09-2026): de drie datums stonden
-- zichtbaar in de beheer-UI maar kwamen leeg in de serveractie aan ("Geen
-- wijzigingen."). De oorzaak zat in de client (zie PR / handover §6c); deze
-- check bewijst dat de DB-kant het payload dat de app nu verstuurt — exact de
-- vorm van bouwCuratieDiff (platform/lib/generiek-curatie-diff.ts) — correct en
-- atomisch verwerkt, voor een klein document én voor 1.000 chunks:
--   D0  de §8.1-allowlist van de RPC bevat de drie datumvelden; documenten-
--       kolommen zijn `date`; de denorm-trigger dekt documentdatum en
--       geldig_vanaf; document_chunks heeft GEEN volgende_review (documentmeta).
--   D1  klein document (3 chunks): drie datums in één RPC-aanroep → document
--       gezet (als date), alle chunks documentdatum/geldig_vanaf gelijk, precies
--       drie auditregels met actor (id + naam), reden en rag_impact.
--   D2  idem op 1.000 chunks (HNSW/GIN actief), binnen budget.
--   D3  tweede opslag met identieke waarden herschrijft 0 chunks (de app stuurt
--       dan niets; ook een gelijke waarde via de trigger-WHEN kost niets).
--   D4  leegmaken (null) is toegestaan: document + alle chunks → NULL, audit
--       oud → null.
--   D5  ongeldige datum → fout (22007/22008) en volledige rollback, geen audit.
--   D6  NEGATIEVE CONTROLE: zonder de denorm-trigger zou D2 rood zijn (de
--       chunkconsistentiecheck onderscheidt dus wél/niet gekopieerd).
--
-- Self-seeding in één transactie met ROLLBACK — laat geen data achter.
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw, afbraak, catalogusvragen en de controles achteraf;
--      service_role voor D1–D5, want dat is de rol waarmee de platform-client
--      (withPlatform → createPlatformSupabase) de RPC via PostgREST aanroept.
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- ── D0: structuur ───────────────────────────────────────────────────────────
do $$
declare
  v_src  text;
  v_trig text;
  n      int;
begin
  select prosrc into v_src from pg_proc
   where oid = 'public.fn_platform_generiek_document_bijwerken(uuid,jsonb,jsonb,uuid,text,text)'::regprocedure;
  if v_src !~ '''documentdatum''' or v_src !~ '''geldig_vanaf''' or v_src !~ '''volgende_review''' then
    raise exception 'LEK D0: §8.1-allowlist van de RPC mist een datumveld.';
  end if;
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'documenten'
     and column_name in ('documentdatum','geldig_vanaf','volgende_review') and data_type = 'date';
  if n <> 3 then
    raise exception 'LEK D0: verwacht 3 date-kolommen op documenten, kreeg %.', n;
  end if;
  select pg_get_triggerdef(t.oid) into v_trig from pg_trigger t
   where t.tgrelid = 'public.documenten'::regclass and t.tgname = 'trg_chunk_denorm_refresh';
  if v_trig !~* 'update of .*documentdatum' or v_trig !~* 'update of .*geldig_vanaf' then
    raise exception 'LEK D0: trg_chunk_denorm_refresh dekt documentdatum/geldig_vanaf niet: %', v_trig;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'document_chunks'
                and column_name = 'volgende_review') then
    raise exception 'D0: document_chunks kreeg een volgende_review-kolom — herzie het #504-contract (documentmetadata).';
  end if;
  raise notice 'OK D0: allowlist bevat de datumvelden; date-kolommen; trigger dekt documentdatum/geldig_vanaf; volgende_review is documentmetadata.';
end $$;

-- ── Seed: klein document (3 chunks) + groot document (1.000 chunks) ─────────
create or replace function pg_temp.rvec() returns vector
language sql volatile as
$$ select array_agg(random()::real - 0.5)::vector from generate_series(1, 1024) $$;

-- Curator (platform-identiteit = auth.users-id; FK van document_metadata_log).
insert into auth.users (id, instance_id, aud, role, email)
values ('0a5040cc-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'curator-504@example.test');

insert into public.documenten
  (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief, normgewicht,
   documenttype, wettelijk_regime, extern_url)
values
  ('0a5040cc-0000-0000-0000-000000000001', null, 'generiek', 'Extern',
   'Klein wetgevingsdocument (#504)', 'van_kracht', 'actief', true, 'bindend',
   'wetgeving', 'pw', 'https://wetten.overheid.nl/BWBR0020809'),
  ('0a5040cc-0000-0000-0000-000000000002', null, 'generiek', 'Extern',
   'Pensioenwet (regressietest #504)', 'van_kracht', 'actief', true, 'bindend',
   'wetgeving', 'pw', 'https://wetten.overheid.nl/BWBR0020809');

insert into public.document_chunks
  (document_id, chunk_index, tekst, embedding, embedding_model)
select '0a5040cc-0000-0000-0000-000000000001', c, 'Artikel ' || c || ' klein document',
       pg_temp.rvec(), 'regressietest-504'
  from generate_series(0, 2) c;
insert into public.document_chunks
  (document_id, chunk_index, tekst, embedding, embedding_model)
select '0a5040cc-0000-0000-0000-000000000002', c,
       'Artikel ' || c || ' pensioenuitvoerder deelnemer aanspraak toezicht',
       pg_temp.rvec(), 'regressietest-504'
  from generate_series(0, 999) c;

do $$
declare n int;
begin
  select count(*) into n from public.document_chunks
   where document_id in ('0a5040cc-0000-0000-0000-000000000001','0a5040cc-0000-0000-0000-000000000002')
     and documentdatum is null and geldig_vanaf is null;
  if n <> 1003 then
    raise exception 'OPBOUW D: verwacht 1.003 chunks zonder datums, kreeg %', n;
  end if;
end $$;

-- Hulp: exact het payload dat curatieBijwerken nu stuurt voor de drie datums.
create or replace function pg_temp.datums_zetten(p_doc uuid, p_reden text) returns int
language sql as $$
  select public.fn_platform_generiek_document_bijwerken(
    p_doc,
    '{"documentdatum":"2026-01-01","geldig_vanaf":"2026-01-01","volgende_review":"2026-12-15"}'::jsonb,
    '[{"veld_naam":"documentdatum","oude_waarde":null,"nieuwe_waarde":"2026-01-01","wijzig_type":"metadata","rag_impact":true},
      {"veld_naam":"geldig_vanaf","oude_waarde":null,"nieuwe_waarde":"2026-01-01","wijzig_type":"metadata","rag_impact":true},
      {"veld_naam":"volgende_review","oude_waarde":null,"nieuwe_waarde":"2026-12-15","wijzig_type":"metadata","rag_impact":true}]'::jsonb,
    '0a5040cc-0000-0000-0000-0000000000aa'::uuid, 'Curator #504', p_reden) $$;

-- Hulp: controleer document + chunks + audit na de datumwijziging.
create or replace function pg_temp.controleer_gezet(p_doc uuid, p_chunks int, p_reden text, p_label text)
returns void language plpgsql as $$
declare d record; n_ok int; n_log int;
begin
  select documentdatum, geldig_vanaf, volgende_review into d from public.documenten where id = p_doc;
  if d.documentdatum is distinct from date '2026-01-01'
     or d.geldig_vanaf is distinct from date '2026-01-01'
     or d.volgende_review is distinct from date '2026-12-15' then
    raise exception 'LEK %: document niet (juist) gezet: %', p_label, d;
  end if;
  select count(*) into n_ok from public.document_chunks
   where document_id = p_doc
     and documentdatum = date '2026-01-01' and geldig_vanaf = date '2026-01-01';
  if n_ok <> p_chunks then
    raise exception 'LEK %: % van % chunks met documentdatum/geldig_vanaf 2026-01-01.', p_label, n_ok, p_chunks;
  end if;
  select count(*) into n_log from public.document_metadata_log
   where document_id = p_doc and fonds_id is null and rag_impact and wijzig_type = 'metadata'
     and gewijzigd_door = '0a5040cc-0000-0000-0000-0000000000aa'
     and gewijzigd_door_naam = 'Curator #504' and wijzig_reden = p_reden
     and oude_waarde is null
     and (veld_naam, nieuwe_waarde) in (('documentdatum','2026-01-01'),
                                        ('geldig_vanaf','2026-01-01'),
                                        ('volgende_review','2026-12-15'));
  if n_log <> 3 then
    raise exception 'LEK %: verwacht 3 auditregels met actor en reden, kreeg %.', p_label, n_log;
  end if;
end $$;

-- ── D1: klein document ──────────────────────────────────────────────────────
set local role service_role;
do $$
declare v int;
begin
  v := pg_temp.datums_zetten('0a5040cc-0000-0000-0000-000000000001', 'Pilot #504 klein');
  if v <> 3 then raise exception 'LEK D1: RPC schreef % auditregels (verwacht 3).', v; end if;
end $$;
reset role;
select pg_temp.controleer_gezet('0a5040cc-0000-0000-0000-000000000001', 3, 'Pilot #504 klein', 'D1');
do $$ begin raise notice 'OK D1: klein document — drie datums gezet, 3/3 chunks, 3 auditregels met actor en reden.'; end $$;

-- ── D2: 1.000 chunks ────────────────────────────────────────────────────────
-- D6 (negatieve controle) hergebruikt deze uitgangssituatie; leg hem vast.
savepoint d2_voor;
set local role service_role;
do $$
declare t0 timestamptz := clock_timestamp(); v int; v_ms numeric;
begin
  v := pg_temp.datums_zetten('0a5040cc-0000-0000-0000-000000000002', 'Pilot #504 Pensioenwet');
  v_ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if v <> 3 then raise exception 'LEK D2: RPC schreef % auditregels (verwacht 3).', v; end if;
  if v_ms >= 30000 then
    raise exception 'LEK D2: datumwijziging op 1.000 chunks duurde % ms (≥ 30 s).', round(v_ms);
  end if;
  raise notice 'D2: datumwijziging op 1.000 chunks in % ms.', round(v_ms);
end $$;
reset role;
select pg_temp.controleer_gezet('0a5040cc-0000-0000-0000-000000000002', 1000, 'Pilot #504 Pensioenwet', 'D2');
do $$ begin raise notice 'OK D2: 1.000 chunks — document gezet, 1.000/1.000 chunks, 3 auditregels met actor en reden.'; end $$;

-- ── D3: identieke waarden herschrijven niets ────────────────────────────────
create temp table d504_ctid(ctid_tekst text) on commit drop;
insert into d504_ctid select ctid::text from public.document_chunks
 where document_id = '0a5040cc-0000-0000-0000-000000000002';
set local role service_role;
update public.documenten
   set documentdatum = '2026-01-01', geldig_vanaf = '2026-01-01', volgende_review = '2026-12-15'
 where id = '0a5040cc-0000-0000-0000-000000000002';
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.document_chunks
   where document_id = '0a5040cc-0000-0000-0000-000000000002'
     and ctid::text not in (select ctid_tekst from d504_ctid);
  if n <> 0 then
    raise exception 'LEK D3: % chunk(s) herschreven bij identieke datums.', n;
  end if;
  raise notice 'OK D3: identieke datums herschrijven 0 van 1.000 chunks (app: "Geen wijzigingen.").';
end $$;

-- ── D4: leegmaken is toegestaan ─────────────────────────────────────────────
set local role service_role;
select public.fn_platform_generiek_document_bijwerken(
  '0a5040cc-0000-0000-0000-000000000002',
  '{"geldig_vanaf":null,"volgende_review":null}'::jsonb,
  '[{"veld_naam":"geldig_vanaf","oude_waarde":"2026-01-01","nieuwe_waarde":null,"wijzig_type":"metadata","rag_impact":true},
    {"veld_naam":"volgende_review","oude_waarde":"2026-12-15","nieuwe_waarde":null,"wijzig_type":"metadata","rag_impact":true}]'::jsonb,
  '0a5040cc-0000-0000-0000-0000000000aa'::uuid, 'Curator #504', 'Leegmaken #504');
reset role;
do $$
declare d record; n int; n_log int;
begin
  select documentdatum, geldig_vanaf, volgende_review into d from public.documenten
   where id = '0a5040cc-0000-0000-0000-000000000002';
  if d.geldig_vanaf is not null or d.volgende_review is not null
     or d.documentdatum is distinct from date '2026-01-01' then
    raise exception 'LEK D4: document na leegmaken onjuist: %', d;
  end if;
  select count(*) into n from public.document_chunks
   where document_id = '0a5040cc-0000-0000-0000-000000000002'
     and geldig_vanaf is null and documentdatum = date '2026-01-01';
  if n <> 1000 then
    raise exception 'LEK D4: % van 1.000 chunks met geldig_vanaf NULL en documentdatum behouden.', n;
  end if;
  select count(*) into n_log from public.document_metadata_log
   where document_id = '0a5040cc-0000-0000-0000-000000000002' and wijzig_reden = 'Leegmaken #504'
     and nieuwe_waarde is null and veld_naam in ('geldig_vanaf','volgende_review');
  if n_log <> 2 then
    raise exception 'LEK D4: verwacht 2 auditregels (oud → null), kreeg %.', n_log;
  end if;
  raise notice 'OK D4: leegmaken → NULL op document en 1.000 chunks; 2 auditregels oud → null.';
end $$;

-- ── D5: ongeldige datum → fout en volledige rollback ────────────────────────
set local role service_role;
do $$
declare n_log_voor int; n_log_na int; v date;
begin
  select count(*) into n_log_voor from public.document_metadata_log
   where document_id = '0a5040cc-0000-0000-0000-000000000001';
  begin
    perform public.fn_platform_generiek_document_bijwerken(
      '0a5040cc-0000-0000-0000-000000000001',
      '{"documentdatum":"2026-02-30"}'::jsonb,
      '[{"veld_naam":"documentdatum","oude_waarde":"2026-01-01","nieuwe_waarde":"2026-02-30","wijzig_type":"metadata","rag_impact":true}]'::jsonb,
      null, 'x', 'ongeldig');
    raise exception 'LEK D5: ongeldige datum 2026-02-30 aanvaard.';
  exception when datetime_field_overflow or invalid_datetime_format then null;
  end;
  select documentdatum into v from public.documenten where id = '0a5040cc-0000-0000-0000-000000000001';
  select count(*) into n_log_na from public.document_metadata_log
   where document_id = '0a5040cc-0000-0000-0000-000000000001';
  if v is distinct from date '2026-01-01' or n_log_na <> n_log_voor then
    raise exception 'LEK D5: gedeeltelijke wijziging na fout (datum %, audit % → %).', v, n_log_voor, n_log_na;
  end if;
  raise notice 'OK D5: ongeldige datum geweigerd; document en audit ongewijzigd.';
end $$;
reset role;

-- ── D6: negatieve controle — zonder denorm-trigger is D2 rood ───────────────
rollback to savepoint d2_voor;
alter table public.documenten disable trigger trg_chunk_denorm_refresh;
set local role service_role;
select pg_temp.datums_zetten('0a5040cc-0000-0000-0000-000000000002', 'Negatieve controle #504');
reset role;
do $$
begin
  begin
    perform pg_temp.controleer_gezet('0a5040cc-0000-0000-0000-000000000002', 1000,
                                     'Negatieve controle #504', 'D6');
  exception when raise_exception then
    raise notice 'OK D6-neg: zonder chunk-denorm faalt de consistentiecheck (%).', sqlerrm;
    return;
  end;
  raise exception 'NEGATIEVE CONTROLE D6 FAALT: check groen zonder chunk-denorm — hij onderscheidt niets.';
end $$;
alter table public.documenten enable trigger trg_chunk_denorm_refresh;

rollback;

\echo '#504 curatie-datumvelden: D0–D6 groen.'
