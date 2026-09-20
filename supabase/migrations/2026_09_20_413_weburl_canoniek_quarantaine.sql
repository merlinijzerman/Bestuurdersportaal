-- #413 T4-C — Canonieke webUrl-index met DATABEHOUDENDE quarantaine.
-- ---------------------------------------------------------------------------
-- Copilot Retrieval levert per hit een `webUrl`, geen DriveItem-id. De
-- locatorstap zoekt die URL daarom op in het al bestaande documentregister. Dat
-- mag maar één ding opleveren: EXACT ÉÉN rij, of niets.
--
-- Drie maatregelen, en ze doen elk iets anders:
--   1. `sharepoint_canoniek_weburl()` is de ENIGE canonicalisering. Zij voedt
--      een gegenereerde kolom, zodat opslag en opzoeking per constructie
--      dezelfde waarde gebruiken — niet tweemaal dezelfde bedoeling.
--   2. Een partiële unieke index maakt twee ACTIEVE rijen met dezelfde
--      canonieke URL binnen één bron onmogelijk.
--   3. `mapping_status` zet botsende rijen in QUARANTAINE in plaats van hun
--      `web_url` te wissen. Meting 20-09: Preview 1 botsingsgroep / 6 rijen,
--      Productie 0. Die zes rijen blijven volledig intact; ze vallen alleen
--      buiten de index en buiten de opzoekfunctie, en een volgende listing kan
--      ze vanzelf weer activeren.
--
-- WAAROM GEEN DECODE IN DE CANONICALISERING. `%2F` decoderen zou er een
-- padscheiding van maken en twee verschillende bestanden op elkaar kunnen
-- afbeelden. Padsegmenten worden daarom byte-gelijk overgenomen; alleen schema,
-- host, poort, query, fragment en trailing slash worden genormaliseerd.
-- Encodingverschillen tussen Copilot en de listing leiden zo tot een gemiste
-- mapping (fail-closed, zichtbaar in de teller) en nooit tot een verkeerde.
--
-- ROLLBACK: ../rollbacks/2026_09_20_413_weburl_canoniek_quarantaine_ROLLBACK.sql
begin;

-- ── 1. De canonicalisering ──────────────────────────────────────────────────
-- IMMUTABLE en STRICT: vereist voor een gegenereerde kolom. Bewust zonder
-- `SET search_path` en zonder SECURITY DEFINER — de functie roept uitsluitend
-- ingebouwde functies aan (die in `pg_catalog` staan, altijd eerst in het
-- zoekpad) en raakt geen enkele tabel. Er valt dus niets te kapen.
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

-- ── 2. Gegenereerde kolom + quarantainestatus ───────────────────────────────
alter table microsoft_private.sharepoint_documenten
  add column if not exists web_url_canoniek text
  generated always as (microsoft_private.sharepoint_canoniek_weburl(web_url)) stored;

alter table microsoft_private.sharepoint_documenten
  add column if not exists mapping_status text not null default 'actief';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'microsoft_private.sharepoint_documenten'::regclass
       and conname = 'sharepoint_documenten_mapping_status_check'
  ) then
    alter table microsoft_private.sharepoint_documenten
      add constraint sharepoint_documenten_mapping_status_check
      check (mapping_status in ('actief', 'botsing'));
  end if;
end $$;

-- ── 3. Bestaande botsingen in quarantaine, ZONDER gegevensverlies ───────────
-- `web_url` blijft staan; alleen de status verandert. De zes Preview-rijen zijn
-- hierna nog volledig leesbaar via `sharepoint_lees_document()` — ze doen alleen
-- niet mee aan de locatoropzoeking.
update microsoft_private.sharepoint_documenten d
   set mapping_status = 'botsing'
 where d.web_url_canoniek is not null
   and exists (
     select 1 from microsoft_private.sharepoint_documenten a
      where a.bron_id = d.bron_id
        and a.id <> d.id
        and a.web_url_canoniek = d.web_url_canoniek
   );

-- ── 4. De exact-één-invariant in het datamodel ──────────────────────────────
create unique index if not exists sharepoint_documenten_weburl_canoniek_uniek
  on microsoft_private.sharepoint_documenten(bron_id, web_url_canoniek)
  where web_url_canoniek is not null and mapping_status = 'actief';

-- ── 5. De upsert houdt de quarantaine zelf bij ──────────────────────────────
-- Zonder deze wijziging zou de unieke index de DOCUMENTENLIJST kunnen breken:
-- levert SharePoint ooit twee items met dezelfde canonieke URL, dan faalt de
-- insert en valt een bestaande productieroute om. Dat is een veel grotere
-- blast radius dan de Copilot-arm die de index beschermt.
--
-- Daarom in drie stappen:
--   a. alles wat deze listing aanraakt gaat eerst de index UIT (status
--      'botsing'). Daarmee kan geen enkele tussenstand van de upsert — ook een
--      omwisseling van twee URL's niet — de index schenden;
--   b. de upsert zelf, ongewijzigd behalve dat hij die status meegeeft;
--   c. één herclassificatie over de hele bron: uniek = 'actief', anders
--      'botsing'. Dit statement kan de index niet schenden, want twee rijen met
--      dezelfde canonieke URL krijgen allebei 'botsing'.
create or replace function microsoft_private.sharepoint_upsert_documenten(p_fonds uuid, p_bron uuid, p_versie integer, p_items jsonb)
returns table(ref uuid, extern_item_id text) language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
#variable_conflict use_column
declare
  v_bron sharepoint_bronnen%rowtype;
  v_refs uuid[];
  v_items text[];
begin
  select * into v_bron from sharepoint_bronnen where id = p_bron and fonds_id = p_fonds and status = 'actief';
  if v_bron.id is null then raise exception 'sharepoint bron hoort niet bij dit fonds of is niet actief'; end if;
  if p_versie <> v_bron.configuratieversie then raise exception 'verouderde sharepoint configuratieversie'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 5000 then raise exception 'ongeldige documentenlijst'; end if;

  -- (a) uit de index met alles wat deze listing aanraakt.
  update sharepoint_documenten
     set mapping_status = 'botsing'
   where bron_id = v_bron.id
     and item_id in (
       select x.item_id from jsonb_to_recordset(p_items) as x(item_id text)
        where coalesce(x.item_id, '') <> ''
     );

  -- (b) de bestaande upsert. De geschreven rijen worden in arrays bewaard in
  -- plaats van in een temp table: een temp table zou bij een tweede aanroep
  -- binnen dezelfde transactie al bestaan.
  with invoer as (
    select x.item_id, x.naam, x.bestandstype, x.mime_type, x.grootte, x.gewijzigd_op, x.etag, x.ctag, x.ouder_item_id, x.mappad, x.web_url
      from jsonb_to_recordset(p_items) as x(item_id text, naam text, bestandstype text, mime_type text, grootte bigint, gewijzigd_op timestamptz, etag text, ctag text, ouder_item_id text, mappad text, web_url text)
     where coalesce(x.item_id,'') <> '' and coalesce(x.naam,'') <> ''
  ), geschreven as (
    insert into sharepoint_documenten(bron_id,fonds_id,drive_id,item_id,naam,bestandstype,mime_type,grootte,gewijzigd_op,etag,ctag,ouder_item_id,mappad,web_url,status,configuratieversie,laatst_gezien_op,mapping_status)
    select v_bron.id, v_bron.fonds_id, v_bron.drive_id, i.item_id, left(i.naam,240), i.bestandstype, left(i.mime_type,120), i.grootte, i.gewijzigd_op, left(i.etag,200), left(i.ctag,200), i.ouder_item_id, left(coalesce(i.mappad,''),1000), i.web_url, 'gezien', p_versie, now(), 'botsing'
      from invoer i
    on conflict (bron_id, item_id) do update set
      drive_id = excluded.drive_id, naam = excluded.naam, bestandstype = excluded.bestandstype, mime_type = excluded.mime_type, grootte = excluded.grootte,
      gewijzigd_op = excluded.gewijzigd_op, etag = excluded.etag, ctag = excluded.ctag, ouder_item_id = excluded.ouder_item_id, mappad = excluded.mappad,
      web_url = excluded.web_url, status = 'gezien', configuratieversie = excluded.configuratieversie, laatst_gezien_op = now(), mapping_status = 'botsing'
    returning sharepoint_documenten.id, sharepoint_documenten.item_id
  )
  select array_agg(g.id), array_agg(g.item_id) into v_refs, v_items from geschreven g;

  -- (c) herclassificatie over de HELE bron.
  update sharepoint_documenten d
     set mapping_status = case
           when d.web_url_canoniek is null then 'actief'
           when exists (
             select 1 from sharepoint_documenten a
              where a.bron_id = d.bron_id and a.id <> d.id and a.web_url_canoniek = d.web_url_canoniek
           ) then 'botsing'
           else 'actief'
         end
   where d.bron_id = v_bron.id;

  return query
    select r.ref, r.extern_item_id
      from unnest(coalesce(v_refs, '{}'::uuid[]), coalesce(v_items, '{}'::text[])) as r(ref, extern_item_id);
end $$;

-- ── 6. De locatoropzoeking: exact één rij, of niets ─────────────────────────
-- De unieke index maakt ">1 actieve rij" onmogelijk, maar deze functie toetst
-- het alsnog: de index dekt alleen niet-null, actieve rijen, en een latere
-- indexwijziging mag hier niet stil een meervoudige match doorlaten.
-- Quarantainerijen vallen fail-closed af — ze bestaan voor de locator niet.
create or replace function microsoft_private.sharepoint_zoek_document_op_weburl(p_fonds uuid, p_bron uuid, p_weburl text)
returns table(id uuid, bron_id uuid, drive_id text, item_id text, root_item_id text, naam text, bestandstype text, mappad text, status text, bron_status text, site_hostnaam text, configuratieversie integer)
language sql security definer set search_path = microsoft_private, public, pg_temp as $$
  with sleutel as (
    select microsoft_private.sharepoint_canoniek_weburl(p_weburl) as canoniek
  ), kandidaat as (
    select d.id
      from sharepoint_documenten d
      join sharepoint_bronnen b on b.id = d.bron_id
      cross join sleutel s
     where s.canoniek is not null
       and d.fonds_id = p_fonds and b.fonds_id = p_fonds
       and d.bron_id = p_bron and b.id = p_bron
       and b.status = 'actief' and d.drive_id = b.drive_id and d.configuratieversie = b.configuratieversie
       and d.mapping_status = 'actief'
       and d.web_url_canoniek = s.canoniek
     limit 2
  )
  select d.id, d.bron_id, d.drive_id, d.item_id, b.root_item_id, d.naam, d.bestandstype, d.mappad, d.status, b.status, b.site_hostnaam, d.configuratieversie
    from kandidaat k
    join sharepoint_documenten d on d.id = k.id
    join sharepoint_bronnen b on b.id = d.bron_id
   where (select count(*) from kandidaat) = 1
$$;

revoke all on all tables in schema microsoft_private from public, anon, authenticated;
revoke all on all functions in schema microsoft_private from public, anon, authenticated;
grant execute on function microsoft_private.sharepoint_upsert_documenten(uuid,uuid,integer,jsonb) to microsoft_vault;
grant execute on function microsoft_private.sharepoint_zoek_document_op_weburl(uuid,uuid,text) to microsoft_vault;
grant execute on function microsoft_private.sharepoint_canoniek_weburl(text) to microsoft_vault;

commit;
