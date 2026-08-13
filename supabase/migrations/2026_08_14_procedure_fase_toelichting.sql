-- ============================================================
--  Migratie 2026-08-14 — Per-proces fase-toelichting (UI-wens WO-2-vervolg)
--
--  Een bestuurlijke toelichting PER PROCESINSTANTIE per fase, los van de
--  gedeelde (per fonds overschrijfbare) fasebeschrijving uit D8
--  (procedure_fase_beschrijving_override). Waar D8 de generieke duiding van een
--  fase draagt, legt dit vast wat er in DÍT specifieke traject bij die fase
--  speelt. Zichtbaar bij het uitklappen van de fase in de procesfasen-rail;
--  bewerkbaar door voorzitter/beheerder.
--
--  Eigen fonds_id → fonds-RLS (Gate B) + WITH CHECK; schrijven alleen
--  voorzitter/beheerder (defense-in-depth naast de route). Idempotent.
-- ============================================================

begin;

create table if not exists public.procedure_fase_toelichting (
  id             uuid primary key default uuid_generate_v4(),
  procedure_id   uuid not null references public.procedures(id) on delete cascade,
  fase_code      text not null,
  toelichting    text,
  fonds_id       uuid not null references public.fondsen(id) on delete cascade,
  aangepast_door uuid references auth.users(id) on delete set null,
  aangepast_op   timestamptz default now(),
  unique (procedure_id, fase_code)
);

create index if not exists idx_fase_toelichting_procedure
  on public.procedure_fase_toelichting(procedure_id);

comment on table public.procedure_fase_toelichting is
  'Per-proces bestuurlijke toelichting per fase (WO-2-vervolg). Los van de gedeelde D8-fasebeschrijving. Fonds-RLS + WITH CHECK; schrijven voorzitter/beheerder.';

alter table public.procedure_fase_toelichting enable row level security;

-- Lezen: eigen fonds.
drop policy if exists "fase-toelichting eigen fonds lezen"
  on public.procedure_fase_toelichting;
create policy "fase-toelichting eigen fonds lezen" on public.procedure_fase_toelichting
  for select using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- Toevoegen: eigen fonds + voorzitter/beheerder.
drop policy if exists "fase-toelichting toevoegen voorzitter-beheerder"
  on public.procedure_fase_toelichting;
create policy "fase-toelichting toevoegen voorzitter-beheerder" on public.procedure_fase_toelichting
  for insert with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and exists (select 1 from public.profielen
                 where id = auth.uid() and rol in ('voorzitter','beheerder'))
  );

-- Wijzigen: eigen fonds + voorzitter/beheerder.
drop policy if exists "fase-toelichting wijzigen voorzitter-beheerder"
  on public.procedure_fase_toelichting;
create policy "fase-toelichting wijzigen voorzitter-beheerder" on public.procedure_fase_toelichting
  for update using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  ) with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and exists (select 1 from public.profielen
                 where id = auth.uid() and rol in ('voorzitter','beheerder'))
  );

revoke all on public.procedure_fase_toelichting from anon;
revoke delete, truncate, references, trigger
  on public.procedure_fase_toelichting from authenticated;
grant select, insert, update
  on table public.procedure_fase_toelichting to authenticated;

commit;

-- ============================================================
--  Verificatie:
--    select count(*) from public.procedure_fase_toelichting;   -- 0
--    -- Eigen fonds_id → Gate B (policy noemt fonds_id).
-- ============================================================
