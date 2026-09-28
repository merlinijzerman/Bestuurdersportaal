-- Rollback #462 PR-2 — SharePoint-mapregister en agendapuntkoppeling.
-- Verwijdert uitsluitend de objecten van deze migratie. Het documentregister
-- (fase 3B, #321) en de #413-aanvullingen blijven intact; alleen het
-- composite-FK-doel `sharepoint_documenten_fonds_id_id_uniek` gaat eraf, en dat
-- kan pas nadat de koppeltabel (de enige verwijzer) weg is.
-- LET OP: koppelingen en maprefs gaan hierbij verloren. SharePoint zelf en het
-- documentregister worden niet geraakt.
begin;
revoke execute on function microsoft_private.sharepoint_lees_agendapunt_koppelingen(uuid,uuid[]) from microsoft_vault;
revoke execute on function microsoft_private.sharepoint_ontkoppel_agendapunt(uuid,uuid,uuid) from microsoft_vault;
revoke execute on function microsoft_private.sharepoint_koppel_agendapunt(uuid,uuid,uuid,text,uuid) from microsoft_vault;
revoke execute on function microsoft_private.sharepoint_lees_map(uuid,uuid) from microsoft_vault;
revoke execute on function microsoft_private.sharepoint_upsert_mappen(uuid,uuid,integer,jsonb) from microsoft_vault;
drop function if exists microsoft_private.sharepoint_lees_agendapunt_koppelingen(uuid,uuid[]);
drop function if exists microsoft_private.sharepoint_ontkoppel_agendapunt(uuid,uuid,uuid);
drop function if exists microsoft_private.sharepoint_koppel_agendapunt(uuid,uuid,uuid,text,uuid);
drop table if exists microsoft_private.agendapunt_sharepoint_koppelingen;
drop function if exists microsoft_private.fn_agendapunt_sharepoint_koppeling_validatie();
drop function if exists microsoft_private.sharepoint_lees_map(uuid,uuid);
drop function if exists microsoft_private.sharepoint_upsert_mappen(uuid,uuid,integer,jsonb);
drop table if exists microsoft_private.sharepoint_mappen;
alter table microsoft_private.sharepoint_documenten drop constraint if exists sharepoint_documenten_fonds_id_id_uniek;
commit;
