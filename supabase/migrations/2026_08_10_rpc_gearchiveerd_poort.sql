-- ============================================================================
-- Migratie 2026-08-10 — RPC-poort: gearchiveerd universeel uitsluiten (0154 / §3)
-- ----------------------------------------------------------------------------
-- WAAROM (DOELMODEL-status-as §3, Fase 2A): de onvoorwaardelijke RPC-poort filtert
-- vandaag alleen op `d.actief = true`. Onder de modi historisch/alles (waar geen
-- statuspoort geldt) zou een `gearchiveerd` document met actief=true alsnog
-- vindbaar zijn. 0154 sluit dat expliciet: voeg `documentstatus <> 'gearchiveerd'`
-- toe aan de onvoorwaardelijke poort van BEIDE RPC's, in elke retrieval-arm.
--
-- SCOPE (2A, NIET 2B): dit is de ENIGE poortwijziging nu. De `bronstatus='actief'`-
-- eis in de actueel-poort BLIJFT staan (die gaat pas in Fase 2B/0153 weg, samen
-- met de generieke-levenscyclus-herbedrading). Verder byte-identiek aan de
-- huidige functies (2026_08_06 hybride, 2026_07_10 FTS).
--
-- NULL-VEILIG: `is distinct from 'gearchiveerd'` i.p.v. `<> 'gearchiveerd'`, zodat
-- een chunk met NULL documentstatus (legacy) NIET per ongeluk uit historisch/alles
-- valt (`NULL <> 'gearchiveerd'` is NULL/false en zou hem wegfilteren).
--
-- EFFECT OP DE HUIDIGE POPULATIE: nul. Er zijn nu geen `gearchiveerd`-documenten,
-- dus de RAG-bereik-diff blijft leeg; de clausule is een structurele gap-closer.
--
-- Draai EERST op een kloon + supabase/checks/2026_07_31_r1_structurele_gates.sql
-- (gate F+H: de ACL na drop). ATOMISCH (DDL transactioneel).
-- ROLLBACK: 2026_08_10_rpc_gearchiveerd_poort_ROLLBACK.sql
-- ============================================================================

begin;

-- ── 1. FTS-route: zoek_chunks ────────────────────────────────────────────────
drop function if exists public.zoek_chunks(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid);

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
  p_fonds_id            uuid   default null
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
  fonds_id           uuid,
  volgende_review    date
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
    d.fonds_id,
    d.volgende_review
  from public.document_chunks c
  join public.documenten d on d.id = c.document_id
  cross join websearch_to_tsquery('dutch', p_query) as q(query)
  where d.actief = true
    -- 0154 §3: gearchiveerd universeel uit (NULL-veilig).
    and c.documentstatus is distinct from 'gearchiveerd'
    and c.zoek_vector @@ q.query
    and (p_document_ids is null or c.document_id = any(p_document_ids))
    and (
      p_modus is distinct from 'actueel'
      or (
        c.documentstatus in ('vastgesteld','van_kracht')
        and coalesce(c.bronstatus,'actief') = 'actief'
        and (c.geldig_vanaf is null or c.geldig_vanaf <= p_peildatum)
        and (c.geldig_tot   is null or c.geldig_tot   >= p_peildatum)
      )
    )
    and (p_bronstatus          is null or coalesce(c.bronstatus,'actief') = any(p_bronstatus))
    and (p_documentstatus      is null or c.documentstatus     = any(p_documentstatus))
    and (p_procesinstantie_ids is null or c.procesinstantie_id = any(p_procesinstantie_ids))
    and (p_bronsoort           is null or c.bibliotheek         = any(p_bronsoort))
    and (p_fonds_id is null or d.fonds_id = p_fonds_id or c.bibliotheek = 'generiek')
    and (
      c.bibliotheek is distinct from 'generiek'
      or (
        c.documentstatus = 'van_kracht'
        and coalesce(c.bronstatus,'actief') = 'actief'
        and (d.volgende_review is null or d.volgende_review >= p_peildatum)
      )
    )
  order by rang desc, c.chunk_index asc
  limit greatest(p_limit, 1);
$$;

revoke all on function public.zoek_chunks(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) from public, anon;
grant execute on function public.zoek_chunks(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) to authenticated, service_role;

-- ── 2. Hybride route: zoek_chunks_hybride ────────────────────────────────────
drop function if exists public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid);

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
  p_fonds_id            uuid   default null
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
  fonds_id           uuid,
  volgende_review    date
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
           row_number() over (order by ts_rank_cd(dc.zoek_vector, q.tsq) desc, dc.id) as r
    from public.document_chunks dc
    join public.documenten d on d.id = dc.document_id
    cross join q
    where d.actief = true
      and dc.documentstatus is distinct from 'gearchiveerd'   -- 0154 §3 (NULL-veilig)
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
      and (p_fonds_id is null or d.fonds_id = p_fonds_id or dc.bibliotheek = 'generiek')
      and (
        dc.bibliotheek is distinct from 'generiek'
        or (
          dc.documentstatus = 'van_kracht'
          and coalesce(dc.bronstatus,'actief') = 'actief'
          and (d.volgende_review is null or d.volgende_review >= p_peildatum)
        )
      )
    order by ts_rank_cd(dc.zoek_vector, q.tsq) desc, dc.id
    limit p_kandidaten
  ),
  vec as (
    select dc.id,
           row_number() over (order by dc.embedding <=> p_embedding, dc.id) as r
    from public.document_chunks dc
    join public.documenten d on d.id = dc.document_id
    where d.actief = true
      and dc.documentstatus is distinct from 'gearchiveerd'   -- 0154 §3 (NULL-veilig)
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
      and (p_fonds_id is null or d.fonds_id = p_fonds_id or dc.bibliotheek = 'generiek')
      and (
        dc.bibliotheek is distinct from 'generiek'
        or (
          dc.documentstatus = 'van_kracht'
          and coalesce(dc.bronstatus,'actief') = 'actief'
          and (d.volgende_review is null or d.volgende_review >= p_peildatum)
        )
      )
    order by dc.embedding <=> p_embedding, dc.id
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
         d.fonds_id,
         d.volgende_review
  from samen s
  join public.document_chunks dc on dc.id = s.id
  join public.documenten d on d.id = dc.document_id
  where d.actief = true
  order by s.rrf desc, dc.id
  limit p_limit;
$$;

revoke all on function public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) from public, anon;
grant execute on function public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) to authenticated, service_role;

commit;

-- ============================================================================
-- CONTROLE (op de kloon, ná COMMIT)
-- ============================================================================
-- 1. Beide functies bestaan met de nieuwe ACL (gate F+H):
--   select proname, proacl from pg_proc where proname in ('zoek_chunks','zoek_chunks_hybride');
-- 2. gearchiveerd is in GEEN modus vindbaar (zet 1 testdoc op gearchiveerd op de
--    kloon en bevestig 0 treffers in modus 'alles' én 'historisch').
-- 3. Geen ander gedrag: draai de AQLab-regressieset before/after; nul onverklaarde
--    verschuivingen (op de huidige populatie triviaal — geen gearchiveerd-docs).
