-- ============================================================================
--  #423 T4-D — READ-ONLY pre-mergecontrole op de Copilot-rolloutpoorten
-- ----------------------------------------------------------------------------
--  DOEL
--    Vaststellen dat migratie 423a correct is geland, VÓÓR #425 wordt gemerged.
--    Dit is de enige T4-D-controle die bedoeld is om tegen een echte omgeving te
--    draaien, en zij is daarom strikt READ-ONLY: geen insert, geen update, geen
--    delete, geen DDL, geen enkele tijdelijke schrijfactie.
--
--    De DB-gedragssuite `2026_09_21_423_t4d_copilot_rollout.sql` is nadrukkelijk
--    NIET geschikt voor dit doel: zij bewijst gedrag door te schrijven binnen een
--    transactie die terugrolt, en zij gebruikt een psql-metacommando. Prima voor
--    een wegwerp-DB en CI, niet voor de Preview SQL Editor.
--
--  SQL-EDITORVAST: geen psql-metacommando's. Plakbaar in de Supabase SQL Editor.
--
--  ROL: database-eigenaar/postgres. Deze controle meet de STAND van de
--    catalogus en van de grants, niet het gedrag van één sessie. Zij speelt de
--    rolscheiding daarom niet na met `set role` — dat zou alleen aantonen wat
--    één rol mag — maar leest haar uit met has_function_privilege(), wat de
--    werkelijke grants toetst voor microsoft_vault, copilot_operator, anon,
--    authenticated en service_role tegelijk.
--
--  TWEE STANDEN, allebei geldig, allebei asserterend:
--    * expand-venster (alleen 423a): twee bewaar_koppeling-signaturen, 12 en 13
--      parameters. Dit is de stand waarin de pre-mergecontrole hoort te draaien.
--    * post-contract (423a + 423b): exact één signatuur, met client_id.
--  Er wordt nooit stil overgeslagen; de melding zegt welke tak is gemeten.
-- ============================================================================
do $$
declare
  v_n integer; v_rol text; v_fout text := ''; v_tak text;
  v_tgnaam text; v_tgenabled text; v_tgtype integer; v_fnnaam text; v_fnschema text;
  v_rij record;
begin
  -- ── 1. Rollen. Eerst, en meteen afbreken ─────────────────────────────────
  -- has_function_privilege() werpt verderop een kale fout op een niet-bestaande
  -- rol, en dan leest de operator niet wélke stap ontbreekt.
  if not exists (select 1 from pg_roles where rolname = 'copilot_operator') then
    v_fout := v_fout || E'\n  - de rol copilot_operator ontbreekt (stap 1 van de uitrolvolgorde)';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'microsoft_vault') then
    v_fout := v_fout || E'\n  - de rol microsoft_vault ontbreekt (draai eerst de fase-1-connectormigratie)';
  end if;
  if v_fout <> '' then
    raise exception E'423 T4-D PRE-MERGECONTROLE GEFAALD - de rollen zijn niet compleet:%\n\nProvision volgens security/COPILOT-T4D-RUNBOOK.md en draai daarna 423a.', v_fout;
  end if;

  -- ── 2. Is 423a toegepast? ────────────────────────────────────────────────
  if not exists (select 1 from information_schema.columns
                  where table_schema='microsoft_private' and table_name='verbindingen'
                    and column_name='client_id') then
    raise exception '423 T4-D PRE-MERGECONTROLE GEFAALD: microsoft_private.verbindingen.client_id bestaat niet. Migratie 423a is niet toegepast.';
  end if;

  -- ── 3. Kolommen: aanwezig, nullable, en GEEN backfill ────────────────────
  select count(*) into v_n from information_schema.columns
   where table_schema='microsoft_private' and table_name='verbindingen'
     and column_name in ('client_id','verbinding_versie');
  if v_n <> 2 then
    v_fout := v_fout || E'\n  - ' || v_n || ' van 2 T4-D-kolommen aanwezig';
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema='microsoft_private' and table_name='verbindingen'
                and column_name='client_id' and is_nullable='NO') then
    v_fout := v_fout || E'\n  - client_id is NOT NULL; dat breekt de oude koppelflow in het expand-venster';
  end if;

  -- Een bestaande rij kan onder een andere appregistratie zijn ontstaan. Vullen
  -- zou een aanname als feit vastleggen; herconsent is de enige weg.
  select count(*) into v_n from microsoft_private.verbindingen where client_id is not null;
  if v_n > 0 then
    v_fout := v_fout || E'\n  - ' || v_n || ' verbinding(en) hebben al een client_id; er hoort NIET gebackfild te worden';
  end if;

  -- ── 4. Tabellen ──────────────────────────────────────────────────────────
  foreach v_rol in array array['copilot_rollout','copilot_billingbewijs',
                               'copilot_operator_log','copilot_blokkade'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='microsoft_private' and c.relname=v_rol and c.relkind='r') then
      v_fout := v_fout || E'\n  - tabel ' || v_rol || ' ontbreekt';
    end if;
  end loop;

  -- ── 5. DICHT: afwezige rij betekent dicht, en een rij mag niet aan staan ─
  if exists (select 1 from microsoft_private.copilot_rollout where aan) then
    v_fout := v_fout || E'\n  - de globale kill switch staat AAN; na 423a hoort hij dicht te zijn';
  end if;

  -- ── 6. Functies ──────────────────────────────────────────────────────────
  foreach v_rol in array array['copilot_lees_readiness','copilot_zet_rollout',
                               'copilot_zet_billingbewijs','copilot_registreer_blokkade'] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname='microsoft_private' and p.proname=v_rol) then
      v_fout := v_fout || E'\n  - functie ' || v_rol || ' ontbreekt';
    end if;
  end loop;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='microsoft_private' and p.proname='bewaar_koppeling';
  if v_n = 2 then
    v_tak := 'expand-venster (alleen 423a)';
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname='microsoft_private' and p.proname='bewaar_koppeling' and p.pronargs=12)
       or not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname='microsoft_private' and p.proname='bewaar_koppeling' and p.pronargs=13) then
      v_fout := v_fout || E'\n  - twee bewaar_koppeling-signaturen, maar niet de vormen met 12 en 13 parameters';
    end if;
  elsif v_n = 1 then
    v_tak := 'post-contract (423a + 423b)';
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname='microsoft_private' and p.proname='bewaar_koppeling' and p.pronargs=13) then
      v_fout := v_fout || E'\n  - na de contract-stap hoort de overgebleven signatuur de dertien-parametervorm te zijn';
    end if;
  else
    v_fout := v_fout || E'\n  - bewaar_koppeling heeft ' || v_n || ' signatuur(en); verwacht 2 (expand-venster) of 1 (post-contract)';
  end if;

  -- ── 7. Readiness levert ALTIJD één rij, en die is volledig dicht ─────────
  -- Leesfunctie zonder schrijfpad; een onbekend fonds/gebruiker raakt niets.
  select count(*) into v_n
    from microsoft_private.copilot_lees_readiness(gen_random_uuid(), gen_random_uuid());
  if v_n <> 1 then
    v_fout := v_fout || E'\n  - readiness gaf ' || v_n || ' rijen voor een onbekend fonds; verwacht precies 1';
  else
    select * into v_rij
      from microsoft_private.copilot_lees_readiness(gen_random_uuid(), gen_random_uuid());
    if v_rij.globale_rollout_aan or v_rij.fondsflag_aan or v_rij.billing_geldig
       or v_rij.tijdelijk_geblokkeerd or v_rij.status is not null then
      v_fout := v_fout || E'\n  - readiness levert een open poort op een onbekend fonds; dat hoort volledig dicht te zijn';
    end if;
  end if;

  -- ── 8. Het auditslot: exacte configuratie ────────────────────────────────
  -- Alleen de metadata; de mutatiepoging uit de rollbackfasen hoort hier niet,
  -- want die schrijft. Zie de rollbackfasen voor het gedragsbewijs.
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
      v_fout := v_fout || E'\n  - het auditslot staat uit of vuurt alleen op een replica (tgenabled = ' || v_tgenabled || ')';
    end if;
    if (v_tgtype & 16) = 0 or (v_tgtype & 8) = 0 or (v_tgtype & 1) = 0 or (v_tgtype & 2) = 0 then
      v_fout := v_fout || E'\n  - het auditslot dekt niet BEFORE/ROW op UPDATE én DELETE (tgtype = ' || v_tgtype || ')';
    end if;
  end if;

  -- ── 9. Rolscheiding en bevinding H-18 ────────────────────────────────────
  if not has_function_privilege('microsoft_vault','microsoft_private.copilot_lees_readiness(uuid,uuid)','execute') then
    v_fout := v_fout || E'\n  - microsoft_vault kan readiness niet lezen';
  end if;
  if not has_function_privilege('microsoft_vault','microsoft_private.copilot_registreer_blokkade(uuid,uuid,timestamptz,text)','execute') then
    v_fout := v_fout || E'\n  - microsoft_vault kan geen blokkade registreren';
  end if;
  if has_function_privilege('microsoft_vault','microsoft_private.copilot_zet_rollout(boolean,text,text)','execute') then
    v_fout := v_fout || E'\n  - microsoft_vault kan de kill switch bedienen; dat hoort niet';
  end if;
  if has_function_privilege('microsoft_vault','microsoft_private.copilot_zet_billingbewijs(uuid,boolean,text,text)','execute') then
    v_fout := v_fout || E'\n  - microsoft_vault kan het billingbewijs zetten; dat hoort niet';
  end if;
  if not has_function_privilege('copilot_operator','microsoft_private.copilot_zet_rollout(boolean,text,text)','execute') then
    v_fout := v_fout || E'\n  - copilot_operator kan de kill switch NIET bedienen';
  end if;
  if has_function_privilege('copilot_operator','microsoft_private.copilot_lees_readiness(uuid,uuid)','execute') then
    v_fout := v_fout || E'\n  - copilot_operator kan readiness lezen; dat hoort niet';
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
    raise exception E'423 T4-D PRE-MERGECONTROLE GEFAALD (tak: %):%', coalesce(v_tak,'onbepaald'), v_fout;
  end if;
  raise notice '423 T4-D pre-mergecontrole GESLAAGD, tak: %. Kolommen aanwezig en nullable, geen backfill, poorten dicht, readiness levert één volledig dichte rij, auditslot actief met de juiste configuratie, rolscheiding en H-18 in orde.', v_tak;
end $$;
