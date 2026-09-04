-- Rollback Microsoft 365 fase 3 deel B (documentreferenties). Deel A blijft intact.
begin;
revoke execute on function microsoft_private.sharepoint_registreer_gebeurtenis(uuid,uuid,text,uuid,text,jsonb) from microsoft_vault;
revoke execute on function microsoft_private.sharepoint_markeer_document(uuid,uuid,text) from microsoft_vault;
revoke execute on function microsoft_private.sharepoint_lees_document(uuid,uuid) from microsoft_vault;
revoke execute on function microsoft_private.sharepoint_upsert_documenten(uuid,uuid,integer,jsonb) from microsoft_vault;
drop function if exists microsoft_private.sharepoint_registreer_gebeurtenis(uuid,uuid,text,uuid,text,jsonb);
drop function if exists microsoft_private.sharepoint_markeer_document(uuid,uuid,text);
drop function if exists microsoft_private.sharepoint_lees_document(uuid,uuid);
drop function if exists microsoft_private.sharepoint_upsert_documenten(uuid,uuid,integer,jsonb);
drop table if exists microsoft_private.sharepoint_documenten;
commit;
