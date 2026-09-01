-- ROLLBACK van 2026_08_28_p3d_02_fn_besluit_status_omslag.sql (P3/PR-D, #168, 0193).
begin;
drop function if exists public.fn_besluit_status_omslag(uuid, text, text, text, jsonb);
commit;
