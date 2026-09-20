-- ROLLBACK van 2026_09_20_413_weburl_canoniek_quarantaine.sql (#413 T4-C).
-- ---------------------------------------------------------------------------
-- Draait de locatoropzoeking en de quarantaine volledig terug en herstelt
-- `sharepoint_upsert_documenten` naar de vorm van fase 3b
-- (2026_09_04_microsoft_sharepoint_fase3b_documenten.sql).
--
-- GEEN GEGEVENSVERLIES: `web_url` is door de migratie nooit gewijzigd, en de
-- twee kolommen die hier verdwijnen zijn volledig afgeleid (`web_url_canoniek`
-- is gegenereerd, `mapping_status` is een classificatie die de upsert opnieuw
-- opbouwt zodra de migratie weer wordt toegepast).
--
-- Volgorde: eerst de functies die de kolommen gebruiken, dan de index, dan de
-- kolommen, dan de canonicaliseringsfunctie.
begin;

drop function if exists microsoft_private.sharepoint_zoek_document_op_weburl(uuid,uuid,text);

-- De upsert terug naar de fase 3b-vorm: zonder statusbeheer en zonder
-- arrayvariabelen.
create or replace function microsoft_private.sharepoint_upsert_documenten(p_fonds uuid, p_bron uuid, p_versie integer, p_items jsonb)
returns table(ref uuid, extern_item_id text) language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
#variable_conflict use_column
declare v_bron sharepoint_bronnen%rowtype;
begin
  select * into v_bron from sharepoint_bronnen where id = p_bron and fonds_id = p_fonds and status = 'actief';
  if v_bron.id is null then raise exception 'sharepoint bron hoort niet bij dit fonds of is niet actief'; end if;
  if p_versie <> v_bron.configuratieversie then raise exception 'verouderde sharepoint configuratieversie'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 5000 then raise exception 'ongeldige documentenlijst'; end if;
  return query
  with invoer as (
    select x.item_id, x.naam, x.bestandstype, x.mime_type, x.grootte, x.gewijzigd_op, x.etag, x.ctag, x.ouder_item_id, x.mappad, x.web_url
      from jsonb_to_recordset(p_items) as x(item_id text, naam text, bestandstype text, mime_type text, grootte bigint, gewijzigd_op timestamptz, etag text, ctag text, ouder_item_id text, mappad text, web_url text)
     where coalesce(x.item_id,'') <> '' and coalesce(x.naam,'') <> ''
  ), geschreven as (
    insert into sharepoint_documenten(bron_id,fonds_id,drive_id,item_id,naam,bestandstype,mime_type,grootte,gewijzigd_op,etag,ctag,ouder_item_id,mappad,web_url,status,configuratieversie,laatst_gezien_op)
    select v_bron.id, v_bron.fonds_id, v_bron.drive_id, i.item_id, left(i.naam,240), i.bestandstype, left(i.mime_type,120), i.grootte, i.gewijzigd_op, left(i.etag,200), left(i.ctag,200), i.ouder_item_id, left(coalesce(i.mappad,''),1000), i.web_url, 'gezien', p_versie, now()
      from invoer i
    on conflict (bron_id, item_id) do update set
      drive_id = excluded.drive_id, naam = excluded.naam, bestandstype = excluded.bestandstype, mime_type = excluded.mime_type, grootte = excluded.grootte,
      gewijzigd_op = excluded.gewijzigd_op, etag = excluded.etag, ctag = excluded.ctag, ouder_item_id = excluded.ouder_item_id, mappad = excluded.mappad,
      web_url = excluded.web_url, status = 'gezien', configuratieversie = excluded.configuratieversie, laatst_gezien_op = now()
    returning sharepoint_documenten.id, sharepoint_documenten.item_id
  )
  select g.id, g.item_id from geschreven g;
end $$;

drop index if exists microsoft_private.sharepoint_documenten_weburl_canoniek_uniek;

alter table microsoft_private.sharepoint_documenten
  drop constraint if exists sharepoint_documenten_mapping_status_check;
alter table microsoft_private.sharepoint_documenten
  drop column if exists mapping_status;
alter table microsoft_private.sharepoint_documenten
  drop column if exists web_url_canoniek;

drop function if exists microsoft_private.sharepoint_canoniek_weburl(text);

revoke all on all tables in schema microsoft_private from public, anon, authenticated;
revoke all on all functions in schema microsoft_private from public, anon, authenticated;
grant execute on function microsoft_private.sharepoint_upsert_documenten(uuid,uuid,integer,jsonb) to microsoft_vault;

commit;
