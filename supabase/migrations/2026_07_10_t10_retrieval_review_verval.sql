-- ============================================================================
-- Migratie 2026-07-10 — Increment T10: review-verval-gate op het retrievalpad.
-- ----------------------------------------------------------------------------
-- T6/besluit 0048 schoof datum-gebaseerde expiry expliciet door naar T10 ("de
-- published-gate checkt géén datum-verloop"). Deze migratie sluit dat gat: een
-- GENERIEKE bron waarvan de verplichte review is verstreken (volgende_review <
-- peildatum) telt niet meer als ACTUELE bron in RAG — modus-onafhankelijk, net
-- als de bestaande published-only-gate (T4/besluit 0045).
--
-- Beleidskeuze (decisions/0053, akkoord Merlin): BLOKKEREN als actuele bron
-- (veilige faalrichting: bron ontbreekt i.p.v. verouderd meekomen). NULL
-- volgende_review = NIET afgedwongen (backward-compat: content zonder reviewdatum
-- blijft beschikbaar, en wordt in het curatie-overzicht als "geen reviewdatum"
-- gesignaleerd). READ-TIME afgeleid (geen muterende job) → geen stille statuszet,
-- geen human-in-the-loop-omzeiling.
--
-- Wat wijzigt t.o.v. 2026_07_08_t4_retrieval_fondsfilter.sql (beide RPC's):
--   • De generieke published-gate krijgt een derde voorwaarde:
--       (d.volgende_review IS NULL OR d.volgende_review >= p_peildatum)
--     Gelezen via de al bestaande documenten-join (d) — GEEN denormalisatie op
--     document_chunks, dus GEEN reindex. Fondsdocumenten vallen NIET onder de
--     gate (eigen lifecycle) en ondervinden GEEN wijziging.
--   • Return-kolom `volgende_review date` erbij, zodat de app-guard
--     (handhaafFondsdiscipline) de verval-regel als defense-in-depth náást de RPC
--     kan afdwingen op de fallbackpaden (decisions/0045 twee-lagen-patroon).
--
-- p_peildatum bestaat al (default current_date). Signatuur ONGEWIJZIGD; alleen de
-- return-tabel groeit → `drop function` + `create` (create or replace kan een
-- return-type-wijziging niet). Idempotent. Coördineert met T4/0045 (raakt dezelfde
-- gedeelde retrieval-gate; migratie-eerst-dan-deploy).
--
-- RLS/tenant-isolatie: ONGEWIJZIGD en primair (security invoker). De verval-gate
-- is additief en kan zichtbaarheid nooit verruimen — hij sluit alleen verder uit.
--
-- EERST hier in Supabase draaien, DAN code-deploy (de app leest de nieuwe
-- return-kolom volgende_review). ROLLBACK: 2026_07_10_t10_retrieval_review_verval_ROLLBACK.sql.
-- Verificatie: supabase/checks/2026_07_10_t10_review_verval.sql.
-- ============================================================================

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
  volgende_review    date   -- T10: reviewdatum van de bron (voedt de app-guard)
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
    -- T4: expliciete fondsfilter (additief náást RLS).
    and (p_fonds_id is null or d.fonds_id = p_fonds_id or c.bibliotheek = 'generiek')
    -- T4 + T10: published-only voor generiek (modus-onafhankelijk) MET review-verval.
    and (
      c.bibliotheek is distinct from 'generiek'
      or (
        c.documentstatus = 'van_kracht'
        and coalesce(c.bronstatus,'actief') = 'actief'
        and (d.volgende_review is null or d.volgende_review >= p_peildatum)  -- T10
      )
    )
  order by rang desc, c.chunk_index asc
  limit greatest(p_limit, 1);
$$;

comment on function public.zoek_chunks(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) is
  'RAG-retrieval (ts_rank_cd) met documentscope + Increment G-filters + T4 expliciete fondsfilter en published-only generiek (van_kracht+actief), aangevuld met de T10 review-verval-gate (volgende_review >= p_peildatum OR NULL). Filter is ADDITIEF op RLS (defense-in-depth). Returnt d.fonds_id + d.volgende_review. SECURITY INVOKER: RLS blijft primair. Defaults = huidig gedrag.';

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
  volgende_review    date   -- T10
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
      and (p_fonds_id is null or d.fonds_id = p_fonds_id or dc.bibliotheek = 'generiek')
      -- T4 + T10: published-only generiek MET review-verval.
      and (
        dc.bibliotheek is distinct from 'generiek'
        or (
          dc.documentstatus = 'van_kracht'
          and coalesce(dc.bronstatus,'actief') = 'actief'
          and (d.volgende_review is null or d.volgende_review >= p_peildatum)
        )
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
      and (p_fonds_id is null or d.fonds_id = p_fonds_id or dc.bibliotheek = 'generiek')
      -- T4 + T10: published-only generiek MET review-verval.
      and (
        dc.bibliotheek is distinct from 'generiek'
        or (
          dc.documentstatus = 'van_kracht'
          and coalesce(dc.bronstatus,'actief') = 'actief'
          and (d.volgende_review is null or d.volgende_review >= p_peildatum)
        )
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
         d.fonds_id,
         d.volgende_review
  from samen s
  join public.document_chunks dc on dc.id = s.id
  join public.documenten d on d.id = dc.document_id
  where d.actief = true
  order by s.rrf desc
  limit p_limit;
$$;

comment on function public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) is
  'Hybride RAG-retrieval (FTS+vector via RRF) met documentscope + Increment G-filters + T4 fondsfilter + published-only generiek + T10 review-verval-gate, in BEIDE armen vóór de fusion. Additief op RLS (defense-in-depth). Returnt d.fonds_id + d.volgende_review. SECURITY INVOKER: RLS blijft primair. Defaults = huidig gedrag.';

-- ============================================================================
-- Verificatie (SQL Editor) — volledige negatieve suite in
-- supabase/checks/2026_07_10_t10_review_verval.sql:
--   -- nieuwe return-kolom bestaat:
--   select volgende_review from public.zoek_chunks('beleid', 1) limit 1;
--   -- een generiek document met volgende_review in het verleden verschijnt NIET;
--   -- met volgende_review in de toekomst of NULL verschijnt het WEL (mits published).
-- ============================================================================
