-- #413 T4-C — Office-weergave-URL's in de canonicalisering.
-- ---------------------------------------------------------------------------
-- WAAROM. Graph levert voor Word-, Excel- en PowerPointbestanden vaak geen
-- bibliotheekpad maar een VIEWER-URL: `https://host/:w:/r/sites/…/a.docx`. De
-- labscan van #419 stelde dat live vast, en `sharepointDocumenten()` slaat die
-- vorm onveranderd op in `web_url` — terwijl een MAP wél het gewone pad krijgt.
-- De locator vergeleek daardoor `/:w:/r/sites/…` met `/sites/…` en wees élk
-- Word- en PowerPointdocument af: precies de twee bestandstypen waaruit de
-- PGB-fixtures bestaan.
--
-- De vier prefixen `/:w:/r/`, `/:x:/r/`, `/:p:/r/` en `/:b:/r/` worden daarom
-- weggestreken; het deel erachter ís het serverrelatieve pad. EXACT deze vier:
-- een SHARINGLINK (`/:w:/s/<token>`) draagt een token en geen pad, en hoort
-- fail-closed af te vallen in plaats van op goed geluk te matchen. Hoofdletters
-- tellen niet mee — alleen de letterlijke vier.
--
-- WAT DEZE MIGRATIE MOET DOEN, EN WAAROM DAT MEER IS DAN DE FUNCTIE VERVANGEN.
-- `web_url_canoniek` is een STORED generated column. Postgres herberekent die
-- NIET wanneer de onderliggende functie verandert — en waarschuwt er ook niet
-- voor. Geverifieerd op postgres:17: na `create or replace` van de functie
-- bleef de opgeslagen waarde staan tot een `update` de rij aanraakte. Zonder
-- geforceerde herschrijving zou de index dus op oude waarden matchen en de
-- opzoeking op nieuwe: stil, en precies verkeerd.
--
-- Volgorde: index eruit → functie vervangen → kolom drop + opnieuw aanmaken
-- (dat herberekent gegarandeerd élke rij) → opnieuw classificeren (de nieuwe
-- normalisatie kan rijen laten samenvallen die eerder verschilden) → index
-- terug. Er wordt geen enkele `web_url` gewijzigd of gewist.
--
-- ROLLBACK: ../rollbacks/2026_09_21_413_weburl_office_viewer_ROLLBACK.sql
begin;

-- 1. De index eruit: hij hangt aan de kolom die zo wordt vervangen, en tijdens
--    de herclassificatie mag geen tussenstand hem kunnen schenden.
drop index if exists microsoft_private.sharepoint_documenten_weburl_canoniek_uniek;

-- 2. De canonicalisering, met de viewerprefixen erbij.
create or replace function microsoft_private.sharepoint_canoniek_weburl(p_url text)
returns text language sql immutable strict as $$
  with delen as (
    select regexp_match(p_url, '^([A-Za-z][A-Za-z0-9+.-]*)://([^/?#]+)([^?#]*)') as d
  ), ontleed as (
    select
      lower(d[1]) as schema,
      lower(regexp_replace(d[2], ':443$', '')) as host,
      rtrim(d[3], '/') as ruw_pad
    from delen
  ), genormaliseerd as (
    select
      o.schema,
      o.host,
      -- `/r` = resource: het deel erna is het serverrelatieve pad. `/s`
      -- (sharing) heeft die eigenschap niet en blijft daarom ongemoeid.
      case
        when o.ruw_pad ~ '^/:[wxpb]:/r/' then substring(o.ruw_pad from 7)
        else o.ruw_pad
      end as pad
    from ontleed o
  )
  select case
    when g.schema is null then null
    when g.schema <> 'https' then null
    when position('@' in g.host) > 0 then null
    when g.host !~ '^[a-z0-9][a-z0-9.-]*\.sharepoint\.com$' then null
    when g.pad = '' then null
    when g.pad ~ '[[:cntrl:]]' then null
    else 'https://' || g.host || g.pad
  end
  from genormaliseerd g
$$;

revoke all on function microsoft_private.sharepoint_canoniek_weburl(text) from public, anon, authenticated;
grant execute on function microsoft_private.sharepoint_canoniek_weburl(text) to microsoft_vault;

-- 3. De kolom opnieuw opbouwen. Drop + add is hier geen grove bijl maar de
--    enige constructie die élke rij gegarandeerd herberekent; `web_url` zelf
--    wordt niet aangeraakt en de kolom is volledig afgeleid.
alter table microsoft_private.sharepoint_documenten drop column if exists web_url_canoniek;
alter table microsoft_private.sharepoint_documenten
  add column web_url_canoniek text
  generated always as (microsoft_private.sharepoint_canoniek_weburl(web_url)) stored;

-- 4. Opnieuw classificeren over ALLE bronnen. De nieuwe normalisatie kan twee
--    rijen laten samenvallen die eerder verschilden (een viewer-URL en een
--    bibliotheek-URL van hetzelfde pad), en kan omgekeerd een oude botsing
--    oplossen. Eén statement, dus geen tussenstand die de index zou schenden.
update microsoft_private.sharepoint_documenten d
   set mapping_status = case
         when d.web_url_canoniek is null then 'actief'
         when exists (
           select 1 from microsoft_private.sharepoint_documenten a
            where a.bron_id = d.bron_id and a.id <> d.id and a.web_url_canoniek = d.web_url_canoniek
         ) then 'botsing'
         else 'actief'
       end;

-- 5. De invariant opnieuw vastleggen — mét een expliciete controle vooraf, zodat
--    een fout in stap 4 een leesbare melding geeft in plaats van een kale
--    indexschending.
do $$
declare v_botsingen integer;
begin
  select count(*) into v_botsingen from (
    select bron_id, web_url_canoniek
      from microsoft_private.sharepoint_documenten
     where web_url_canoniek is not null and mapping_status = 'actief'
     group by bron_id, web_url_canoniek having count(*) > 1) g;
  if v_botsingen > 0 then
    raise exception 'herclassificatie liet % actieve canonieke botsing(en) staan', v_botsingen;
  end if;
end $$;

create unique index sharepoint_documenten_weburl_canoniek_uniek
  on microsoft_private.sharepoint_documenten(bron_id, web_url_canoniek)
  where web_url_canoniek is not null and mapping_status = 'actief';

-- 6. Bewijs dat er geen stale waarde is achtergebleven: elke opgeslagen
--    canonieke waarde moet gelijk zijn aan wat de functie nú oplevert.
do $$
declare v_stale integer;
begin
  select count(*) into v_stale
    from microsoft_private.sharepoint_documenten
   where web_url_canoniek is distinct from microsoft_private.sharepoint_canoniek_weburl(web_url);
  if v_stale > 0 then
    raise exception '% rij(en) dragen een verouderde canonieke waarde', v_stale;
  end if;
end $$;

commit;
