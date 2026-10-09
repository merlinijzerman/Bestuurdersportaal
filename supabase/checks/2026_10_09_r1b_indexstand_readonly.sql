-- ============================================================================
-- R1b — READ-ONLY indexstand voor de HNSW-indexwissel (één SELECT)
-- ----------------------------------------------------------------------------
-- Verandert niets (geen DML/DDL, geen set, geen temp-tabel). Bruikbaar in de
-- SQL-editor of via psql, vóór en ná elke stap van
-- MIGRATIEDRAAIBOEK-R1B-INDEXWISSEL.md. Inhoudsvrij: alleen catalogusvlaggen,
-- groottes en tellingen.
--
--   volledig_*   idx_chunks_embedding (bestaande index van het oude pad)
--   partieel_*   idx_chunks_embedding_generiek_r1b (R1b)
--   *_geldig     indisvalid AND indisready; null = index bestaat niet
--   *_def_ok     pg_get_indexdef exact gelijk aan de gepinde definitie
--   ongeldige_indexen  ELKE ongeldige index op document_chunks (achtergebleven
--                      afgebroken CONCURRENTLY-bouw); moet 0 zijn vóór elke stap
--   lopende_indexbouw  CREATE INDEX-voortgang (pg_stat_progress_create_index)
--   r1b_functie        aantal overloads van zoek_chunks_hybride_begrensd
--   minstens_een_hnsw_geldig  stopregel: mag NOOIT false zijn
-- ============================================================================
with idx as (
  select c.relname, (i.indisvalid and i.indisready) as geldig,
         pg_catalog.pg_get_indexdef(i.indexrelid) as def,
         pg_catalog.pg_relation_size(i.indexrelid) as bytes
    from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
   where i.indrelid = 'public.document_chunks'::regclass
)
select
  (select geldig from idx where relname = 'idx_chunks_embedding')                       as volledig_geldig,
  (select def = 'CREATE INDEX idx_chunks_embedding ON public.document_chunks USING hnsw (embedding vector_cosine_ops)'
     from idx where relname = 'idx_chunks_embedding')                                   as volledig_def_ok,
  (select pg_catalog.pg_size_pretty(bytes) from idx where relname = 'idx_chunks_embedding') as volledig_omvang,
  (select geldig from idx where relname = 'idx_chunks_embedding_generiek_r1b')          as partieel_geldig,
  (select def = 'CREATE INDEX idx_chunks_embedding_generiek_r1b ON public.document_chunks USING hnsw (embedding vector_cosine_ops) WITH (m=''32'', ef_construction=''256'') WHERE (bibliotheek = ''generiek''::text)'
     from idx where relname = 'idx_chunks_embedding_generiek_r1b')                      as partieel_def_ok,
  (select pg_catalog.pg_size_pretty(bytes) from idx where relname = 'idx_chunks_embedding_generiek_r1b') as partieel_omvang,
  (select count(*) from idx where not geldig)                                            as ongeldige_indexen,
  (select count(*) from pg_catalog.pg_stat_progress_create_index
    where relid = 'public.document_chunks'::regclass)                                    as lopende_indexbouw,
  (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'zoek_chunks_hybride_begrensd')           as r1b_functie,
  (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'zoek_chunks_hybride')                    as oude_functie,
  coalesce((select bool_or(geldig) from idx
             where relname in ('idx_chunks_embedding', 'idx_chunks_embedding_generiek_r1b')), false)
                                                                                         as minstens_een_hnsw_geldig,
  pg_catalog.pg_size_pretty(pg_catalog.pg_total_relation_size('public.document_chunks')) as tabel_totaal;
