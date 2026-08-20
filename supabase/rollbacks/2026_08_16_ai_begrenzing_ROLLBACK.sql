-- ============================================================================
--  ROLLBACK van 2026_08_16_ai_begrenzing.sql — AI-begrenzing (besluit 0180)
--
--  WAT DIT TERUGDRAAIT
--    De acht ai_*-tabellen, hun triggers, de kolomvries-functie en de
--    circulaire FK tussen ai_kill_switch en ai_heractivering_verzoek.
--
--  WAT DIT NADRUKKELIJK NIET RAAKT
--    * public.fn_log_append_only()  — gedeeld met governance_log, risico_log,
--      procedure_log, agendapunt_log en de T7-tabellen. Blijft staan.
--    * public.platform_event_log    — het auditspoor van de reeds uitgevoerde
--      beheerhandelingen blijft integraal bewaard. Een rollback van de
--      functionaliteit mag de vastlegging dát er is ingegrepen niet wissen.
--    * Bestaande tabellen, policies, grants of functies buiten deze tranche.
--
--  VOLGORDE — NIET-ONDERHANDELBAAR
--    1. EERST de code terugrollen (deploy van de vorige commit). Zolang de
--       applicatie nog draait, roept elke kostendragende route de preflight
--       aan; die faalt na deze rollback fail-closed op een ontbrekende functie.
--       Dat is correct gedrag, maar het legt de AI plat.
--    2. DAN 2026_08_16_ai_begrenzing_rpc_ROLLBACK.sql.
--    3. DAN de eventuele omgevingsseed terugdraaien.
--    4. PAS DAARNA dit bestand.
--
--  DATAVERLIES
--    ai_verbruik_log is de enige telbron voor het maandquotum. Dit script
--    verwijdert die historie definitief. Wil je het verbruik bewaren, exporteer
--    de tabel dan vóór de rollback:
--      \copy (select * from public.ai_verbruik_log) to 'ai_verbruik_log.csv' csv header
--
--  IDEMPOTENT: alles `if exists`. Meermaals draaien is veilig.
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → New query → Run.
-- ============================================================================

begin;

-- De FK van de schakelaar naar het verzoek moet weg vóór de verzoektabel valt.
alter table if exists public.ai_kill_switch
  drop constraint if exists fk_aks_open_verzoek;

drop trigger if exists trg_ai_verbruik_log_no_update          on public.ai_verbruik_log;
drop trigger if exists trg_ai_verbruik_log_no_delete          on public.ai_verbruik_log;
drop trigger if exists trg_ai_heractivering_verzoek_no_update on public.ai_heractivering_verzoek;
drop trigger if exists trg_ai_heractivering_verzoek_no_delete on public.ai_heractivering_verzoek;
drop trigger if exists trg_ai_heractivering_besluit_no_update on public.ai_heractivering_besluit;
drop trigger if exists trg_ai_heractivering_besluit_no_delete on public.ai_heractivering_besluit;
drop trigger if exists trg_ai_actie_bevries                   on public.ai_actie;

drop table if exists public.ai_verbruik_log;
drop table if exists public.ai_actie;
drop table if exists public.ai_heractivering_besluit;
drop table if exists public.ai_heractivering_verzoek;
drop table if exists public.ai_kill_switch;
drop table if exists public.ai_model_allowlist;
drop table if exists public.ai_quota_config;
drop table if exists public.ai_config_versie;

-- Alleen de functie die exclusief van deze tranche is.
drop function if exists public.fn_ai_actie_bevries_kolommen();

-- Fail-closed verificatie: een half teruggedraaide staat is gevaarlijker dan
-- geen rollback, want dan verwijst de code naar objecten die deels bestaan.
do $$
declare
  tabellen text[] := array[
    'ai_config_versie','ai_quota_config','ai_model_allowlist','ai_kill_switch',
    'ai_heractivering_verzoek','ai_heractivering_besluit','ai_actie','ai_verbruik_log'
  ];
  t      text;
  fouten text := '';
begin
  foreach t in array tabellen loop
    if exists (
      select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public' and c.relname = t
    ) then
      fouten := fouten || format('  - tabel %s bestaat nog%s', t, chr(10));
    end if;
  end loop;

  if exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
              where ns.nspname = 'public' and p.proname = 'fn_ai_actie_bevries_kolommen') then
    fouten := fouten || '  - fn_ai_actie_bevries_kolommen bestaat nog' || chr(10);
  end if;

  -- Positieve controle: de GEDEELDE append-only-functie moet juist blijven staan.
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'fn_log_append_only') then
    fouten := fouten || '  - fn_log_append_only is ten onrechte verwijderd (gedeeld met andere logtabellen)' || chr(10);
  end if;

  if fouten <> '' then
    raise exception E'ROLLBACK FAALT:\n%', fouten;
  end if;

  raise notice 'ROLLBACK OK: de acht ai_*-tabellen zijn weg; fn_log_append_only en platform_event_log zijn ongemoeid.';
end $$;

commit;
