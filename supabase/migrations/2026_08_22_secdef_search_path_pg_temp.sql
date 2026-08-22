-- ============================================================================
-- Migratie 2026-08-22 — SECURITY DEFINER: pg_temp expliciet als laatste
-- ----------------------------------------------------------------------------
-- WAAROM
-- Staat pg_temp NIET in de search_path van een functie, dan doorzoekt Postgres
-- het tijdelijke schema juist als EERSTE voor relatie- en typenamen. Voor een
-- SECURITY-DEFINER-functie is dat de klassieke shadowing-route: de aanroeper
-- maakt `create temp table profielen (...)` en de functie leest die in plaats
-- van public.profielen, met de rechten van de eigenaar.
--
-- Gemeten op productie 22-08-2026: `authenticated`, `anon` én PUBLIC hebben
-- alle drie TEMP-rechten op de database. De voorwaarde is dus vervuld. Hoe
-- makkelijk die route in de praktijk te lopen is hangt af van hergebruik van
-- poolverbindingen; dat is geen reden om de afscherming weg te laten.
--
-- De fix uit de PostgreSQL-documentatie: zet pg_temp expliciet als LAATSTE
-- entry, zodat het tijdelijke schema als laatste wordt doorzocht.
--
-- WAT DEZE MIGRATIE WEL EN NIET DOET
-- Hij VOEGT pg_temp TOE aan de bestaande search_path. Hij vervangt die niet.
-- Dat onderscheid is niet cosmetisch: drie van de zeven geraakte functies
-- hebben een betekenisvolle eigen search_path (`pg_catalog, public`, en één met
-- `extensions`). Een migratie die botweg `= public, pg_temp` zet zou die stil
-- kapotmaken. Een eerdere versie van dit bestand deed dat en is herschreven.
--
-- HOE DIT IS ONTDEKT — het hoort in de historie, want het is leerzaam.
-- Bij het gelijktrekken van functietekst met de repo is fn_rate_limit_check op
-- productie opnieuw uitgerold vanuit 2026_06_10_rate_limiting.sql. Die migratie
-- declareert `set search_path = public`. Productie had op dat moment
-- `public, pg_temp` — via handwerk, want de repo zet dat nergens. De uitrol
-- maakte de functie dus zwakker, en de driftmeting ving dat binnen één run.
-- Dat is precies waar signaal 2 (productie versus preview) voor bedoeld is.
--
-- Idempotent: een functie die pg_temp al heeft wordt overgeslagen. Raakt geen
-- functiebody en geen data; alleen proconfig.
-- ROLLBACK: 2026_08_22_secdef_search_path_pg_temp_ROLLBACK.sql
-- TENANT-IMPACT: geen.
-- ============================================================================

begin;

do $migratie$
declare
  r          record;
  v_huidig   text;
  v_aantal   integer := 0;
  v_ongepind text := '';
begin
  for r in
    select p.oid::regprocedure as sig,
           p.oid::regprocedure::text as naam,
           p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
  loop
    -- Haal de bestaande search_path op; null = niet gepind.
    select substring(cfg from 'search_path=(.*)')
      into v_huidig
      from unnest(coalesce(r.proconfig, array[]::text[])) as cfg
     where cfg like 'search_path=%'
     limit 1;

    if v_huidig is null then
      -- Niet gepind: hier valt niets aan toe te voegen zonder te gokken wat
      -- de bedoelde path is. Fail-closed melden in plaats van iets verzinnen.
      v_ongepind := v_ongepind || '  - ' || r.naam || chr(10);
      continue;
    end if;

    if v_huidig like '%pg_temp%' then
      continue;  -- al goed
    end if;

    execute format('alter function %s set search_path = %s', r.sig, v_huidig || ', pg_temp');
    v_aantal := v_aantal + 1;
  end loop;

  if v_ongepind <> '' then
    raise exception
      'Deze SECURITY-DEFINER-functies hebben geen gepinde search_path; los dat apart op:%',
      chr(10) || v_ongepind;
  end if;

  raise notice 'pg_temp toegevoegd aan % functie(s).', v_aantal;
end $migratie$;

commit;

-- ── Verificatie — fail-closed, breder dan de fix ────────────────────────────
do $verificatie$
declare
  v_zwak text := '';
  r      record;
begin
  for r in
    select p.oid::regprocedure::text as naam
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and not coalesce(array_to_string(p.proconfig, ',') like '%pg_temp%', false)
  loop
    v_zwak := v_zwak || '  - ' || r.naam || chr(10);
  end loop;

  if v_zwak <> '' then
    raise exception
      'Deze SECURITY-DEFINER-functies missen pg_temp nog in search_path:%',
      chr(10) || v_zwak;
  end if;
  raise notice 'AKKOORD: elke SECURITY-DEFINER-functie in public heeft pg_temp als laatste.';
end $verificatie$;
