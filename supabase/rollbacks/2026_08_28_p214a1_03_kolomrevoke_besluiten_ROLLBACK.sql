-- ROLLBACK van 2026_08_28_p214a1_03 (#214-a1 / 0194). Herstelt UPDATE + DELETE.
-- LET OP: heropent het defect (besluit weer muteerbaar/verwijderbaar). Noodherstel.
begin;
grant update, delete on public.procedure_besluiten to authenticated;
commit;
