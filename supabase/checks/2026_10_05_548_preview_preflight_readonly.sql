-- ============================================================================
--  #548 — READ-ONLY preflight voor de Preview-uitrol van
--  2026_10_05_548_chunks_atomisch_vervangen.sql
-- ----------------------------------------------------------------------------
--  DOEL
--    Vóór toepassing vaststellen: is dit werkelijk Preview, staan alle
--    voorwaarden waarop fn_document_chunks_vervangen en de #548-code leunen,
--    en moet de migratie nog worden toegepast (of staat zij er al, met de
--    juiste vorm). VERANDERT NIETS: geen insert/update/delete, geen DDL, geen
--    tijdelijke tabel, geen `set role`. Alleen catalogus- en grantmetadata.
--
--    Model: supabase/checks/2026_09_23_434_preview_preflight_readonly.sql.
--
--  ROL: database-eigenaar/postgres (Supabase SQL Editor). Leest de rechten
--    met has_function_privilege() voor anon/authenticated/service_role.
--    Niet aangesloten in scripts/cross-tenant-ci.sh: op een wegwerp-DB
--    ontbreekt de Preview-fingerprint en hoort deze check fail-closed af te
--    breken.
--
--  SQL-EDITORVAST: geen psql-metacommando's.
--
--  UITKOMST: één NOTICE met regels [doel], [voorwaarde], [stand] en
--    [nog doen]; bij een ontbrekende voorwaarde een EXCEPTION met de lijst.
-- ============================================================================
do $$
declare
  v_fout   text := '';
  v_stand  text := '';
  v_def    text;
  v_oid    regprocedure;
  v_cfg    text[];
  v_kol    text;
begin
  -- ── 0. DOELBEVESTIGING. Eerst, en fail-closed ────────────────────────────
  if not exists (
        select 1 from public.tenant_domains
         where host = 'app.preview.bestuurdersportaal.com' and actief)
     or exists (
        select 1 from public.tenant_domains
         where host like '%.bestuurdersportaal.com'
           and host not like '%.preview.bestuurdersportaal.com')
  then
    raise exception '#548 VERKEERDE DOELOMGEVING: Preview-fingerprint ontbreekt of er staat een productiehost. Deze preflight hoort uitsluitend op portal_preview te draaien.';
  end if;
  v_stand := v_stand || E'\n  [doel]       Preview-fingerprint bevestigd.';

  -- ── 1. Kolommen die de RPC en de code lezen/schrijven ────────────────────
  foreach v_kol in array array[
    'document_chunks.chunk_index', 'document_chunks.tekst', 'document_chunks.pagina',
    'document_chunks.paragraaf', 'document_chunks.structuur_type', 'document_chunks.structuur_label',
    'document_chunks.context_prefix', 'document_chunks.prefix_model', 'document_chunks.indexering_versie',
    'document_chunks.embedding', 'document_chunks.zoek_vector', 'document_chunks.bibliotheek',
    'document_chunks.documentstatus', 'document_chunks.bronstatus',
    'documenten.geindexeerd', 'documenten.verwerkingsstatus', 'documenten.ocr_toegepast',
    'documenten.dossiernummer', 'documenten.bestandsnaam', 'documenten.bestand_hash',
    'documenten.scan_resultaat', 'documenten.volgende_review', 'documenten.extern_url',
    'document_processing_jobs.stap', 'document_processing_jobs.foutcode',
    'document_processing_jobs.fonds_id', 'document_processing_jobs.correlatie_id',
    'reindex_runs.indexering_versie'
  ] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = split_part(v_kol, '.', 1)
         and column_name = split_part(v_kol, '.', 2)
    ) then
      v_fout := v_fout || E'\n  - kolom public.' || v_kol || ' ontbreekt.';
    end if;
  end loop;
  if v_fout = '' then
    v_stand := v_stand || E'\n  [voorwaarde] alle 28 benodigde kolommen aanwezig.';
  end if;

  -- ── 2. CHECK-waarden die de RPC en de herindexering gebruiken ────────────
  select string_agg(pg_get_constraintdef(c.oid), ' ') into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.documenten') and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%verwerkingsstatus%';
  if v_def is null or v_def not like '%embedding%' or v_def not like '%mislukt%' or v_def not like '%beschikbaar%' then
    v_fout := v_fout || E'\n  - CHECK op documenten.verwerkingsstatus staat embedding/mislukt/beschikbaar niet (allemaal) toe.';
  else
    v_stand := v_stand || E'\n  [voorwaarde] verwerkingsstatus staat embedding, mislukt en beschikbaar toe.';
  end if;

  select string_agg(pg_get_constraintdef(c.oid), ' ') into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.document_processing_jobs') and c.contype = 'c';
  if v_def is null or v_def not like '%indexering%' or v_def not like '%overgeslagen%' or v_def not like '%geslaagd%' then
    v_fout := v_fout || E'\n  - CHECK op document_processing_jobs staat stap indexering / status geslaagd/overgeslagen niet toe.';
  else
    v_stand := v_stand || E'\n  [voorwaarde] document_processing_jobs: stap indexering en status geslaagd/mislukt/overgeslagen toegestaan.';
  end if;

  select string_agg(pg_get_constraintdef(c.oid), ' ') into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.document_chunks') and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%structuur_type%';
  if v_def is not null and (v_def not like '%kop%' or v_def not like '%artikel%' or v_def not like '%paragraaf%' or v_def not like '%tabel%') then
    v_fout := v_fout || E'\n  - CHECK op document_chunks.structuur_type mist kop/artikel/paragraaf/tabel.';
  else
    v_stand := v_stand || E'\n  [voorwaarde] structuur_type accepteert de gebruikte waarden.';
  end if;

  -- ── 3. Denorm-trigger (vult bibliotheek/status op de nieuwe chunks) ──────
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = to_regclass('public.document_chunks') and not t.tgisinternal
       and pg_get_triggerdef(t.oid) ilike '%BEFORE INSERT%'
  ) then
    v_fout := v_fout || E'\n  - BEFORE INSERT-denormtrigger op document_chunks ontbreekt; nieuwe chunks krijgen dan geen bibliotheek/status en vallen uit de zoekfilters.';
  else
    v_stand := v_stand || E'\n  [voorwaarde] BEFORE INSERT-denormtrigger op document_chunks aanwezig.';
  end if;

  -- ── 4. RLS-schrijfpolicies (de RPC is SECURITY INVOKER) ──────────────────
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_chunks' and policyname = 'chunks write eigen fonds')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'documenten' and policyname = 'documenten update eigen fonds')
     or not coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.document_chunks')), false)
     or not coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.documenten')), false) then
    v_fout := v_fout || E'\n  - RLS of de policies "chunks write eigen fonds"/"documenten update eigen fonds" ontbreken.';
  else
    v_stand := v_stand || E'\n  [voorwaarde] RLS aan; schrijfpolicies chunks/documenten aanwezig.';
  end if;

  if v_fout <> '' then
    raise exception E'#548 PREFLIGHT ROOD — niet toepassen:%', v_fout;
  end if;

  -- ── 5. Stand van de migratie zelf ────────────────────────────────────────
  v_oid := to_regprocedure('public.fn_document_chunks_vervangen(uuid,jsonb)');
  if v_oid is null then
    v_stand := v_stand || E'\n  [nog doen]   supabase/migrations/2026_10_05_548_chunks_atomisch_vervangen.sql';
  else
    select proconfig into v_cfg from pg_proc where oid = v_oid;
    if (select prosecdef from pg_proc where oid = v_oid)
       or not coalesce('statement_timeout=120s' = any (v_cfg), false)
       or has_function_privilege('anon', v_oid, 'execute')
       or not has_function_privilege('authenticated', v_oid, 'execute')
       or not has_function_privilege('service_role', v_oid, 'execute') then
      raise exception '#548 AFWIJKENDE STAND: fn_document_chunks_vervangen bestaat maar wijkt af (DEFINER, budget of ACL). Opnieuw toepassen (idempotent) en deze preflight herhalen.';
    end if;
    v_stand := v_stand || E'\n  [stand]      fn_document_chunks_vervangen aanwezig: INVOKER, 120 s, EXECUTE authenticated+service_role, niet anon. Niets meer te doen.';
  end if;

  raise notice E'#548 PREFLIGHT GROEN:%', v_stand;
end $$;
