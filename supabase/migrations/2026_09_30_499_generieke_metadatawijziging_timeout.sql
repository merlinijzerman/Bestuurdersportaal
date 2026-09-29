-- ============================================================================
-- #499 — generieke metadatawijziging loopt op time-out bij documenten met veel
-- chunks.
-- ----------------------------------------------------------------------------
-- OORZAAK (gemeten, niet aangenomen — zie PR en de handover, §#499).
--   Een curatiewijziging op `documenten` (Pensioenwet, 968 chunks) werkt via
--   trg_chunk_denorm_refresh SYNCHROON alle chunks bij. Elke chunk-UPDATE is een
--   nieuwe tuple (geen HOT: de pagina's zijn vol en bronstatus/documentstatus/
--   geldig_* zijn geïndexeerd) en krijgt dus een nieuw element in ÁLLE indexen,
--   waaronder de HNSW-index op embedding vector(1024). Lokaal gemeten (1.000
--   chunks, 10.000 chunks in de HNSW-graaf): 1,4 s totaal, waarvan ~97 % HNSW
--   (zonder HNSW-index: 38 ms; GIN/tsvector en btree samen < 40 ms). Met
--   productie-achtige rekenkracht (container op 0,25 vCPU) loopt dezelfde
--   update op 11–14 s en breekt hij af op 57014 na 8 s.
--   De 8 s komt van de rol `authenticator` (statement_timeout=8s): de service-
--   role-client van het platform praat via PostgREST, en `service_role` heeft
--   zelf geen statement_timeout, dus de sessiewaarde van authenticator geldt.
--   Bijkomend: de trigger vuurde op ELKE update die een van de kolommen in de
--   SET-lijst noemde (ook bij gelijke waarde), en de functie herschreef álle
--   chunks zonder IS DISTINCT FROM-filter — ook als er niets veranderde.
--
-- WIJZIGING.
--   1. fn_chunk_denorm_refresh(): werkt alleen chunks bij waarvan de gedenorma-
--      liseerde waarden werkelijk afwijken (rij-vergelijking IS DISTINCT FROM).
--      Eindtoestand identiek aan voorheen (zelfde kolommen, zelfde bron
--      fn_chunk_denorm — besluit 0010); alleen overbodig herschrijven vervalt.
--   2. trg_chunk_denorm_refresh krijgt een WHEN-clausule: vuurt alleen als een
--      denorm-relevante kolom werkelijk van waarde verandert.
--   3. Nieuwe RPC fn_platform_generiek_document_bijwerken(...): voert de
--      generieke curatiewijziging (documenten-UPDATE → chunk-denorm via de
--      trigger) EN de document_metadata_log-regels uit in ÉÉN transactie, met
--      een functie-eigen `statement_timeout = 120s`. PostgREST hijst die
--      functie-instelling naar SET LOCAL vóór het statement start (db-hoisted-
--      tx-settings; lokaal geverifieerd op de gepinde CLI-stack: RPC met
--      pg_sleep(9,5) slaagt, een gewone service-role-aanroep breekt af op 8 s).
--      Een `SET` BINNEN een functie verlengt het lopende statement níet; daarom
--      zit de instelling op de functiedefinitie. Atomisch: bij een time-out,
--      ongeldige statusovergang of CHECK-schending rolt alles terug —
--      documentmetadata, chunkmetadata én de auditregels. 120 s blijft ruim
--      onder maxDuration = 300 s van de curatiepagina (Vercel), zodat de server
--      action het DB-resultaat altijd nog ziet.
--
-- SECURITY. SECURITY INVOKER (geen RLS-bypass door de functie zelf); EXECUTE
-- alleen voor service_role (de platform-client achter withPlatform). Expliciet
-- `revoke … from public, anon, authenticated` (Supabase default-ACL, H-18).
-- Kolommen zijn server-side begrensd tot de bewerkbare §8.1-velden en elke
-- gewijzigde kolom MOET een auditregel hebben (geen ongelogde wijziging).
--
-- VOLGORDE. EERST deze migratie op portal_preview, dán de code-deploy van
-- preview; later idem portal_production → main. Oude code (tabel-PATCH) blijft
-- na deze migratie werken en profiteert al van punt 1–2; de nieuwe code
-- vereist de RPC (zonder migratie: PGRST202 → nette foutmelding, geen
-- gedeeltelijke wijziging).
-- Idempotent. ROLLBACK: supabase/rollbacks/2026_09_30_499_generieke_metadatawijziging_timeout_ROLLBACK.sql
-- DB-check: supabase/checks/2026_09_30_499_metadatawijziging_timeout.sql
-- ============================================================================

begin;

-- ── 1. Denorm-refresh: alleen werkelijk afwijkende chunks herschrijven ──────
create or replace function public.fn_chunk_denorm_refresh()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- #499: zelfde kolommen en bron (fn_chunk_denorm, besluit 0010) als
  -- 2026_08_12_t4_regime_borging; nieuw is uitsluitend het IS DISTINCT FROM-
  -- filter. Elke chunk-UPDATE kost een nieuw HNSW-element; een chunk die al
  -- klopt, wordt daarom niet meer herschreven.
  update public.document_chunks dc
     set procesmodel_id     = v.procesmodel_id,
         procesinstantie_id = v.procesinstantie_id,
         vergadering_id     = v.vergadering_id,
         agendapunt_id      = v.agendapunt_id,
         documenttype       = v.documenttype,
         documentstatus     = v.documentstatus,
         documentdatum      = v.documentdatum,
         periode            = v.periode,
         bronstatus         = v.bronstatus,
         geldig_vanaf       = v.geldig_vanaf,
         geldig_tot         = v.geldig_tot,
         bibliotheek        = v.bibliotheek,
         bronorganisatie    = v.bronorganisatie,
         normgewicht        = v.normgewicht,
         extern_url         = v.extern_url,
         wettelijk_regime   = v.wettelijk_regime
    from public.fn_chunk_denorm(new.id) v
   where dc.document_id = new.id
     and (dc.procesmodel_id, dc.procesinstantie_id, dc.vergadering_id,
          dc.agendapunt_id, dc.documenttype, dc.documentstatus,
          dc.documentdatum, dc.periode, dc.bronstatus, dc.geldig_vanaf,
          dc.geldig_tot, dc.bibliotheek, dc.bronorganisatie, dc.normgewicht,
          dc.extern_url, dc.wettelijk_regime)
         is distinct from
         (v.procesmodel_id, v.procesinstantie_id, v.vergadering_id,
          v.agendapunt_id, v.documenttype, v.documentstatus,
          v.documentdatum, v.periode, v.bronstatus, v.geldig_vanaf,
          v.geldig_tot, v.bibliotheek, v.bronorganisatie, v.normgewicht,
          v.extern_url, v.wettelijk_regime);
  return new;
end;
$$;

-- ── 2. Trigger alleen bij een werkelijke waardewijziging ────────────────────
-- `AFTER UPDATE OF kol` vuurt al zodra kol in de SET-lijst staat, ook met een
-- gelijke waarde. De WHEN-clausule maakt dat een no-op-update geen enkele
-- chunk raakt. Kolomlijst ongewijzigd t.o.v. 2026_08_12_t4_regime_borging.
drop trigger if exists trg_chunk_denorm_refresh on public.documenten;
create trigger trg_chunk_denorm_refresh
  after update of procesinstantie_id, vergadering_id, agendapunt_id, documenttype,
                  status, bronstatus, documentdatum, geldig_vanaf, geldig_tot,
                  bibliotheek, bronorganisatie, normgewicht, extern_url,
                  wettelijk_regime
  on public.documenten
  for each row
  when ((old.procesinstantie_id, old.vergadering_id, old.agendapunt_id,
         old.documenttype, old.status, old.bronstatus, old.documentdatum,
         old.geldig_vanaf, old.geldig_tot, old.bibliotheek, old.bronorganisatie,
         old.normgewicht, old.extern_url, old.wettelijk_regime)
        is distinct from
        (new.procesinstantie_id, new.vergadering_id, new.agendapunt_id,
         new.documenttype, new.status, new.bronstatus, new.documentdatum,
         new.geldig_vanaf, new.geldig_tot, new.bibliotheek, new.bronorganisatie,
         new.normgewicht, new.extern_url, new.wettelijk_regime))
  execute procedure public.fn_chunk_denorm_refresh();

-- ── 3. Atomische curatie-RPC met functie-eigen statement_timeout ────────────
create or replace function public.fn_platform_generiek_document_bijwerken(
  p_document_id         uuid,
  p_wijzigingen         jsonb,
  p_logregels           jsonb,
  p_gewijzigd_door      uuid,
  p_gewijzigd_door_naam text,
  p_wijzig_reden        text
) returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
set statement_timeout = '120s'
as $$
declare
  -- De bewerkbare §8.1-velden (generieke-bibliotheek/acties.ts). Alles buiten
  -- deze lijst — fonds_id, bibliotheek, opslag, koppelingen — is hier taboe.
  c_toegestaan constant text[] := array[
    'titel','bron','bronorganisatie','extern_url','normgewicht',
    'documentdatum','geldig_vanaf','geldig_tot','status','bronstatus',
    'toepassingsgebied','regelingstype','doelgroep','thema','statusinterpretatie',
    'eigenaar','volgende_review','versie',
    'documenttype','wetsgeschiedenis_subtype','dossiernummer','wettelijk_regime'
  ];
  c_wijzig_types constant text[] := array['metadata','status','bronstatus','koppeling'];
  v_bibliotheek text;
  v_titel       text;
  v_sleutels    text[];
  v_log_velden  text[];
  v_set         text;
  v_aantal      integer;
begin
  if p_document_id is null then
    raise exception 'fn_platform_generiek_document_bijwerken: document ontbreekt'
      using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_wijzigingen, 'null'::jsonb)) <> 'object'
     or p_wijzigingen = '{}'::jsonb then
    raise exception 'fn_platform_generiek_document_bijwerken: geen wijzigingen'
      using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_logregels, 'null'::jsonb)) <> 'array' then
    raise exception 'fn_platform_generiek_document_bijwerken: ongeldige auditvorm'
      using errcode = '22023';
  end if;

  select array_agg(k order by k) into v_sleutels
    from jsonb_object_keys(p_wijzigingen) k;
  if not (v_sleutels <@ c_toegestaan) then
    raise exception 'fn_platform_generiek_document_bijwerken: niet-bewerkbaar veld'
      using errcode = '22023';
  end if;

  -- Geen ongelogde wijziging: elke gewijzigde kolom heeft precies één
  -- auditregel, en er zijn geen auditregels voor niet-gewijzigde kolommen.
  if exists (
    select 1 from jsonb_array_elements(p_logregels) e
     where jsonb_typeof(e) <> 'object'
        or nullif(btrim(e->>'veld_naam'), '') is null
        or coalesce(e->>'wijzig_type', '') <> all (c_wijzig_types)
        or jsonb_typeof(coalesce(e->'rag_impact', 'false'::jsonb)) <> 'boolean'
  ) then
    raise exception 'fn_platform_generiek_document_bijwerken: ongeldige auditregel'
      using errcode = '22023';
  end if;
  select array_agg(e->>'veld_naam' order by e->>'veld_naam') into v_log_velden
    from jsonb_array_elements(p_logregels) e;
  if v_log_velden is distinct from v_sleutels then
    raise exception 'fn_platform_generiek_document_bijwerken: auditregels dekken de wijziging niet'
      using errcode = '22023';
  end if;

  -- Vergrendel de documentrij; alleen generieke content.
  select d.bibliotheek into v_bibliotheek
    from public.documenten d
   where d.id = p_document_id
   for update;
  if v_bibliotheek is distinct from 'generiek' then
    raise exception 'fn_platform_generiek_document_bijwerken: generiek document niet gevonden'
      using errcode = 'P0002';
  end if;

  select string_agg(format('%I = r.%I', k, k), ', ' order by k) into v_set
    from unnest(v_sleutels) k;

  -- Getypeerde waarden via het rijtype van documenten; CHECKs, de generieke
  -- toestandsmachine en de chunk-denorm-trigger vuren zoals bij een gewone UPDATE.
  execute format(
    'update public.documenten d set %s
       from jsonb_populate_record(null::public.documenten, $1) r
      where d.id = $2
      returning d.titel', v_set)
    into v_titel
    using p_wijzigingen, p_document_id;

  insert into public.document_metadata_log
    (document_id, document_titel_snapshot, fonds_id, gewijzigd_door,
     gewijzigd_door_naam, veld_naam, oude_waarde, nieuwe_waarde, wijzig_reden,
     wijzig_type, rag_impact)
  select p_document_id, v_titel, null, p_gewijzigd_door, p_gewijzigd_door_naam,
         e->>'veld_naam', e->>'oude_waarde', e->>'nieuwe_waarde',
         nullif(btrim(p_wijzig_reden), ''), e->>'wijzig_type',
         coalesce((e->>'rag_impact')::boolean, false)
    from jsonb_array_elements(p_logregels) e;
  get diagnostics v_aantal = row_count;

  return v_aantal;
end;
$$;

comment on function public.fn_platform_generiek_document_bijwerken(uuid, jsonb, jsonb, uuid, text, text) is
  '#499: atomische generieke curatiewijziging (documenten + chunk-denorm + document_metadata_log) met functie-eigen statement_timeout (PostgREST hijst die naar SET LOCAL). Alleen service_role.';

revoke all on function public.fn_platform_generiek_document_bijwerken(uuid, jsonb, jsonb, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.fn_platform_generiek_document_bijwerken(uuid, jsonb, jsonb, uuid, text, text)
  to service_role;

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- POSTCHECK (read-only):
--   select proconfig from pg_proc
--    where oid = 'public.fn_platform_generiek_document_bijwerken(uuid,jsonb,jsonb,uuid,text,text)'::regprocedure;
--     → bevat 'statement_timeout=120s'
--   select pg_get_triggerdef(oid) from pg_trigger
--    where tgname = 'trg_chunk_denorm_refresh';
--     → bevat 'WHEN ((old.procesinstantie_id, …) IS DISTINCT FROM (new.…'
--   select has_function_privilege('anon', 'public.fn_platform_generiek_document_bijwerken(uuid,jsonb,jsonb,uuid,text,text)', 'execute'),
--          has_function_privilege('authenticated', 'public.fn_platform_generiek_document_bijwerken(uuid,jsonb,jsonb,uuid,text,text)', 'execute'),
--          has_function_privilege('service_role', 'public.fn_platform_generiek_document_bijwerken(uuid,jsonb,jsonb,uuid,text,text)', 'execute');
--     → false, false, true
-- ============================================================================
