-- ============================================================================
-- PR 0 zoekpad-herontwerp — LOKAAL MEETONDERZOEK. Opruimen van de fixture
-- (2026_10_03_pr0_zoekpad_fixture.sql + _b_match.sql) en de prototypes
-- (2026_10_03_pr0_zoekpad_prototypes.sql). Alleen lokaal.
-- ============================================================================
\set ON_ERROR_STOP on
begin;
drop schema if exists pr0_proto cascade;
drop index if exists public.idx_pr0_zoek_generiek;
delete from public.document_chunks where embedding_model in ('pr0-zoekpad', 'pr0-zoekpad-bmatch');
delete from public.documenten where id::text like '00000000-0000-4000-d000-%';
delete from public.profielen where id::text like '00000000-0000-4000-b000-%';
delete from auth.users where id::text like '00000000-0000-4000-b000-%';
delete from public.fondsen where id::text like '00000000-0000-4000-a000-%';
drop schema if exists pr0_fixture cascade;
analyze public.document_chunks;
analyze public.documenten;
commit;
