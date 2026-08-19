-- ============================================================================
-- ROLLBACK 2026-07-16 — T13: periodemodel + reserves voor stuurinformatie
-- ----------------------------------------------------------------------------
-- Draait 2026_07_16_t13_stuurinfo_periode_reserve.sql terug:
--   - dropt fonds_stuurinfo_reserve en fonds_stuurinfo_periode;
--   - haalt de periode-kolom + FK van fonds_stuurinfo_kpi / fonds_stuurinfo_reeks
--     en herstelt de oorspronkelijke PK's (fonds_id, kpi_key) resp.
--     (fonds_id, reeks_key, punt_key) en de oorspronkelijke index.
--
-- VOLGORDE: draai EERST de seed-rollback
-- (2026_07_16_t13b_stuurinfo_balans_seed_ROLLBACK.sql). Deze rollback verwijdert
-- daarna defensief alle rijen met periode <> '2026Q1' — de oorspronkelijke PK
-- kan anders niet terug (duplicaten). Dataverlies beperkt zich dus tot
-- niet-'2026Q1'-periodes; dat is exact de T13-seed-data.
-- ============================================================================

begin;

-- 1. Reserve-tabel weg (bevat uitsluitend T13-data).
drop table if exists public.fonds_stuurinfo_reserve;

-- 2. Alleen de oorspronkelijke snapshot ('2026Q1') blijft over.
delete from public.fonds_stuurinfo_kpi   where periode <> '2026Q1';
delete from public.fonds_stuurinfo_reeks where periode <> '2026Q1';

-- 3. FK's en periode-kolommen weg; PK's herstellen.
alter table public.fonds_stuurinfo_kpi
  drop constraint if exists fonds_stuurinfo_kpi_periode_fk;
alter table public.fonds_stuurinfo_kpi
  drop column if exists periode;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fonds_stuurinfo_kpi_pkey'
      and conrelid = 'public.fonds_stuurinfo_kpi'::regclass
  ) then
    alter table public.fonds_stuurinfo_kpi add primary key (fonds_id, kpi_key);
  end if;
end $$;

alter table public.fonds_stuurinfo_reeks
  drop constraint if exists fonds_stuurinfo_reeks_periode_fk;
alter table public.fonds_stuurinfo_reeks
  drop column if exists periode;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fonds_stuurinfo_reeks_pkey'
      and conrelid = 'public.fonds_stuurinfo_reeks'::regclass
  ) then
    alter table public.fonds_stuurinfo_reeks add primary key (fonds_id, reeks_key, punt_key);
  end if;
end $$;

drop index if exists public.idx_stuurinfo_reeks_fonds_periode_reeks;
create index if not exists idx_stuurinfo_reeks_fonds_reeks
  on public.fonds_stuurinfo_reeks(fonds_id, reeks_key, volgorde);

-- 4. Registry weg.
drop table if exists public.fonds_stuurinfo_periode;

commit;

-- ── Verificatie (handmatig ná de rollback) ─────────────────────────────────
-- 1. Tabellen weg:
--      select tablename from pg_tables
--       where tablename in ('fonds_stuurinfo_periode','fonds_stuurinfo_reserve');
-- 2. PK's hersteld (zonder periode):
--      select conrelid::regclass, pg_get_constraintdef(oid) from pg_constraint
--       where contype = 'p' and conrelid::regclass::text
--         in ('fonds_stuurinfo_kpi','fonds_stuurinfo_reeks');
