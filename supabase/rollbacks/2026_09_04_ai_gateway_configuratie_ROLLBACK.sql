-- ============================================================================
--  ROLLBACK van 2026_09_04_ai_gateway_configuratie.sql — AI-gateway T2 (#311)
--
--  WAT DIT TERUGDRAAIT
--    Het private schema ai_gateway_private (vijf tabellen, triggers, drie
--    gateway-functies), de trigger + functie op public.fondsen, en de rechten
--    van de loginrol ai_gateway.
--
--  WAT DIT NADRUKKELIJK NIET RAAKT
--    * public.ai_model_allowlist, kill switch, quota (0180-laag) — ongewijzigd.
--    * De loginrol ai_gateway zelf: die wordt op NOLOGIN gezet en blijft bestaan.
--      Verwijder haar pas apart nadat is vastgesteld dat geen deployment of
--      secretstore de login nog gebruikt (patroon microsoft_vault).
--
--  VOLGORDE — NIET-ONDERHANDELBAAR
--    1. EERST de T3-code terugrollen. Zolang de gateway-code draait, faalt elke
--       AI-taak na deze rollback fail-closed op 'gateway_db_onbereikbaar' —
--       correct gedrag, maar het legt de AI plat.
--    2. PAS DAARNA dit bestand.
--
--  DATAVERLIES — FAIL-CLOSED
--    ai_gateway_private.gateway_log is de per-call kostengrondslag en
--    fonds_configuratie_log het wijzigingsspoor. Dit script WEIGERT zolang een
--    van beide regels bevat. Exporteer eerst en zet dan de grendel bewust om:
--      \copy (select * from ai_gateway_private.gateway_log) to 'ai_gateway_log.csv' csv header
--      \copy (select * from ai_gateway_private.fonds_configuratie_log) to 'ai_gateway_configlog.csv' csv header
--      set ai_gateway.rollback_met_dataverlies = 'ja';   -- alleen in dezelfde sessie
--
--  IDEMPOTENT: alles `if exists`. Meermaals draaien is veilig.
-- ============================================================================

begin;

do $$
declare
  v_grendel text := current_setting('ai_gateway.rollback_met_dataverlies', true);
  v_log integer := 0;
  v_cfglog integer := 0;
begin
  if to_regclass('ai_gateway_private.gateway_log') is not null then
    execute 'select count(*) from ai_gateway_private.gateway_log' into v_log;
  end if;
  if to_regclass('ai_gateway_private.fonds_configuratie_log') is not null then
    execute 'select count(*) from ai_gateway_private.fonds_configuratie_log' into v_cfglog;
  end if;
  if (v_log > 0 or v_cfglog > 0) and coalesce(v_grendel, '') <> 'ja' then
    raise exception 'ROLLBACK GEWEIGERD: gateway_log (%) / fonds_configuratie_log (%) bevatten regels. Exporteer eerst en zet ai_gateway.rollback_met_dataverlies = ''ja''.', v_log, v_cfglog;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'ai_gateway') then
    alter role ai_gateway nologin;
    if exists (select 1 from pg_namespace where nspname = 'ai_gateway_private') then
      revoke all privileges on all functions in schema ai_gateway_private from ai_gateway;
      revoke usage on schema ai_gateway_private from ai_gateway;
    end if;
  end if;
end $$;

drop trigger if exists trg_fonds_ai_configuratie_standaard on public.fondsen;
drop function if exists public.fn_fonds_ai_configuratie_standaard();
drop schema if exists ai_gateway_private cascade;

commit;
