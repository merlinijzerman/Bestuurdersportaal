-- ============================================================================
--  #423 T4-D — ROLLBACK, gefaseerd en expand/contract-compatibel
-- ----------------------------------------------------------------------------
--  Een vlakke rollback zou hetzelfde venster openbreken als een vlakke uitrol:
--  kolommen of de nieuwe signatuur weghalen terwijl de nieuwe applicatiecode nog
--  draait, breekt elke Microsoft-koppeling.
--
--  FASE A — direct, zonder deploy, zonder voorwaarde.
--      Zet de arm onmiddellijk inert. Dit alleen voldoet aan het herstelpad:
--      ongeacht fondsflag, billing of consent komt er geen Copilot-call meer.
--
--      select microsoft_private.copilot_zet_rollout(false, '<actor>', '<reden>');
--
--      In een incident stopt het hier. Fase B tot en met D zijn alleen nodig bij
--      een volledige terugbouw.
--
--  FASE B — poorten weg. Voorwaarde: fase A is uitgevoerd.
--  FASE C — code terug. LET OP DE VOLGORDE: als migratie B (contract) al is
--      gedraaid, moet de OUDE signatuur EERST opnieuw bestaan, en pas daarna mag
--      de oude applicatiecode terug. Andersom roept de teruggezette code een
--      functie aan die niet meer bestaat.
--  FASE D — kolommen weg. Voorwaarde: geen draaiende instantie schrijft ze nog.
--
--  Onderstaande blokken zijn bewust apart en NIET in één transactie: ze horen op
--  verschillende momenten te draaien.
-- ============================================================================

-- ── FASE B — poorten weg ────────────────────────────────────────────────────
drop function if exists microsoft_private.copilot_zet_billingbewijs(uuid, boolean, text, text);
drop function if exists microsoft_private.copilot_zet_rollout(boolean, text, text);
drop function if exists microsoft_private.copilot_lees_readiness(uuid, uuid);
drop function if exists microsoft_private.copilot_registreer_blokkade(uuid, uuid, timestamptz, text);

drop trigger if exists trg_copilot_operator_log_append_only on microsoft_private.copilot_operator_log;
drop function if exists microsoft_private.copilot_log_append_only();

drop table if exists microsoft_private.copilot_operator_log;
drop table if exists microsoft_private.copilot_blokkade;
drop table if exists microsoft_private.copilot_billingbewijs;
drop table if exists microsoft_private.copilot_rollout;

-- ── FASE C — oude signatuur herstellen VÓÓR de oude code terugkomt ──────────
-- Alleen nodig wanneer migratie B (contract) al is gedraaid. Dit blok VOERT de
-- terugbouw uit; een uitgecommentarieerd skelet zou betekenen dat na een
-- volledige rollback géén `bewaar_koppeling` meer bestaat en de koppelflow stuk
-- is op precies het moment dat je herstelt.
--
-- Het blok werkt in ELKE stand van fase D, ook halverwege: het kijkt welke T4-D
-- kolommen er nog zijn en bouwt de body daarop. Staan de kolommen er nog, dan
-- zet de herstelde functie `client_id` EXPLICIET op NULL en hoogt zij
-- `verbinding_versie` op — precies zoals de variant uit migratie A. Weglaten zou
-- bij `on conflict do update` de vorige client-id laten staan op een verbinding
-- die net opnieuw is gelegd: fail-open, en dan zou de Copilot-arm na een
-- rollback juist wél door een gat heen kunnen.
create or replace function microsoft_private.copilot_rollback_herstel_bewaar_koppeling()
returns void language plpgsql as $fase_c$
declare
  v_client boolean := exists (
    select 1 from information_schema.columns
     where table_schema = 'microsoft_private' and table_name = 'verbindingen'
       and column_name = 'client_id');
  v_versie boolean := exists (
    select 1 from information_schema.columns
     where table_schema = 'microsoft_private' and table_name = 'verbindingen'
       and column_name = 'verbinding_versie');
  v_kolommen text := '';
  v_waarden  text := '';
  v_set      text := '';
begin
  if v_client then
    v_kolommen := v_kolommen || ',client_id';
    v_waarden  := v_waarden  || ',null';
    v_set      := v_set      || ',client_id=null';
  end if;
  if v_versie then
    v_kolommen := v_kolommen || ',verbinding_versie';
    v_waarden  := v_waarden  || ',1';
    v_set      := v_set      || ',verbinding_versie=verbindingen.verbinding_versie+1';
  end if;

  execute format($fn$
    create or replace function microsoft_private.bewaar_koppeling(
      p_fonds uuid, p_gebruiker uuid, p_tenant text, p_object text, p_home text,
      p_naam text, p_user text, p_scopes text[], p_sleutel integer, p_iv text,
      p_tag text, p_cipher text
    ) returns void language plpgsql security definer
      set search_path = microsoft_private, public, pg_temp as $body$
    declare v_id uuid;
    begin
      insert into verbindingen(fonds_id,gebruiker_id,tenant_id,microsoft_object_id,home_account_id,display_name,masked_username,status,scopes,gekoppeld_op,foutcategorie%s)
      values(p_fonds,p_gebruiker,p_tenant,p_object,p_home,p_naam,p_user,'gekoppeld',p_scopes,now(),null%s)
      on conflict(fonds_id,gebruiker_id) do update set
        tenant_id=excluded.tenant_id, microsoft_object_id=excluded.microsoft_object_id,
        home_account_id=excluded.home_account_id, display_name=excluded.display_name,
        masked_username=excluded.masked_username, status='gekoppeld', scopes=excluded.scopes,
        gekoppeld_op=now(), ontkoppeld_op=null, foutcategorie=null%s
      returning id into v_id;
      insert into token_cache(verbinding_id,sleutel_versie,iv,tag,ciphertext)
      values(v_id,p_sleutel,p_iv,p_tag,p_cipher)
      on conflict(verbinding_id) do update set versie=token_cache.versie+1,
        sleutel_versie=excluded.sleutel_versie, iv=excluded.iv, tag=excluded.tag,
        ciphertext=excluded.ciphertext, bijgewerkt=now();
      insert into audit_log(fonds_id,gebruiker_id,gebeurtenis)
      values(p_fonds,p_gebruiker,'microsoft.koppeling.geslaagd');
    end $body$;
  $fn$, v_kolommen, v_waarden, v_set);

  raise notice 'bewaar_koppeling/12 hersteld (client_id-kolom: %, verbinding_versie-kolom: %)', v_client, v_versie;
end $fase_c$;

-- De generator kijkt naar de ACTUELE kolommen. Fase D verandert die, dus fase D
-- roept hem daarna opnieuw aan; anders verwijst de herstelde body naar kolommen
-- die net zijn gedropt en breekt de eerste koppelpoging.
select microsoft_private.copilot_rollback_herstel_bewaar_koppeling();

revoke all on function microsoft_private.bewaar_koppeling(uuid,uuid,text,text,text,text,text,text[],integer,text,text,text) from public, anon, authenticated, service_role;
grant execute on function microsoft_private.bewaar_koppeling(uuid,uuid,text,text,text,text,text,text[],integer,text,text,text) to microsoft_vault;

-- ── FASE D — kolommen weg ───────────────────────────────────────────────────
-- Pas uitvoeren wanneer geen enkele draaiende instantie deze kolommen nog
-- schrijft. De dertien-parameter signatuur moet dan al weg zijn.
drop function if exists microsoft_private.bewaar_koppeling(
  uuid, uuid, text, text, text, text, text, text[], integer, text, text, text, text
);
alter table microsoft_private.verbindingen drop column if exists verbinding_versie;
alter table microsoft_private.verbindingen drop column if exists client_id;

-- De in fase C herstelde `bewaar_koppeling` is gebouwd op de kolommen zoals ze
-- TOEN waren. Nu ze weg zijn, moet zij opnieuw worden gegenereerd — anders
-- verwijst haar body naar client_id en verbinding_versie die niet meer bestaan.
select microsoft_private.copilot_rollback_herstel_bewaar_koppeling();
drop function microsoft_private.copilot_rollback_herstel_bewaar_koppeling();

-- `ontkoppel` verwijst naar verbinding_versie en zou na fase D een kolom
-- aanroepen die niet meer bestaat. Daarom hier de vorm uit de fase-1-migratie
-- terug — niet als aanwijzing in commentaar, maar als uitgevoerde stap.
create or replace function microsoft_private.ontkoppel(p_fonds uuid, p_gebruiker uuid)
returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from verbindingen where fonds_id=p_fonds and gebruiker_id=p_gebruiker for update;
  delete from token_cache where verbinding_id=v_id;
  update verbindingen set status='ontkoppeld', ontkoppeld_op=now(), foutcategorie=null where id=v_id;
  insert into audit_log(fonds_id,gebruiker_id,gebeurtenis) values(p_fonds,p_gebruiker,'microsoft.lokaal_ontkoppeld');
end $$;

-- ── Slotcontrole ────────────────────────────────────────────────────────────
-- Bewijs dat de terugbouw werkelijk iets heeft achtergelaten. Zonder deze
-- controle zou een stil mislukte fase C pas opvallen bij de eerste koppelpoging,
-- dus precies wanneer je hem niet kunt gebruiken.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'microsoft_private' and p.proname = 'bewaar_koppeling'
       and p.pronargs = 12
  ) then
    raise exception 'ROLLBACK mislukt: bewaar_koppeling met 12 parameters bestaat niet';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'microsoft_private' and p.proname like 'copilot\_%'
  ) then
    raise exception 'ROLLBACK mislukt: er staat nog een copilot_-functie in microsoft_private';
  end if;
end $$;
