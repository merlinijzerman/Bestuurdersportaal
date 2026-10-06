-- ============================================================================
-- R1b — integriteitsborging document_chunks.bibliotheek (variant I1b_nn)
-- ----------------------------------------------------------------------------
-- WAAROM. De partiële HNSW-index uit het R1b-ontwerp selecteert rijen op de
-- chunkkolom `document_chunks.bibliotheek`. Die kolom is een denormalisatie
-- van `documenten.bibliotheek` en werd tot nu toe alleen door triggers gelijk
-- gehouden (insert: fn_chunk_denorm_before_insert; documentwijziging:
-- fn_chunk_denorm_refresh). Een directe chunk-update — door een fondsgebruiker
-- via de policy "chunks write eigen fonds" of door service_role — kon de kolom
-- laten afwijken van het brondocument, of `document_id`/`bibliotheek` op NULL
-- zetten. RLS op het brondocument herstelt dat niet. Onderzoek en metingen:
-- ZOEKPAD-R1B-B0-RAPPORT.md §15–§19 (onderzoeksbranch codex/r1b-b0-meting).
--
-- WAT (kleinst mogelijke wijziging):
--   1. documenten: unique (id, bibliotheek)              — FK-doel.
--   2. document_chunks.document_id  NOT NULL.
--   3. document_chunks.bibliotheek  NOT NULL.
--   4. FK document_chunks (document_id, bibliotheek)
--        → documenten (id, bibliotheek)
--        ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED.
-- Geen wijziging aan RLS, grants, auth, zoek-RPC's, HNSW-indexen, triggers of
-- retrievalcode. De bestaande FK document_chunks_document_id_fkey
-- (ON DELETE CASCADE) blijft het verwijderpad; de nieuwe FK wordt pas bij
-- COMMIT getoetst, zodat
--   • een geldige wijziging van documenten.bibliotheek via de bestaande
--     refresh-trigger alle 16 gedenormaliseerde chunkvelden (incl. bibliotheek)
--     in ÉÉN UPDATE per chunk bijwerkt (geen FK-cascade, dus geen tweede
--     herschrijving; B0.7/B0.8: 1 fysieke update per chunk);
--   • een document verwijderen (cascade op de chunks) en de vervangings-RPC
--     fn_document_chunks_vervangen (#548) ongewijzigd werken.
-- Een directe chunk-update die bibliotheek/document_id laat afwijken van het
-- document wordt bij COMMIT geweigerd (23503); NULL direct (23502).
--
-- LOCKBEWUST (PostgreSQL 17, ALTER TABLE lock-niveaus). Elke stap is een
-- EIGEN transactie met lock_timeout, zodat er nergens een volledige tabelscan
-- onder een lang vastgehouden ACCESS EXCLUSIVE-lock plaatsvindt:
--   S1 unique (id, bibliotheek) op documenten — klein (~100 rijen); een gewone
--      ADD CONSTRAINT neemt kort SHARE/ACCESS EXCLUSIVE op documenten. Geen
--      CREATE INDEX CONCURRENTLY: dat kan niet binnen een transactieblok en
--      via de SQL-editor/Management API wordt een script als één (impliciete)
--      transactie aangeboden; voor een tabel van deze omvang is de korte lock
--      goedkoper dan een aparte niet-transactionele stap.
--   S2 CHECK (… IS NOT NULL) NOT VALID op beide chunkkolommen — korte
--      ACCESS EXCLUSIVE, géén scan.
--   S3 VALIDATE CONSTRAINT (beide) — SHARE UPDATE EXCLUSIVE: lezen en
--      schrijven gaan door; dit is de enige stap met een tabelscan.
--   S4 SET NOT NULL (beide) — PostgreSQL 12+ slaat de scan over op grond van
--      de gevalideerde CHECK; daarna de hulp-CHECK's verwijderen. Korte
--      ACCESS EXCLUSIVE, géén scan.
--   S5 FK … NOT VALID — korte SHARE ROW EXCLUSIVE op beide tabellen, géén scan.
--   S6 VALIDATE CONSTRAINT (FK) — SHARE UPDATE EXCLUSIVE op document_chunks,
--      ROW SHARE op documenten; scan zonder schrijvers te blokkeren.
-- Lokaal gemeten (ZOEKPAD-R1B-B0-RAPPORT.md §19.2, 32.511 chunks): elke stap
-- < 25 ms; absolute tijden op Preview/Productie vastleggen bij uitvoering.
--
-- PREFLIGHT (fail-closed, GEEN backfill): de migratie breekt af vóór enige DDL
-- als er chunks zijn met NULL document_id, NULL bibliotheek, een niet-bestaand
-- document of een bibliotheek die afwijkt van het document. Een backfill vraagt
-- nieuw bewijs en een afzonderlijk akkoord.
--
-- IDEMPOTENT: elke stap controleert eerst de catalogus. Opnieuw draaien na een
-- gedeeltelijke uitvoering hervat bij de eerste ontbrekende stap.
-- UITVOERING: SQL-editorvast (geen psql-metacommando's); bij voorkeur stap voor
-- stap volgens MIGRATIEDRAAIBOEK-R1B-BORGING.md.
-- ROLLBACK: supabase/rollbacks/2026_10_06_r1b_chunks_bibliotheek_borging_ROLLBACK.sql
-- DB-check: supabase/checks/2026_10_06_r1b_chunks_bibliotheek_borging.sql
-- Drift (read-only): supabase/checks/2026_10_06_r1b_bibliotheek_drift_readonly.sql
-- ============================================================================

-- ── S0 preflight (read-only, fail-closed) ──────────────────────────────────
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
do $$
declare
  v_null_doc int; v_null_bib int; v_wees int; v_afwijkend int;
begin
  select count(*) filter (where document_id is null),
         count(*) filter (where bibliotheek is null)
    into v_null_doc, v_null_bib
    from public.document_chunks;
  select count(*) into v_wees
    from public.document_chunks dc
   where dc.document_id is not null
     and not exists (select 1 from public.documenten d where d.id = dc.document_id);
  select count(*) into v_afwijkend
    from public.document_chunks dc
    join public.documenten d on d.id = dc.document_id
   where dc.bibliotheek is distinct from d.bibliotheek;
  if v_null_doc + v_null_bib + v_wees + v_afwijkend > 0 then
    raise exception 'R1B-BORGING preflight: % chunks met NULL document_id, % met NULL bibliotheek, % zonder document, % met afwijkende bibliotheek — geen DDL uitgevoerd; backfill vraagt nieuw bewijs en akkoord',
      v_null_doc, v_null_bib, v_wees, v_afwijkend
      using errcode = 'P0R08';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'documenten'
                and column_name = 'bibliotheek' and is_nullable = 'YES') then
    raise exception 'R1B-BORGING preflight: documenten.bibliotheek is nullable — verwacht NOT NULL'
      using errcode = 'P0R08';
  end if;
end $$;
commit;

-- ── S1 unique (id, bibliotheek) op documenten ───────────────────────────────
begin;
set local lock_timeout = '3s';
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.documenten'::regclass
                    and conname = 'documenten_id_bibliotheek_key') then
    alter table public.documenten
      add constraint documenten_id_bibliotheek_key unique (id, bibliotheek);
  end if;
end $$;
commit;

-- ── S2 hulp-CHECK's NOT VALID (geen scan) ───────────────────────────────────
begin;
set local lock_timeout = '3s';
do $$
begin
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.document_chunks'::regclass
                    and attname = 'document_id' and attnotnull)
     and not exists (select 1 from pg_constraint
                      where conrelid = 'public.document_chunks'::regclass
                        and conname = 'document_chunks_document_id_nn') then
    alter table public.document_chunks
      add constraint document_chunks_document_id_nn check (document_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.document_chunks'::regclass
                    and attname = 'bibliotheek' and attnotnull)
     and not exists (select 1 from pg_constraint
                      where conrelid = 'public.document_chunks'::regclass
                        and conname = 'document_chunks_bibliotheek_nn') then
    alter table public.document_chunks
      add constraint document_chunks_bibliotheek_nn check (bibliotheek is not null) not valid;
  end if;
end $$;
commit;

-- ── S3 VALIDATE (scan onder SHARE UPDATE EXCLUSIVE) ─────────────────────────
begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';
do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.document_chunks'::regclass
                and conname = 'document_chunks_document_id_nn' and not convalidated) then
    alter table public.document_chunks validate constraint document_chunks_document_id_nn;
  end if;
  if exists (select 1 from pg_constraint
              where conrelid = 'public.document_chunks'::regclass
                and conname = 'document_chunks_bibliotheek_nn' and not convalidated) then
    alter table public.document_chunks validate constraint document_chunks_bibliotheek_nn;
  end if;
end $$;
commit;

-- ── S4 SET NOT NULL (geen scan dankzij de gevalideerde CHECK) + opruimen ────
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $$
begin
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.document_chunks'::regclass
                    and attname = 'document_id' and attnotnull) then
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.document_chunks'::regclass
                      and conname = 'document_chunks_document_id_nn' and convalidated) then
      raise exception 'R1B-BORGING S4: gevalideerde CHECK document_chunks_document_id_nn ontbreekt — draai eerst S2/S3 (anders zou SET NOT NULL de tabel scannen onder ACCESS EXCLUSIVE)'
        using errcode = 'P0R08';
    end if;
    alter table public.document_chunks alter column document_id set not null;
  end if;
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.document_chunks'::regclass
                    and attname = 'bibliotheek' and attnotnull) then
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.document_chunks'::regclass
                      and conname = 'document_chunks_bibliotheek_nn' and convalidated) then
      raise exception 'R1B-BORGING S4: gevalideerde CHECK document_chunks_bibliotheek_nn ontbreekt — draai eerst S2/S3'
        using errcode = 'P0R08';
    end if;
    alter table public.document_chunks alter column bibliotheek set not null;
  end if;
  alter table public.document_chunks drop constraint if exists document_chunks_document_id_nn;
  alter table public.document_chunks drop constraint if exists document_chunks_bibliotheek_nn;
end $$;
commit;

-- ── S5 samengestelde FK NOT VALID (geen scan) ───────────────────────────────
begin;
set local lock_timeout = '3s';
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.document_chunks'::regclass
                    and conname = 'document_chunks_document_bibliotheek_fkey') then
    alter table public.document_chunks
      add constraint document_chunks_document_bibliotheek_fkey
      foreign key (document_id, bibliotheek)
      references public.documenten (id, bibliotheek)
      on update no action on delete no action
      deferrable initially deferred
      not valid;
  end if;
end $$;
commit;

-- ── S6 VALIDATE FK (scan onder SHARE UPDATE EXCLUSIVE) ──────────────────────
begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';
do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.document_chunks'::regclass
                and conname = 'document_chunks_document_bibliotheek_fkey' and not convalidated) then
    alter table public.document_chunks validate constraint document_chunks_document_bibliotheek_fkey;
  end if;
end $$;
commit;

-- ── S7 postcheck (read-only, fail-closed) ───────────────────────────────────
do $$
declare
  v_fk record;
begin
  select c.convalidated, c.condeferrable, c.condeferred, c.confupdtype, c.confdeltype,
         pg_get_constraintdef(c.oid) def
    into v_fk
    from pg_constraint c
   where c.conrelid = 'public.document_chunks'::regclass
     and c.conname = 'document_chunks_document_bibliotheek_fkey';
  if v_fk is null or not v_fk.convalidated or not v_fk.condeferrable or not v_fk.condeferred
     or v_fk.confupdtype <> 'a' or v_fk.confdeltype <> 'a' then
    raise exception 'R1B-BORGING postcheck: FK ontbreekt of heeft niet de vorm NO ACTION DEFERRABLE INITIALLY DEFERRED (gevonden: %)', v_fk.def
      using errcode = 'P0R08';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.documenten'::regclass
                  and conname = 'documenten_id_bibliotheek_key' and contype = 'u') then
    raise exception 'R1B-BORGING postcheck: unique documenten_id_bibliotheek_key ontbreekt' using errcode = 'P0R08';
  end if;
  if (select count(*) from pg_attribute where attrelid = 'public.document_chunks'::regclass
        and attname in ('document_id', 'bibliotheek') and attnotnull) <> 2 then
    raise exception 'R1B-BORGING postcheck: document_id/bibliotheek niet beide NOT NULL' using errcode = 'P0R08';
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.document_chunks'::regclass
              and conname in ('document_chunks_document_id_nn', 'document_chunks_bibliotheek_nn')) then
    raise exception 'R1B-BORGING postcheck: hulp-CHECK nog aanwezig' using errcode = 'P0R08';
  end if;
  raise notice 'R1B-BORGING: unique, NOT NULL (2) en FK (deferred, gevalideerd) aanwezig.';
end $$;
