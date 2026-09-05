-- Microsoft 365 fase 3 (#321) — SharePoint read-only, deel A: bronregistratie.
-- Kandidaatsites worden buiten de browser geregistreerd; de gekozen bron bindt
-- fonds, fase-1-verbinding, Entra-tenant, site, documentbibliotheek en rootmap
-- in de private schema. Externe site-/drive-/item-id's zijn nooit browserleesbaar;
-- de microsoft_vault-rol is de enige technische aanroeper van de functies hieronder.
-- ROLLBACK: ../rollbacks/2026_09_04_microsoft_sharepoint_fase3_ROLLBACK.sql
begin;

-- Door de databasebeheerder per runbook gevuld (security/MICROSOFT-365-F3-RUNBOOK.md).
-- Er is bewust geen vaultfunctie om kandidaten te schrijven: het portaal kan
-- zichzelf geen extra sites toewijzen.
create table if not exists microsoft_private.sharepoint_kandidaatsites (
  id uuid primary key default gen_random_uuid(),
  fonds_id uuid not null references public.fondsen(id) on delete cascade,
  hostnaam text not null check (hostnaam ~ '^[a-z0-9-]+\.sharepoint\.com$'),
  server_relatief_pad text not null check (server_relatief_pad ~ '^/[A-Za-z0-9._~/-]*$' and server_relatief_pad !~ '//' and server_relatief_pad !~ '/\.\./'),
  weergavenaam text not null check (length(weergavenaam) between 1 and 160),
  actief boolean not null default true,
  geregistreerd_op timestamptz not null default now(),
  unique (fonds_id, hostnaam, server_relatief_pad)
);
create table if not exists microsoft_private.sharepoint_bronnen (
  id uuid primary key default gen_random_uuid(),
  fonds_id uuid not null unique references public.fondsen(id) on delete cascade,
  kandidaat_id uuid not null references microsoft_private.sharepoint_kandidaatsites(id) on delete restrict,
  verbinding_id uuid not null references microsoft_private.verbindingen(id) on delete restrict,
  gebruiker_id uuid not null references auth.users(id) on delete restrict,
  tenant_id text not null,
  site_id text not null,
  site_weergavenaam text not null,
  site_hostnaam text not null,
  drive_id text not null,
  drive_weergavenaam text not null,
  root_item_id text not null,
  root_pad text not null default '',
  weergavenaam text not null,
  status text not null default 'actief' check (status in ('actief','fout','toestemming_nodig','ontkoppeld')),
  configuratieversie integer not null default 1 check (configuratieversie >= 1),
  laatst_gecontroleerd_op timestamptz,
  laatst_foutcategorie text,
  bijgewerkt_op timestamptz not null default now(),
  check (site_hostnaam ~ '^[a-z0-9-]+\.sharepoint\.com$'),
  check (split_part(site_id, ',', 1) = site_hostnaam)
);
alter table microsoft_private.sharepoint_kandidaatsites enable row level security;
alter table microsoft_private.sharepoint_bronnen enable row level security;

create or replace function microsoft_private.sharepoint_lees_kandidaten(p_fonds uuid)
returns table(id uuid, hostnaam text, server_relatief_pad text, weergavenaam text)
language sql security definer set search_path = microsoft_private, public, pg_temp as $$
  select k.id, k.hostnaam, k.server_relatief_pad, k.weergavenaam
    from sharepoint_kandidaatsites k
   where k.fonds_id = p_fonds and k.actief
   order by k.weergavenaam
$$;

-- Fondsbrede, niet-gevoelige status plus de technische bronvelden die de
-- server nodig heeft. Beheerroutes blijven achter fonds.config.manage; gewone
-- fondsgebruikers krijgen via de route uitsluitend de projectie zonder id's.
create or replace function microsoft_private.sharepoint_lees_bron(p_fonds uuid)
returns table(id uuid, kandidaat_id uuid, gebruiker_id uuid, tenant_id text, site_id text, site_weergavenaam text, site_hostnaam text, drive_id text, drive_weergavenaam text, root_item_id text, root_pad text, weergavenaam text, status text, configuratieversie integer, laatst_gecontroleerd_op timestamptz, laatst_foutcategorie text)
language sql security definer set search_path = microsoft_private, public, pg_temp as $$
  select b.id, b.kandidaat_id, b.gebruiker_id, b.tenant_id, b.site_id, b.site_weergavenaam, b.site_hostnaam, b.drive_id, b.drive_weergavenaam, b.root_item_id, b.root_pad, b.weergavenaam, b.status, b.configuratieversie, b.laatst_gecontroleerd_op, b.laatst_foutcategorie
    from sharepoint_bronnen b
   where b.fonds_id = p_fonds
$$;

-- De bron bindt de keuze aan precies de fase-1-koppeling én de geregistreerde
-- kandidaat van hetzelfde fonds. Een gestolen site-id van een ander fonds of
-- een kandidaat van een ander fonds wordt geweigerd.
create or replace function microsoft_private.sharepoint_configureer_bron(
  p_fonds uuid, p_gebruiker uuid, p_kandidaat uuid, p_tenant text, p_site_id text, p_site_naam text, p_site_host text,
  p_drive_id text, p_drive_naam text, p_root_item text, p_root_pad text, p_naam text
) returns uuid language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
declare v_verbinding uuid; v_kandidaat sharepoint_kandidaatsites%rowtype; v_id uuid;
begin
  select * into v_kandidaat from sharepoint_kandidaatsites where id = p_kandidaat and fonds_id = p_fonds and actief for update;
  if v_kandidaat.id is null or v_kandidaat.hostnaam <> lower(p_site_host) then
    raise exception 'sharepoint kandidaatsite hoort niet bij dit fonds';
  end if;
  select id into v_verbinding from verbindingen
   where fonds_id = p_fonds and gebruiker_id = p_gebruiker and tenant_id = p_tenant
     and status = 'gekoppeld' and 'Sites.Selected' = any(scopes) for update;
  if v_verbinding is null or coalesce(p_site_id,'') = '' or coalesce(p_drive_id,'') = '' or coalesce(p_root_item,'') = '' or coalesce(p_naam,'') = '' then
    raise exception 'sharepoint bronconfiguratie is ongeldig';
  end if;
  insert into sharepoint_bronnen(fonds_id,kandidaat_id,verbinding_id,gebruiker_id,tenant_id,site_id,site_weergavenaam,site_hostnaam,drive_id,drive_weergavenaam,root_item_id,root_pad,weergavenaam,status,configuratieversie,laatst_gecontroleerd_op,laatst_foutcategorie,bijgewerkt_op)
  values(p_fonds,v_kandidaat.id,v_verbinding,p_gebruiker,p_tenant,p_site_id,left(p_site_naam,160),lower(p_site_host),p_drive_id,left(p_drive_naam,160),p_root_item,left(coalesce(p_root_pad,''),1000),left(p_naam,160),'actief',1,now(),null,now())
  on conflict (fonds_id) do update set
    kandidaat_id=excluded.kandidaat_id, verbinding_id=excluded.verbinding_id, gebruiker_id=excluded.gebruiker_id, tenant_id=excluded.tenant_id,
    site_id=excluded.site_id, site_weergavenaam=excluded.site_weergavenaam, site_hostnaam=excluded.site_hostnaam,
    drive_id=excluded.drive_id, drive_weergavenaam=excluded.drive_weergavenaam, root_item_id=excluded.root_item_id, root_pad=excluded.root_pad,
    weergavenaam=excluded.weergavenaam, status='actief', configuratieversie=sharepoint_bronnen.configuratieversie+1,
    laatst_gecontroleerd_op=now(), laatst_foutcategorie=null, bijgewerkt_op=now()
  returning id into v_id;
  insert into audit_log(fonds_id,gebruiker_id,gebeurtenis,details)
  values(p_fonds,p_gebruiker,'microsoft.sharepoint.bron_gekozen',jsonb_build_object('bron_id',v_id,'configuratieversie',(select configuratieversie from sharepoint_bronnen where id=v_id)));
  return v_id;
end $$;

create or replace function microsoft_private.sharepoint_registreer_controle(p_fonds uuid, p_gebruiker uuid, p_ok boolean, p_fout text)
returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from sharepoint_bronnen where fonds_id = p_fonds and status <> 'ontkoppeld' for update;
  if v_id is null then raise exception 'geen actieve sharepoint bron voor dit fonds'; end if;
  update sharepoint_bronnen
     set laatst_gecontroleerd_op = case when p_ok then now() else laatst_gecontroleerd_op end,
         status = case when p_ok then 'actief' when p_fout = 'toestemming_of_token' then 'toestemming_nodig' else 'fout' end,
         laatst_foutcategorie = case when p_ok then null else left(coalesce(nullif(p_fout,''),'onverwachte_fout'),80) end,
         bijgewerkt_op = now()
   where id = v_id;
  insert into audit_log(fonds_id,gebruiker_id,gebeurtenis,foutcategorie,details)
  values(p_fonds,p_gebruiker,case when p_ok then 'microsoft.sharepoint.controle.geslaagd' else 'microsoft.sharepoint.controle.mislukt' end,
         case when p_ok then null else left(coalesce(nullif(p_fout,''),'onverwachte_fout'),80) end, jsonb_build_object('bron_id',v_id));
end $$;

-- Lokaal ontkoppelen laat de rij staan (configuratieversie en latere
-- documentreferenties blijven herleidbaar) maar sluit de bron voor gebruik.
create or replace function microsoft_private.sharepoint_ontkoppel_bron(p_fonds uuid, p_gebruiker uuid)
returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from sharepoint_bronnen where fonds_id = p_fonds for update;
  if v_id is null then return; end if;
  update sharepoint_bronnen set status='ontkoppeld', laatst_foutcategorie=null, bijgewerkt_op=now() where id = v_id;
  insert into audit_log(fonds_id,gebruiker_id,gebeurtenis,details) values(p_fonds,p_gebruiker,'microsoft.sharepoint.bron_ontkoppeld',jsonb_build_object('bron_id',v_id));
end $$;

revoke all on all tables in schema microsoft_private from public, anon, authenticated;
revoke all on all functions in schema microsoft_private from public, anon, authenticated;
grant execute on function microsoft_private.sharepoint_lees_kandidaten(uuid) to microsoft_vault;
grant execute on function microsoft_private.sharepoint_lees_bron(uuid) to microsoft_vault;
grant execute on function microsoft_private.sharepoint_configureer_bron(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text) to microsoft_vault;
grant execute on function microsoft_private.sharepoint_registreer_controle(uuid,uuid,boolean,text) to microsoft_vault;
grant execute on function microsoft_private.sharepoint_ontkoppel_bron(uuid,uuid) to microsoft_vault;
commit;
