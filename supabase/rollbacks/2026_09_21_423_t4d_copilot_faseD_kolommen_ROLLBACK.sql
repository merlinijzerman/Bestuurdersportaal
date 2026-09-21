-- ============================================================================
--  #423 T4-D — ROLLBACK FASE D: de kolommen weg
-- ----------------------------------------------------------------------------
--  VOORWAARDE   fase C is gedraaid ÉN de oude applicatiecode draait aantoonbaar,
--               zodat niets `client_id` meer schrijft. Deze fase is
--               onomkeerbaar: de kolomwaarden zijn erna weg.
--
--  Twee bewijzen, allebei verplicht:
--    1. GEGEVENS — geen verse koppeling met een gevulde client_id. Schrijft er
--       nog iets, dan draait de nieuwe code nog en breekt deze fase hem.
--    2. VERKLARING — de operator bevestigt de deploy expliciet. Punt 1 is stil
--       groen op een omgeving waar toevallig niemand koppelt; een verklaring
--       dwingt af dat iemand daadwerkelijk heeft gekeken.
--
--  GEBRUIK
--    psql "$DB" -v ON_ERROR_STOP=1 \
--         -v oude_code_gedeployd=ja \
--         -f supabase/rollbacks/2026_09_21_423_t4d_copilot_faseD_kolommen_ROLLBACK.sql
-- ============================================================================
\set ON_ERROR_STOP on
\if :{?oude_code_gedeployd} \else \set oude_code_gedeployd '' \endif

-- psql vervangt geen variabelen BINNEN een dollar-quoted blok, dus de
-- bevestiging gaat via een sessie-instelling het do-blok in.
select set_config('t4d.oude_code_gedeployd', :'oude_code_gedeployd', false);

-- ── Preflight ───────────────────────────────────────────────────────────────
do $$
declare v_vers integer;
begin
  if coalesce(current_setting('t4d.oude_code_gedeployd', true), '') <> 'ja' then
    raise exception 'FASE D geweigerd: bevestig de teruggedraaide deploy met -v oude_code_gedeployd=ja. Deze fase is onomkeerbaar.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'microsoft_private' and p.proname = 'bewaar_koppeling' and p.pronargs = 12
  ) then
    raise exception 'FASE D geweigerd: fase C is niet gedraaid; de twaalf-parametersignatuur bestaat niet. Zonder haar laat deze fase een stukke koppelflow achter.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'microsoft_private'
       and p.proname = 'copilot_rollback_herstel_bewaar_koppeling'
  ) then
    raise exception 'FASE D geweigerd: de generator uit fase C ontbreekt. Zij moet ná het droppen van de kolommen opnieuw draaien, anders verwijst de herstelde functie naar kolommen die niet meer bestaan.';
  end if;

  -- Schrijft er nog iets een client-id? Dan draait de nieuwe code nog.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'microsoft_private' and table_name = 'verbindingen'
       and column_name = 'client_id'
  ) then
    execute $q$
      select count(*) from microsoft_private.verbindingen
       where client_id is not null and gekoppeld_op > now() - interval '1 hour'
    $q$ into v_vers;
    if v_vers > 0 then
      raise exception 'FASE D geweigerd: % verse koppeling(en) met een gevulde client_id in het laatste uur. Er draait nog een instantie op de nieuwe code.', v_vers;
    end if;
  end if;
end $$;

-- ── Kolommen en de nieuwe signatuur weg ─────────────────────────────────────
drop function if exists microsoft_private.bewaar_koppeling(
  uuid, uuid, text, text, text, text, text, text[], integer, text, text, text, text
);
alter table microsoft_private.verbindingen drop column if exists verbinding_versie;
alter table microsoft_private.verbindingen drop column if exists client_id;

-- De in fase C herstelde functie is gebouwd op de kolommen zoals ze TOEN waren.
-- Nu ze weg zijn moet zij opnieuw worden gegenereerd; zonder deze aanroep faalt
-- de eerste koppelpoging op `column "client_id" ... does not exist`.
select microsoft_private.copilot_rollback_herstel_bewaar_koppeling();
drop function microsoft_private.copilot_rollback_herstel_bewaar_koppeling();

-- `ontkoppel` verwijst naar verbinding_versie en zou nu een kolom aanroepen die
-- niet meer bestaat. Daarom hier de vorm uit de fase-1-migratie terug — niet als
-- aanwijzing in commentaar, maar als uitgevoerde stap.
create or replace function microsoft_private.ontkoppel(p_fonds uuid, p_gebruiker uuid)
returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from verbindingen where fonds_id=p_fonds and gebruiker_id=p_gebruiker for update;
  delete from token_cache where verbinding_id=v_id;
  update verbindingen set status='ontkoppeld', ontkoppeld_op=now(), foutcategorie=null where id=v_id;
  insert into audit_log(fonds_id,gebruiker_id,gebeurtenis) values(p_fonds,p_gebruiker,'microsoft.lokaal_ontkoppeld');
end $$;

-- ── Eindcontrole ────────────────────────────────────────────────────────────
do $$
declare v_n integer; v_rest text;
begin
  select count(*) into v_n from information_schema.columns
   where table_schema = 'microsoft_private' and table_name = 'verbindingen'
     and column_name in ('client_id','verbinding_versie');
  if v_n <> 0 then raise exception 'FASE D mislukt: % T4-D-kolom(men) staan er nog', v_n; end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'microsoft_private' and p.proname = 'bewaar_koppeling';
  if v_n <> 1 then raise exception 'FASE D mislukt: er zijn % bewaar_koppeling-signaturen, verwacht precies 1', v_n; end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'microsoft_private' and p.proname = 'bewaar_koppeling' and p.pronargs = 12
  ) then
    raise exception 'FASE D mislukt: de overgebleven bewaar_koppeling is niet de twaalf-parametervorm';
  end if;

  -- Alles weg behalve het auditspoor en zijn slot; zie fase B voor het waarom.
  select string_agg(naam, ', ') into v_rest from (
    select c.relname as naam
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'microsoft_private' and c.relkind in ('r','p','v','m')
       and c.relname like 'copilot\_%' and c.relname <> 'copilot_operator_log'
    union all
    select p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'microsoft_private' and p.proname like 'copilot\_%'
       and p.proname <> 'copilot_log_append_only'
  ) rest;
  if v_rest is not null then
    raise exception 'FASE D mislukt: deze copilot-objecten staan er nog: %', v_rest;
  end if;

  raise notice 'FASE D geslaagd: T4-D is volledig teruggebouwd. copilot_operator_log blijft staan als auditspoor.';
end $$;
