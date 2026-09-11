-- Rollback Microsoft 365 fase 3 deel A (bronregistratie). Verwijdert de
-- private SharePoint-objecten; fase 1 en 2A blijven intact.
begin;
revoke execute on function microsoft_private.sharepoint_ontkoppel_bron(uuid,uuid) from microsoft_vault;
revoke execute on function microsoft_private.sharepoint_registreer_controle(uuid,uuid,boolean,text) from microsoft_vault;
revoke execute on function microsoft_private.sharepoint_configureer_bron(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text) from microsoft_vault;
revoke execute on function microsoft_private.sharepoint_lees_bron(uuid) from microsoft_vault;
revoke execute on function microsoft_private.sharepoint_lees_kandidaten(uuid) from microsoft_vault;
drop function if exists microsoft_private.sharepoint_ontkoppel_bron(uuid,uuid);
drop function if exists microsoft_private.sharepoint_registreer_controle(uuid,uuid,boolean,text);
drop function if exists microsoft_private.sharepoint_configureer_bron(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text);
drop function if exists microsoft_private.sharepoint_lees_bron(uuid);
drop function if exists microsoft_private.sharepoint_lees_kandidaten(uuid);
drop table if exists microsoft_private.sharepoint_bronnen;
drop table if exists microsoft_private.sharepoint_kandidaatsites;
commit;
