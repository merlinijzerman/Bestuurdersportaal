-- ============================================================================
-- T14b — DRIFTMETING auditketen stuurinfo  (READ-ONLY, veilig op productie)
-- ----------------------------------------------------------------------------
-- Aanleiding: op 19-08-2026 is gemeten dat de T14b-hardening op Productie
-- ontbreekt. Het uitvoerplan
-- (security/PRODUCTIE-UITVOERPLAN-AUDITKETEN-T14B-2026-08-15.md) staat op NO-GO;
-- de reparatie supabase/migrations/2026_08_15_t14b_production_drift_repair.sql
-- is nooit toegepast. Deze suite meet de drie onderdelen van die reparatie in
-- plaats van erover te redeneren.
--
--   T14b-1  VOLLEDIGE CAPTURE — fn_fonds_stuurinfo_capture bouwt haar payload
--           uit de héle rij (to_jsonb(new) - 'bijgewerkt') en niet uit een
--           handgekozen veldenlijst.
--
--           Waarom dit het zwaarste onderdeel is: de no-op-guard vergelijkt
--           v_oud met v_nieuw. Bij een smalle payload is een wijziging in een
--           niet-opgenomen kolom voor die vergelijking ONZICHTBAAR — de trigger
--           keert vroeg terug en er wordt HELEMAAL NIETS gelogd. Geen
--           onvolledige regel: geen regel. Twaalf inhoudskolommen over drie
--           tabellen vallen daaronder, waaronder kpi.toelichting, reeks.kleur
--           en delta — precies de velden die de duiding van een getal bepalen.
--
--   T14b-2  ACTOR-ANTI-SPOOFING — de INSERT-policy op fonds_stuurinfo_log eist
--           gebruiker_id is not distinct from auth.uid(), zodat een directe
--           insert nooit een andere actor kan opvoeren.
--
--   T14b-3  RPC-TYPEVALIDATIE — stuurinfo_balans_opslaan weigert JSON-nulls
--           (die passeerden de som-check stil, want sum() negeert null) en
--           dwingt de bron-allowlist ook op DB-niveau af.
--
-- Deze suite LEEST alleen catalogus (pg_proc, pg_policies). Ze schrijft niets,
-- muteert niets en mag tegen Productie draaien met een read-only rol.
--
-- Gebruik:  psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/2026_08_19_t14b_driftmeting.sql
--
-- Getest op 19-08-2026 tegen een wegwerp-Postgres 17.11 in drie toestanden:
--   lege database          → ONBEKEND op de vier objectgebonden regels;
--   de LIVE productieversie → T14b-1 DRIFT, T14b-1b OK (reproduceert exact de
--                             meting van 19-08 en is daarmee de kalibratie);
--   de gerepareerde versie  → alle vijf OK.
-- De suite is dus aantoonbaar in staat beide uitkomsten te onderscheiden.
-- ============================================================================

with capture as (
  select pg_get_functiondef(p.oid) as src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fn_fonds_stuurinfo_capture'
),
rpc as (
  select pg_get_functiondef(p.oid) as src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'stuurinfo_balans_opslaan'
),
beleid as (
  select coalesce(string_agg(with_check, ' | '), '') as wc
  from pg_policies
  where schemaname = 'public'
    and tablename  = 'fonds_stuurinfo_log'
    and cmd in ('INSERT', 'ALL')
)
select * from (
  values
    ('T14b-1  volledige rij-capture',
     (select case
        when not exists (select 1 from capture)          then 'ONBEKEND — functie bestaat niet'
        when (select src from capture) like '%to_jsonb(new)%' then 'OK'
        else 'DRIFT — handgekozen veldenlijst; wijzigingen buiten die lijst worden NIET gelogd'
      end)),

    ('T14b-1b no-op-guard aanwezig',
     (select case
        when not exists (select 1 from capture)                     then 'ONBEKEND'
        when (select src from capture) like '%is not distinct from%' then 'OK'
        else 'AFWEZIG'
      end)),

    ('T14b-2  actor-anti-spoofing op log-insert',
     (select case
        when (select wc from beleid) = ''                                  then 'DRIFT — geen INSERT-policy gevonden'
        when (select wc from beleid) like '%gebruiker_id%auth.uid()%'      then 'OK'
        else 'DRIFT — policy bindt gebruiker_id niet aan auth.uid()'
      end)),

    ('T14b-3a RPC weigert JSON-null',
     (select case
        when not exists (select 1 from rpc)                    then 'ONBEKEND — RPC bestaat niet'
        when (select src from rpc) like '%jsonb_typeof%'       then 'OK'
        else 'DRIFT — JSON-null passeert de som-check stil'
      end)),

    ('T14b-3b RPC bron-allowlist op DB-niveau',
     (select case
        when not exists (select 1 from rpc)                       then 'ONBEKEND — RPC bestaat niet'
        when (select src from rpc) like '%ONGELDIGE_BRON%'        then 'OK'
        else 'DRIFT — bron alleen app-side gevalideerd'
      end))
) as t(onderdeel, uitkomst);

-- GEMETEN OP PRODUCTIE, 19-08-2026 — volledige uitslag:
--   T14b-1   DRIFT   handgekozen veldenlijst
--   T14b-1b  OK      no-op-guard aanwezig — en dát maakt T14b-1 ernstig
--   T14b-2   DRIFT   policy bindt gebruiker_id niet aan auth.uid()
--   T14b-3a  DRIFT   JSON-null passeert de som-check stil
--   T14b-3b  DRIFT   bron alleen app-side gevalideerd
--
-- Vier van de vijf rood. Het enige onderdeel dat OK meldt is de guard, en die
-- is precies wat T14b-1 van "onvolledig log" naar "geen log" tilt.
--
-- Oorzaak, herleid in de repo: 2026_07_17_t14b_stuurinfo_audit_hardening.sql
-- staat sinds 17 juli op main en definieert álle drie de onderdelen. Productie
-- draait nog de voorganger 2026_07_17_t14_stuurinfo_invoer_audit.sql. Geen
-- latere migratie herdefinieert de functie of de policy — er is dus niets
-- overschreven. Een gemergede migratie heeft productie simpelweg nooit bereikt,
-- en dat bleef vier weken onopgemerkt omdat er geen versieregister is.
-- Dat is de aanleiding van de ontwerpnotitie, in één casus.
--
-- Na 2026_08_15_t14b_production_drift_repair.sql horen alle vijf op OK te staan.
