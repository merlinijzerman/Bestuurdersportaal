-- ============================================================
--  Migratie 2026-08-13 — Proceduremodule-engine v2, D7 (b)
--  Aanpasbare checklist en bewijslast op instantieniveau.
--
--  Levert:
--   • procedure_checklist: herkomst (`bron`) + soft-deactivate (`actief`) +
--     governance-koppeling, zodat een lopende procedure een checklist-
--     onderwerp kan krijgen zonder de audittrail te breken (append-only:
--     deactiveren i.p.v. verwijderen).
--   • procedure_requirement_instance: een NIEUWE, instantie-gescopete tabel
--     naast de template-bron procedure_requirements. Draagt een eigen
--     fonds_id → fonds-RLS (Gate B) + WITH CHECK; schrijven alleen
--     voorzitter/beheerder (defense-in-depth naast de route).
--
--  De readiness-UNIE (template + actieve instantie-items) zit in d7c
--  (fn_decision_readiness_check) en in buildEvidenceLijst (TS).
--
--  Idempotent (add column if not exists; create table if not exists;
--  drop policy if exists). Toepassen ná d7a (enum) en vóór d7c.
-- ============================================================

begin;

-- ── procedure_checklist: herkomst + soft-deactivate ───────────────────
alter table public.procedure_checklist
  add column if not exists bron text not null default 'template'
      check (bron in ('template','handmatig')),
  add column if not exists actief boolean not null default true,
  add column if not exists governance_event_id uuid references public.governance_events(id),
  add column if not exists aangemaakt_door uuid references auth.users(id) on delete set null,
  add column if not exists aangemaakt_op timestamptz default now();

comment on column public.procedure_checklist.bron is
  'template = meegesnapshot bij start; handmatig = tijdens de rit toegevoegd (D7).';
comment on column public.procedure_checklist.actief is
  'false = soft-deactivated (append-only; audit overleeft). Deactiveren via de route, gelogd.';

-- ── procedure_requirement_instance: instantie-scoped bewijslast ───────
create table if not exists public.procedure_requirement_instance (
  id                        uuid primary key default uuid_generate_v4(),
  decision_id               uuid not null references public.decision_objects(id) on delete cascade,
  stap_volgorde             int  not null,
  requirement_type          text not null
                             check (requirement_type in (
                               'document','field','assumption','risk',
                               'ai_validation','approval','mandate_check',
                               'kpi','evaluation','dissent_review',
                               'external_submission','consultation'
                             )),
  label                     text not null,
  documenttype              text,
  veld_pad                  text,
  verplicht                 boolean not null default true,
  blokkerend                boolean not null default false,
  min_aantal                int default 1 check (min_aantal >= 1),
  vereist_validatie_domein  text,
  bron                      text not null default 'handmatig' check (bron in ('handmatig')),
  actief                    boolean not null default true,
  governance_event_id       uuid references public.governance_events(id),
  aangemaakt_door           uuid references auth.users(id) on delete set null,
  aangemaakt_op             timestamptz default now(),
  fonds_id                  uuid not null references public.fondsen(id) on delete cascade
);

create index if not exists idx_req_instance_decision
  on public.procedure_requirement_instance(decision_id, stap_volgorde);

comment on table public.procedure_requirement_instance is
  'Instantie-scoped bewijslast (D7): op een lopende procedure toegevoegde requirements. Fonds-RLS + WITH CHECK; schrijven voorzitter/beheerder; append-only via soft-deactivate (actief=false). procedure_requirements blijft de TEMPLATE-bron.';

alter table public.procedure_requirement_instance enable row level security;

-- Lezen: eigen fonds.
drop policy if exists "req-instance eigen fonds lezen"
  on public.procedure_requirement_instance;
create policy "req-instance eigen fonds lezen" on public.procedure_requirement_instance
  for select using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- Toevoegen: eigen fonds + voorzitter/beheerder.
drop policy if exists "req-instance toevoegen voorzitter-beheerder"
  on public.procedure_requirement_instance;
create policy "req-instance toevoegen voorzitter-beheerder" on public.procedure_requirement_instance
  for insert with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and exists (select 1 from public.profielen
                 where id = auth.uid() and rol in ('voorzitter','beheerder'))
  );

-- Wijzigen (soft-deactivate): eigen fonds + voorzitter/beheerder.
drop policy if exists "req-instance wijzigen voorzitter-beheerder"
  on public.procedure_requirement_instance;
create policy "req-instance wijzigen voorzitter-beheerder" on public.procedure_requirement_instance
  for update using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  ) with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and exists (select 1 from public.profielen
                 where id = auth.uid() and rol in ('voorzitter','beheerder'))
  );

revoke all on public.procedure_requirement_instance from anon;
revoke delete, truncate, references, trigger
  on public.procedure_requirement_instance from authenticated;
grant select, insert, update
  on table public.procedure_requirement_instance to authenticated;

commit;

-- ============================================================
--  Verificatie:
--    select count(*) from public.procedure_requirement_instance;   -- 0
--    -- procedure_requirement_instance heeft een eigen fonds_id → Gate B
--    -- (policy noemt fonds_id). NIET in het A-parent-register opnemen.
-- ============================================================
