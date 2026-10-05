-- ============================================================================
-- #548 — `public.fn_document_chunks_vervangen`: de chunkset van één document
-- in ÉÉN transactie vervangen.
-- ----------------------------------------------------------------------------
-- WAAROM. De ingestworker en de (her)indexering vervingen chunks met een DELETE
-- gevolgd door losse INSERT-batches van 50 rijen. Faalde een batch halverwege,
-- dan stond er een GEDEELTELIJKE chunkset die de zoekroutes gewoon zien: geen
-- enkele zoekroute filtert op documenten.geindexeerd of verwerkingsstatus (de
-- zoek-RPC's lezen document_chunks onder RLS met de chunk-denormvelden). De
-- herindexering liet bovendien geindexeerd=true staan, en de al ingevoegde
-- chunks waren gestempeld, zodat de backfill het document niet terugvond.
--
-- WAT. Eén RPC die binnen één transactie:
--   1. het document markeert als in verwerking (geindexeerd=false,
--      verwerkingsstatus='embedding') — mislukt dat (document niet zichtbaar of
--      niet bijwerkbaar onder RLS), dan gebeurt er niets;
--   2. alle bestaande chunks van het document verwijdert;
--   3. de nieuwe kale chunks invoegt (zonder embedding; de verrijking vult
--      context_prefix/embedding daarna per rij, zoals de worker al deed).
-- Faalt iets, dan rolt alles terug: de oude chunkset blijft volledig staan.
-- Er is dus nooit een half ingevoegde chunkset zichtbaar. GEEN schaduwindex:
-- er bestaat op geen moment een tweede chunkset naast de actieve.
--
-- Validatie (fail-closed, SQLSTATE 22023): p_chunks is een niet-lege array van
-- hoogstens 20.000 objecten; chunk_index is precies 0..n-1 (uniek, aaneen-
-- gesloten); tekst en indexering_versie zijn gevuld.
--
-- BEVEILIGING. SECURITY INVOKER: RLS op documenten en document_chunks blijft
-- de enige grens. Een tenant kan hiermee niets wat de bestaande policies
-- ("chunks write eigen fonds", "documenten update eigen fonds") niet al
-- toestaan: alleen chunks van een document van het eigen fonds vervangen.
-- Generieke documenten zijn voor tenants read-only en dus alleen via de
-- service-role (platform/worker) te vervangen. EXECUTE voor authenticated
-- (fonds-herindexering via anon-key + RLS) en service_role (worker, generieke
-- curatie); expliciet `revoke … from public, anon` (H-18).
-- Functie-eigen statement_timeout 120s (PostgREST hijst die naar SET LOCAL;
-- precedent #499): een groot document (MvT: ~2.900 chunks) blijft binnen de
-- grens, ruim onder maxDuration 300 s van de aanroepende routes.
--
-- VOLGORDE. EERST deze migratie op portal_preview, dán de code-deploy van
-- preview; later idem portal_production → main. De #548-code roept de RPC
-- aan; zonder migratie faalt de chunkvervanging met PGRST202 en blijft de oude
-- chunkset staan (document krijgt status 'mislukt' bij herindexering, de
-- worker gaat in backoff) — geen gedeeltelijke index.
-- Idempotent. ROLLBACK: supabase/rollbacks/2026_10_05_548_chunks_atomisch_vervangen_ROLLBACK.sql
-- DB-check: supabase/checks/2026_10_05_548_chunks_atomisch_vervangen.sql
-- ============================================================================

begin;

create or replace function public.fn_document_chunks_vervangen(
  p_document_id uuid,
  p_chunks      jsonb
) returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
set statement_timeout = '120s'
as $$
declare
  v_aantal     integer;
  v_ingevoegd  integer;
begin
  if p_document_id is null then
    raise exception 'fn_document_chunks_vervangen: document ontbreekt'
      using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_chunks, 'null'::jsonb)) <> 'array' then
    raise exception 'fn_document_chunks_vervangen: chunks moeten een array zijn'
      using errcode = '22023';
  end if;
  v_aantal := jsonb_array_length(p_chunks);
  if v_aantal = 0 or v_aantal > 20000 then
    raise exception 'fn_document_chunks_vervangen: aantal chunks (%) buiten 1..20000', v_aantal
      using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_chunks) e
     where jsonb_typeof(e) <> 'object'
        or jsonb_typeof(e->'chunk_index') <> 'number'
        or nullif(btrim(coalesce(e->>'tekst', '')), '') is null
        or nullif(btrim(coalesce(e->>'indexering_versie', '')), '') is null
  ) then
    raise exception 'fn_document_chunks_vervangen: ongeldige chunk (chunk_index, tekst en indexering_versie verplicht)'
      using errcode = '22023';
  end if;
  if (select count(distinct (e->>'chunk_index')::integer)
             filter (where (e->>'chunk_index')::integer between 0 and v_aantal - 1)
        from jsonb_array_elements(p_chunks) e) <> v_aantal then
    raise exception 'fn_document_chunks_vervangen: chunk_index moet precies 0..n-1 zijn'
      using errcode = '22023';
  end if;

  -- 1. Document als in verwerking markeren — onder RLS. Geen rij = niet
  --    zichtbaar of niet bijwerkbaar voor deze rol: niets doen.
  update public.documenten
     set geindexeerd = false,
         verwerkingsstatus = 'embedding'
   where id = p_document_id;
  get diagnostics v_ingevoegd = row_count;
  if v_ingevoegd = 0 then
    raise exception 'fn_document_chunks_vervangen: document niet gevonden of niet bijwerkbaar'
      using errcode = '42501';
  end if;

  -- 2. Bestaande chunks weg (zelfde transactie).
  delete from public.document_chunks where document_id = p_document_id;

  -- 3. Nieuwe kale chunks. De BEFORE INSERT-denormtrigger vult de document-
  --    velden (status, bibliotheek, fonds, …); zoek_vector is gegenereerd.
  insert into public.document_chunks
    (document_id, chunk_index, tekst, pagina, paragraaf, structuur_type,
     structuur_label, context_prefix, prefix_model, indexering_versie)
  select p_document_id, r.chunk_index, r.tekst, r.pagina, r.paragraaf,
         r.structuur_type, r.structuur_label, r.context_prefix, r.prefix_model,
         r.indexering_versie
    from jsonb_to_recordset(p_chunks) as r(
           chunk_index integer, tekst text, pagina integer, paragraaf text,
           structuur_type text, structuur_label text, context_prefix text,
           prefix_model text, indexering_versie text)
   order by r.chunk_index;
  get diagnostics v_ingevoegd = row_count;
  if v_ingevoegd <> v_aantal then
    raise exception 'fn_document_chunks_vervangen: % van % chunks ingevoegd', v_ingevoegd, v_aantal
      using errcode = 'P0001';
  end if;

  return v_ingevoegd;
end;
$$;

comment on function public.fn_document_chunks_vervangen(uuid, jsonb) is
  '#548: vervangt de chunkset van één document atomisch (document → in verwerking, oude chunks weg, nieuwe kale chunks erin) in één transactie, zodat nooit een gedeeltelijke chunkset zichtbaar is. SECURITY INVOKER (RLS blijft de grens), statement_timeout 120s. authenticated + service_role.';

revoke all on function public.fn_document_chunks_vervangen(uuid, jsonb)
  from public, anon;
grant execute on function public.fn_document_chunks_vervangen(uuid, jsonb)
  to authenticated, service_role;

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- POSTCHECK (read-only): zie supabase/checks/2026_10_05_548_chunks_atomisch_vervangen.sql
-- ============================================================================
