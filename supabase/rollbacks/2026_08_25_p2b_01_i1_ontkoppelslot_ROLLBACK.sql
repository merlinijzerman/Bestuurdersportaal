-- ROLLBACK van 2026_08_25_p2b_01_i1_ontkoppelslot.sql (P2/PR-B, #167, 0189 §I1).
begin;

drop trigger if exists trg_bewijs_i1 on public.procedure_bewijs;
drop trigger if exists trg_vaststelling_i1 on public.procedure_vaststelling;
drop trigger if exists trg_approval_i1 on public.procedure_besluiten;
drop trigger if exists trg_aivalidation_i1 on public.decision_ai_interactions;
drop trigger if exists trg_evaluation_i1 on public.decision_evaluations;
drop trigger if exists trg_kpi_i1 on public.decision_conditions;
drop trigger if exists trg_assumption_i1 on public.decision_assumptions;
drop trigger if exists trg_risk_i1 on public.decision_risks;

drop function if exists public.fn_guard_bewijs_i1();
drop function if exists public.fn_guard_procedure_scoped_i1();
drop function if exists public.fn_guard_decision_scoped_i1();
drop function if exists public.fn_assert_feit_ontgrendeld(uuid);

commit;
