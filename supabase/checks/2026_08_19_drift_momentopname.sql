-- ============================================================================
-- DRIFTMOMENTOPNAME — de blinde vlekken van `supabase db diff`  (READ-ONLY)
-- ----------------------------------------------------------------------------
-- Fase 5 van 02 Architectuur/ONTWERPNOTITIE-MIGRATIEPROCES-v2.1.md.
--
-- WAAROM DIT BESTAAT
-- `db diff` toetst of het schema overeenkomt met de migraties, maar heeft
-- gedocumenteerde blinde vlekken: publications, storage buckets en sommige
-- views. Bij deze applicatie is dat geen detail — storage buckets en policies
-- zijn precies waar bevinding P0-3 zit.
--
-- En het geval dat deze hele fase heeft afgedwongen — de T14b-drift van juli —
-- zat in een FUNCTIELICHAAM. Dat is waar `db diff` het minst betrouwbaar is en
-- waar geen structurele gate naar kijkt: gates A–H toetsen eigenschappen
-- (tenantpredicaat, gepind search_path, anon-grants), niet of het lichaam nog
-- hetzelfde is als gisteren.
--
-- WERKING
-- Deze suite drukt geen oordeel uit. Ze produceert een STABIELE, SORTEERBARE
-- momentopname van de toestand: één regel per feit, in de vorm
--
--     categorie|sleutel|waarde
--
-- De workflow vergelijkt die met supabase/checks/drift-momentopname-verwacht.txt
-- in de repo. Elke afwijking is een diff die iemand moet verklaren — of door de
-- wijziging terug te draaien, of door de verwachting bij te werken in dezelfde
-- PR die de wijziging aanbrengt.
--
-- Dat is bewust anders dan een lijst hardgecodeerde verwachtingen: die rot stil
-- als het schema meegroeit. Een momentopname rot luidruchtig, en dat is precies
-- wat je wilt.
--
-- Functielichamen staan als md5. Een hash zegt DAT er iets veranderde, niet
-- wat — dat is genoeg voor een alarm; het onderzoek volgt daarna.
--
-- Gebruik:
--   psql "$DRIFT_DB_URL" -v ON_ERROR_STOP=1 -At -f dit_bestand.sql
--
-- Vereist uitsluitend leesrechten. Zie scripts/drift-readonly-rol.sql.
-- ============================================================================

with

-- ── Storage buckets: blinde vlek 1 van db diff ──────────────────────────────
buckets as (
  select
    'storage.bucket' as categorie,
    id               as sleutel,
    concat_ws(' ',
      'public='       || coalesce(public::text, 'null'),
      'limiet='       || coalesce(file_size_limit::text, 'geen'),
      'mimetypes='    || coalesce(array_to_string(allowed_mime_types, ','), 'alle')
    ) as waarde
  from storage.buckets
),

-- ── Publications: blinde vlek 2 ─────────────────────────────────────────────
publicaties as (
  select
    'publication' as categorie,
    pubname       as sleutel,
    concat_ws(' ',
      'alletabellen=' || puballtables::text,
      'insert='       || pubinsert::text,
      'update='       || pubupdate::text,
      'delete='       || pubdelete::text
    ) as waarde
  from pg_publication
),

-- ── RLS per tabel: niet blind, maar wel stil als hij uitvalt ────────────────
rls as (
  select
    'rls' as categorie,
    c.relname::text as sleutel,
    'enabled=' || c.relrowsecurity::text
      || ' forced=' || c.relforcerowsecurity::text as waarde
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),

-- ── Policies: naam, commando en een hash van het predicaat ──────────────────
-- Een gewijzigd predicaat is precies het soort verandering dat niemand ziet
-- tot er iets lekt. De hash maakt hem zichtbaar zonder het predicaat te tonen.
policies as (
  select
    'policy' as categorie,
    schemaname || '.' || tablename || '.' || policyname as sleutel,
    concat_ws(' ',
      'cmd='       || cmd,
      'qual='      || coalesce(md5(qual), 'geen'),
      'withcheck=' || coalesce(md5(with_check), 'geen')
    ) as waarde
  from pg_policies
  where schemaname in ('public', 'storage')
),

-- ── Functielichamen: de blinde vlek die T14b vier weken liet bestaan ────────
functies as (
  select
    'functie' as categorie,
    n.nspname || '.' || p.proname as sleutel,
    concat_ws(' ',
      'secdef='      || p.prosecdef::text,
      'searchpath='  || coalesce(array_to_string(p.proconfig, ','), 'niet gepind'),
      'md5='         || md5(pg_get_functiondef(p.oid))
    ) as waarde
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
),

-- ── EXECUTE-rechten voor de applicatierollen ────────────────────────────────
-- Een stil toegekende anon-EXECUTE is een van de goedkoopste manieren om een
-- fondsgrens te verliezen.
grants as (
  select
    'execute' as categorie,
    n.nspname || '.' || p.proname as sleutel,
    concat_ws(' ',
      'anon='          || has_function_privilege('anon', p.oid, 'EXECUTE')::text,
      'authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
    ) as waarde
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
),

-- ── Extensies met versie: providergebonden, maar wel het weten waard ────────
extensies as (
  select
    'extensie' as categorie,
    e.extname  as sleutel,
    'versie=' || e.extversion as waarde
  from pg_extension e
),

alles as (
  select * from buckets
  union all select * from publicaties
  union all select * from rls
  union all select * from policies
  union all select * from functies
  union all select * from grants
  union all select * from extensies
)

select categorie || '|' || sleutel || '|' || waarde
from alles
order by 1;
