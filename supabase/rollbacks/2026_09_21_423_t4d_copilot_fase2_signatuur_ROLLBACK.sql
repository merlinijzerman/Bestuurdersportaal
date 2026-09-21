-- ============================================================================
--  #423 T4-D — ROLLBACK FASE 2 van 4: de oude bewaar_koppeling-signatuur terug
-- ----------------------------------------------------------------------------
--  VOORWAARDE   fase 1 is gedraaid: de kill switch staat uit.
--  VOLGORDE     deze fase draait VÓÓR je de oude applicatiecode deployt. De oude
--               code roept de twaalf-parametervorm aan; bestaat die niet, dan
--               breekt elke Microsoft-koppeling precies terwijl je herstelt.
--
--  Dit bestand VOERT het herstel uit. Een uitgecommentarieerd skelet zou
--  betekenen dat na een volledige rollback géén `bewaar_koppeling` bestaat —
--  precies wanneer je hem nodig hebt.
--
--  De generator kijkt welke T4-D-kolommen er op DIT moment zijn en bouwt de body
--  daarop. Staan ze er nog, dan zet de herstelde functie `client_id` EXPLICIET
--  op NULL en hoogt zij `verbinding_versie` op — net als de variant uit migratie
--  A. Weglaten zou bij `on conflict do update` de vorige client-id laten staan op
--  een verbinding die net opnieuw is gelegd: fail-open, en dan zou de
--  Copilot-arm na een rollback juist wél door een gat heen kunnen.
--
--  De generator BLIJFT na deze fase staan. Fase 4 verandert de kolommen en roept
--  hem opnieuw aan; pas daarna ruimt zij hem op.
--
--  SQL-EDITORVAST: geen psql-metacommando's; één transactie.
-- ============================================================================
begin;

-- ── Preflight: fase 1 aantoonbaar ───────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'microsoft_private' and c.relname = 'copilot_rollout'
  ) then
    if exists (select 1 from microsoft_private.copilot_rollout where aan) then
      raise exception 'FASE 2 geweigerd: de kill switch staat nog AAN. Draai eerst fase 1; een terugbouw begint met een inerte arm.';
    end if;
  else
    raise notice 'LET OP: copilot_rollout bestaat niet. Migratie 423a is niet toegepast, of fase 3 is buiten de volgorde al gedraaid. Deze fase herstelt dan alsnog de koppelflow.';
  end if;
end $$;

-- ── De generator ────────────────────────────────────────────────────────────
create or replace function microsoft_private.copilot_rollback_herstel_bewaar_koppeling()
returns void language plpgsql as $fase2$
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
end $fase2$;

-- Een nieuwe functie krijgt op Postgres standaard EXECUTE voor PUBLIC, en op
-- Supabase kent de default-ACL dat expliciet aan anon en authenticated toe
-- (bevinding H-18 uit CLAUDE.md). Dat geldt ook voor een hulpfunctie in een
-- rollback: alleen de eigenaar hoeft haar te kunnen aanroepen.
revoke all on function microsoft_private.copilot_rollback_herstel_bewaar_koppeling() from public, anon, authenticated, service_role;

select microsoft_private.copilot_rollback_herstel_bewaar_koppeling();

revoke all on function microsoft_private.bewaar_koppeling(uuid,uuid,text,text,text,text,text,text[],integer,text,text,text) from public, anon, authenticated, service_role;
grant execute on function microsoft_private.bewaar_koppeling(uuid,uuid,text,text,text,text,text,text[],integer,text,text,text) to microsoft_vault;

-- ── Eindcontrole ────────────────────────────────────────────────────────────
do $$
declare v_rol text; v_tgnaam text; v_tgenabled text; v_tgtype integer; v_fnnaam text; v_fnschema text; v_muteerbaar boolean;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'microsoft_private' and p.proname = 'bewaar_koppeling' and p.pronargs = 12
  ) then
    raise exception 'FASE 2 mislukt: bewaar_koppeling met 12 parameters bestaat niet';
  end if;
  if not has_function_privilege('microsoft_vault',
       'microsoft_private.bewaar_koppeling(uuid,uuid,text,text,text,text,text,text[],integer,text,text,text)', 'execute') then
    raise exception 'FASE 2 mislukt: microsoft_vault mag de herstelde functie niet aanroepen';
  end if;

  foreach v_rol in array array['public','anon','authenticated','service_role'] loop
    if has_function_privilege(v_rol,
         'microsoft_private.copilot_rollback_herstel_bewaar_koppeling()', 'execute') then
      raise exception 'FASE 2 mislukt: % kan de rollbackgenerator uitvoeren (bevinding H-18)', v_rol;
    end if;
    if has_function_privilege(v_rol,
         'microsoft_private.bewaar_koppeling(uuid,uuid,text,text,text,text,text,text[],integer,text,text,text)', 'execute') then
      raise exception 'FASE 2 mislukt: % kan de herstelde bewaar_koppeling uitvoeren', v_rol;
    end if;
  end loop;

  -- ── Auditslot: de tabel ÉN een trigger die werkelijk append-only afdwingt ──
  -- Het bestaan van "een" niet-interne trigger bewijst niets. Een uitgeschakelde
  -- trigger, een trigger die alleen op INSERT vuurt, of een onschuldige dummy met
  -- een andere functie eronder laat het spoor gewoon muteerbaar. Daarom naam,
  -- functie, status én dekking — en daarna een echte mutatiepoging, want alleen
  -- die bewijst dat het slot ook werkelijk dichtvalt.
  --
  --   tgtype-bits: 1 = ROW, 2 = BEFORE, 8 = DELETE, 16 = UPDATE.
  --   tgenabled:   'O' origin, 'A' always, 'R' alleen replica, 'D' uitgeschakeld.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'microsoft_private' and c.relname = 'copilot_operator_log'
       and c.relkind = 'r'
  ) then
    raise exception 'FASE 2 mislukt: copilot_operator_log ontbreekt in microsoft_private; dat is auditdata en hoort te blijven staan';
  end if;

  select t.tgname, t.tgenabled::text, t.tgtype::integer, fn.proname, fnn.nspname
    into v_tgnaam, v_tgenabled, v_tgtype, v_fnnaam, v_fnschema
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc fn on fn.oid = t.tgfoid
    join pg_namespace fnn on fnn.oid = fn.pronamespace
   where n.nspname = 'microsoft_private'
     and c.relname = 'copilot_operator_log'
     and not t.tgisinternal
     and t.tgname = 'trg_copilot_operator_log_append_only';

  if v_tgnaam is null then
    raise exception 'FASE 2 mislukt: de trigger trg_copilot_operator_log_append_only ontbreekt op copilot_operator_log';
  end if;
  if v_fnschema <> 'microsoft_private' or v_fnnaam <> 'copilot_log_append_only' then
    raise exception 'FASE 2 mislukt: het auditslot hangt aan %.% in plaats van microsoft_private.copilot_log_append_only', v_fnschema, v_fnnaam;
  end if;
  if v_tgenabled not in ('O', 'A') then
    raise exception 'FASE 2 mislukt: het auditslot staat uit of vuurt alleen op een replica (tgenabled = %)', v_tgenabled;
  end if;
  if (v_tgtype & 16) = 0 or (v_tgtype & 8) = 0 then
    raise exception 'FASE 2 mislukt: het auditslot dekt niet zowel UPDATE als DELETE (tgtype = %)', v_tgtype;
  end if;
  if (v_tgtype & 1) = 0 or (v_tgtype & 2) = 0 then
    raise exception 'FASE 2 mislukt: het auditslot is niet BEFORE ... FOR EACH ROW (tgtype = %)', v_tgtype;
  end if;

  -- De metadata kan kloppen terwijl de functie eronder niets doet. Eén echte
  -- poging is het enige sluitende bewijs. Op een lege tabel vuurt een ROW-trigger
  -- niet, dus dan zegt de poging niets en slaan we haar over — de controles
  -- hierboven blijven staan.
  if exists (select 1 from microsoft_private.copilot_operator_log) then
    v_muteerbaar := true;
    begin
      update microsoft_private.copilot_operator_log set reden = reden;
    exception when others then
      v_muteerbaar := false;
    end;
    if v_muteerbaar then
      raise exception 'FASE 2 mislukt: een UPDATE op copilot_operator_log werd NIET geblokkeerd; het slot staat er wel maar werkt niet';
    end if;
  end if;

  raise notice 'FASE 2 geslaagd. DEPLOY NU DE OUDE APPLICATIECODE en neem die deploy waar. Pas daarna fase 3.';
end $$;

commit;
