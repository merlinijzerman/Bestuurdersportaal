-- ============================================================================
--  #423 T4-D — Copilot-rolloutpoorten, EXPAND-stap (migratie A van twee)
-- ----------------------------------------------------------------------------
--  WAAROM EXPAND/CONTRACT
--    Er is geen migratierunner: migraties worden handmatig geplakt en de vaste
--    volgorde is MIGRATIE EERST, DEPLOY DAARNA. Tussen die twee momenten draait
--    de OUDE applicatiecode tegen het NIEUWE schema. Zou deze migratie de oude
--    `bewaar_koppeling`-signatuur droppen, dan breekt elke lopende Microsoft-
--    koppeling en -herkoppeling — ook die van Outlook en SharePoint, die niets
--    met Copilot te maken hebben.
--
--    Daarom behoudt deze migratie de oude signatuur en herschrijft haar zodat zij
--    `client_id` EXPLICIET op NULL zet. Expliciet, want `bewaar_koppeling` doet
--    `on conflict do update`: laat je de kolom weg, dan blijft de vorige waarde
--    staan en houdt een herkoppeling onder oude code een client-id uit een
--    EERDERE consent vast. Readiness zou dan groen kunnen worden voor een
--    verbinding die net opnieuw is gelegd.
--
--    De contract-stap (droppen) staat in migratie B en draait pas ná een
--    waargenomen deploy.
--
--  WAT WEL
--    * verbindingen.client_id        — nullable, GEEN backfill (zie hieronder);
--    * verbindingen.verbinding_versie— monotoon, alleen bij koppelen/herkoppelen/
--                                      ontkoppelen; NIET bij tokenrefresh;
--    * copilot_rollout               — globale kill switch, AFWEZIGE RIJ = DICHT;
--    * copilot_billingbewijs         — per fonds;
--    * copilot_operator_log          — append-only, inhoudsvrij;
--    * copilot_blokkade              — vensterblokkade per fonds of per actor;
--    * copilot_lees_readiness        — leesfunctie voor microsoft_vault; levert
--                                      ALTIJD precies één rij met de VOLLEDIGE
--                                      conjunctie (kill switch, fondsflag,
--                                      billing, blokkade, verbinding), zodat het
--                                      bewijs uit één momentopname komt;
--    * copilot_registreer_blokkade   — alleen VERLENGEN, voor microsoft_vault;
--    * copilot_zet_rollout /
--      copilot_zet_billingbewijs     — operatorfuncties, ALLEEN voor copilot_operator.
--
--  WAT NIET
--    * geen backfill van client_id. Een bestaande rij invullen met de client-id
--      van de huidige omgeving legt een aanname als feit vast: die rij kan onder
--      een andere appregistratie zijn ontstaan. NULL ⇒ configuratie_ongeldig, en
--      herconsent via de bestaande koppelflow is de enige weg naar `gereed`;
--    * geen wijziging aan outlookAccessToken/sharepointAccessToken-paden;
--    * geen activering: copilot_rollout blijft leeg, dus dicht.
--
--  LOCKVOLGORDE (verplicht, ook voor toekomstige functies)
--      copilot_rollout → copilot_billingbewijs → verbindingen → token_cache
--    Nooit in omgekeerde richting. Leespaden nemen géén `for update`.
--
--  VOORWAARDE
--    De NOLOGIN-rol `copilot_operator` wordt VOORAF via het runbook aangemaakt.
--    Deze migratie weigert te draaien als hij ontbreekt, zodat zij niet half
--    landt en de rol niet stilzwijgend met onbedoelde rechten ontstaat.
--
--  IDEMPOTENT: ja. Herhaald draaien is veilig.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'copilot_operator') then
    raise exception 'copilot_operator (NOLOGIN) ontbreekt; provision deze volgens het T4-D-runbook vóór de migratie';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'microsoft_vault') then
    raise exception 'microsoft_vault ontbreekt; draai eerst de fase-1-connectormigratie';
  end if;
end $$;

-- ── 1. Kolommen op de bestaande verbindingstabel ────────────────────────────
alter table microsoft_private.verbindingen
  add column if not exists client_id text;
alter table microsoft_private.verbindingen
  add column if not exists verbinding_versie integer not null default 1;

comment on column microsoft_private.verbindingen.client_id is
  '#423: appregistratie waaronder deze consent is verleend. NULL = van vóór T4-D of geschreven door het oude pad; telt als configuratie_ongeldig voor de Copilot-arm. Nooit backfillen.';
comment on column microsoft_private.verbindingen.verbinding_versie is
  '#423: monotoon, uitsluitend opgehoogd bij koppelen, herkoppelen en ontkoppelen. NIET bij tokenrefresh, zodat een normale refresh een lopende beurt niet afbreekt.';

-- ── 2. Rolloutpoorten ───────────────────────────────────────────────────────
-- Eén rij, of geen. Geen rij betekent DICHT: de lezer in §copilot_lees_readiness
-- levert dan `false`, zodat een lege tabel nooit als "open" wordt gelezen.
create table if not exists microsoft_private.copilot_rollout (
  id boolean primary key default true check (id),
  aan boolean not null default false,
  gewijzigd timestamptz not null default now()
);

create table if not exists microsoft_private.copilot_billingbewijs (
  fonds_id uuid primary key references public.fondsen(id),
  geldig boolean not null default false,
  gewijzigd timestamptz not null default now()
);

-- Vensterblokkade na een weigering of een 429. Zonder deze tabel heeft
-- `tijdelijk_geblokkeerd` geen bron en kan de volledige conjunctie niet uit één
-- momentopname worden opgebouwd.
--
-- `gebruiker_id is null` betekent: het hele fonds. Een 429 treft de app/tenant en
-- raakt dus iedereen; een 403 treft één actor.
create table if not exists microsoft_private.copilot_blokkade (
  fonds_id        uuid not null references public.fondsen(id),
  gebruiker_id    uuid references auth.users(id),
  geblokkeerd_tot timestamptz not null,
  reden           text not null,
  gewijzigd       timestamptz not null default now()
);

create unique index if not exists copilot_blokkade_fonds_uniek
  on microsoft_private.copilot_blokkade (fonds_id) where gebruiker_id is null;
create unique index if not exists copilot_blokkade_fonds_gebruiker_uniek
  on microsoft_private.copilot_blokkade (fonds_id, gebruiker_id) where gebruiker_id is not null;

comment on table microsoft_private.copilot_blokkade is
  '#423: vensterblokkade per fonds (gebruiker_id null) of per actor. Alleen te VERLENGEN; er is bewust geen applicatiepad om een rem eerder op te heffen. Een blokkade verloopt vanzelf.';

-- Append-only. Geen update, geen delete; de trigger hieronder blokkeert beide.
create table if not exists microsoft_private.copilot_operator_log (
  id uuid primary key default gen_random_uuid(),
  handeling text not null,
  actor text not null,
  reden text not null,
  -- Door de FUNCTIE vastgelegd, nooit als parameter meegegeven: binnen een
  -- SECURITY DEFINER wijst current_user naar de eigenaar en is dus waardeloos
  -- voor attributie, en een parameter zou vervalsbaar zijn.
  sessierol text not null,
  aangemaakt timestamptz not null default now()
);

alter table microsoft_private.copilot_rollout        enable row level security;
alter table microsoft_private.copilot_billingbewijs  enable row level security;
alter table microsoft_private.copilot_operator_log   enable row level security;
alter table microsoft_private.copilot_blokkade       enable row level security;

create or replace function microsoft_private.copilot_log_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'copilot_operator_log is append-only';
end $$;
-- Een nieuwe functie krijgt op Postgres standaard EXECUTE voor PUBLIC, en op
-- Supabase kent de default-ACL dat expliciet aan anon en authenticated toe
-- (bevinding H-18). Zonder deze revoke is zelfs een triggerfunctie in een
-- privaat schema vanuit de browserrol aanroepbaar.
revoke all on function microsoft_private.copilot_log_append_only() from public, anon, authenticated, service_role;

drop trigger if exists trg_copilot_operator_log_append_only on microsoft_private.copilot_operator_log;
create trigger trg_copilot_operator_log_append_only
  before update or delete on microsoft_private.copilot_operator_log
  for each row execute function microsoft_private.copilot_log_append_only();

-- ── 3. Leesfunctie voor de applicatierol ────────────────────────────────────
-- Leest in de vaste lockvolgorde, maar ZONDER `for update`: een leespad dat
-- locks neemt zou de koppelflow kunnen blokkeren.
-- Het returntype is in #423 uitgebreid; `create or replace` kan dat niet, dus
-- eerst droppen. De grants staan in §8 en worden hierna opnieuw gezet.
drop function if exists microsoft_private.copilot_lees_readiness(uuid, uuid);
create function microsoft_private.copilot_lees_readiness(p_fonds uuid, p_gebruiker uuid)
returns table(
  globale_rollout_aan boolean,
  fondsflag_aan boolean,
  billing_geldig boolean,
  tijdelijk_geblokkeerd boolean,
  status text,
  tenant_id text,
  actor_object_id text,
  client_id text,
  scopes text[],
  verbinding_versie integer
)
language sql security definer set search_path = microsoft_private, public, pg_temp as $$
  -- ALTIJD precies één rij, ook zonder verbinding. Een lege resultset zou de
  -- lezer dwingen de conjunctie uit twee bronnen samen te stellen — en dan is
  -- 'geen rij' niet te onderscheiden van 'niet gelezen'. De left join maakt
  -- 'geen consent' een WAARDE in het bewijs in plaats van de afwezigheid ervan.
  select
    coalesce((select r.aan from copilot_rollout r where r.id), false),
    -- Strikt: uitsluitend jsonb `true` telt. De generieke flagAlsBoolean van de
    -- applicatie accepteert ook "true"/"on"/1; voor deze poort is dat te ruim.
    -- Een flag die niet eenduidig aan staat, staat uit.
    coalesce((select f.waarde = 'true'::jsonb
                from public.fonds_feature_flags f
               where f.fonds_id = p_fonds
                 and f.flag_key = 'microsoft_copilot_retrieval'), false),
    coalesce((select b.geldig from copilot_billingbewijs b where b.fonds_id = p_fonds), false),
    exists (select 1 from copilot_blokkade k
             where k.fonds_id = p_fonds
               and (k.gebruiker_id is null or k.gebruiker_id = p_gebruiker)
               and k.geblokkeerd_tot > now()),
    v.status, v.tenant_id, v.microsoft_object_id, v.client_id, v.scopes, v.verbinding_versie
  from (select 1) as altijd_een_rij
  left join verbindingen v
    on v.fonds_id = p_fonds and v.gebruiker_id = p_gebruiker
$$;

-- Verlengt een vensterblokkade, of legt hem aan. `greatest` maakt inkorten
-- onmogelijk: de arm mag zijn eigen rem niet losdraaien.
create or replace function microsoft_private.copilot_registreer_blokkade(
  p_fonds uuid, p_gebruiker uuid, p_tot timestamptz, p_reden text)
returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
begin
  if p_tot is null or p_reden is null or btrim(p_reden) = '' then
    raise exception 'geblokkeerd_tot en reden zijn verplicht';
  end if;
  update copilot_blokkade
     set geblokkeerd_tot = greatest(geblokkeerd_tot, p_tot), reden = p_reden, gewijzigd = now()
   where fonds_id = p_fonds and gebruiker_id is not distinct from p_gebruiker;
  if not found then
    insert into copilot_blokkade(fonds_id, gebruiker_id, geblokkeerd_tot, reden)
    values (p_fonds, p_gebruiker, p_tot, p_reden);
  end if;
end $$;

-- ── 4. Operatorfuncties ─────────────────────────────────────────────────────
create or replace function microsoft_private.copilot_zet_rollout(p_aan boolean, p_actor text, p_reden text)
returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
begin
  if p_actor is null or btrim(p_actor) = '' or p_reden is null or btrim(p_reden) = '' then
    raise exception 'actor en reden zijn verplicht';
  end if;
  insert into copilot_rollout(id, aan, gewijzigd) values (true, p_aan, now())
    on conflict (id) do update set aan = excluded.aan, gewijzigd = now();
  insert into copilot_operator_log(handeling, actor, reden, sessierol)
    values (case when p_aan then 'copilot.rollout.aan' else 'copilot.rollout.uit' end,
            p_actor, p_reden, session_user);
end $$;

create or replace function microsoft_private.copilot_zet_billingbewijs(p_fonds uuid, p_geldig boolean, p_actor text, p_reden text)
returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
begin
  if p_actor is null or btrim(p_actor) = '' or p_reden is null or btrim(p_reden) = '' then
    raise exception 'actor en reden zijn verplicht';
  end if;
  insert into copilot_billingbewijs(fonds_id, geldig, gewijzigd) values (p_fonds, p_geldig, now())
    on conflict (fonds_id) do update set geldig = excluded.geldig, gewijzigd = now();
  insert into copilot_operator_log(handeling, actor, reden, sessierol)
    values ('copilot.billing.gezet', p_actor, p_reden, session_user);
end $$;

-- ── 5. Koppelfunctie: nieuwe signatuur mét client-id ────────────────────────
-- Hoogt verbinding_versie op. Lockvolgorde: alleen verbindingen/token_cache.
create or replace function microsoft_private.bewaar_koppeling(
  p_fonds uuid, p_gebruiker uuid, p_tenant text, p_object text, p_home text,
  p_naam text, p_user text, p_scopes text[], p_sleutel integer, p_iv text,
  p_tag text, p_cipher text, p_client_id text
) returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
declare v_id uuid;
begin
  insert into verbindingen(fonds_id,gebruiker_id,tenant_id,microsoft_object_id,home_account_id,display_name,masked_username,status,scopes,gekoppeld_op,foutcategorie,client_id,verbinding_versie)
  values(p_fonds,p_gebruiker,p_tenant,p_object,p_home,p_naam,p_user,'gekoppeld',p_scopes,now(),null,p_client_id,1)
  on conflict(fonds_id,gebruiker_id) do update set
    tenant_id=excluded.tenant_id, microsoft_object_id=excluded.microsoft_object_id,
    home_account_id=excluded.home_account_id, display_name=excluded.display_name,
    masked_username=excluded.masked_username, status='gekoppeld', scopes=excluded.scopes,
    gekoppeld_op=now(), ontkoppeld_op=null, foutcategorie=null,
    client_id=excluded.client_id,
    verbinding_versie=verbindingen.verbinding_versie+1
  returning id into v_id;
  insert into token_cache(verbinding_id,sleutel_versie,iv,tag,ciphertext) values(v_id,p_sleutel,p_iv,p_tag,p_cipher)
    on conflict(verbinding_id) do update set versie=token_cache.versie+1, sleutel_versie=excluded.sleutel_versie,
      iv=excluded.iv, tag=excluded.tag, ciphertext=excluded.ciphertext, bijgewerkt=now();
  insert into audit_log(fonds_id,gebruiker_id,gebeurtenis) values(p_fonds,p_gebruiker,'microsoft.koppeling.geslaagd');
end $$;

-- ── 6. Koppelfunctie: OUDE signatuur, behouden en fail-closed gemaakt ──────
-- Blijft bestaan zolang de oude applicatiecode kan draaien. Zet client_id
-- EXPLICIET op NULL en hoogt verbinding_versie op — anders verandert de
-- verbinding zonder dat het bewijs meebeweegt.
create or replace function microsoft_private.bewaar_koppeling(
  p_fonds uuid, p_gebruiker uuid, p_tenant text, p_object text, p_home text,
  p_naam text, p_user text, p_scopes text[], p_sleutel integer, p_iv text,
  p_tag text, p_cipher text
) returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
declare v_id uuid;
begin
  insert into verbindingen(fonds_id,gebruiker_id,tenant_id,microsoft_object_id,home_account_id,display_name,masked_username,status,scopes,gekoppeld_op,foutcategorie,client_id,verbinding_versie)
  values(p_fonds,p_gebruiker,p_tenant,p_object,p_home,p_naam,p_user,'gekoppeld',p_scopes,now(),null,null,1)
  on conflict(fonds_id,gebruiker_id) do update set
    tenant_id=excluded.tenant_id, microsoft_object_id=excluded.microsoft_object_id,
    home_account_id=excluded.home_account_id, display_name=excluded.display_name,
    masked_username=excluded.masked_username, status='gekoppeld', scopes=excluded.scopes,
    gekoppeld_op=now(), ontkoppeld_op=null, foutcategorie=null,
    client_id=null,
    verbinding_versie=verbindingen.verbinding_versie+1
  returning id into v_id;
  insert into token_cache(verbinding_id,sleutel_versie,iv,tag,ciphertext) values(v_id,p_sleutel,p_iv,p_tag,p_cipher)
    on conflict(verbinding_id) do update set versie=token_cache.versie+1, sleutel_versie=excluded.sleutel_versie,
      iv=excluded.iv, tag=excluded.tag, ciphertext=excluded.ciphertext, bijgewerkt=now();
  insert into audit_log(fonds_id,gebruiker_id,gebeurtenis) values(p_fonds,p_gebruiker,'microsoft.koppeling.geslaagd');
end $$;

-- ── 7. Ontkoppelen hoogt de versie op ───────────────────────────────────────
create or replace function microsoft_private.ontkoppel(p_fonds uuid, p_gebruiker uuid)
returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from verbindingen where fonds_id=p_fonds and gebruiker_id=p_gebruiker for update;
  delete from token_cache where verbinding_id=v_id;
  update verbindingen set status='ontkoppeld', ontkoppeld_op=now(), foutcategorie=null,
    verbinding_versie=verbinding_versie+1 where id=v_id;
  insert into audit_log(fonds_id,gebruiker_id,gebeurtenis) values(p_fonds,p_gebruiker,'microsoft.lokaal_ontkoppeld');
end $$;

-- ── 8. Rechten ──────────────────────────────────────────────────────────────
revoke all on microsoft_private.copilot_rollout       from public, anon, authenticated, service_role;
revoke all on microsoft_private.copilot_billingbewijs from public, anon, authenticated, service_role;
revoke all on microsoft_private.copilot_operator_log  from public, anon, authenticated, service_role;
revoke all on microsoft_private.copilot_blokkade       from public, anon, authenticated, service_role;

revoke all on function microsoft_private.copilot_lees_readiness(uuid,uuid)                 from public, anon, authenticated, service_role;
revoke all on function microsoft_private.copilot_zet_rollout(boolean,text,text)            from public, anon, authenticated, service_role;
revoke all on function microsoft_private.copilot_zet_billingbewijs(uuid,boolean,text,text) from public, anon, authenticated, service_role;
revoke all on function microsoft_private.copilot_registreer_blokkade(uuid,uuid,timestamptz,text) from public, anon, authenticated, service_role;
revoke all on function microsoft_private.bewaar_koppeling(uuid,uuid,text,text,text,text,text,text[],integer,text,text,text,text) from public, anon, authenticated, service_role;

-- De applicatierol LEEST readiness maar bedient de rem niet. Zij mag wel haar
-- eigen rem AANZETTEN na een weigering of 429 — die functie kan alleen
-- verlengen, nooit inkorten, dus dit is geen sluipweg naar meer toegang.
grant execute on function microsoft_private.copilot_lees_readiness(uuid,uuid) to microsoft_vault;
grant execute on function microsoft_private.copilot_registreer_blokkade(uuid,uuid,timestamptz,text) to microsoft_vault;
grant execute on function microsoft_private.bewaar_koppeling(uuid,uuid,text,text,text,text,text,text[],integer,text,text,text,text) to microsoft_vault;

-- De operatorrol bedient de rem maar heeft geen leespad naar tokens of verbindingen.
grant execute on function microsoft_private.copilot_zet_rollout(boolean,text,text)            to copilot_operator;
grant execute on function microsoft_private.copilot_zet_billingbewijs(uuid,boolean,text,text) to copilot_operator;

-- Expliciet NIET: microsoft_vault op de operatorfuncties, en copilot_operator op
-- de leesfunctie. Die scheiding is de kern van de poort.
revoke execute on function microsoft_private.copilot_zet_rollout(boolean,text,text)            from microsoft_vault;
revoke execute on function microsoft_private.copilot_zet_billingbewijs(uuid,boolean,text,text) from microsoft_vault;
revoke execute on function microsoft_private.copilot_lees_readiness(uuid,uuid)                 from copilot_operator;
revoke execute on function microsoft_private.copilot_registreer_blokkade(uuid,uuid,timestamptz,text) from copilot_operator;
