-- ROLLBACK van 2026_08_28_p3d_03_status_kolomrevoke.sql (P3/PR-D, #168, 0193).
-- Herstelt de tabel-brede UPDATE-grant voor authenticated (de toestand vóór PR-D).
begin;
revoke update on public.decision_objects from authenticated;
grant update on public.decision_objects to authenticated;
commit;
