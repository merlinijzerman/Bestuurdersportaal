-- ============================================================================
--  #423 T4-D — gedragssuite op de Copilot-rolloutpoorten (DB-laag)
-- ----------------------------------------------------------------------------
--  Toetst de UITKOMST in de database, niet de intentie in de migratie. Draait
--  tegen een ephemere test-DB en rolt alles aan het eind terug.
--
--  Wat hier wordt bewezen:
--    1. afwezige rollout-rij = DICHT (niet open);
--    2. de OUDE bewaar_koppeling-signatuur schrijft client_id expliciet op NULL,
--       óók bij on conflict over een rij die al een client-id had;
--    3. beide signaturen hogen verbinding_versie op; een tokenrefresh niet;
--    4. ontkoppelen hoogt de versie op;
--    5. de rolscheiding: microsoft_vault mag de rem niet bedienen, en
--       copilot_operator mag readiness niet lezen;
--    6. de operatoraudit legt actor, reden ÉN session_user vast;
--    7. copilot_operator_log is append-only;
--    8. readiness levert ALTIJD precies één rij, ook zonder verbinding;
--    9. de fondsflag telt alleen bij jsonb `true`, en de vensterblokkade werkt
--       en is uitsluitend te VERLENGEN.
--
-- ROL: database-eigenaar/postgres. Deze suite meet bewust NIET als
--   microsoft_vault of copilot_operator: zij roept de definers aan om hun
--   GEDRAG vast te stellen (schrijft de oude signatuur echt NULL? hoogt een
--   refresh de versie niet op?), en dat gedrag is rolonafhankelijk omdat het in
--   de functiebody zit. De ROLSCHEIDING zelf wordt daarom niet nagespeeld met
--   `set role` — dat zou alleen aantonen dat één sessie iets wel of niet mag —
--   maar uitgelezen met has_function_privilege(), wat de werkelijke grants
--   toetst voor álle betrokken rollen tegelijk, inclusief anon, authenticated
--   en service_role.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_fonds uuid := gen_random_uuid();
  v_gebruiker uuid := gen_random_uuid();
  v_versie integer;
  v_client text;
  v_rollout boolean;
  v_cacheversie integer;
  v_sessierol text;
  v_ok boolean;
  v_rijen integer;
  v_status text;
  v_flag boolean;
  v_blok boolean;
  v_tot timestamptz;
  v_leeg_fonds uuid := gen_random_uuid();
  v_leeg_gebruiker uuid := gen_random_uuid();
begin
  insert into public.fondsen(id, naam, slug) values (v_fonds, 'T4D Wegwerpfonds', 't4d-wegwerp-' || left(v_fonds::text, 8));
  insert into auth.users(id) values (v_gebruiker);

  -- ── 1. Afwezige rollout-rij betekent DICHT ───────────────────────────────
  delete from microsoft_private.copilot_rollout;
  perform microsoft_private.bewaar_koppeling(
    v_fonds, v_gebruiker, 'tenant-a', 'oid-1', 'oid-1.tenant-a', 'Naam', 'n***@x', array['Files.Read.All','Sites.Read.All'],
    1, 'iv', 'tag', 'cipher', 'client-preview');

  select globale_rollout_aan into v_rollout
    from microsoft_private.copilot_lees_readiness(v_fonds, v_gebruiker);
  if v_rollout is distinct from false then
    raise exception 'FOUT 1: een lege copilot_rollout wordt niet als dicht gelezen (kreeg %)', v_rollout;
  end if;

  -- ── 2/3. Nieuwe signatuur zet client-id; versie loopt op ─────────────────
  select client_id, verbinding_versie into v_client, v_versie
    from microsoft_private.verbindingen where fonds_id = v_fonds and gebruiker_id = v_gebruiker;
  if v_client is distinct from 'client-preview' then
    raise exception 'FOUT 2: nieuwe signatuur schreef client_id % in plaats van client-preview', v_client;
  end if;

  -- Herkoppelen via de nieuwe signatuur: versie moet omhoog.
  perform microsoft_private.bewaar_koppeling(
    v_fonds, v_gebruiker, 'tenant-a', 'oid-1', 'oid-1.tenant-a', 'Naam', 'n***@x', array['Files.Read.All','Sites.Read.All'],
    1, 'iv', 'tag', 'cipher', 'client-preview');
  select verbinding_versie into v_versie
    from microsoft_private.verbindingen where fonds_id = v_fonds and gebruiker_id = v_gebruiker;
  if v_versie <> 2 then
    raise exception 'FOUT 3: verbinding_versie is % na herkoppelen, verwacht 2', v_versie;
  end if;

  -- ── 4. Het expand-venster, afhankelijk van de stand van de keten ─────────
  -- Beide takken toetsen iets echts; er wordt nooit stil overgeslagen.
  --
  --   • oude signatuur aanwezig  ⇒ expand-venster: zij MOET client_id op NULL
  --     zetten, ook bij on conflict over een rij die al een client-id had. Dat
  --     is het geval dat fail-open zou opleveren als de kolom werd weggelaten
  --     in plaats van expliciet genuld.
  --   • oude signatuur weg       ⇒ post-contract: er hoort exact één signatuur
  --     te bestaan, en die schrijft altijd een client-id.
  select count(*) = 2 into v_ok
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'microsoft_private' and p.proname = 'bewaar_koppeling';

  if v_ok then
    raise notice 'T4-D: expand-venster open, de oude signatuur wordt getoetst.';
    perform microsoft_private.bewaar_koppeling(
      v_fonds, v_gebruiker, 'tenant-a', 'oid-1', 'oid-1.tenant-a', 'Naam', 'n***@x', array['Files.Read.All','Sites.Read.All'],
      1, 'iv', 'tag', 'cipher');
    select client_id, verbinding_versie into v_client, v_versie
      from microsoft_private.verbindingen where fonds_id = v_fonds and gebruiker_id = v_gebruiker;
    if v_client is not null then
      raise exception 'FOUT 4: de oude signatuur liet client_id op % staan; het expand-venster is niet fail-closed', v_client;
    end if;
    if v_versie <> 3 then
      raise exception 'FOUT 5: de oude signatuur hoogde verbinding_versie niet op (is %)', v_versie;
    end if;
  else
    raise notice 'T4-D: contract-stap is gedraaid, de post-contract-invariant wordt getoetst.';
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'microsoft_private' and p.proname = 'bewaar_koppeling') <> 1 then
      raise exception 'FOUT 4b: na de contract-stap hoort er exact één bewaar_koppeling te bestaan';
    end if;
    -- De overgebleven signatuur schrijft altijd een client-id.
    perform microsoft_private.bewaar_koppeling(
      v_fonds, v_gebruiker, 'tenant-a', 'oid-1', 'oid-1.tenant-a', 'Naam', 'n***@x', array['Files.Read.All','Sites.Read.All'],
      1, 'iv', 'tag', 'cipher', 'client-preview');
    select client_id, verbinding_versie into v_client, v_versie
      from microsoft_private.verbindingen where fonds_id = v_fonds and gebruiker_id = v_gebruiker;
    if v_client is distinct from 'client-preview' then
      raise exception 'FOUT 5b: de overgebleven signatuur schreef client_id % ', v_client;
    end if;
    if v_versie <> 3 then
      raise exception 'FOUT 5c: verbinding_versie is % na de derde koppeling', v_versie;
    end if;
  end if;

  -- ── 5. Een tokenrefresh raakt verbinding_versie NIET ─────────────────────
  select c.versie into v_cacheversie
    from microsoft_private.token_cache c
    join microsoft_private.verbindingen v on v.id = c.verbinding_id
   where v.fonds_id = v_fonds and v.gebruiker_id = v_gebruiker;
  perform microsoft_private.bewaar_cache(v_fonds, v_gebruiker, v_cacheversie, 2, 'iv2', 'tag2', 'cipher2');
  select verbinding_versie into v_versie
    from microsoft_private.verbindingen where fonds_id = v_fonds and gebruiker_id = v_gebruiker;
  if v_versie <> 3 then
    raise exception 'FOUT 6: een tokenrefresh hoogde verbinding_versie op naar %; dat zou elke beurt afbreken', v_versie;
  end if;

  -- ── 6. Ontkoppelen hoogt de versie wél op ────────────────────────────────
  perform microsoft_private.ontkoppel(v_fonds, v_gebruiker);
  select verbinding_versie into v_versie
    from microsoft_private.verbindingen where fonds_id = v_fonds and gebruiker_id = v_gebruiker;
  if v_versie <> 4 then
    raise exception 'FOUT 7: ontkoppelen hoogde verbinding_versie niet op (is %)', v_versie;
  end if;

  -- ── 7. Operatoraudit: actor, reden én session_user ───────────────────────
  delete from microsoft_private.copilot_operator_log;
  perform microsoft_private.copilot_zet_rollout(true, 'dba-01', 'T4D-activatieproef');
  select sessierol into v_sessierol from microsoft_private.copilot_operator_log limit 1;
  if v_sessierol is null or v_sessierol <> session_user then
    raise exception 'FOUT 8: sessierol in de audit is % maar session_user is %', v_sessierol, session_user;
  end if;
  if not exists (
    select 1 from microsoft_private.copilot_operator_log
     where actor = 'dba-01' and reden = 'T4D-activatieproef' and handeling = 'copilot.rollout.aan'
  ) then
    raise exception 'FOUT 9: actor of reden ontbreekt in de operatoraudit';
  end if;

  -- Lege actor of reden wordt geweigerd.
  begin
    perform microsoft_private.copilot_zet_rollout(false, '', 'reden');
    raise exception 'FOUT 10: een lege actor werd geaccepteerd';
  exception when others then
    if sqlerrm like 'FOUT 10%' then raise; end if;
  end;

  -- ── 8. copilot_operator_log is append-only ───────────────────────────────
  begin
    update microsoft_private.copilot_operator_log set reden = 'herschreven';
    raise exception 'FOUT 11: de operatoraudit bleek muteerbaar';
  exception when others then
    if sqlerrm like 'FOUT 11%' then raise; end if;
  end;

  -- ── 9. Readiness levert ALTIJD precies één rij ───────────────────────────
  -- Een fonds/gebruiker zonder enige verbinding. De oude vorm gaf hier nul rijen
  -- terug, en dan is 'geen consent' niet te onderscheiden van 'niet gelezen'.
  -- Stap 7 zette de globale schakelaar aan; die is niet fondsspecifiek, dus
  -- eerst terug naar dicht — anders toetst de controle hieronder niets.
  perform microsoft_private.copilot_zet_rollout(false, 'dba-01', 'terug naar dicht voor de leeg-fondscontrole');

  insert into public.fondsen(id, naam, slug)
    values (v_leeg_fonds, 'T4D Leeg fonds', 't4d-leeg-' || left(v_leeg_fonds::text, 8));
  insert into auth.users(id) values (v_leeg_gebruiker);

  select count(*) into v_rijen
    from microsoft_private.copilot_lees_readiness(v_leeg_fonds, v_leeg_gebruiker);
  if v_rijen <> 1 then
    raise exception 'FOUT 18: readiness gaf % rijen zonder verbinding, verwacht precies 1', v_rijen;
  end if;

  select status, globale_rollout_aan, fondsflag_aan, billing_geldig, tijdelijk_geblokkeerd
    into v_status, v_rollout, v_flag, v_ok, v_blok
    from microsoft_private.copilot_lees_readiness(v_leeg_fonds, v_leeg_gebruiker);
  if v_status is not null then
    raise exception 'FOUT 19: zonder verbinding hoort status null te zijn, kreeg %', v_status;
  end if;
  if v_rollout or v_flag or v_ok or v_blok then
    raise exception 'FOUT 20: de poorten staan niet allemaal dicht op een leeg fonds';
  end if;

  -- ── 10. De fondsflag telt alleen bij jsonb `true` ─────────────────────────
  insert into public.fonds_feature_flags(fonds_id, flag_key, waarde)
    values (v_leeg_fonds, 'microsoft_copilot_retrieval', '"true"'::jsonb);
  select fondsflag_aan into v_flag
    from microsoft_private.copilot_lees_readiness(v_leeg_fonds, v_leeg_gebruiker);
  if v_flag then
    raise exception 'FOUT 21: de string "true" opende de fondsflag; alleen jsonb true mag tellen';
  end if;

  -- `versie` mee ophogen: fn_fonds_config_capture logt elke flagwijziging en
  -- eist een unieke versie per sleutel.
  update public.fonds_feature_flags set waarde = 'true'::jsonb, versie = versie + 1
   where fonds_id = v_leeg_fonds and flag_key = 'microsoft_copilot_retrieval';
  select fondsflag_aan into v_flag
    from microsoft_private.copilot_lees_readiness(v_leeg_fonds, v_leeg_gebruiker);
  if not v_flag then
    raise exception 'FOUT 22: jsonb true opende de fondsflag niet';
  end if;

  -- ── 11. Vensterblokkade: werkt, en is alleen te VERLENGEN ─────────────────
  perform microsoft_private.copilot_registreer_blokkade(
    v_leeg_fonds, v_leeg_gebruiker, now() + interval '10 minutes', '429 tijdens proef');
  select tijdelijk_geblokkeerd into v_blok
    from microsoft_private.copilot_lees_readiness(v_leeg_fonds, v_leeg_gebruiker);
  if not v_blok then
    raise exception 'FOUT 23: een lopende blokkade werd niet gelezen';
  end if;

  -- Inkorten mag niet: de arm mag zijn eigen rem niet losdraaien.
  perform microsoft_private.copilot_registreer_blokkade(
    v_leeg_fonds, v_leeg_gebruiker, now() - interval '1 hour', 'poging tot inkorten');
  select geblokkeerd_tot into v_tot from microsoft_private.copilot_blokkade
   where fonds_id = v_leeg_fonds and gebruiker_id = v_leeg_gebruiker;
  if v_tot <= now() then
    raise exception 'FOUT 24: de blokkade werd ingekort tot %', v_tot;
  end if;
  select tijdelijk_geblokkeerd into v_blok
    from microsoft_private.copilot_lees_readiness(v_leeg_fonds, v_leeg_gebruiker);
  if not v_blok then
    raise exception 'FOUT 25: na een inkortpoging is de blokkade verdwenen';
  end if;

  -- Een fondsbrede blokkade (gebruiker_id null) raakt óók een andere actor.
  perform microsoft_private.copilot_registreer_blokkade(
    v_leeg_fonds, null, now() + interval '10 minutes', 'fondsbrede 429');
  select tijdelijk_geblokkeerd into v_blok
    from microsoft_private.copilot_lees_readiness(v_leeg_fonds, gen_random_uuid());
  if not v_blok then
    raise exception 'FOUT 26: een fondsbrede blokkade raakte een andere actor niet';
  end if;

  -- Een verlopen blokkade blokkeert niet meer.
  delete from microsoft_private.copilot_blokkade where fonds_id = v_leeg_fonds;
  insert into microsoft_private.copilot_blokkade(fonds_id, gebruiker_id, geblokkeerd_tot, reden)
    values (v_leeg_fonds, v_leeg_gebruiker, now() - interval '1 minute', 'verlopen');
  select tijdelijk_geblokkeerd into v_blok
    from microsoft_private.copilot_lees_readiness(v_leeg_fonds, v_leeg_gebruiker);
  if v_blok then
    raise exception 'FOUT 27: een verlopen blokkade blokkeert nog steeds';
  end if;

  raise notice 'T4-D gedragssuite: alle gedragscontroles geslaagd.';
end $$;

-- ── 9. Rolscheiding, buiten het do-blok zodat de grants echt worden getoetst ─
do $$
declare v_mag boolean;
begin
  -- microsoft_vault LEEST readiness maar bedient de rem niet.
  select has_function_privilege('microsoft_vault',
    'microsoft_private.copilot_lees_readiness(uuid,uuid)', 'execute') into v_mag;
  if not v_mag then raise exception 'FOUT 12: microsoft_vault kan readiness niet lezen'; end if;

  select has_function_privilege('microsoft_vault',
    'microsoft_private.copilot_zet_rollout(boolean,text,text)', 'execute') into v_mag;
  if v_mag then raise exception 'FOUT 13: microsoft_vault kan de kill switch bedienen'; end if;

  select has_function_privilege('microsoft_vault',
    'microsoft_private.copilot_zet_billingbewijs(uuid,boolean,text,text)', 'execute') into v_mag;
  if v_mag then raise exception 'FOUT 14: microsoft_vault kan het billingbewijs zetten'; end if;

  -- copilot_operator bedient de rem maar heeft geen leespad naar verbindingen.
  select has_function_privilege('copilot_operator',
    'microsoft_private.copilot_zet_rollout(boolean,text,text)', 'execute') into v_mag;
  if not v_mag then raise exception 'FOUT 15: copilot_operator kan de kill switch niet bedienen'; end if;

  select has_function_privilege('copilot_operator',
    'microsoft_private.copilot_lees_readiness(uuid,uuid)', 'execute') into v_mag;
  if v_mag then raise exception 'FOUT 16: copilot_operator kan readiness lezen'; end if;

  -- De arm mag zijn eigen rem AANZETTEN; de operator heeft daar niets te zoeken.
  select has_function_privilege('microsoft_vault',
    'microsoft_private.copilot_registreer_blokkade(uuid,uuid,timestamptz,text)', 'execute') into v_mag;
  if not v_mag then raise exception 'FOUT 18b: microsoft_vault kan geen blokkade registreren'; end if;

  select has_function_privilege('copilot_operator',
    'microsoft_private.copilot_registreer_blokkade(uuid,uuid,timestamptz,text)', 'execute') into v_mag;
  if v_mag then raise exception 'FOUT 18c: copilot_operator kan een blokkade registreren'; end if;

  -- Geen browser- of servicerol raakt iets van dit alles.
  for v_mag in
    select has_function_privilege(rol, fn, 'execute')
      from unnest(array['anon','authenticated','service_role']) rol,
           unnest(array[
             'microsoft_private.copilot_lees_readiness(uuid,uuid)',
             'microsoft_private.copilot_zet_rollout(boolean,text,text)',
             'microsoft_private.copilot_zet_billingbewijs(uuid,boolean,text,text)',
             'microsoft_private.copilot_registreer_blokkade(uuid,uuid,timestamptz,text)'
           ]) fn
  loop
    if v_mag then raise exception 'FOUT 17: een browser- of servicerol heeft execute op een copilot-functie'; end if;
  end loop;

  raise notice 'T4-D gedragssuite: rolscheiding geslaagd.';
end $$;

rollback;
