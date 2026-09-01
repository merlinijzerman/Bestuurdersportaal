-- ROLLBACK van P2/PR-A gedeelde bindingsmachinerie. HAND-RUN.
-- LET OP: draai eerst de rollbacks van de per-tabel-migraties (p2a_03..p2a_08) —
-- die droppen de wrappers die deze functies aanroepen. Anders faalt de drop op
-- een afhankelijkheid (correct: dan staat er nog een wrapper die de invariant
-- nodig heeft).
begin;
drop function if exists public.fn_log_gebonden_feit_mutatie(uuid, text, uuid, text, text);
drop function if exists public.fn_assert_gebonden_feit(uuid, uuid, text, text);
commit;
