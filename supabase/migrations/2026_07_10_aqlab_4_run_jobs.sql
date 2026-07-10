-- ============================================================================
-- Migratie 2026-07-10 (AQLab-4 / run-jobs) — async werk-queue + output-rollup
-- ----------------------------------------------------------------------------
-- WAAROM (werkticket AQL-2, run-engine & scoring):
--   1. aqlab_run_jobs — de async werk-queue: één idempotente rij per
--      (run, testcase, iteratie). De run-orchestrator plant deze rijen bij
--      `startRun`; een worker (cron-gedraind) claimt batches via
--      `FOR UPDATE SKIP LOCKED` met lease/timeout/retry. BEWUST los van
--      aqlab_run_outputs: bij persist_mode='none' mogen er GEEN output-rijen
--      bestaan, maar de run moet zijn werk wél kunnen tracken. Dit is
--      operationele state (GEEN append-only) — status/attempts/lease muteren,
--      analoog aan document_processing_jobs (P1).
--   2. aqlab_run_outputs — additieve per-output rollup (quality_score,
--      gate_status) t.b.v. de scorekaart en persist_mode='metadata_only', plus
--      een unieke (run, testcase, iteratie)-sleutel voor idempotent wegschrijven.
--   3. platform_capabilities — seed van de twee AQLab-capabilities
--      (platform.aqlab.operate / .review). Bron-van-waarheid blijft de code-union
--      in lib/platform-capabilities.ts (CI-check TO §12 test 17); deze seed
--      spiegelt die (FK-integriteit voor grants).
--
-- AUTORISATIE/RLS: aqlab_run_jobs deny-by-default, service-role via de
--   platform-wrapper (decision 0058). Provider-globaal, geen fonds_id in MVP.
--
-- Idempotent (create table/column/index if not exists + guarded constraint).
-- Transactioneel. Eerst in Supabase draaien, DAN code-deploy.
-- ROLLBACK: 2026_07_10_aqlab_4_run_jobs_ROLLBACK.sql
-- VOLGORDE: draait NA aqlab_1/2 (verwijst naar runs/test_cases/run_outputs) en
--   NA het platformfundament (platform_capabilities bestaat).
-- TENANT-IMPACT: geen (provider-globaal, geen fonds_id).
-- ============================================================================

begin;

-- ── 1. aqlab_run_jobs — async werk-queue (operationele state, NIET append-only)
create table if not exists public.aqlab_run_jobs (
  id               uuid primary key default uuid_generate_v4(),
  run_id           uuid not null references public.aqlab_runs(id) on delete cascade,
  test_case_id     uuid references public.aqlab_test_cases(id) on delete set null,
  iteratie         integer not null default 1,
  status           text not null default 'wachtend'
                     check (status in ('wachtend','bezig','klaar','mislukt','overgeslagen')),
  attempts         integer not null default 0,
  max_attempts     integer not null default 2,
  lease_expires_at timestamptz,                       -- claim-lease; verlopen ⇒ herclaimbaar
  worker_id        text,                              -- welke worker de job claimde
  foutcode         text,
  aangemaakt_op    timestamptz not null default now(),
  bijgewerkt_op    timestamptz not null default now(),
  -- Idempotentiesleutel: één werk-rij per (run × testcase × iteratie).
  unique (run_id, test_case_id, iteratie)
);
comment on table public.aqlab_run_jobs is
  'AQLab GLOBAAL. Async werk-queue per (run×testcase×iteratie); claim via FOR UPDATE SKIP LOCKED + lease. Operationele state (muteerbaar), geen fonds_id.';

-- ── 2. aqlab_run_outputs — additieve per-output rollup + idempotentiesleutel ──
alter table public.aqlab_run_outputs
  add column if not exists quality_score numeric;
alter table public.aqlab_run_outputs
  add column if not exists gate_status text;

-- gate_status-CHECK guarded (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'aqlab_run_outputs_gate_status_check'
  ) then
    alter table public.aqlab_run_outputs
      add constraint aqlab_run_outputs_gate_status_check
      check (gate_status is null or gate_status in ('pass','geblokkeerd','review_vereist'));
  end if;
end $$;

comment on column public.aqlab_run_outputs.quality_score is
  'Gewogen kwaliteitsscore 0-100 (gradueel). STRIKT gescheiden van gate_status.';
comment on column public.aqlab_run_outputs.gate_status is
  'Blokkade-uitkomst (categorisch): pass / geblokkeerd / review_vereist. Onafhankelijk van quality_score.';

-- Defense-in-depth tegen dubbele outputs per (run×testcase×iteratie) voor het
-- niet-NULL testcase-pad. LET OP: standaard NULLS DISTINCT ⇒ deze index dedupt
-- NIET het ad-hoc pad (test_case_id NULL). De echte idempotentie draait daarom in
-- de orchestrator via delete-then-insert per sleutel (run-orchestrator.ts), niet
-- via ON CONFLICT. Unieke index i.p.v. constraint zodat `if not exists` herhaalbaar is.
create unique index if not exists uq_aqlab_run_outputs_run_tc_iter
  on public.aqlab_run_outputs(run_id, test_case_id, iteratie);

-- ── 3. RLS: aan, deny-by-default (decision 0058) ────────────────────────────
alter table public.aqlab_run_jobs enable row level security;

-- ── 4. Indexen ──────────────────────────────────────────────────────────────
-- Partiële index op de te-draaien statussen (claim-/drain-query).
create index if not exists idx_aqlab_run_jobs_status
  on public.aqlab_run_jobs(status) where status in ('wachtend','bezig');
create index if not exists idx_aqlab_run_jobs_run
  on public.aqlab_run_jobs(run_id);

-- ── 4b. Atomische claim-functie (FOR UPDATE SKIP LOCKED) ────────────────────
-- PostgREST kan geen `for update skip locked` uitdrukken; daarom een RPC. De
-- worker (service-role) claimt tot p_limit wachtende óf lease-verlopen jobs,
-- zet ze op 'bezig' met een verse lease en verhoogt attempts. security definer +
-- vaste search_path (defense-in-depth; de service-role omzeilt RLS toch al).
create or replace function public.aqlab_claim_run_jobs(
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer
) returns setof public.aqlab_run_jobs
language plpgsql
security definer
set search_path = public
as $f$
begin
  return query
  update public.aqlab_run_jobs j
     set status = 'bezig',
         worker_id = p_worker_id,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempts = j.attempts + 1,
         bijgewerkt_op = now()
   where j.id in (
     select k.id
       from public.aqlab_run_jobs k
      where k.status = 'wachtend'
         or (k.status = 'bezig' and k.lease_expires_at is not null and k.lease_expires_at < now())
      order by k.aangemaakt_op
      for update skip locked
      limit greatest(p_limit, 0)
   )
  returning j.*;
end
$f$;

-- Geen EXECUTE voor anon/authenticated: uitsluitend de service-role draait de worker.
revoke all on function public.aqlab_claim_run_jobs(text, integer, integer) from public;

-- ── 4c. Atomische kostenoptelling ───────────────────────────────────────────
-- Voorkomt lost-updates op totale_kosten wanneer meerdere worker-invocaties
-- verschillende jobs van dezelfde run verwerken (kostenplafond blijft dan
-- correct afdwingbaar). Retourneert de nieuwe cumulatieve kosten.
create or replace function public.aqlab_add_run_cost(
  p_run_id uuid,
  p_delta numeric
) returns numeric
language plpgsql
security definer
set search_path = public
as $f$
declare
  v numeric;
begin
  update public.aqlab_runs
     set totale_kosten = coalesce(totale_kosten, 0) + coalesce(p_delta, 0)
   where id = p_run_id
   returning totale_kosten into v;
  return v;
end
$f$;
revoke all on function public.aqlab_add_run_cost(uuid, numeric) from public;

-- ── 5. Capability-seed (spiegelt lib/platform-capabilities.ts) ──────────────
insert into public.platform_capabilities (capability, omschrijving) values
  ('platform.aqlab.operate', 'AI Quality Lab: runs starten, scorekaarten en run-overzicht inzien'),
  ('platform.aqlab.review',  'AI Quality Lab: menselijke review/aftekening (bevestig/overrule) op outputs')
on conflict (capability) do nothing;

commit;

-- ── Verificatie (handmatig ná de migratie) ─────────────────────────────────
-- 1. Werk-queue bestaat met RLS aan, geen permissive policies:
--      select relname, relrowsecurity from pg_class where relname = 'aqlab_run_jobs';
--      select count(*) from pg_policies where tablename = 'aqlab_run_jobs';   -- 0
-- 2. Idempotentiesleutel afgedwongen (moet FALEN bij dubbele insert):
--      -- twee keer dezelfde (run_id, test_case_id, iteratie) → unique violation.
-- 3. Rollup-kolommen + CHECK aanwezig:
--      select column_name from information_schema.columns
--       where table_name='aqlab_run_outputs' and column_name in ('quality_score','gate_status');
-- 4. Twee AQLab-caps geseed:
--      select capability from public.platform_capabilities where capability like 'platform.aqlab.%';
