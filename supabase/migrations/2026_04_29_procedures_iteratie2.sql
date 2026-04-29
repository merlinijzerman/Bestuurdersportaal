-- ============================================================
--  Migratie 2026-04-29 — Procedures iteratie 2
--  Voegt procedure_stap_id toe aan agendapunten zodat een
--  procedure-stap een agendapunt in een vergadering kan claimen.
-- ============================================================

alter table public.agendapunten
  add column if not exists procedure_stap_id uuid references public.procedure_stappen(id) on delete set null;

create index if not exists idx_agendapunten_procstap
  on public.agendapunten(procedure_stap_id);
