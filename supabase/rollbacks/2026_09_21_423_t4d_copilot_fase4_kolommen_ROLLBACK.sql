-- ============================================================================
--  #423 T4-D — ROLLBACK FASE 4 van 4: de kolommen weg
-- ----------------------------------------------------------------------------
--  VOORWAARDE   fase 3 is gedraaid ÉN de oude applicatiecode draait aantoonbaar.
--  ONOMKEERBAAR de kolomwaarden zijn hierna weg.
--
--  Twee bewijzen, allebei verplicht:
--    1. GEGEVENS   — geen verse koppeling met een gevulde client_id. Schrijft er
--                    nog iets, dan draait de nieuwe code nog.
--    2. VERKLARING — de operator bevestigt de deploy expliciet. Punt 1 is stil
--                    groen op een omgeving waar toevallig niemand koppelt; een
--                    verklaring dwingt af dat iemand daadwerkelijk heeft gekeken.
--
--  SQL-EDITORVAST: geen psql-metacommando's; één transactie.
--
--  VUL IN: zet hieronder de bevestiging op 'ja'.
-- ============================================================================
begin;

select set_config('t4d.oude_code_gedeployd', 'VUL_IN', true);

-- ── Preflight ───────────────────────────────────────────────────────────────
do $$
declare v_vers integer; v_rest text;
begin
  if coalesce(current_setting('t4d.oude_code_gedeployd', true), '') <> 'ja' then
    raise exception 'FASE 4 geweigerd: zet bovenaan dit bestand de bevestiging op ''ja''. Deze fase is onomkeerbaar.';
  end if;

  select string_agg(p.proname, ', ') into v_rest
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'microsoft_private'
     and p.proname in ('copilot_lees_readiness','copilot_zet_rollout',
                       'copilot_zet_billingbewijs','copilot_registreer_blokkade');
  if v_rest is not null then
    raise exception 'FASE 4 geweigerd: fase 3 is niet gedraaid; deze poorten bestaan nog: %', v_rest;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'microsoft_private' and p.proname = 'bewaar_koppeling' and p.pronargs = 12
  ) then
    raise exception 'FASE 4 geweigerd: fase 2 is niet gedraaid; de twaalf-parametersignatuur bestaat niet. Zonder haar laat deze fase een stukke koppelflow achter.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'microsoft_private' and p.proname = 'copilot_rollback_herstel_bewaar_koppeling'
  ) then
    raise exception 'FASE 4 geweigerd: de generator uit fase 2 ontbreekt. Zij moet ná het droppen van de kolommen opnieuw draaien, anders verwijst de herstelde functie naar kolommen die niet meer bestaan.';
  end if;

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
      raise exception 'FASE 4 geweigerd: % verse koppeling(en) met een gevulde client_id in het laatste uur. Er draait nog een instantie op de nieuwe code.', v_vers;
    end if;
  end if;
end $$;

-- ── Kolommen en de nieuwe signatuur weg ─────────────────────────────────────
drop function if exists microsoft_private.bewaar_koppeling(
  uuid, uuid, text, text, text, text, text, text[], integer, text, text, text, text
);
alter table microsoft_private.verbindingen drop column if exists verbinding_versie;
alter table microsoft_private.verbindingen drop column if exists client_id;

-- De in fase 2 herstelde functie is gebouwd op de kolommen zoals ze TOEN waren.
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
declare v_n integer; v_rest text; v_rol text;
begin
  select count(*) into v_n from information_schema.columns
   where table_schema = 'microsoft_private' and table_name = 'verbindingen'
     and column_name in ('client_id','verbinding_versie');
  if v_n <> 0 then raise exception 'FASE 4 mislukt: % T4-D-kolom(men) staan er nog', v_n; end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'microsoft_private' and p.proname = 'bewaar_koppeling';
  if v_n <> 1 then raise exception 'FASE 4 mislukt: er zijn % bewaar_koppeling-signaturen, verwacht precies 1', v_n; end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'microsoft_private' and p.proname = 'bewaar_koppeling' and p.pronargs = 12
  ) then
    raise exception 'FASE 4 mislukt: de overgebleven bewaar_koppeling is niet de twaalf-parametervorm';
  end if;

  foreach v_rol in array array['public','anon','authenticated','service_role'] loop
    if has_function_privilege(v_rol,
         'microsoft_private.bewaar_koppeling(uuid,uuid,text,text,text,text,text,text[],integer,text,text,text)', 'execute') then
      raise exception 'FASE 4 mislukt: % kan de hergenereerde bewaar_koppeling uitvoeren', v_rol;
    end if;
    if has_function_privilege(v_rol, 'microsoft_private.ontkoppel(uuid,uuid)', 'execute') then
      raise exception 'FASE 4 mislukt: % kan ontkoppel uitvoeren', v_rol;
    end if;
  end loop;

  -- Alles weg behalve het auditspoor en zijn slot; zie fase 3 voor het waarom.
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
    raise exception 'FASE 4 mislukt: deze copilot-objecten staan er nog: %', v_rest;
  end if;

  raise notice 'FASE 4 geslaagd: T4-D is volledig teruggebouwd. copilot_operator_log blijft staan als auditspoor.';
end $$;

commit;
