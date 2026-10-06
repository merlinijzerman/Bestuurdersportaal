-- ============================================================================
-- R1b — READ-ONLY driftcheck document_chunks.bibliotheek / document_id
-- ----------------------------------------------------------------------------
-- Eén SELECT; verandert niets (geen DML/DDL, geen set role, geen temp-tabel).
-- Bruikbaar vóór (preflight) en ná de migratie
-- 2026_10_06_r1b_chunks_bibliotheek_borging.sql, en na een rollback.
-- ROL: postgres/database-eigenaar (Management API of SQL-editor): telt over
-- alle fondsen; RLS zou de telling tot één gebruiker beperken.
-- Inhoudsvrij: alleen tellingen en catalogusvlaggen.
--
-- Oordeel `ok`: 0 chunks met NULL document_id, 0 met NULL bibliotheek, 0 zonder
-- bestaand document, 0 met een bibliotheek die afwijkt van het document.
-- `borging_aanwezig` toont of de migratie (volledig) actief is; die waarde
-- zelf maakt `ok` niet rood (zelfde check vóór én na de migratie).
-- Draait de borging, dan is elke afwijking een signaal van een omzeiling
-- (superuser, session_replication_role = replica) of een defect.
-- ============================================================================
select
  (select count(*) from public.document_chunks)                                       as chunks,
  (select count(*) from public.document_chunks where document_id is null)             as document_id_null,
  (select count(*) from public.document_chunks where bibliotheek is null)             as bibliotheek_null,
  (select count(*) from public.document_chunks dc
    where dc.document_id is not null
      and not exists (select 1 from public.documenten d where d.id = dc.document_id))  as zonder_document,
  (select count(*) from public.document_chunks dc
     join public.documenten d on d.id = dc.document_id
    where dc.bibliotheek is distinct from d.bibliotheek)                               as bibliotheek_afwijkend,
  (select coalesce(bool_and(convalidated and condeferrable and condeferred), false)
     from pg_constraint
    where conrelid = 'public.document_chunks'::regclass
      and conname = 'document_chunks_document_bibliotheek_fkey')                      as fk_aanwezig_gevalideerd_deferred,
  exists (select 1 from pg_constraint where conrelid = 'public.documenten'::regclass
           and conname = 'documenten_id_bibliotheek_key')                              as unique_aanwezig,
  (select count(*) from pg_attribute where attrelid = 'public.document_chunks'::regclass
     and attname in ('document_id', 'bibliotheek') and attnotnull)                     as not_null_kolommen,
  (select count(*) from pg_constraint where conrelid = 'public.document_chunks'::regclass
     and conname in ('document_chunks_document_id_nn', 'document_chunks_bibliotheek_nn')) as hulp_checks,
  (
    (select count(*) from public.document_chunks where document_id is null) = 0
    and (select count(*) from public.document_chunks where bibliotheek is null) = 0
    and (select count(*) from public.document_chunks dc
          where dc.document_id is not null
            and not exists (select 1 from public.documenten d where d.id = dc.document_id)) = 0
    and (select count(*) from public.document_chunks dc
           join public.documenten d on d.id = dc.document_id
          where dc.bibliotheek is distinct from d.bibliotheek) = 0
  )                                                                                    as ok,
  (
    exists (select 1 from pg_constraint where conrelid = 'public.document_chunks'::regclass
             and conname = 'document_chunks_document_bibliotheek_fkey' and convalidated)
    and exists (select 1 from pg_constraint where conrelid = 'public.documenten'::regclass
                 and conname = 'documenten_id_bibliotheek_key')
    and (select count(*) from pg_attribute where attrelid = 'public.document_chunks'::regclass
           and attname in ('document_id', 'bibliotheek') and attnotnull) = 2
  )                                                                                    as borging_aanwezig;
