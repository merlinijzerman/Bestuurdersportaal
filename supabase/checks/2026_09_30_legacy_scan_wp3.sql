-- ============================================================================
-- WP3 — legacy-documenten met uitgesteld scanbewijs: scan vóór wissen,
-- daarna herindexering onder de ÉCHTE triggers en indexen (Refs #500).
-- ----------------------------------------------------------------------------
-- Productie (30-09-2026): 14 actieve generieke documenten (4.351 chunks) met
-- scan_resultaat {scan:'uitgesteld_wp3'} en een geldige SHA-256, o.a. de
-- Pensioenwet (968 chunks, wetgeving/pw, datums gezet). De worker
-- (platform/lib/legacy-scan.ts) scant ze nu eerst en laat de bestaande chunks
-- pas door de herindexering vervangen. Deze check bewijst de DB-kant van elke
-- stap met exact de kolommen die de worker schrijft:
--   L0  structuur: verwerkingsstatus-CHECK kent gescand/gequarantineerd; de
--       insert-denormtrigger bestaat.
--   L1  selectie: het PostgREST-voorfilter + predicaat van de reaper (hier als
--       SQL) kiest precies het uitgestelde document, geen van de negatieven.
--   L2  technische scanfout: alleen scan_resultaat wijzigt; 968 chunks blijven,
--       document blijft 'beschikbaar' en heeft geen schoon bewijs.
--   L3  clean: de conditionele update (id + opslag_pad + bestand_hash) raakt
--       1 rij; scanbewijs hash-gebonden; chunks nog steeds 968.
--   L4  herindex: delete + insert van 968 kale chunks (workerkolommen) →
--       denormalisatie wetgeving/pw/actief/van_kracht/datums/normgewicht op
--       968/968; artikelkoppen (o.a. 150d) terug; daarna embeddings compleet
--       en afronding 'beschikbaar'.
--   L5  infected: gequarantineerd + chunks verwijderd.
--   L6  NEGATIEVE CONTROLE: zonder de insert-denormtrigger is L4 rood (de
--       metadatacheck onderscheidt dus wél/niet gedenormaliseerd).
--
-- Self-seeding in één transactie met ROLLBACK — laat geen data achter.
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw, afbraak, catalogusvragen en de controles achteraf;
--      service_role voor L2–L5, want dat is de rol waarmee de ingestworker
--      (createServiceSupabase) via PostgREST schrijft.
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- ── L0: structuur ───────────────────────────────────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.documenten'::regclass and conname = 'documenten_verwerkingsstatus_check';
  if v_def is null or v_def !~ 'gescand' or v_def !~ 'gequarantineerd' then
    raise exception 'LEK L0: verwerkingsstatus-CHECK mist gescand/gequarantineerd: %', v_def;
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.document_chunks'::regclass
                    and tgname = 'trg_chunk_denorm_before_insert' and not tgisinternal) then
    raise exception 'LEK L0: trg_chunk_denorm_before_insert ontbreekt op document_chunks.';
  end if;
  raise notice 'OK L0: statusCHECK kent gescand/gequarantineerd; insert-denormtrigger aanwezig.';
end $$;

-- ── Seed ────────────────────────────────────────────────────────────────────
create or replace function pg_temp.rvec() returns vector
language sql volatile as
$$ select array_agg(random()::real - 0.5)::vector from generate_series(1, 1024) $$;

-- Pensioenwet-nabootsing + negatieven. Hash = sha256 van een vaste string.
insert into public.documenten
  (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief, normgewicht,
   documenttype, wettelijk_regime, extern_url, documentdatum, geldig_vanaf,
   bestandstype, opslag_pad, bestand_hash, scan_resultaat, verwerkingsstatus, geindexeerd)
select v.id::uuid, null, 'generiek', 'Extern', v.titel, 'van_kracht', 'actief', v.actief, 'bindend',
       'wetgeving', 'pw', 'https://wetten.overheid.nl/BWBR0020809', date '2026-01-01', date '2026-01-01',
       'pdf', v.pad, v.hash, v.scan::jsonb, v.vs, true
  from (values
    ('1e9ac000-0000-4000-8000-000000000001', 'Pensioenwet (legacy-scan)', true,
     'generiek/1e9ac000-0000-4000-8000-000000000001.pdf', encode(sha256('pensioenwet'::bytea), 'hex'),
     '{"scan":"uitgesteld_wp3"}', 'beschikbaar'),
    ('1e9ac000-0000-4000-8000-000000000002', 'Schoon', true, 'generiek/2.pdf', encode(sha256('schoon'::bytea), 'hex'),
     '{"verdict":"clean","sha256":"' || encode(sha256('schoon'::bytea), 'hex') || '"}', 'beschikbaar'),
    ('1e9ac000-0000-4000-8000-000000000003', 'Besmet', true, 'generiek/3.pdf', encode(sha256('besmet'::bytea), 'hex'),
     '{"verdict":"infected"}', 'gequarantineerd'),
    ('1e9ac000-0000-4000-8000-000000000004', 'Mislukt', true, 'generiek/4.pdf', encode(sha256('mislukt'::bytea), 'hex'),
     '{"scan":"uitgesteld_wp3"}', 'mislukt'),
    ('1e9ac000-0000-4000-8000-000000000005', 'Inactief', false, 'generiek/5.pdf', encode(sha256('inactief'::bytea), 'hex'),
     '{"scan":"uitgesteld_wp3"}', 'beschikbaar'),
    ('1e9ac000-0000-4000-8000-000000000006', 'Zonder pad', true, null, encode(sha256('zonderpad'::bytea), 'hex'),
     '{"scan":"uitgesteld_wp3"}', 'beschikbaar'),
    ('1e9ac000-0000-4000-8000-000000000007', 'Ongeldige hash', true, 'generiek/7.pdf', 'ABC',
     '{"scan":"uitgesteld_wp3"}', 'beschikbaar'),
    ('1e9ac000-0000-4000-8000-000000000008', 'Clean afwijkend', true, 'generiek/8.pdf', encode(sha256('acht'::bytea), 'hex'),
     '{"verdict":"clean","sha256":"' || repeat('b', 64) || '"}', 'beschikbaar'),
    ('1e9ac000-0000-4000-8000-000000000009', 'Besmet-later', true, 'generiek/9.pdf', encode(sha256('negen'::bytea), 'hex'),
     '{"scan":"uitgesteld_wp3"}', 'beschikbaar')
  ) as v(id, titel, actief, pad, hash, scan, vs);

-- 968 bestaande (legacy) chunks met embedding, zoals op Productie.
insert into public.document_chunks
  (document_id, chunk_index, tekst, structuur_type, structuur_label, embedding, embedding_model, indexering_versie)
select '1e9ac000-0000-4000-8000-000000000001', c,
       'Artikel ' || c || ' oude passage pensioenuitvoerder deelnemer', 'artikel', 'Artikel ' || c,
       pg_temp.rvec(), 'legacy-scan-check', 'r1-structuur-contextueel'
  from generate_series(0, 967) c;
insert into public.document_chunks (document_id, chunk_index, tekst, embedding, embedding_model)
select '1e9ac000-0000-4000-8000-000000000009', c, 'passage ' || c, pg_temp.rvec(), 'legacy-scan-check'
  from generate_series(0, 9) c;

-- ── L1: selectie (voorfilter + predicaat van platform/lib/legacy-scan.ts) ───
do $$
declare v_ids uuid[];
begin
  select array_agg(id order by id) into v_ids
    from public.documenten d
   where d.id::text like '1e9ac000-%'
     and d.actief and d.opslag_pad is not null
     -- LEGACY_SCAN_VOORFILTER
     and (d.bestand_hash is null or d.scan_resultaat is null
          or d.scan_resultaat->>'verdict' is null
          or d.scan_resultaat->>'verdict' in ('scanner_unreachable','error','stale_definitions'))
     -- legacyScanCategorie: status + geldige hash (tak uitgesteld_scanbewijs)
     and coalesce(d.verwerkingsstatus, '') not in ('geweigerd','gequarantineerd','mislukt')
     and d.bestand_hash ~ '^[a-f0-9]{64}$';
  if v_ids is distinct from array['1e9ac000-0000-4000-8000-000000000001'::uuid,
                                  '1e9ac000-0000-4000-8000-000000000009'::uuid] then
    raise exception 'LEK L1: selectie verwacht de twee uitgestelde documenten, kreeg %', v_ids;
  end if;
  raise notice 'OK L1: selectie kiest uitgesteld_wp3 met geldige hash; schoon/infected/mislukt/inactief/zonder pad/ongeldige hash/clean-afwijkend vallen af.';
end $$;

-- ── L2: technische scanfout ─────────────────────────────────────────────────
set local role service_role;
update public.documenten
   set scan_resultaat = '{"verdict":"scanner_unreachable","code":"scanner_timeout","sha256":""}'::jsonb
 where id = '1e9ac000-0000-4000-8000-000000000001'
   and opslag_pad = 'generiek/1e9ac000-0000-4000-8000-000000000001.pdf';
reset role;
do $$
declare n int; d record;
begin
  select count(*) into n from public.document_chunks where document_id = '1e9ac000-0000-4000-8000-000000000001';
  select verwerkingsstatus, geindexeerd, scan_resultaat, bestand_hash into d
    from public.documenten where id = '1e9ac000-0000-4000-8000-000000000001';
  if n <> 968 then raise exception 'LEK L2: technische fout liet % chunks over (verwacht 968).', n; end if;
  if d.verwerkingsstatus <> 'beschikbaar' then raise exception 'LEK L2: status %', d.verwerkingsstatus; end if;
  if d.scan_resultaat->>'verdict' = 'clean' then raise exception 'LEK L2: document open na technische fout.'; end if;
  raise notice 'OK L2: technische fout — 968 chunks behouden, status beschikbaar, geen schoon bewijs.';
end $$;

-- ── L3: clean → scanbewijs + gescand (conditioneel, één transitie) ─────────
set local role service_role;
do $$
declare n int; v_hash text := encode(sha256('pensioenwet'::bytea), 'hex');
begin
  with geraakt as (
    update public.documenten
       set scan_resultaat = jsonb_build_object('verdict','clean','sha256',v_hash,'engine','clamav',
                                               'deploymentId','dpl_scanner_1'),
           bestand_hash = v_hash, bestandstype = 'pdf', mime_gedetecteerd = 'application/pdf',
           geindexeerd = false, verwerkingsstatus = 'gescand'
     where id = '1e9ac000-0000-4000-8000-000000000001'
       and opslag_pad = 'generiek/1e9ac000-0000-4000-8000-000000000001.pdf'
       and bestand_hash = v_hash
    returning id)
  select count(*) into n from geraakt;
  if n <> 1 then raise exception 'LEK L3: conditionele clean-update raakte % rijen.', n; end if;
end $$;
reset role;
do $$
declare n int; d record;
begin
  select * into d from public.documenten where id = '1e9ac000-0000-4000-8000-000000000001';
  if not (d.scan_resultaat->>'verdict' = 'clean' and d.scan_resultaat->>'sha256' = d.bestand_hash) then
    raise exception 'LEK L3: scanbewijs niet hash-gebonden: %', d.scan_resultaat;
  end if;
  if d.verwerkingsstatus <> 'gescand' or d.geindexeerd then
    raise exception 'LEK L3: status %/% (verwacht gescand/false)', d.verwerkingsstatus, d.geindexeerd;
  end if;
  select count(*) into n from public.document_chunks where document_id = d.id;
  if n <> 968 then raise exception 'LEK L3: clean wiste chunks vóór de herindex (% over).', n; end if;
  raise notice 'OK L3: clean — hash-gebonden scanbewijs, gescand, 968 chunks nog aanwezig tot de herindex.';
end $$;

-- ── L4: herindexering (extracteerEnChunk → verrijk → finaliseer) ────────────
create or replace function pg_temp.herindexeer() returns void language sql as $$
  delete from public.document_chunks where document_id = '1e9ac000-0000-4000-8000-000000000001';
  -- Exact de kolommen van bouwChunkRecordsZonderVerrijking (chunk-bouw.ts).
  insert into public.document_chunks
    (document_id, chunk_index, tekst, pagina, paragraaf, structuur_type, structuur_label,
     context_prefix, prefix_model, indexering_versie)
  select '1e9ac000-0000-4000-8000-000000000001', c,
         'Artikel ' || l.nr || '. Nieuwe passage over informatieverstrekking aan de deelnemer.',
         c / 4 + 1, null, 'artikel', 'Artikel ' || l.nr, null, null, 'r1-structuur-contextueel'
    from generate_series(0, 967) c
    cross join lateral (select case c when 600 then '150d' when 601 then '150d' when 599 then '150c'
                                      else (c + 1)::text end as nr) l;
$$;

create or replace function pg_temp.controleer_metadata(p_label text) returns void language plpgsql as $$
declare n_ok int; n_150d int;
begin
  select count(*) into n_ok from public.document_chunks
   where document_id = '1e9ac000-0000-4000-8000-000000000001'
     and documenttype = 'wetgeving' and wettelijk_regime = 'pw' and bibliotheek = 'generiek'
     and bronstatus = 'actief' and documentstatus = 'van_kracht' and normgewicht = 'bindend'
     and documentdatum = date '2026-01-01' and geldig_vanaf = date '2026-01-01'
     and extern_url = 'https://wetten.overheid.nl/BWBR0020809';
  if n_ok <> 968 then
    raise exception 'LEK %: % van 968 chunks dragen de documentmetadata na herindexering.', p_label, n_ok;
  end if;
  select count(*) into n_150d from public.document_chunks
   where document_id = '1e9ac000-0000-4000-8000-000000000001' and structuur_label = 'Artikel 150d';
  if n_150d <> 2 then raise exception 'LEK %: artikelkop 150d % keer (verwacht 2).', p_label, n_150d; end if;
end $$;

-- L6 hergebruikt deze uitgangssituatie (functies hierboven blijven bestaan).
savepoint l4_voor;
set local role service_role;
select pg_temp.herindexeer();
reset role;
select pg_temp.controleer_metadata('L4');
do $$
declare n_null int;
begin
  select count(*) into n_null from public.document_chunks
   where document_id = '1e9ac000-0000-4000-8000-000000000001' and embedding is null;
  if n_null <> 968 then raise exception 'LEK L4: verwacht 968 kale chunks, kreeg % zonder embedding.', n_null; end if;
end $$;
-- Embeddingfase (verrijkChunks) + finaliseer-invariant.
set local role service_role;
update public.document_chunks
   set embedding = pg_temp.rvec(), embedding_model = 'legacy-scan-check',
       context_prefix = 'Onderdeel: artikel — ' || structuur_label, prefix_model = 'legacy-scan-check'
 where document_id = '1e9ac000-0000-4000-8000-000000000001' and embedding is null;
update public.documenten set verwerkingsstatus = 'embedding'
 where id = '1e9ac000-0000-4000-8000-000000000001';
update public.documenten set geindexeerd = true, verwerkingsstatus = 'beschikbaar'
 where id = '1e9ac000-0000-4000-8000-000000000001'
   and not exists (select 1 from public.document_chunks
                    where document_id = '1e9ac000-0000-4000-8000-000000000001' and embedding is null);
reset role;
do $$
declare n_null int; n int; d record;
begin
  select count(*) filter (where embedding is null), count(*) into n_null, n
    from public.document_chunks where document_id = '1e9ac000-0000-4000-8000-000000000001';
  select * into d from public.documenten where id = '1e9ac000-0000-4000-8000-000000000001';
  if n <> 968 or n_null <> 0 then raise exception 'LEK L4: % chunks, % zonder embedding.', n, n_null; end if;
  if d.verwerkingsstatus <> 'beschikbaar' or not d.geindexeerd
     or not (d.scan_resultaat->>'verdict' = 'clean' and d.scan_resultaat->>'sha256' = d.bestand_hash) then
    raise exception 'LEK L4: eindstand document %/%/%', d.verwerkingsstatus, d.geindexeerd, d.scan_resultaat;
  end if;
  perform pg_temp.controleer_metadata('L4-eind');
  raise notice 'OK L4: herindex — 968/968 chunks met wetgeving/pw/actief/van_kracht/bindend/datums, 150d terug, embeddings compleet, beschikbaar met scanbewijs.';
end $$;

-- ── L5: infected → gequarantineerd + chunks verwijderd ─────────────────────
set local role service_role;
update public.documenten
   set scan_resultaat = '{"verdict":"infected","detection":"Eicar-Test-Signature"}'::jsonb,
       geindexeerd = false, verwerkingsstatus = 'gequarantineerd'
 where id = '1e9ac000-0000-4000-8000-000000000009' and opslag_pad = 'generiek/9.pdf';
delete from public.document_chunks where document_id = '1e9ac000-0000-4000-8000-000000000009';
reset role;
do $$
declare n int; v text;
begin
  select count(*) into n from public.document_chunks where document_id = '1e9ac000-0000-4000-8000-000000000009';
  select verwerkingsstatus into v from public.documenten where id = '1e9ac000-0000-4000-8000-000000000009';
  if n <> 0 or v <> 'gequarantineerd' then raise exception 'LEK L5: % chunks, status %', n, v; end if;
  raise notice 'OK L5: infected — gequarantineerd, afgeleide chunks verwijderd.';
end $$;

-- ── L6: negatieve controle — zonder insert-denorm is L4 rood ────────────────
rollback to savepoint l4_voor;
alter table public.document_chunks disable trigger trg_chunk_denorm_before_insert;
select pg_temp.herindexeer();
do $$
declare v_rood boolean := false;
begin
  begin
    perform pg_temp.controleer_metadata('L6');
  exception when others then
    v_rood := true;
  end;
  if not v_rood then
    raise exception 'LEK L6: metadatacheck bleef groen zonder denormtrigger — de check bewijst niets.';
  end if;
  raise notice 'OK L6: negatieve controle — zonder trg_chunk_denorm_before_insert is de metadatacheck rood.';
end $$;
alter table public.document_chunks enable trigger trg_chunk_denorm_before_insert;

rollback;
