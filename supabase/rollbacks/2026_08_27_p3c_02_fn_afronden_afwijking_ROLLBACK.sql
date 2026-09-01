-- ROLLBACK van 2026_08_27_p3c_02_fn_afronden_afwijking.sql (P3/PR-C, #168, 0192).
-- Verwijdert de twee functies. De kolommen (p3c_01) blijven; die hebben een eigen
-- rollback.
begin;

drop function if exists public.fn_stap_afronden_met_afwijking(uuid, uuid, text, boolean);
drop function if exists public.fn_stap_open_per_zwaarte(uuid);

commit;
