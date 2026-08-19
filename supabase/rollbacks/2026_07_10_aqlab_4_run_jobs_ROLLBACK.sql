-- ============================================================================
-- ROLLBACK 2026-07-10 (AQLab-4 / run-jobs)
-- ----------------------------------------------------------------------------
-- Draait de aqlab_4-migratie terug. Idempotent (if exists / guarded).
-- LET OP: de capability-seed wordt alleen verwijderd als er GEEN actieve grants
--   op hangen (FK-veiligheid). Bij bestaande grants blijft de referentierij staan
--   (deactiveren i.p.v. verwijderen is het non-destructieve alternatief).
-- ============================================================================

begin;

-- 5. Capability-seed terug (alleen zonder afhankelijke grants).
delete from public.platform_capabilities pc
 where pc.capability in ('platform.aqlab.operate', 'platform.aqlab.review')
   and not exists (
     select 1 from public.platform_identity_capabilities pic
      where pic.capability = pc.capability
   );

-- 2. aqlab_run_outputs additieve objecten terug.
drop index if exists public.uq_aqlab_run_outputs_run_tc_iter;
alter table public.aqlab_run_outputs
  drop constraint if exists aqlab_run_outputs_gate_status_check;
alter table public.aqlab_run_outputs drop column if exists gate_status;
alter table public.aqlab_run_outputs drop column if exists quality_score;

-- 4b/4c. Functies terug.
drop function if exists public.aqlab_claim_run_jobs(text, integer, integer);
drop function if exists public.aqlab_add_run_cost(uuid, numeric);

-- 1/3/4. Werk-queue + indexen terug (RLS/indexen vallen met de tabel weg).
drop index if exists public.idx_aqlab_run_jobs_status;
drop index if exists public.idx_aqlab_run_jobs_run;
drop table if exists public.aqlab_run_jobs;

commit;
