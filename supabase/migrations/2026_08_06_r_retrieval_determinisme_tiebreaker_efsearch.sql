-- ============================================================================
-- Migratie: reproduceerbare retrieval — deterministische tiebreaker
--           (besluit 0139, WERKOPDRACHT-RETRIEVAL-DETERMINISME M-R5.1)
--           M-R5.2 (ef_search) is UITGESTELD: Supabase weigert de functie-SET
--           (ERROR 42501). Zie de notitie bij de SET-clausule + onderaan.
-- ----------------------------------------------------------------------------
-- WAT & WAAROM
--   1. TIEBREAKER (M-R5.1). zoek_chunks_hybride sorteerde op drie plekken (twee
--      per-arm row_number()'s + de finale RRF-sortering) ZONDER stabiele
--      tiebreaker. Bij gelijke sorteersleutel plus LIMIT bepaalt de fysieke
--      leesvolgorde wie de snijlijn haalt — en die verandert door een gewijzigd
--      queryplan, VACUUM, HOT-updates of parallelle workers. Dezelfde vraag kon
--      zo een andere bronnenset opleveren. De niet-hybride zoek_chunks HAD deze
--      tiebreaker al (order by rang desc, c.chunk_index asc); dit herstelt de
--      symmetrie. Op elke order by komt `, dc.id` als laatste sleutel.
--
--   2. ef_search (M-R5.2) — UITGESTELD. De HNSW-index draait op de pgvector-
--      default hnsw.ef_search = 40, gelijk aan p_kandidaten (40): de vector-arm
--      haalt exact zoveel rijen als de graaf maximaal aanlevert en past de fonds-/
--      published-/modusfilters daar PAS NA toe — bij uitputting klapt de arm in.
--      De bedoelde fix (`set hnsw.ef_search = 100` op de functie, zodat de waarde
--      met elke aanroep meereist i.p.v. via een losse sessie-SET die de app achter
--      de pooler nooit bereikt) wordt door Supabase GEWEIGERD: de migratie-rol mag
--      dit parameter niet in een functie-SET zetten (ERROR 42501). Daarom in DEZE
--      migratie NIET gezet; ef_search = 40 blijft. Belegd als apart openstaand punt
--      (besluit 0139): opties zijn (a) `alter role authenticated set hnsw.ef_search
--      = 100` als dat wél mag, (b) een plpgsql-wrapper met `set local`, of (c) app-
--      side via set_config. Elk vergt eigen test; de tiebreaker hieronder staat er
--      los van en levert de determinismewinst nu al.
--
-- WAT NIET WIJZIGT
--   - De SIGNATUUR van zoek_chunks_hybride (returns table + parameters) is
--     identiek; alleen de body + de SET-clausules veranderen.
--   - De VOLLEDIGE T4/T10 + Increment G filterset in BEIDE armen (fondsfilter,
--     published-only generiek, review-verval, modus/peildatum) is letterlijk
--     overgenomen. security invoker blijft: RLS blijft primair.
--
-- ACL — LET OP (bevinding H-18 / gate F+H). `drop function` reset de ACL. Deze
--   migratie herstelt daarom het r7-patroon expliciet: revoke van public+anon,
--   grant execute aan authenticated + service_role. Zonder dit blok zou de functie
--   na de drop via de Supabase-default-ACL ongeauthenticeerd aanroepbaar worden.
--
-- IDEMPOTENT. Handmatig in de SQL-editor plakken (geen migratierunner). Draai
--   daarna de verificatie onderaan én supabase/checks/2026_07_31_r1_structurele_gates.sql.
-- ============================================================================

-- ATOMISCH: alles-of-niets. DDL is transactioneel in Postgres; faalt de create of
-- een grant, dan rolt COMMIT niet en blijft de HUIDIGE functie ongewijzigd staan
-- (geen breukvenster, geen half-toegepaste staat). De verificatie onderaan draai je
-- ná de COMMIT als losse selects.
begin;

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
-- LET OP (M-R5.2): `set hnsw.ef_search = 100` op de functie is op Supabase NIET
-- toegestaan voor de migratie-rol (ERROR 42501: permission denied to set parameter).
-- Daarom NIET hier gezet; ef_search blijft de pgvector-default (40) en is als
-- apart openstaand punt belegd (zie besluit 0139 + de notitie onderaan). De
-- deterministische tiebreaker hieronder — de kern-determinismefix — is onafhankelijk
-- van ef_search en werkt wél.
as $$
  with q as (
    select websearch_to_tsquery('dutch', p_query) as tsq
  ),
  fts as (
    select dc.id,
           -- M-R5.1: tiebreaker `, dc.id` maakt de per-arm rangschikking deterministisch.
           row_number() over (order by ts_rank_cd(dc.zoek_vector, q.tsq) desc, dc.id) as r
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
    order by ts_rank_cd(dc.zoek_vector, q.tsq) desc, dc.id   -- M-R5.1 tiebreaker
    limit p_kandidaten
  ),
  vec as (
    select dc.id,
           -- M-R5.1: tiebreaker `, dc.id`.
           row_number() over (order by dc.embedding <=> p_embedding, dc.id) as r
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
    order by dc.embedding <=> p_embedding, dc.id   -- M-R5.1 tiebreaker
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
  order by s.rrf desc, dc.id   -- M-R5.1 tiebreaker op de finale RRF-sortering
  limit p_limit;
$$;

comment on function public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) is
  'Hybride RAG-retrieval (FTS+vector via RRF) met documentscope + Increment G-filters + T4 fondsfilter + published-only generiek + T10 review-verval-gate, in BEIDE armen vóór de fusion. Besluit 0139: deterministische tiebreaker (, dc.id) op alle vijf de order-by-clausules (2 vensters + 2 armen + finale RRF). hnsw.ef_search NIET op de functie gezet (Supabase weigert dit, 42501) — blijft default 40, apart belegd. Additief op RLS (defense-in-depth). Returnt d.fonds_id + d.volgende_review + fts_rang/vec_rang. SECURITY INVOKER: RLS blijft primair. Defaults = huidig gedrag.';

-- ── ACL-herstel na drop (r7-patroon; bevinding H-18 / gate F+H) ──────────────
revoke all on function public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) from public, anon;
grant execute on function public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) to authenticated, service_role;

commit;

-- ============================================================================
-- VERIFICATIE (SQL Editor) — draaien ná de COMMIT als losse selects; leg de uitvoer vast (K-02/K-03:
-- bewijs de UITKOMST in de database, niet dat het bestand bestaat).
--
-- 1. Tiebreaker staat in de functiedefinitie in pg_proc. Er zijn VIJF functionele
--    order-by-clausules met dc.id (2 row_number-vensters + 2 arm-sorteringen +
--    1 finale RRF-sortering). De regex matcht alleen die sorteringen, niet het
--    inline-commentaar in de body:
--      select regexp_count(pg_get_functiondef(p.oid), '(desc|p_embedding), dc\.id') as tiebreakers
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'zoek_chunks_hybride';
--    → tiebreakers = 5. (Of inspecteer de definitie visueel met pg_get_functiondef.)
--
-- 2. proconfig bevat ALLEEN search_path (ef_search is UITGESTELD, zie boven):
--      select proconfig
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'zoek_chunks_hybride';
--    → proconfig bevat 'search_path=public, pg_temp' en NIET 'hnsw.ef_search'.
--
-- 3. anon kan de functie NIET aanroepen (gate H), authenticated wél:
--      select has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
--             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'zoek_chunks_hybride';
--    → anon = false, authenticated = true.
--
-- 4. Determinisme onder parallelle workers (criterium C):
--      set max_parallel_workers_per_gather = 4;
--      -- roep zoek_chunks_hybride 10× met identieke argumenten aan en vergelijk
--      -- de id-volgorde; die moet 10× identiek zijn.
--
-- 5. Structurele gates schoon:
--      supabase/checks/2026_07_31_r1_structurele_gates.sql  (gates A–H, i.h.b. F/H)
-- ============================================================================
