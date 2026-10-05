-- ============================================================================
-- LOKAAL-ALLEEN, FAIL-CLOSED: het guardblok hieronder weigert buiten een
-- expliciet lokale testomgeving (tenant-host, serveradres, GUC pr0.lokaal_ok,
-- PostgREST-sessie) vóór de eerste wijzigende opdracht. Aanroepen met
--   psql "$DB" -v ON_ERROR_STOP=1 -v pr0_lokaal_ok=ja -f dit-bestand
-- PR 0 zoekpad-herontwerp — LOKAAL MEETONDERZOEK. Opruimen van de fixture
-- (2026_10_03_pr0_zoekpad_fixture.sql + _b_match.sql) en de prototypes
-- (2026_10_03_pr0_zoekpad_prototypes.sql). Alleen lokaal.
-- ============================================================================
\set ON_ERROR_STOP on
-- ── LOKAAL-ALLEEN GUARD (fail-closed; byte-identiek in de vier pr0-bestanden) ─
-- Weigert vóór de eerste wijzigende opdracht (vóór begin/DDL/insert), tenzij
-- ALLE drie gelden:
--   1. geen tenant-host in public.tenant_domains (host like '%bestuurdersportaal.com',
--      dezelfde heuristiek als scripts/drift/genereer.sh) — én de rol kan die
--      tabel werkelijk volledig lezen (eigenaar of BYPASSRLS; RLS is deny-by-default);
--   2. inet_server_addr() is null (unix-socket) of loopback/docker/privé:
--      127.0.0.0/8, ::1, 172.16.0.0/12, 10.0.0.0/8, 192.168.0.0/16;
--   3. de GUC pr0.lokaal_ok is exact 'ja' — door de aanroeper te zetten:
--      psql -v pr0_lokaal_ok=ja (hieronder naar de GUC vertaald) of
--      `set pr0.lokaal_ok = 'ja'`; het meetharnas zet hem zelf.
-- En weigert altijd als request.jwt.claims gezet is (PostgREST-sessie).
-- Negatieve test: tests/karakterisering/zoekpad-pr0-guard.test.mjs.
\if :{?pr0_lokaal_ok}
select set_config('pr0.lokaal_ok', :'pr0_lokaal_ok', false) as pr0_lokaal_ok;
\endif
do $pr0_guard$
declare
  v_addr inet := inet_server_addr();
  v_jwt  text := nullif(current_setting('request.jwt.claims', true), '');
  v_rol  oid  := (select oid from pg_catalog.pg_roles where rolname = current_user);
begin
  if not coalesce((select rolbypassrls from pg_catalog.pg_roles where oid = v_rol), false)
     and (select relowner from pg_catalog.pg_class where oid = 'public.tenant_domains'::regclass) <> v_rol then
    raise exception 'PR0-GUARD: rol % kan public.tenant_domains niet volledig lezen (geen eigenaar/BYPASSRLS); geweigerd vóór enige wijziging.', current_user;
  end if;
  if exists (select 1 from public.tenant_domains where host like '%bestuurdersportaal.com') then
    raise exception 'PR0-GUARD: tenant-host (%%bestuurdersportaal.com) in public.tenant_domains — geen lokale testomgeving; geweigerd vóór enige wijziging.';
  end if;
  if v_addr is not null
     and not (v_addr <<= inet '127.0.0.0/8' or v_addr = inet '::1' or v_addr <<= inet '172.16.0.0/12'
              or v_addr <<= inet '10.0.0.0/8' or v_addr <<= inet '192.168.0.0/16') then
    raise exception 'PR0-GUARD: serveradres % is geen loopback-/docker-adres; geweigerd vóór enige wijziging.', v_addr;
  end if;
  if current_setting('pr0.lokaal_ok', true) is distinct from 'ja' then
    raise exception 'PR0-GUARD: GUC pr0.lokaal_ok is niet ''ja'' (zet: psql -v pr0_lokaal_ok=ja); geweigerd vóór enige wijziging.';
  end if;
  if v_jwt is not null then
    raise exception 'PR0-GUARD: request.jwt.claims is gezet (PostgREST-sessie?); geweigerd vóór enige wijziging.';
  end if;
end $pr0_guard$;
-- ── einde guard ──────────────────────────────────────────────────────────────

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
