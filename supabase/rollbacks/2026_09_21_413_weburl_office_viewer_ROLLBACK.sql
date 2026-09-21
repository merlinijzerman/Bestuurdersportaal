-- ROLLBACK van 2026_09_21_413_weburl_office_viewer.sql (#413 T4-C).
-- ---------------------------------------------------------------------------
-- Zet de canonicalisering terug naar de vorm van 2026_09_20 (zonder de
-- Office-viewerprefixen) en herstelt de afgeleide kolom, de classificatie en de
-- index in dezelfde volgorde als de migratie. `web_url` wordt niet aangeraakt.
--
-- LET OP: ná deze rollback vallen Word-, Excel- en PowerPointdocumenten waarvan
-- Graph een viewer-URL levert weer af onder `root`/`mapping`. Dat is het gedrag
-- van vóór de fix, niet een nieuw defect.
begin;

drop index if exists microsoft_private.sharepoint_documenten_weburl_canoniek_uniek;

create or replace function microsoft_private.sharepoint_canoniek_weburl(p_url text)
returns text language sql immutable strict as $$
  with delen as (
    select regexp_match(p_url, '^([A-Za-z][A-Za-z0-9+.-]*)://([^/?#]+)([^?#]*)') as d
  ), ontleed as (
    select
      lower(d[1]) as schema,
      lower(regexp_replace(d[2], ':443$', '')) as host,
      rtrim(d[3], '/') as pad
    from delen
  )
  select case
    when o.schema is null then null
    when o.schema <> 'https' then null
    when position('@' in o.host) > 0 then null
    when o.host !~ '^[a-z0-9][a-z0-9.-]*\.sharepoint\.com$' then null
    when o.pad = '' then null
    when o.pad ~ '[[:cntrl:]]' then null
    else 'https://' || o.host || o.pad
  end
  from ontleed o
$$;

revoke all on function microsoft_private.sharepoint_canoniek_weburl(text) from public, anon, authenticated;
grant execute on function microsoft_private.sharepoint_canoniek_weburl(text) to microsoft_vault;

alter table microsoft_private.sharepoint_documenten drop column if exists web_url_canoniek;
alter table microsoft_private.sharepoint_documenten
  add column web_url_canoniek text
  generated always as (microsoft_private.sharepoint_canoniek_weburl(web_url)) stored;

update microsoft_private.sharepoint_documenten d
   set mapping_status = case
         when d.web_url_canoniek is null then 'actief'
         when exists (
           select 1 from microsoft_private.sharepoint_documenten a
            where a.bron_id = d.bron_id and a.id <> d.id and a.web_url_canoniek = d.web_url_canoniek
         ) then 'botsing'
         else 'actief'
       end;

create unique index sharepoint_documenten_weburl_canoniek_uniek
  on microsoft_private.sharepoint_documenten(bron_id, web_url_canoniek)
  where web_url_canoniek is not null and mapping_status = 'actief';

commit;
