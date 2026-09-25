-- ============================================================================
--  #423 T4-D — READ-ONLY post-contractcontrole op de Copilot-rolloutpoorten
-- ----------------------------------------------------------------------------
--  DOEL
--    Vaststellen dat migraties 423a én 423b correct zijn geland. Deze controle
--    is herhaalbaar nadat echte Microsoft-koppelingen een client_id hebben
--    opgeslagen. Een gevulde client_id is hier dus geldig bewijs, geen backfill.
--
--  SQL-EDITORVAST: geen psql-metacommando's. Strikt read-only: geen insert,
--  update, delete, DDL of tijdelijke schrijfactie.
--
--  ROL: database-eigenaar/postgres. De catalogus- en grantcontroles meten de
--  werkelijke stand voor microsoft_vault, copilot_operator, anon,
--  authenticated en service_role tegelijk.
-- ============================================================================
do $$
declare
  v_n integer; v_client_ids integer; v_rol text; v_fout text := '';
  v_tgnaam text; v_tgenabled text; v_tgtype integer; v_fnnaam text; v_fnschema text;
  v_rij record;
begin
  -- ── 1. Rollen ────────────────────────────────────────────────────────────
  if not exists (select 1 from pg_roles where rolname = 'copilot_operator') then
    v_fout := v_fout || E'\n  - de rol copilot_operator ontbreekt';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'microsoft_vault') then
    v_fout := v_fout || E'\n  - de rol microsoft_vault ontbreekt';
  end if;
  if v_fout <> '' then
    raise exception E'423 T4-D POST-CONTRACTCONTROLE GEFAALD - de rollen zijn niet compleet:%', v_fout;
  end if;

  -- ── 2. Kolommen aanwezig en nullable ─────────────────────────────────────
  select count(*) into v_n from information_schema.columns
   where table_schema='microsoft_private' and table_name='verbindingen'
     and column_name in ('client_id','verbinding_versie');
  if v_n <> 2 then
    v_fout := v_fout || E'\n  - ' || v_n || ' van 2 T4-D-kolommen aanwezig';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema='microsoft_private' and table_name='verbindingen'
                and column_name='client_id' and is_nullable='NO') then
    v_fout := v_fout || E'\n  - client_id is NOT NULL; ontkoppelde of nog niet hergekoppelde rijen moeten null mogen zijn';
  end if;

  -- Informatief: een echte herconsent hoort client_id juist te vullen. Dit
  -- aantal is daarom nooit op zichzelf een foutconditie.
  select count(*) into v_client_ids
    from microsoft_private.verbindingen where client_id is not null;

  -- ── 3. Tabellen en gesloten kill switch ──────────────────────────────────
  foreach v_rol in array array['copilot_rollout','copilot_billingbewijs',
                               'copilot_operator_log','copilot_blokkade'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='microsoft_private' and c.relname=v_rol and c.relkind='r') then
      v_fout := v_fout || E'\n  - tabel ' || v_rol || ' ontbreekt';
    end if;
  end loop;
  if exists (select 1 from microsoft_private.copilot_rollout where aan) then
    v_fout := v_fout || E'\n  - de globale kill switch staat AAN';
  end if;

  -- ── 4. Functies en de contractstand ──────────────────────────────────────
  foreach v_rol in array array['copilot_lees_readiness','copilot_zet_rollout',
                               'copilot_zet_billingbewijs','copilot_registreer_blokkade'] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname='microsoft_private' and p.proname=v_rol) then
      v_fout := v_fout || E'\n  - functie ' || v_rol || ' ontbreekt';
    end if;
  end loop;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='microsoft_private' and p.proname='bewaar_koppeling';
  if v_n <> 1 then
    v_fout := v_fout || E'\n  - bewaar_koppeling heeft ' || v_n ||
      ' signatuur(en); post-contract verwacht exact één dertien-parametervorm';
  elsif not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='microsoft_private' and p.proname='bewaar_koppeling'
                       and p.pronargs=13) then
    v_fout := v_fout || E'\n  - de overgebleven bewaar_koppeling is niet de dertien-parametervorm';
  end if;

  -- ── 5. Readiness levert altijd één volledig dichte rij ───────────────────
  select count(*) into v_n
    from microsoft_private.copilot_lees_readiness(gen_random_uuid(), gen_random_uuid());
  if v_n <> 1 then
    v_fout := v_fout || E'\n  - readiness gaf ' || v_n || ' rijen voor een onbekend fonds; verwacht precies 1';
  else
    select * into v_rij
      from microsoft_private.copilot_lees_readiness(gen_random_uuid(), gen_random_uuid());
    if v_rij.globale_rollout_aan or v_rij.fondsflag_aan or v_rij.billing_geldig
       or v_rij.tijdelijk_geblokkeerd or v_rij.status is not null then
      v_fout := v_fout || E'\n  - readiness levert een open poort op een onbekend fonds';
    end if;
  end if;

  -- ── 6. Het auditslot: exacte metadata ────────────────────────────────────
  select t.tgname, t.tgenabled::text, t.tgtype::integer, fn.proname, fnn.nspname
    into v_tgnaam, v_tgenabled, v_tgtype, v_fnnaam, v_fnschema
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc fn on fn.oid = t.tgfoid
    join pg_namespace fnn on fnn.oid = fn.pronamespace
   where n.nspname='microsoft_private' and c.relname='copilot_operator_log'
     and not t.tgisinternal and t.tgname='trg_copilot_operator_log_append_only';
  if v_tgnaam is null then
    v_fout := v_fout || E'\n  - de append-only trigger op copilot_operator_log ontbreekt';
  else
    if v_fnschema <> 'microsoft_private' or v_fnnaam <> 'copilot_log_append_only' then
      v_fout := v_fout || E'\n  - het auditslot hangt aan ' || v_fnschema || '.' || v_fnnaam;
    end if;
    if v_tgenabled not in ('O','A') then
      v_fout := v_fout || E'\n  - het auditslot staat uit of vuurt alleen op een replica';
    end if;
    if (v_tgtype & 16) = 0 or (v_tgtype & 8) = 0 or (v_tgtype & 1) = 0 or (v_tgtype & 2) = 0 then
      v_fout := v_fout || E'\n  - het auditslot dekt niet BEFORE/ROW op UPDATE én DELETE';
    end if;
  end if;

  -- ── 7. Rolscheiding en bevinding H-18 ────────────────────────────────────
  if not has_function_privilege('microsoft_vault','microsoft_private.copilot_lees_readiness(uuid,uuid)','execute') then
    v_fout := v_fout || E'\n  - microsoft_vault kan readiness niet lezen';
  end if;
  if not has_function_privilege('microsoft_vault','microsoft_private.copilot_registreer_blokkade(uuid,uuid,timestamptz,text)','execute') then
    v_fout := v_fout || E'\n  - microsoft_vault kan geen blokkade registreren';
  end if;
  if has_function_privilege('microsoft_vault','microsoft_private.copilot_zet_rollout(boolean,text,text)','execute') then
    v_fout := v_fout || E'\n  - microsoft_vault kan de kill switch bedienen';
  end if;
  if has_function_privilege('microsoft_vault','microsoft_private.copilot_zet_billingbewijs(uuid,boolean,text,text)','execute') then
    v_fout := v_fout || E'\n  - microsoft_vault kan het billingbewijs zetten';
  end if;
  if not has_function_privilege('copilot_operator','microsoft_private.copilot_zet_rollout(boolean,text,text)','execute') then
    v_fout := v_fout || E'\n  - copilot_operator kan de kill switch niet bedienen';
  end if;
  if has_function_privilege('copilot_operator','microsoft_private.copilot_lees_readiness(uuid,uuid)','execute') then
    v_fout := v_fout || E'\n  - copilot_operator kan readiness lezen';
  end if;

  foreach v_rol in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(v_rol,'microsoft_private.copilot_lees_readiness(uuid,uuid)','execute')
       or has_function_privilege(v_rol,'microsoft_private.copilot_zet_rollout(boolean,text,text)','execute')
       or has_function_privilege(v_rol,'microsoft_private.copilot_zet_billingbewijs(uuid,boolean,text,text)','execute')
       or has_function_privilege(v_rol,'microsoft_private.copilot_registreer_blokkade(uuid,uuid,timestamptz,text)','execute')
       or has_function_privilege(v_rol,'microsoft_private.copilot_log_append_only()','execute') then
      v_fout := v_fout || E'\n  - rol ' || v_rol || ' heeft execute op een copilot-functie (bevinding H-18)';
    end if;
  end loop;

  if v_fout <> '' then
    raise exception E'423 T4-D POST-CONTRACTCONTROLE GEFAALD:%', v_fout;
  end if;
  raise notice '423 T4-D post-contractcontrole GESLAAGD. Exact één dertien-parametervorm, % koppeling(en) met client_id toegestaan, poorten dicht, readiness dicht, auditslot en rolscheiding in orde.', v_client_ids;
end $$;
