-- ============================================================================
-- Migratie 2026-06-20g — Increment G: RAG-filtering vóór retrieval +
--                        antwoordmodusfamilie (schema-deel).
-- ----------------------------------------------------------------------------
-- G is een SCHEMA-VRIJE CONSUMENT van de denorm-velden die Increment E
-- (2026_06_19e) en C+/B13 (2026_06_20e) al op document_chunks hebben gezet
-- (procesinstantie_id, documentstatus, bronstatus, geldig_vanaf/tot,
-- bibliotheek, bronorganisatie, normgewicht, extern_url, …). Deze migratie
-- voegt daarom GEEN chunk-denorm of documenten-kolommen toe. Twee dingen:
--
--   1. gesprekken.actieve_antwoordmodus (text, nullable; null = auto-detectie).
--   2. zoek_chunks / zoek_chunks_hybride: optionele, ADDITIEVE filterparameters
--      (defaults = huidig gedrag) + return-uitbreiding met de denorm-velden die
--      de bronkaarten/audit nodig hebben. Het filter staat VÓÓR ranking/RRF op
--      de gedenormaliseerde chunkvelden (scope-vóór-ranking-patroon).
--
-- Signatuur- én return-type-wijziging → `create or replace` kan dit niet
-- (return-type wijzigt). Daarom — net als 2026_06_10_document_scope.sql —
-- `drop function if exists` op de bestaande signatuur, dan `create`. Idempotent.
--
-- "Actuele bron"-definitie (modus 'actueel'), server-side hard afgedwongen,
-- spiegelt lib/document-status-transities.ts (isActueleBronStatus):
--   d.actief=true  (basis, blijft)
--   ∧ documentstatus ∈ {vastgesteld, van_kracht}   (concept NOOIT actueel)
--   ∧ coalesce(bronstatus,'actief') = 'actief'      (NULL ≡ actief; test #9)
--   ∧ (geldig_vanaf is null or <= peildatum)
--   ∧ (geldig_tot   is null or >= peildatum)        (verlopen/niet-geldig eruit)
-- Conceptregel: documentstatus in {vastgesteld,van_kracht} sluit concept én
-- ter_bespreking/ter_besluitvorming uit, óók bij bronstatus='actief' (test #10).
-- NB (besluit 1, bevestigd 2026-06-20): bronstatus-NULL telt coulant als actief
-- (queue nog niet leeg, zie 2026_06_18 §2d). documentstatus-NULL blijft eruit:
-- de C-backfill zette bestaande docs op 'concept', en concept is nooit actueel.
-- Het strikte exit-criterium (NULL-bronstatus uitsluiten) is een latere
-- operationele flip, géén datamigratie.
--
-- Modi:
--   'actueel'       → harde definitie hierboven.
--   'historisch'    → géén actueel-restrictie (toont oud/vervangen); labeling
--                     gebeurt presentatie-side (test #4/#20).
--   'besluitvorming'→ géén harde restrictie op RPC-niveau; de rang-boost over de
--                     gecombineerde bronset + Decision Object-injectie/dedup
--                     gebeuren in de route (besluit 2/3, transparant/testbaar).
--   'alles'         → géén filter = exact huidig gedrag (default).
-- Orthogonaal bovenop de modus (null = geen filter): p_bronstatus,
-- p_documentstatus, p_procesinstantie_ids, p_bronsoort. p_document_ids
-- (gespreksselectie) blijft orthogonaal zoals voorheen.
--
-- security invoker + RLS (fonds chunks / fonds documenten) blijven leidend; de
-- filters zijn ADDITIEF op RLS en verbreden geen leesrechten. set search_path
-- tegen injection.
--
-- EERST hier in de Supabase SQL Editor draaien, DAARNA code-deploy.
-- ROLLBACK: 2026_06_20g_retrieval_modusfamilie_ROLLBACK.sql.
-- ============================================================================

-- ── 1. Gespreksniveau: actieve antwoordmodus ────────────────────────────────
-- null = auto-detectie (lib/vraagtype.bepaalAntwoordmodus). Raakt het append-
-- only auditspoor (governance_log) niet.
alter table public.gesprekken
  add column if not exists actieve_antwoordmodus text;

comment on column public.gesprekken.actieve_antwoordmodus is
  'Door de gebruiker vastgezette antwoordmodus van het gesprek (feitelijk|bronoverzicht|historisch|duiding|besluitrijpheid|sparring|persoonlijke_voorbereiding). NULL = auto-detectie per vraag.';

-- ── 2. FTS-route: zoek_chunks met retrieval-filters ─────────────────────────
drop function if exists public.zoek_chunks(text, int, uuid[]);

create or replace function public.zoek_chunks(
  p_query               text,
  p_limit               int    default 20,
  p_document_ids        uuid[] default null,
  p_bronstatus          text[] default null,
  p_documentstatus      text[] default null,
  p_procesinstantie_ids uuid[] default null,
  p_modus               text   default 'alles',
  p_peildatum           date   default current_date,
  p_bronsoort           text[] default null
)
returns table (
  id                 uuid,
  document_id        uuid,
  tekst              text,
  pagina             int,
  paragraaf          text,
  chunk_index        int,
  titel              text,
  bron               text,
  bibliotheek        text,
  opslag_pad         text,
  rang               real,
  -- Increment G — denorm-velden voor bronkaarten/audit/weging.
  documentstatus     text,
  bronstatus         text,
  documentdatum      date,
  geldig_vanaf       date,
  geldig_tot         date,
  procesinstantie_id uuid,
  bronorganisatie    text,
  normgewicht        text,
  extern_url         text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    c.id,
    c.document_id,
    c.tekst,
    c.pagina,
    c.paragraaf,
    c.chunk_index,
    d.titel,
    d.bron,
    d.bibliotheek,
    d.opslag_pad,
    ts_rank_cd(c.zoek_vector, q.query) as rang,
    c.documentstatus,
    c.bronstatus,
    c.documentdatum,
    c.geldig_vanaf,
    c.geldig_tot,
    c.procesinstantie_id,
    c.bronorganisatie,
    c.normgewicht,
    c.extern_url
  from public.document_chunks c
  join public.documenten d on d.id = c.document_id
  cross join websearch_to_tsquery('dutch', p_query) as q(query)
  where d.actief = true
    and c.zoek_vector @@ q.query
    -- scope vóór rank (increment 1)
    and (p_document_ids is null or c.document_id = any(p_document_ids))
    -- modus 'actueel': harde actuele-bron-definitie (concept nooit; NULL-bronstatus ≡ actief)
    and (
      p_modus is distinct from 'actueel'
      or (
        c.documentstatus in ('vastgesteld','van_kracht')
        and coalesce(c.bronstatus,'actief') = 'actief'
        and (c.geldig_vanaf is null or c.geldig_vanaf <= p_peildatum)
        and (c.geldig_tot   is null or c.geldig_tot   >= p_peildatum)
      )
    )
    -- orthogonale additieve filters (null = geen filter)
    and (p_bronstatus          is null or coalesce(c.bronstatus,'actief') = any(p_bronstatus))
    and (p_documentstatus      is null or c.documentstatus     = any(p_documentstatus))
    and (p_procesinstantie_ids is null or c.procesinstantie_id = any(p_procesinstantie_ids))
    and (p_bronsoort           is null or c.bibliotheek         = any(p_bronsoort))
  order by rang desc, c.chunk_index asc
  limit greatest(p_limit, 1);
$$;

comment on function public.zoek_chunks(text, int, uuid[], text[], text[], uuid[], text, date, text[]) is
  'RAG-retrieval (ts_rank_cd) met optionele documentscope + Increment G retrieval-filters (bronstatus/documentstatus/procesinstantie/modus/peildatum/bronsoort), vóór ranking op de denorm-chunkvelden. Defaults = huidig gedrag. SECURITY INVOKER: RLS dwingt tenant-isolatie af.';

-- ── 3. Hybride route: zoek_chunks_hybride met retrieval-filters ─────────────
drop function if exists public.zoek_chunks_hybride(text, vector, int, int, int, uuid[]);

create or replace function public.zoek_chunks_hybride(
  p_query               text,
  p_embedding           vector(1024),
  p_limit               int    default 10,
  p_kandidaten          int    default 40,
  p_k                   int    default 60,
  p_document_ids        uuid[] default null,
  p_bronstatus          text[] default null,
  p_documentstatus      text[] default null,
  p_procesinstantie_ids uuid[] default null,
  p_modus               text   default 'alles',
  p_peildatum           date   default current_date,
  p_bronsoort           text[] default null
)
returns table (
  id                 uuid,
  document_id        uuid,
  tekst              text,
  pagina             int,
  paragraaf          text,
  chunk_index        int,
  titel              text,
  bron               text,
  bibliotheek        text,
  opslag_pad         text,
  rang               real,
  fts_rang           int,
  vec_rang           int,
  -- Increment G — denorm-velden voor bronkaarten/audit/weging.
  documentstatus     text,
  bronstatus         text,
  documentdatum      date,
  geldig_vanaf       date,
  geldig_tot         date,
  procesinstantie_id uuid,
  bronorganisatie    text,
  normgewicht        text,
  extern_url         text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with q as (
    select websearch_to_tsquery('dutch', p_query) as tsq
  ),
  fts as (
    select dc.id,
           row_number() over (order by ts_rank_cd(dc.zoek_vector, q.tsq) desc) as r
    from public.document_chunks dc
    join public.documenten d on d.id = dc.document_id
    cross join q
    where d.actief = true
      and dc.zoek_vector @@ q.tsq
      and (p_document_ids is null or dc.document_id = any(p_document_ids))
      and (
        p_modus is distinct from 'actueel'
        or (
          dc.documentstatus in ('vastgesteld','van_kracht')
          and coalesce(dc.bronstatus,'actief') = 'actief'
          and (dc.geldig_vanaf is null or dc.geldig_vanaf <= p_peildatum)
          and (dc.geldig_tot   is null or dc.geldig_tot   >= p_peildatum)
        )
      )
      and (p_bronstatus          is null or coalesce(dc.bronstatus,'actief') = any(p_bronstatus))
      and (p_documentstatus      is null or dc.documentstatus     = any(p_documentstatus))
      and (p_procesinstantie_ids is null or dc.procesinstantie_id = any(p_procesinstantie_ids))
      and (p_bronsoort           is null or dc.bibliotheek         = any(p_bronsoort))
    order by ts_rank_cd(dc.zoek_vector, q.tsq) desc
    limit p_kandidaten
  ),
  vec as (
    select dc.id,
           row_number() over (order by dc.embedding <=> p_embedding) as r
    from public.document_chunks dc
    join public.documenten d on d.id = dc.document_id
    where d.actief = true
      and dc.embedding is not null
      and (p_document_ids is null or dc.document_id = any(p_document_ids))
      and (
        p_modus is distinct from 'actueel'
        or (
          dc.documentstatus in ('vastgesteld','van_kracht')
          and coalesce(dc.bronstatus,'actief') = 'actief'
          and (dc.geldig_vanaf is null or dc.geldig_vanaf <= p_peildatum)
          and (dc.geldig_tot   is null or dc.geldig_tot   >= p_peildatum)
        )
      )
      and (p_bronstatus          is null or coalesce(dc.bronstatus,'actief') = any(p_bronstatus))
      and (p_documentstatus      is null or dc.documentstatus     = any(p_documentstatus))
      and (p_procesinstantie_ids is null or dc.procesinstantie_id = any(p_procesinstantie_ids))
      and (p_bronsoort           is null or dc.bibliotheek         = any(p_bronsoort))
    order by dc.embedding <=> p_embedding
    limit p_kandidaten
  ),
  samen as (
    select coalesce(fts.id, vec.id) as id,
           fts.r as fts_rang,
           vec.r as vec_rang,
           coalesce(1.0 / (p_k + fts.r), 0) + coalesce(1.0 / (p_k + vec.r), 0) as rrf
    from fts
    full outer join vec on fts.id = vec.id
  )
  select dc.id, dc.document_id, dc.tekst, dc.pagina, dc.paragraaf, dc.chunk_index,
         d.titel, d.bron, d.bibliotheek, d.opslag_pad,
         s.rrf::real as rang, s.fts_rang, s.vec_rang,
         dc.documentstatus, dc.bronstatus, dc.documentdatum,
         dc.geldig_vanaf, dc.geldig_tot, dc.procesinstantie_id,
         dc.bronorganisatie, dc.normgewicht, dc.extern_url
  from samen s
  join public.document_chunks dc on dc.id = s.id
  join public.documenten d on d.id = dc.document_id
  where d.actief = true
  order by s.rrf desc
  limit p_limit;
$$;

comment on function public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[]) is
  'Hybride RAG-retrieval (FTS+vector via RRF) met optionele documentscope + Increment G retrieval-filters, vóór de fusion in BEIDE armen op de denorm-chunkvelden. Defaults = huidig gedrag. SECURITY INVOKER: RLS dwingt tenant-isolatie af.';

-- ============================================================================
-- Verificatie (SQL Editor) — uitgebreide regressie staat in
-- supabase/checks/2026_06_20g_retrieval_filtering.sql.
--   -- defaults = huidig gedrag (geen filter):
--   select count(*) from public.zoek_chunks('beleid', 20);
--   -- actueel sluit concept uit:
--   select count(*) from public.zoek_chunks('beleid', 50, null, null, null, null, 'actueel');
--   -- nieuwe kolom bestaat:
--   select column_name from information_schema.columns
--    where table_name = 'gesprekken' and column_name = 'actieve_antwoordmodus';
-- ============================================================================
