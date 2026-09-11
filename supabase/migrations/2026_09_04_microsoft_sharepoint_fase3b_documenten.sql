-- Microsoft 365 fase 3 (#321) — SharePoint read-only, deel B: documentreferenties.
-- Het register vertaalt een lokale, fondsgebonden referentie (uuid) naar een
-- extern drive-item en bewaart minimale presentatiemetadata plus versie-identiteit
-- (eTag/cTag) voor later bronbewijs. Het is GEEN autorisatiebron: zichtbaarheid en
-- preview worden per request live via Graph met het token van de gebruiker bepaald.
-- Geen bestandskopie, tekst, chunks, embeddings of preview-URL's.
-- ROLLBACK: ../rollbacks/2026_09_04_microsoft_sharepoint_fase3b_documenten_ROLLBACK.sql
begin;
create table if not exists microsoft_private.sharepoint_documenten (
  id uuid primary key default gen_random_uuid(),
  bron_id uuid not null references microsoft_private.sharepoint_bronnen(id) on delete cascade,
  fonds_id uuid not null references public.fondsen(id) on delete cascade,
  drive_id text not null,
  item_id text not null,
  naam text not null,
  bestandstype text check (bestandstype is null or bestandstype in ('pdf','docx','doc','pptx','ppt','xlsx','xls')),
  mime_type text,
  grootte bigint check (grootte is null or grootte >= 0),
  gewijzigd_op timestamptz,
  etag text,
  ctag text,
  ouder_item_id text,
  mappad text not null default '',
  web_url text check (web_url is null or web_url ~ '^https://[a-z0-9.-]+\.sharepoint\.com/'),
  status text not null default 'gezien' check (status in ('gezien','verwijderd','ontoegankelijk')),
  configuratieversie integer not null check (configuratieversie >= 1),
  eerst_gezien_op timestamptz not null default now(),
  laatst_gezien_op timestamptz not null default now(),
  unique (bron_id, item_id)
);
create index if not exists sharepoint_documenten_fonds_idx on microsoft_private.sharepoint_documenten(fonds_id, bron_id);
alter table microsoft_private.sharepoint_documenten enable row level security;

-- Upsert per (bron, item): rename/move/versie werken de bestaande referentie bij;
-- er ontstaat nooit een tweede referentie voor hetzelfde item. De bron moet bij
-- het fonds horen en actief zijn.
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

-- Fondsgebonden opzoeking: een referentie van fonds B levert voor fonds A niets op.
create or replace function microsoft_private.sharepoint_lees_document(p_fonds uuid, p_ref uuid)
returns table(id uuid, bron_id uuid, drive_id text, item_id text, root_item_id text, naam text, bestandstype text, mappad text, status text, bron_status text, site_hostnaam text, configuratieversie integer)
language sql security definer set search_path = microsoft_private, public, pg_temp as $$
  select d.id, d.bron_id, d.drive_id, d.item_id, b.root_item_id, d.naam, d.bestandstype, d.mappad, d.status, b.status, b.site_hostnaam, d.configuratieversie
    from sharepoint_documenten d join sharepoint_bronnen b on b.id = d.bron_id
   where d.fonds_id = p_fonds and b.fonds_id = p_fonds and d.id = p_ref
     and b.status = 'actief' and d.drive_id = b.drive_id and d.configuratieversie = b.configuratieversie
$$;

create or replace function microsoft_private.sharepoint_markeer_document(p_fonds uuid, p_ref uuid, p_status text)
returns void language sql security definer set search_path = microsoft_private, public, pg_temp as $$
  update sharepoint_documenten set status = p_status where fonds_id = p_fonds and id = p_ref and p_status in ('gezien','verwijderd','ontoegankelijk')
$$;

-- Inhoudsarme audit voor lijst en preview. Details mogen uitsluitend referenties,
-- aantallen, vlaggen en latency bevatten; een URL of Graph-body wordt geweigerd.
create or replace function microsoft_private.sharepoint_registreer_gebeurtenis(p_fonds uuid, p_gebruiker uuid, p_gebeurtenis text, p_correlation uuid, p_fout text, p_details jsonb)
returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
begin
  if p_gebeurtenis !~ '^microsoft\.sharepoint\.[a-z_.]+$' then raise exception 'ongeldige sharepoint gebeurtenis'; end if;
  if jsonb_typeof(coalesce(p_details,'{}'::jsonb)) <> 'object' or p_details::text ~* '(https?://|sharepoint\.com|bearer|token|drive_id|item_id)' then
    raise exception 'sharepoint audit-details bevatten niet-toegestane inhoud';
  end if;
  insert into audit_log(fonds_id,gebruiker_id,gebeurtenis,foutcategorie,correlation_id,details)
  values(p_fonds,p_gebruiker,p_gebeurtenis,left(nullif(p_fout,''),80),p_correlation,coalesce(p_details,'{}'::jsonb));
end $$;

revoke all on all tables in schema microsoft_private from public, anon, authenticated;
revoke all on all functions in schema microsoft_private from public, anon, authenticated;
grant execute on function microsoft_private.sharepoint_upsert_documenten(uuid,uuid,integer,jsonb) to microsoft_vault;
grant execute on function microsoft_private.sharepoint_lees_document(uuid,uuid) to microsoft_vault;
grant execute on function microsoft_private.sharepoint_markeer_document(uuid,uuid,text) to microsoft_vault;
grant execute on function microsoft_private.sharepoint_registreer_gebeurtenis(uuid,uuid,text,uuid,text,jsonb) to microsoft_vault;
commit;
