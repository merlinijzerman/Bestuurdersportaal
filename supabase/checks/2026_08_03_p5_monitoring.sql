-- ============================================================================
--  GEDRAGSCHECK 2026-08-03 — P5 monitoringbasis
--
--  De structurele gates (2026_07_31_r1_structurele_gates.sql) toetsen de VORM:
--  staat RLS aan, is er een policy, is het search_path gepind. Deze check toetst
--  het GEDRAG: ziet de publieke anon-key daadwerkelijk niets, en kan hij het
--  schrijfpad niet aanroepen.
--
--  Dat onderscheid is niet academisch. CLAUDE.md: "toets de uitkomst in de
--  database, niet de intentie in de migratie" — een `revoke` in een migratie
--  bewijst niets over productie, want er is geen migratierunner. De review van
--  31-07-2026 vond drie objecten die in productie stonden maar in geen enkele
--  migratie.
--
--  SEED-EERST: zonder rijen zou elke telling vacuüm op 0 uitkomen en zou deze
--  check groen zijn op een tabel die wagenwijd openstaat. Er wordt daarom eerst
--  als eigenaar geseed, en pas daarna als `anon` geteld. Alles in één
--  transactie met ROLLBACK — er blijft niets achter.
--
--  Draaien:
--    psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/2026_08_03_p5_monitoring.sql
--  of plakken in de Supabase SQL-editor.
-- ============================================================================

begin;

-- ── Seed ────────────────────────────────────────────────────────────────────
insert into public.fondsen (id, naam, slug)
values ('44444444-4444-4444-4444-444444444444', 'P5 Testfonds', 'p5-monitoring-test')
on conflict (id) do nothing;

insert into public.app_errors (fonds_id, label, categorie, severity, melding_kort)
values ('44444444-4444-4444-4444-444444444444', 'p5.check', 'validatie', 'laag', 'seed');

insert into public.platform_signal_snapshots (signaal, fonds_id, waarde, n, status)
values ('uptime_kern', null, 100, 1, 'groen');

insert into public.platform_signaal_config
  (signaal, label, eenheid, interval_minuten, venster_minuten, richting)
values ('p5_check_dummy', 'P5 check', 'aantal', 5, 60, 'hoger_is_slechter')
on conflict (signaal) do nothing;

-- ── 1. anon ziet niets en mag niets ─────────────────────────────────────────
set local role anon;

do $$
declare
  fouten text := '';
  n int;
begin
  -- Lezen. Een geslaagde SELECT met 0 rijen is óók goed (RLS deny-by-default);
  -- een permission-denied is nog beter (grants ingetrokken). Beide tellen als
  -- OK; alles wat rijen teruggeeft is fout.
  begin
    select count(*) into n from public.app_errors;
    if n <> 0 then
      fouten := fouten || format('  - app_errors: %s rijen zichtbaar voor anon%s', n, chr(10));
    end if;
  exception when insufficient_privilege then null;
  end;

  begin
    select count(*) into n from public.platform_signal_snapshots;
    if n <> 0 then
      fouten := fouten || format('  - platform_signal_snapshots: %s rijen zichtbaar voor anon%s', n, chr(10));
    end if;
  exception when insufficient_privilege then null;
  end;

  begin
    select count(*) into n from public.platform_signaal_config;
    if n <> 0 then
      fouten := fouten || format('  - platform_signaal_config: %s rijen zichtbaar voor anon%s', n, chr(10));
    end if;
  exception when insufficient_privilege then null;
  end;

  -- Schrijven MOET falen. Lukt dit wel, dan kan een willekeurige internetbezoeker
  -- de monitoringtabellen vullen (vervuiling van de signalen) of leegtrekken.
  begin
    insert into public.app_errors (label, categorie, severity)
    values ('anon.injectie', 'validatie', 'laag');
    fouten := fouten || '  - anon kan INSERTen in app_errors' || chr(10);
  exception when others then null;  -- elke fout is goed: de schrijfpoging faalde
  end;

  begin
    insert into public.platform_signal_snapshots (signaal, status)
    values ('anon_injectie', 'groen');
    fouten := fouten || '  - anon kan INSERTen in platform_signal_snapshots' || chr(10);
  exception when others then null;  -- elke fout is goed: de schrijfpoging faalde
  end;

  -- Drempels verzetten is een aanvalspad op zich: zet drempel_rood op 999999 en
  -- het dashboard staat voor eeuwig op groen.
  begin
    update public.platform_signaal_config set drempel_rood = 999999;
    fouten := fouten || '  - anon kan drempels wijzigen in platform_signaal_config' || chr(10);
  exception when others then null;  -- elke fout is goed: de schrijfpoging faalde
  end;

  -- DELETE en TRUNCATE. TRUNCATE valt buiten RLS — Postgres evalueert daarbij
  -- geen enkele policy — dus deny-by-default beschermt daar niet tegen; alleen
  -- de ingetrokken grant doet dat. Gate F dekt dit structureel, maar een
  -- monitoringtabel die leeggetrokken kan worden verdient een eigen gedragstest.
  begin
    delete from public.app_errors;
    fouten := fouten || '  - anon kan rijen VERWIJDEREN uit app_errors' || chr(10);
  exception when others then null;
  end;

  begin
    execute 'truncate public.platform_signal_snapshots';
    fouten := fouten || '  - anon kan platform_signal_snapshots TRUNCATEn' || chr(10);
  exception when others then null;
  end;

  -- Het SCHRIJFPAD zelf. fn_app_error_log is bewust NIET aan anon gegeven: dat
  -- zou een internet-facing schrijfpad naar een platformtabel openen en gate H
  -- breken.
  begin
    perform public.fn_app_error_log('anon.rpc', 'validatie', 'laag');
    fouten := fouten || '  - anon kan fn_app_error_log uitvoeren' || chr(10);
  exception when others then null;  -- elke fout is goed: de aanroep faalde
  end;

  if fouten <> '' then
    raise exception E'P5-GEDRAGSCHECK FAALT (anon):\n%', fouten;
  end if;
  raise notice 'P5 OK (anon): geen leesbare rijen, geen schrijfpad, geen RPC.';
end $$;

reset role;

-- ── 2. authenticated ziet de tabellen evenmin ───────────────────────────────
--  Een ingelogde bestuurder is geen platformbeheerder. Er is geen policy, dus
--  ook met een geldige sessie hoort er niets zichtbaar te zijn.
set local role authenticated;

do $$
declare
  fouten text := '';
  n int;
begin
  begin
    select count(*) into n from public.app_errors;
    if n <> 0 then
      fouten := fouten || format('  - app_errors: %s rijen zichtbaar voor authenticated%s', n, chr(10));
    end if;
  exception when insufficient_privilege then null;
  end;

  begin
    select count(*) into n from public.platform_signal_snapshots;
    if n <> 0 then
      fouten := fouten || format('  - platform_signal_snapshots: %s rijen zichtbaar voor authenticated%s', n, chr(10));
    end if;
  exception when insufficient_privilege then null;
  end;

  if fouten <> '' then
    raise exception E'P5-GEDRAGSCHECK FAALT (authenticated):\n%', fouten;
  end if;
  raise notice 'P5 OK (authenticated): geen leesbare monitoringrijen zonder platformrol.';
end $$;

reset role;

-- ── 3. app_errors is NIET append-only (retentie moet kunnen) ────────────────
--  De tegenhanger van de auditcheck: op governance_log of platform_event_log
--  MOET een DELETE falen. Hier moet hij juist SLAGEN, anders is de bewaartermijn
--  van 90 dagen (besluit 0104) niet uitvoerbaar en groeit de tabel eeuwig door.
--  Dit legt het onderscheid vast in plaats van het impliciet te laten.
do $$
declare
  verwijderd int;
begin
  delete from public.app_errors where label = 'p5.check';
  get diagnostics verwijderd = row_count;
  if verwijderd < 1 then
    raise exception 'P5 FAALT: DELETE op app_errors verwijderde niets — is er alsnog een append-only-trigger gezet? Dan is de retentie niet uitvoerbaar.';
  end if;
  raise notice 'P5 OK: app_errors is opschoonbaar (bewust GEEN auditspoor, besluit 0104).';
end $$;

-- ── 4. Het auditspoor is ONGEWIJZIGD append-only ────────────────────────────
--  Regressiecontrole en de KERNBELOFTE van deze tranche: monitoring mag het
--  bestaande auditspoor niet hebben geraakt.
--
--  SEED-EERST, ook hier. De append-only-triggers zijn `before update/delete FOR
--  EACH ROW`: op een LEGE tabel vuurt er niets, wordt er niets geprobeerd, en
--  zou deze check groen melden zonder iets te hebben getoetst. In CI draait dit
--  tegen een ephemere database waar platform_event_log vrijwel zeker leeg is —
--  precies de vacuümval die dit bestand in zijn eigen header benoemt.
--
--  Getoetst worden BEIDE auditlogtabellen die deze tranche aanraakt of leest, en
--  BEIDE mutaties (UPDATE en DELETE) — niet alleen DELETE.
insert into public.platform_event_log
  (correlatie_id, fase, capability, handeling, uitkomst)
values
  ('55555555-5555-5555-5555-555555555555', 'attempt',
   'platform.observability.read', 'p5.check.seed', null);

-- Sinds plateau A (2026-08-04) draagt governance_log geen vraag/antwoord meer;
-- die staan in governance_log_inhoud. De seed gebruikt daarom een vast id en
-- `model` als herkenbare markering. Wat hier wordt getoetst — de append-only
-- triggers — is kolomonafhankelijk en dus ongewijzigd.
insert into public.governance_log (id, fonds_id, modus, model)
values ('66666666-6666-6666-6666-666666666666',
        '44444444-4444-4444-4444-444444444444', 'documenten', 'P5 check');

do $$
declare
  fouten text := '';
  gelukt boolean;
begin
  -- platform_event_log — UPDATE
  gelukt := false;
  begin
    update public.platform_event_log set reden = 'gewijzigd'
     where correlatie_id = '55555555-5555-5555-5555-555555555555';
    gelukt := true;
  exception when others then null;
  end;
  if gelukt then
    fouten := fouten || '  - UPDATE op platform_event_log slaagde (append-only weg)' || chr(10);
  end if;

  -- platform_event_log — DELETE
  gelukt := false;
  begin
    delete from public.platform_event_log
     where correlatie_id = '55555555-5555-5555-5555-555555555555';
    gelukt := true;
  exception when others then null;
  end;
  if gelukt then
    fouten := fouten || '  - DELETE op platform_event_log slaagde (append-only weg)' || chr(10);
  end if;

  -- governance_log — UPDATE. Dit is de tabel die deze tranche daadwerkelijk
  -- aanraakt (twee extra sleutels in retrieval_meta), dus de belangrijkste.
  gelukt := false;
  begin
    update public.governance_log set modus = 'algemeen'
     where id = '66666666-6666-6666-6666-666666666666';
    gelukt := true;
  exception when others then null;
  end;
  if gelukt then
    fouten := fouten || '  - UPDATE op governance_log slaagde (append-only weg)' || chr(10);
  end if;

  -- governance_log — DELETE
  gelukt := false;
  begin
    delete from public.governance_log
     where id = '66666666-6666-6666-6666-666666666666';
    gelukt := true;
  exception when others then null;
  end;
  if gelukt then
    fouten := fouten || '  - DELETE op governance_log slaagde (append-only weg)' || chr(10);
  end if;

  if fouten <> '' then
    raise exception E'P5 FAALT: het auditspoor is niet meer append-only:\n%', fouten;
  end if;
  raise notice 'P5 OK: platform_event_log en governance_log blijven append-only op UPDATE en DELETE.';
end $$;

-- ── 5. service_role kan er WEL bij (positieve controle) ─────────────────────
--  De deny-by-default is hierboven negatief bewezen. Zonder deze positieve
--  tegenhanger zou een strakkere default-ACL de monitoring STIL laten falen:
--  de snapshot-route slikt zijn leesfouten bewust, want hij mag niets blokkeren.
set local role service_role;

do $$
declare
  fouten text := '';
  n int;
begin
  begin
    select count(*) into n from public.platform_signaal_config;
  exception when others then
    fouten := fouten || '  - service_role kan platform_signaal_config niet lezen' || chr(10);
  end;

  begin
    insert into public.platform_signal_snapshots (signaal, status, waarde)
    values ('p5_check_dummy', 'groen', 1);
  exception when others then
    fouten := fouten || '  - service_role kan niet schrijven in platform_signal_snapshots' || chr(10);
  end;

  -- LET OP: eerst een rij MAKEN. Een DELETE die nul rijen raakt slaagt ook als
  -- het recht ontbreekt op rijniveau — dan zou deze controle vacuüm zijn, precies
  -- de val die dit bestand in zijn kop benoemt.
  begin
    insert into public.app_errors (label, categorie, severity, bron)
    values ('p5.check.retentie', 'validatie', 'laag', 'service');
  exception when others then
    fouten := fouten || '  - service_role kan niet schrijven in app_errors' || chr(10);
  end;

  begin
    delete from public.app_errors where label = 'p5.check.retentie';
    get diagnostics n = row_count;
    if n < 1 then
      fouten := fouten || '  - DELETE op app_errors verwijderde niets (retentie onuitvoerbaar)' || chr(10);
    end if;
  exception when others then
    fouten := fouten || '  - service_role kan niet opschonen in app_errors (retentie onuitvoerbaar)' || chr(10);
  end;

  if fouten <> '' then
    raise exception E'P5 FAALT (service_role):\n%', fouten;
  end if;
  raise notice 'P5 OK (service_role): lezen, schrijven en opschonen werken — de monitoring kan draaien.';
end $$;

reset role;

rollback;

-- ============================================================================
--  Alles geslaagd als psql exit 0 gaf en je vier OK-notices zag.
--  Deze check laat NIETS achter: hij eindigt op ROLLBACK.
-- ============================================================================
