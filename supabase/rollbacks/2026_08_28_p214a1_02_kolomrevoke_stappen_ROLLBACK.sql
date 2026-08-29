-- ROLLBACK van 2026_08_28_p214a1_02 (#214-a1 / 0194). Herstelt de tabel-brede
-- UPDATE-grant. LET OP: heropent het vervalsbaarheidsdefect. Alleen noodherstel.
begin;
grant update on public.procedure_stappen to authenticated;
commit;
