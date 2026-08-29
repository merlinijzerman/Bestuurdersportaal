-- ROLLBACK van 2026_08_28_p214a1_01 (#214-a1 / 0194). Verwijdert de drie
-- schrijf-RPC's. Draai NIET zonder migratie 02 terug te draaien — anders is er geen
-- owner-pad meer naar procedure_stappen.status.
begin;
drop function if exists public.fn_stap_afronden(uuid, uuid);
drop function if exists public.fn_stap_activeren(uuid, uuid);
drop function if exists public.fn_stap_heropenen(uuid, uuid, text);
commit;
