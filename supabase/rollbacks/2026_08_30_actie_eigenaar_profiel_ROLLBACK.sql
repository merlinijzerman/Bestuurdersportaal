-- Rollback van 2026_08_30_actie_eigenaar_profiel.sql.
-- Alleen toepassen ná rollback van de code: de UI/API verwacht daarna geen
-- eigenaar_id meer. Bestaande naam-snapshots blijven behouden.

begin;

drop trigger if exists trg_guard_decision_action_eigenaar on public.decision_actions;
drop function if exists public.fn_guard_decision_action_eigenaar();
drop index if exists public.idx_decision_actions_eigenaar_id;
alter table public.decision_actions drop column if exists eigenaar_id;

commit;
