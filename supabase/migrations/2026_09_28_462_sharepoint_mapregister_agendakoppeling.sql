-- #462 PR-2 (werkpakket B) — SharePoint-mapregister en agendapuntkoppeling.
-- ---------------------------------------------------------------------------
-- WAAROM. De documentenlijst gaf voor mappen alleen PADEN terug. Een pad is geen
-- duurzame of vertrouwde sleutel: een rename verandert het, en de browser kan
-- elk pad verzinnen. Voor "vraag de AI over deze map" en "koppel deze map aan
-- een agendapunt" is een lokale, fondsgebonden opaque referentie nodig — exact
-- zoals `sharepoint_documenten` die voor bestanden al levert (fase 3B, #321).
--
-- WAT ER KOMT.
--   1. `microsoft_private.sharepoint_mappen` — spiegel van het documentregister:
--      lokale uuid ↔ (bron, drive, item). Geen inhoud, geen URL's. GEEN
--      autorisatiebron: toegang wordt per request live via Graph getoetst.
--   2. `microsoft_private.agendapunt_sharepoint_koppelingen` — n-op-n tussen
--      agendapunt en precies één documentref óf één mapref. Koppelen wijzigt
--      niets in SharePoint en kopieert niets naar het portaal; ontkoppelen
--      verwijdert uitsluitend de koppelrij.
--   3. Smalle SECURITY DEFINER-RPC's voor `microsoft_vault`; de browserrollen
--      hebben op geen enkel object hier rechten.
--
-- FONDSCONSISTENTIE (besluit 0007).
--   * Register-kant DECLARATIEF: composite-FK (fonds_id, document_ref|map_ref)
--     → register(fonds_id, id). Beide registers hebben fonds_id NOT NULL, dus
--     het 0007-standaardpatroon past; `sharepoint_documenten` krijgt daarvoor
--     het ontbrekende `unique (fonds_id, id)`-doel. fonds_id op de koppelrij is
--     NOT NULL, dus geen MATCH-SIMPLE-gat: de FK van het gevulde ref-veld wordt
--     altijd gecontroleerd, die van het lege veld bewust niet (xor).
--   * Agenda-kant via TRIGGER (0007-uitzondering): `public.agendapunten` draagt
--     geen fonds_id (tenantgrens loopt via vergaderingen.fonds_id, en die is
--     nullable), dus een composite-FK is daar onmogelijk. De trigger toetst
--     agendapunt ↔ vergadering ↔ fonds, niet-verwijderd agendapunt en een
--     actieve, actuele bron — hetzelfde als de RPC, zodat ook een pad buiten de
--     RPC om (beheer-SQL, latere code) de invariant niet kan breken.
--
-- GEEN BESTAANSORAKEL. Elke reden waarom een ref niet koppelbaar is (onbekend,
-- ander fonds, bron niet actief, oude configuratieversie, andere drive, status
-- niet 'gezien') geeft één en dezelfde melding. Idem voor het agendapunt.
--
-- Capability voor de latere route (PR-5): `documents.metadata.update`, gelijk
-- aan de portaalkoppeling `/api/documents/[id]/agendapunten`. Deze migratie
-- introduceert geen route en geen publieke objecten.
--
-- ROLLBACK: ../rollbacks/2026_09_28_462_sharepoint_mapregister_agendakoppeling_ROLLBACK.sql
begin;

-- ── 1. Composite-FK-doel op het bestaande documentregister ─────────────────
-- Additieve constraint; id is al PK, dus (fonds_id, id) is per constructie uniek
-- en de aanmaak kan op bestaande data niet falen. Geen row-DML.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'microsoft_private.sharepoint_documenten'::regclass
       and conname = 'sharepoint_documenten_fonds_id_id_uniek'
  ) then
    alter table microsoft_private.sharepoint_documenten
      add constraint sharepoint_documenten_fonds_id_id_uniek unique (fonds_id, id);
  end if;
end $$;

-- ── 2. Mapregister ──────────────────────────────────────────────────────────
create table if not exists microsoft_private.sharepoint_mappen (
  id uuid primary key default gen_random_uuid(),
  bron_id uuid not null references microsoft_private.sharepoint_bronnen(id) on delete cascade,
  fonds_id uuid not null references public.fondsen(id) on delete cascade,
  drive_id text not null,
  item_id text not null,
  naam text not null check (length(naam) between 1 and 240),
  ouder_item_id text,
  mappad text not null default '' check (length(mappad) <= 1000),
  status text not null default 'gezien' check (status in ('gezien','verwijderd','ontoegankelijk')),
  configuratieversie integer not null check (configuratieversie >= 1),
  eerst_gezien_op timestamptz not null default now(),
  laatst_gezien_op timestamptz not null default now(),
  constraint sharepoint_mappen_bron_item_uniek unique (bron_id, item_id),
  constraint sharepoint_mappen_fonds_id_id_uniek unique (fonds_id, id)
);
create index if not exists sharepoint_mappen_fonds_idx on microsoft_private.sharepoint_mappen(fonds_id, bron_id);
alter table microsoft_private.sharepoint_mappen enable row level security;

-- Upsert per (bron, item), analoog aan `sharepoint_upsert_documenten`: een
-- rename of verplaatsing werkt de bestaande referentie bij; er ontstaat nooit
-- een tweede referentie voor dezelfde map. De advisory lock per bron (eigen
-- namespace, dus los van de documentlock) serialiseert gelijktijdige listings.
-- Uitvoerkolommen heten bewust `ref`/`extern_item_id` en niet `item_id`: dat
-- zou in `on conflict (bron_id, item_id)` met de tabelkolom botsen.
create or replace function microsoft_private.sharepoint_upsert_mappen(p_fonds uuid, p_bron uuid, p_versie integer, p_items jsonb)
returns table(ref uuid, extern_item_id text) language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
#variable_conflict use_column
declare v_bron sharepoint_bronnen%rowtype;
begin
  select * into v_bron from sharepoint_bronnen where id = p_bron and fonds_id = p_fonds and status = 'actief';
  if v_bron.id is null then raise exception 'sharepoint bron hoort niet bij dit fonds of is niet actief'; end if;
  if p_versie <> v_bron.configuratieversie then raise exception 'verouderde sharepoint configuratieversie'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 5000 then raise exception 'ongeldige mappenlijst'; end if;

  perform pg_advisory_xact_lock(hashtext('microsoft_private.sharepoint_mappen'), hashtext(v_bron.id::text));

  return query
  with invoer as (
    select distinct on (x.item_id) x.item_id, x.naam, x.ouder_item_id, x.mappad
      from jsonb_to_recordset(p_items) as x(item_id text, naam text, ouder_item_id text, mappad text)
     where coalesce(x.item_id,'') <> '' and coalesce(x.naam,'') <> ''
     order by x.item_id
  ), geschreven as (
    insert into sharepoint_mappen(bron_id,fonds_id,drive_id,item_id,naam,ouder_item_id,mappad,status,configuratieversie,laatst_gezien_op)
    select v_bron.id, v_bron.fonds_id, v_bron.drive_id, i.item_id, left(i.naam,240), i.ouder_item_id, left(coalesce(i.mappad,''),1000), 'gezien', p_versie, now()
      from invoer i
    on conflict (bron_id, item_id) do update set
      drive_id = excluded.drive_id, naam = excluded.naam, ouder_item_id = excluded.ouder_item_id, mappad = excluded.mappad,
      status = 'gezien', configuratieversie = excluded.configuratieversie, laatst_gezien_op = now()
    returning sharepoint_mappen.id, sharepoint_mappen.item_id
  )
  select g.id, g.item_id from geschreven g;
end $$;

-- Fondsgebonden opzoeking met exact de poorten van `sharepoint_lees_document`:
-- fonds, actieve bron, zelfde drive en actuele configuratieversie. Een ref van
-- fonds B, van een oude bronconfiguratie of van een ontkoppelde bron levert niets.
create or replace function microsoft_private.sharepoint_lees_map(p_fonds uuid, p_ref uuid)
returns table(id uuid, bron_id uuid, drive_id text, item_id text, root_item_id text, naam text, mappad text, status text, bron_status text, site_hostnaam text, configuratieversie integer)
language sql security definer set search_path = microsoft_private, public, pg_temp as $$
  select m.id, m.bron_id, m.drive_id, m.item_id, b.root_item_id, m.naam, m.mappad, m.status, b.status, b.site_hostnaam, m.configuratieversie
    from sharepoint_mappen m join sharepoint_bronnen b on b.id = m.bron_id
   where m.fonds_id = p_fonds and b.fonds_id = p_fonds and m.id = p_ref
     and b.status = 'actief' and m.drive_id = b.drive_id and m.configuratieversie = b.configuratieversie
$$;

-- ── 3. Koppeltabel agendapunt ↔ SharePoint-object ───────────────────────────
create table if not exists microsoft_private.agendapunt_sharepoint_koppelingen (
  id uuid primary key default gen_random_uuid(),
  fonds_id uuid not null references public.fondsen(id) on delete cascade,
  agendapunt_id uuid not null references public.agendapunten(id) on delete cascade,
  vergadering_id uuid not null references public.vergaderingen(id) on delete cascade,
  document_ref uuid,
  map_ref uuid,
  aangemaakt_door uuid references auth.users(id) on delete set null,
  aangemaakt timestamptz not null default now(),
  constraint agendapunt_sp_koppeling_precies_een_object check ((document_ref is null) <> (map_ref is null)),
  constraint agendapunt_sp_koppeling_document_fk foreign key (fonds_id, document_ref)
    references microsoft_private.sharepoint_documenten(fonds_id, id) on delete cascade,
  constraint agendapunt_sp_koppeling_map_fk foreign key (fonds_id, map_ref)
    references microsoft_private.sharepoint_mappen(fonds_id, id) on delete cascade
);
create unique index if not exists agendapunt_sp_koppeling_document_uniek
  on microsoft_private.agendapunt_sharepoint_koppelingen(agendapunt_id, document_ref) where document_ref is not null;
create unique index if not exists agendapunt_sp_koppeling_map_uniek
  on microsoft_private.agendapunt_sharepoint_koppelingen(agendapunt_id, map_ref) where map_ref is not null;
create index if not exists agendapunt_sp_koppeling_fonds_verg_idx
  on microsoft_private.agendapunt_sharepoint_koppelingen(fonds_id, vergadering_id);
create index if not exists agendapunt_sp_koppeling_document_idx
  on microsoft_private.agendapunt_sharepoint_koppelingen(document_ref) where document_ref is not null;
create index if not exists agendapunt_sp_koppeling_map_idx
  on microsoft_private.agendapunt_sharepoint_koppelingen(map_ref) where map_ref is not null;
alter table microsoft_private.agendapunt_sharepoint_koppelingen enable row level security;

-- Validatietrigger (0007-uitzondering, zie kop). Geen SECURITY DEFINER: de
-- tabel is alleen bereikbaar voor de eigenaar en de definer-RPC's hieronder,
-- dus de trigger draait altijd al met eigenaarsrechten. Wel een gepind
-- search_path. Een koppelrij is onveranderlijk: wijzigen = ontkoppelen +
-- opnieuw koppelen, zodat maker en tijdstip altijd bij de huidige inhoud horen.
create or replace function microsoft_private.fn_agendapunt_sharepoint_koppeling_validatie()
returns trigger language plpgsql set search_path = microsoft_private, public, pg_temp as $$
declare
  v_ap_verg uuid;
  v_ap_verwijderd timestamptz;
  v_verg_fonds uuid;
  v_ok boolean;
begin
  if tg_op = 'UPDATE' then
    -- Enige toegestane wijziging: `on delete set null` van de maker wanneer een
    -- auth-gebruiker wordt verwijderd. Anders zou deze trigger het verwijderen
    -- van een gebruiker blokkeren.
    if new.aangemaakt_door is null
       and (new.id, new.fonds_id, new.agendapunt_id, new.vergadering_id, new.aangemaakt)
           is not distinct from (old.id, old.fonds_id, old.agendapunt_id, old.vergadering_id, old.aangemaakt)
       and new.document_ref is not distinct from old.document_ref
       and new.map_ref is not distinct from old.map_ref then
      return new;
    end if;
    raise exception 'sharepoint agendakoppeling is onveranderlijk; ontkoppel en koppel opnieuw';
  end if;

  -- Geen of twee objecten: laat de xor-CHECK (declaratief) de rij weigeren,
  -- zodat die schending een check_violation blijft en niet hier wordt vermomd.
  if (new.document_ref is null) = (new.map_ref is null) then
    return new;
  end if;

  select a.vergadering_id, a.verwijderd_op into v_ap_verg, v_ap_verwijderd
    from public.agendapunten a where a.id = new.agendapunt_id;
  select v.fonds_id into v_verg_fonds from public.vergaderingen v where v.id = v_ap_verg;
  if v_ap_verg is null or v_ap_verwijderd is not null
     or new.vergadering_id is distinct from v_ap_verg
     or v_verg_fonds is distinct from new.fonds_id then
    raise exception 'agendapunt niet beschikbaar voor sharepoint koppeling';
  end if;

  if new.document_ref is not null then
    select true into v_ok
      from sharepoint_documenten d join sharepoint_bronnen b on b.id = d.bron_id
     where d.id = new.document_ref and d.fonds_id = new.fonds_id and b.fonds_id = new.fonds_id
       and b.status = 'actief' and d.drive_id = b.drive_id and d.configuratieversie = b.configuratieversie
       and d.status = 'gezien';
  else
    select true into v_ok
      from sharepoint_mappen m join sharepoint_bronnen b on b.id = m.bron_id
     where m.id = new.map_ref and m.fonds_id = new.fonds_id and b.fonds_id = new.fonds_id
       and b.status = 'actief' and m.drive_id = b.drive_id and m.configuratieversie = b.configuratieversie
       and m.status = 'gezien';
  end if;
  if v_ok is not true then
    raise exception 'sharepoint object niet beschikbaar voor koppeling';
  end if;
  return new;
end $$;

drop trigger if exists trg_agendapunt_sharepoint_koppeling_validatie on microsoft_private.agendapunt_sharepoint_koppelingen;
create trigger trg_agendapunt_sharepoint_koppeling_validatie
  before insert or update on microsoft_private.agendapunt_sharepoint_koppelingen
  for each row execute function microsoft_private.fn_agendapunt_sharepoint_koppeling_validatie();

-- ── 4. RPC's ────────────────────────────────────────────────────────────────
-- Koppelen, idempotent. vergadering_id komt uit het agendapunt, nooit van de
-- aanroeper. Een tweede aanroep met hetzelfde (agendapunt, object) levert de
-- bestaande koppeling op met `nieuw = false`. De volledige validatie zit in de
-- trigger; de RPC toetst vooraf dezelfde poorten zodat de uitkomst bij een
-- bestaande koppeling op een inmiddels inactieve bron ook "niet beschikbaar" is
-- en niet stil de oude rij teruggeeft.
create or replace function microsoft_private.sharepoint_koppel_agendapunt(p_fonds uuid, p_gebruiker uuid, p_agendapunt uuid, p_soort text, p_ref uuid)
returns table(koppeling_id uuid, nieuw boolean) language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
#variable_conflict use_column
declare
  v_verg uuid;
  v_ok boolean;
  v_id uuid;
begin
  if p_soort not in ('document','map') or p_ref is null then
    raise exception 'ongeldige sharepoint koppelsoort';
  end if;

  select a.vergadering_id into v_verg
    from public.agendapunten a join public.vergaderingen v on v.id = a.vergadering_id
   where a.id = p_agendapunt and a.verwijderd_op is null and v.fonds_id = p_fonds;
  if v_verg is null then raise exception 'agendapunt niet beschikbaar voor sharepoint koppeling'; end if;

  if p_soort = 'document' then
    select true into v_ok from sharepoint_lees_document(p_fonds, p_ref) d where d.status = 'gezien';
  else
    select true into v_ok from sharepoint_lees_map(p_fonds, p_ref) m where m.status = 'gezien';
  end if;
  if v_ok is not true then raise exception 'sharepoint object niet beschikbaar voor koppeling'; end if;

  if p_soort = 'document' then
    insert into agendapunt_sharepoint_koppelingen(fonds_id, agendapunt_id, vergadering_id, document_ref, aangemaakt_door)
    values (p_fonds, p_agendapunt, v_verg, p_ref, p_gebruiker)
    on conflict (agendapunt_id, document_ref) where document_ref is not null do nothing
    returning agendapunt_sharepoint_koppelingen.id into v_id;
    if v_id is not null then return query select v_id, true; return; end if;
    return query select k.id, false from agendapunt_sharepoint_koppelingen k
      where k.fonds_id = p_fonds and k.agendapunt_id = p_agendapunt and k.document_ref = p_ref;
  else
    insert into agendapunt_sharepoint_koppelingen(fonds_id, agendapunt_id, vergadering_id, map_ref, aangemaakt_door)
    values (p_fonds, p_agendapunt, v_verg, p_ref, p_gebruiker)
    on conflict (agendapunt_id, map_ref) where map_ref is not null do nothing
    returning agendapunt_sharepoint_koppelingen.id into v_id;
    if v_id is not null then return query select v_id, true; return; end if;
    return query select k.id, false from agendapunt_sharepoint_koppelingen k
      where k.fonds_id = p_fonds and k.agendapunt_id = p_agendapunt and k.map_ref = p_ref;
  end if;
end $$;

-- Ontkoppelen verwijdert UITSLUITEND de koppelrij — nooit een registerrij en
-- nooit iets in SharePoint. Werkt ook als de bron inmiddels inactief is, zodat
-- een gebruiker een onbruikbaar geworden koppeling altijd kan opruimen. Levert
-- false bij een koppeling van een ander fonds of een ander agendapunt.
create or replace function microsoft_private.sharepoint_ontkoppel_agendapunt(p_fonds uuid, p_agendapunt uuid, p_koppeling uuid)
returns boolean language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
declare v_aantal integer;
begin
  delete from agendapunt_sharepoint_koppelingen k
   where k.id = p_koppeling and k.fonds_id = p_fonds and k.agendapunt_id = p_agendapunt;
  get diagnostics v_aantal = row_count;
  return v_aantal > 0;
end $$;

-- Koppelingen van één of meer agendapunten (maximaal 500 per aanroep). Levert
-- alleen lokale refs en weergavemetadata — geen drive-/item-id's. Koppelingen
-- waarvan het object niet (meer) bruikbaar is (bron inactief, andere
-- configuratie of drive, status ≠ 'gezien') komen WEL terug, met
-- `beschikbaar = false`, zodat de UI ze als blokkade kan tonen en de gebruiker
-- kan ontkoppelen. Contextresolutie (PR-3+) moet op `beschikbaar` filteren én
-- per beurt opnieuw via `sharepoint_lees_document`/`sharepoint_lees_map` gaan.
create or replace function microsoft_private.sharepoint_lees_agendapunt_koppelingen(p_fonds uuid, p_agendapunten uuid[])
returns table(koppeling_id uuid, agendapunt_id uuid, vergadering_id uuid, soort text, ref uuid, naam text, mappad text, bestandstype text, status text, beschikbaar boolean, aangemaakt_door uuid, aangemaakt timestamptz)
language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
begin
  if p_agendapunten is null or cardinality(p_agendapunten) = 0 then return; end if;
  if cardinality(p_agendapunten) > 500 then raise exception 'te veel agendapunten in een aanroep'; end if;
  return query
  select k.id, k.agendapunt_id, k.vergadering_id,
         case when k.document_ref is not null then 'document' else 'map' end,
         coalesce(k.document_ref, k.map_ref),
         coalesce(d.naam, m.naam),
         coalesce(d.mappad, m.mappad),
         d.bestandstype,
         coalesce(d.status, m.status),
         coalesce(b.status = 'actief'
                  and coalesce(d.drive_id, m.drive_id) = b.drive_id
                  and coalesce(d.configuratieversie, m.configuratieversie) = b.configuratieversie
                  and coalesce(d.status, m.status) = 'gezien', false),
         k.aangemaakt_door, k.aangemaakt
    from agendapunt_sharepoint_koppelingen k
    left join sharepoint_documenten d on d.id = k.document_ref and d.fonds_id = k.fonds_id
    left join sharepoint_mappen m on m.id = k.map_ref and m.fonds_id = k.fonds_id
    left join sharepoint_bronnen b on b.id = coalesce(d.bron_id, m.bron_id) and b.fonds_id = k.fonds_id
   where k.fonds_id = p_fonds and k.agendapunt_id = any(p_agendapunten)
   order by k.agendapunt_id, k.aangemaakt, k.id;
end $$;

-- ── 5. ACL ──────────────────────────────────────────────────────────────────
revoke all on all tables in schema microsoft_private from public, anon, authenticated;
revoke all on all functions in schema microsoft_private from public, anon, authenticated;
revoke all on function microsoft_private.fn_agendapunt_sharepoint_koppeling_validatie() from public, anon, authenticated;
grant execute on function microsoft_private.sharepoint_upsert_mappen(uuid,uuid,integer,jsonb) to microsoft_vault;
grant execute on function microsoft_private.sharepoint_lees_map(uuid,uuid) to microsoft_vault;
grant execute on function microsoft_private.sharepoint_koppel_agendapunt(uuid,uuid,uuid,text,uuid) to microsoft_vault;
grant execute on function microsoft_private.sharepoint_ontkoppel_agendapunt(uuid,uuid,uuid) to microsoft_vault;
grant execute on function microsoft_private.sharepoint_lees_agendapunt_koppelingen(uuid,uuid[]) to microsoft_vault;

commit;
