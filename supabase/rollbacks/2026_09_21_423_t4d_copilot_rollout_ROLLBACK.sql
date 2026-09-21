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

drop trigger if exists trg_copilot_operator_log_append_only on microsoft_private.copilot_operator_log;
drop function if exists microsoft_private.copilot_log_append_only();

drop table if exists microsoft_private.copilot_operator_log;
drop table if exists microsoft_private.copilot_billingbewijs;
drop table if exists microsoft_private.copilot_rollout;

-- ── FASE C — oude signatuur herstellen VÓÓR de oude code terugkomt ──────────
-- Alleen nodig wanneer migratie B (contract) al is gedraaid. Herstelt de
-- twaalf-parameter vorm zoals die vóór T4-D bestond: zonder client_id en zonder
-- verbinding_versie, want in de teruggebouwde wereld bestaan die kolommen niet
-- meer. Draai dit blok NIET wanneer fase D wordt overgeslagen en de kolommen
-- blijven staan — gebruik dan de variant uit migratie A, die client_id
-- expliciet op NULL zet.
--
-- create or replace function microsoft_private.bewaar_koppeling(
--   p_fonds uuid, p_gebruiker uuid, p_tenant text, p_object text, p_home text,
--   p_naam text, p_user text, p_scopes text[], p_sleutel integer, p_iv text,
--   p_tag text, p_cipher text
-- ) returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
-- ... (originele body uit 2026_09_04_microsoft_fase1_connectorfundament.sql) ...
-- $$;
-- grant execute on function microsoft_private.bewaar_koppeling(uuid,uuid,text,text,text,text,text,text[],integer,text,text,text) to microsoft_vault;

-- ── FASE D — kolommen weg ───────────────────────────────────────────────────
-- Pas uitvoeren wanneer geen enkele draaiende instantie deze kolommen nog
-- schrijft. De dertien-parameter signatuur moet dan al weg zijn.
drop function if exists microsoft_private.bewaar_koppeling(
  uuid, uuid, text, text, text, text, text, text[], integer, text, text, text, text
);
alter table microsoft_private.verbindingen drop column if exists verbinding_versie;
alter table microsoft_private.verbindingen drop column if exists client_id;

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
