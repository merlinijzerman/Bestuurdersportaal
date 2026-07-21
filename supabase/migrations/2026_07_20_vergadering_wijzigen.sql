-- ============================================================
--  Migratie 2026-07-20 — Vergadering wijzigen (titel, locatie, datum)
--
--  Voegt toe:
--    • vergaderingen.gewijzigd_op / gewijzigd_door  — wijzig-audit op de rij
--    • vergadering_log                              — append-only mutatie-log
--
--  Aanleiding: de vergaderkop (titel/locatie/datum) was na aanmaken niet
--  meer aan te passen. Rechtenmodel volgt agendapunten (aanmaker +
--  voorzitter/beheerder, server-side afgedwongen in de PATCH-route).
--  Log-tabel apart van governance_events, conform de keuze in
--  2026_05_18_vergadering_basics.sql (agendapunt_log): vergaderingen
--  leven niet altijd binnen een Decision Object.
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--  Idempotent: opnieuw draaien is veilig.
-- ============================================================

-- ── 1. Vergaderingen: wijzig-audit-kolommen ─────────────────
alter table public.vergaderingen
  add column if not exists gewijzigd_op   timestamptz,
  add column if not exists gewijzigd_door uuid references auth.users(id) on delete set null;

comment on column public.vergaderingen.gewijzigd_op is
  'Tijdstip laatste wijziging van de vergaderkop (titel/locatie/datum). Null = nooit gewijzigd.';
comment on column public.vergaderingen.gewijzigd_door is
  'Gebruiker die de vergaderkop het laatst wijzigde.';

-- ── 2. Vergadering-log (append-only) ────────────────────────
create table if not exists public.vergadering_log (
  id             uuid primary key default uuid_generate_v4(),
  vergadering_id uuid not null references public.vergaderingen(id) on delete cascade,
  event_type     text not null check (event_type in (
                   'vergadering_gewijzigd'
                 )),
  actor_id       uuid not null references auth.users(id) on delete set null,
  payload        jsonb not null default '{}',
  aangemaakt     timestamptz not null default now()
);

create index if not exists idx_vergadering_log_verg
  on public.vergadering_log(vergadering_id, aangemaakt desc);

comment on table public.vergadering_log is
  'Append-only mutatie-log voor de vergaderkop. Apart van governance_events (besluit-gericht) en agendapunt_log (agendapunt-gericht).';

-- ── 3. RLS op vergadering_log ───────────────────────────────
alter table public.vergadering_log enable row level security;

drop policy if exists "fonds vergadering_log select" on public.vergadering_log;
create policy "fonds vergadering_log select" on public.vergadering_log
  for select using (
    vergadering_id in (
      select id from public.vergaderingen
      where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- INSERT alleen vanuit API-routes met geauthenticeerde user; geen UPDATE/DELETE
-- (append-only via afwezigheid van policy, zelfde patroon als agendapunt_log).
drop policy if exists "fonds vergadering_log insert" on public.vergadering_log;
create policy "fonds vergadering_log insert" on public.vergadering_log
  for insert with check (
    vergadering_id in (
      select id from public.vergaderingen
      where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
    and actor_id = auth.uid()
  );

-- ── 4. Append-only afdwingen via triggers (T3-conform) ──────
-- Zelfde patroon als 2026_07_08_t3_append_only_logs.sql: hergebruik van de
-- gedeelde immutability-functie. Idempotent (drop if exists + recreate).
drop trigger if exists trg_vergadering_log_no_update on public.vergadering_log;
create trigger trg_vergadering_log_no_update
  before update on public.vergadering_log
  for each row execute procedure public.fn_log_append_only();

drop trigger if exists trg_vergadering_log_no_delete on public.vergadering_log;
create trigger trg_vergadering_log_no_delete
  before delete on public.vergadering_log
  for each row execute procedure public.fn_log_append_only();

-- ============================================================
--  Einde migratie. Verifieer in Supabase Dashboard:
--   • select column_name from information_schema.columns
--     where table_name = 'vergaderingen'
--     and column_name in ('gewijzigd_op','gewijzigd_door');
--   • select tablename from pg_tables where tablename = 'vergadering_log';
--   • select policyname from pg_policies where tablename = 'vergadering_log';
--   • select trigger_name from information_schema.triggers
--     where event_object_table = 'vergadering_log';
--     → verwacht: trg_vergadering_log_no_update + trg_vergadering_log_no_delete.
-- ============================================================
