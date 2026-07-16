-- ============================================================================
-- ROLLBACK 2026-07-17 — T14: beheer-invoerlaag stuurinformatie (audit + RPC)
-- ----------------------------------------------------------------------------
-- Draait de migratie 2026_07_17_t14_stuurinfo_invoer_audit.sql terug:
--   * RPC stuurinfo_balans_opslaan weg;
--   * capture-triggers (4×) + functie weg;
--   * append-only-triggers + logtabel fonds_stuurinfo_log weg
--     (LET OP: het auditspoor gaat hiermee VERLOREN — alleen gebruiken als de
--     invoerlaag als geheel wordt teruggedraaid);
--   * invoer_bron-kolommen (4×) weg;
--   * volgorde terug naar een compacte teller per fonds (1..n op periodevolgorde,
--     de T13-seedvorm). De relatieve sortering blijft identiek.
-- fn_log_append_only() blijft staan (gedeeld met andere logtabellen, T3).
-- ============================================================================

begin;

-- ── 1. RPC weg ───────────────────────────────────────────────────────────────
drop function if exists public.stuurinfo_balans_opslaan(
  text, date, text, text, jsonb, jsonb, jsonb, numeric
);

-- ── 2. Capture-triggers + functie weg ───────────────────────────────────────
drop trigger if exists trg_fonds_stuurinfo_periode_audit on public.fonds_stuurinfo_periode;
drop trigger if exists trg_fonds_stuurinfo_kpi_audit     on public.fonds_stuurinfo_kpi;
drop trigger if exists trg_fonds_stuurinfo_reeks_audit   on public.fonds_stuurinfo_reeks;
drop trigger if exists trg_fonds_stuurinfo_reserve_audit on public.fonds_stuurinfo_reserve;
drop function if exists public.fn_fonds_stuurinfo_capture();

-- ── 3. Logtabel weg (incl. append-only-triggers en policies) ────────────────
drop table if exists public.fonds_stuurinfo_log;

-- ── 4. invoer_bron-kolommen weg ──────────────────────────────────────────────
alter table public.fonds_stuurinfo_periode drop column if exists invoer_bron;
alter table public.fonds_stuurinfo_kpi     drop column if exists invoer_bron;
alter table public.fonds_stuurinfo_reeks   drop column if exists invoer_bron;
alter table public.fonds_stuurinfo_reserve drop column if exists invoer_bron;

-- ── 5. Volgorde terug naar compacte teller (T13-seedvorm) ────────────────────
update public.fonds_stuurinfo_periode p
set volgorde = t.rn
from (
  select fonds_id, periode,
         row_number() over (partition by fonds_id order by periode) as rn
  from public.fonds_stuurinfo_periode
) t
where t.fonds_id = p.fonds_id and t.periode = p.periode
  and p.volgorde is distinct from t.rn;

commit;

-- ── Verificatie (handmatig ná de rollback) ──────────────────────────────────
-- 1. Geen T14-triggers meer (moet 0 rijen zijn):
--      select trigger_name from information_schema.triggers
--       where trigger_name like 'trg_fonds_stuurinfo_%';
-- 2. Logtabel weg:
--      select count(*) from pg_tables where tablename = 'fonds_stuurinfo_log';
-- 3. Geen invoer_bron-kolommen meer (moet 0 zijn):
--      select count(*) from information_schema.columns
--       where column_name = 'invoer_bron' and table_name like 'fonds_stuurinfo_%';
