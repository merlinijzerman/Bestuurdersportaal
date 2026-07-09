-- ============================================================================
-- Migratie 2026-07-08 — Increment T4: expliciete server-side fondsfilter op het
--                       retrievalpad (defense-in-depth NÁÁST RLS) + published-only
--                       generieke content.
-- ----------------------------------------------------------------------------
-- Leidend: werkopdracht T4 (multi-tenant T-serie), beslisnotitie v0.4 §12
-- (RAG-tenantdiscipline) + matrix §15 (T11–T14), besluit 0040 (B4) en het nieuwe
-- decisions/0045 (namespace-conventie + fonds_id-behandeling generieke chunks).
--
-- PREMISSE-CORRECTIE (decisions/0045): de werkopdracht ging uit van
-- `document_chunks.fonds_id NOT NULL`. As-built heeft `document_chunks` GEEN eigen
-- `fonds_id`-kolom (zie 2026_06_20d:40, 2026_06_19e:31, 2026_05_30:16). De
-- tenantgrens loopt via de join naar `documenten`, waar `fonds_id` nullable is:
-- NULL voor generiek (bibliotheek='generiek'), gezet voor fonds. De expliciete
-- fondsfilter landt daarom op `d.fonds_id` (de gejoinde documenten-rij), niet op
-- een niet-bestaande `dc.fonds_id`. `bibliotheek` blijft de namespace-discriminator.
--
-- Wat deze migratie doet — uitsluitend de twee retrieval-RPC's uitbreiden:
--   1. Nieuwe param `p_fonds_id uuid default null` (achteraan; default = huidig
--      gedrag, geen regressie). Wanneer gezet: fondschunks alleen waar
--      `d.fonds_id = p_fonds_id`, generieke chunks (bibliotheek='generiek') als
--      gedeelde read-only laag. ADDITIEF op RLS — verruimt NOOIT leesrechten.
--   2. Published-only voor generiek (T13/T14), MODUS-ONAFHANKELIJK: generieke
--      chunks komen alleen mee als documentstatus='van_kracht' EN
--      coalesce(bronstatus,'actief')='actief'. deprecated/withdrawn generiek
--      (alleen_historisch/gearchiveerd/historisch/uitgesloten) valt eruit als
--      actuele bron. Fondsdocumenten vallen NIET onder deze gate (eigen lifecycle
--      + bestaande modusfilters). De volledige status-workflow is T6/T10; T4
--      borgt alleen de retrieval-koppeling.
--   3. Return-kolom `fonds_id` (de `d.fonds_id`) erbij, zodat de app-laag per
--      chunk kan asserten (TS-guard handhaafFondsdiscipline) én de bronversie-
--      audit het toegepaste fonds per bron in retrieval_meta kan vastleggen.
--      Voor generieke chunks is dit NULL — meteen het bewijs "gedeelde bron".
--
-- RLS blijft de PRIMAIRE tenant-isolatie; `security invoker` blijft; de filter is
-- puur defense-in-depth. `set search_path` tegen injection blijft.
--
-- Signatuur- én return-type-wijziging → `create or replace` kan dit niet.
-- Daarom `drop function if exists` op de bestaande (20g-)signatuur, dan `create`.
-- Idempotent. GEEN datamigratie, GEEN chunk-/documenten-kolomwijziging.
--
-- Tenant-impact: (a) de expliciete fondsfilter is additief en kan de zichtbaarheid
-- nooit verruimen; met p_fonds_id=null blijft het gedrag exact gelijk (RLS-only).
-- (b) De published-only-gate kan generieke bronnen die vandaag in modus 'alles'
-- meekomen (bv. status 'alleen_historisch') voortaan uitsluiten als actuele bron —
-- bewust, conform T13/T14. Fondsdocumenten ondervinden GEEN wijziging.
--
-- EERST hier in de Supabase SQL Editor draaien, DAARNA code-deploy.
-- ROLLBACK: 2026_07_08_t4_retrieval_fondsfilter_ROLLBACK.sql (herstelt 20g).
-- Verificatie: supabase/checks/2026_07_08_t4_retrieval_fondsdiscipline.sql.
-- ============================================================================

-- ── 1. FTS-route: zoek_chunks met expliciete fondsfilter + published-generiek ──
drop function if exists public.zoek_chunks(text, int, uuid[], text[], text[], uuid[], text, date, text[]);

create or replace function public.zoek_chunks(
  p_query               text,
  p_limit               int    default 20,
  p_document_ids        uuid[] default null,
  p_bronstatus          text[] default null,
  p_documentstatus      text[] default null,
  p_procesinstantie_ids uuid[] default null,
  p_modus               text   default 'alles',
  p_peildatum           date   default current_date,
  p_bronsoort           text[] default null,
  p_fonds_id            uuid   default null   -- T4: expliciete server-side fondsfilter
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
  documentstatus     text,
  bronstatus         text,
  documentdatum      date,
  geldig_vanaf       date,
  geldig_tot         date,
  procesinstantie_id uuid,
  bronorganisatie    text,
  normgewicht        text,
  extern_url         text,
  fonds_id           uuid   -- T4: fonds van de bron (NULL = generiek/gedeeld)
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
    c.extern_url,
    d.fonds_id
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
    -- ── T4 (defense-in-depth náást RLS): expliciete fondsfilter. Additief;
    --    p_fonds_id=null = geen filter (RLS-only, huidig gedrag).
    and (p_fonds_id is null or d.fonds_id = p_fonds_id or c.bibliotheek = 'generiek')
    -- ── T4 (T13/T14): published-only voor generiek, modus-onafhankelijk.
    and (
      c.bibliotheek is distinct from 'generiek'
      or (c.documentstatus = 'van_kracht' and coalesce(c.bronstatus,'actief') = 'actief')
    )
  order by rang desc, c.chunk_index asc
  limit greatest(p_limit, 1);
$$;

comment on function public.zoek_chunks(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) is
  'RAG-retrieval (ts_rank_cd) met documentscope + Increment G-filters + Increment T4 expliciete fondsfilter (p_fonds_id: d.fonds_id = p_fonds_id OR bibliotheek=''generiek'') en published-only generiek (van_kracht+actief). Filter is ADDITIEF op RLS (defense-in-depth), verruimt nooit leesrechten. Returnt d.fonds_id voor de app-guard + bronversie-audit. SECURITY INVOKER: RLS blijft de primaire tenant-isolatie. Defaults = huidig gedrag.';

-- ── 2. Hybride route: zoek_chunks_hybride met dezelfde uitbreidingen ─────────
drop function if exists public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[]);

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
  p_bronsoort           text[] default null,
  p_fonds_id            uuid   default null   -- T4: expliciete server-side fondsfilter
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
  documentstatus     text,
  bronstatus         text,
  documentdatum      date,
  geldig_vanaf       date,
  geldig_tot         date,
  procesinstantie_id uuid,
  bronorganisatie    text,
  normgewicht        text,
  extern_url         text,
  fonds_id           uuid   -- T4: fonds van de bron (NULL = generiek/gedeeld)
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
      -- T4: expliciete fondsfilter (additief náást RLS)
      and (p_fonds_id is null or d.fonds_id = p_fonds_id or dc.bibliotheek = 'generiek')
      -- T4: published-only voor generiek (modus-onafhankelijk)
      and (
        dc.bibliotheek is distinct from 'generiek'
        or (dc.documentstatus = 'van_kracht' and coalesce(dc.bronstatus,'actief') = 'actief')
      )
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
      -- T4: expliciete fondsfilter (additief náást RLS)
      and (p_fonds_id is null or d.fonds_id = p_fonds_id or dc.bibliotheek = 'generiek')
      -- T4: published-only voor generiek (modus-onafhankelijk)
      and (
        dc.bibliotheek is distinct from 'generiek'
        or (dc.documentstatus = 'van_kracht' and coalesce(dc.bronstatus,'actief') = 'actief')
      )
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
         dc.bronorganisatie, dc.normgewicht, dc.extern_url,
         d.fonds_id
  from samen s
  join public.document_chunks dc on dc.id = s.id
  join public.documenten d on d.id = dc.document_id
  where d.actief = true
  order by s.rrf desc
  limit p_limit;
$$;

comment on function public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) is
  'Hybride RAG-retrieval (FTS+vector via RRF) met documentscope + Increment G-filters + Increment T4 expliciete fondsfilter en published-only generiek, in BEIDE armen vóór de fusion. Filter is ADDITIEF op RLS (defense-in-depth). Returnt d.fonds_id. SECURITY INVOKER: RLS blijft primair. Defaults = huidig gedrag.';

-- ============================================================================
-- Verificatie (SQL Editor) — uitgebreide negatieve suite (T11–T14) staat in
-- supabase/checks/2026_07_08_t4_retrieval_fondsdiscipline.sql.
--   -- defaults = huidig gedrag (geen fondsfilter):
--   select count(*) from public.zoek_chunks('beleid', 20);
--   -- nieuwe return-kolom bestaat:
--   select fonds_id from public.zoek_chunks('beleid', 1) limit 1;
--   -- fondsfilter respecteert generiek (deel van de anon-sessie via RLS):
--   -- (representatief bewijs in de checks-suite met 2 synthetische fondsen)
-- ============================================================================
