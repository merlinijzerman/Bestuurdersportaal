-- ============================================================================
-- T16 — Cross-tenant + consistentie-testsuite voor tabs 6/7 (oper/premie).
-- ----------------------------------------------------------------------------
-- Doel: onder ÉCHTE RLS bewijzen dat (1) de RPC's stuurinfo_operationeel_-
-- opslaan en stuurinfo_premie_opslaan de RLS-rolgate respecteren (bestuurder →
-- weigering), structureel geen fonds-parameter hebben en fonds B nooit raken,
-- (2) de harde consistentie-checks werken (OPER_/COMP_RESERVE_ONTBREEKT,
-- OPER_/COMP_MUTATIE_ONGELIJK, ONGELDIGE_MUTATIES/KOSTEN/COMPONENTEN/WAARDE),
-- (3) de RPC's de reserve-rijen NIET wijzigen (stand = van de balans-save —
-- één bron per bedrag) en alles gelogd wordt, en (4) de nieuwe reeks-/kpi-
-- rijen deny-by-default blijven (geen delete).
-- Elke overtreding → raise exception → psql exit-code <> 0 → CI faalt.
--
-- Scenario's (werkopdracht T16, decisions/0077):
--   T16a — RPC-rolgate: bestuurder → RLS-weigering (beide RPC's).
--   T16b — beheerder A slaagt (oper): 8 mutaties + 6 kostendetail + 3 kpi's,
--          alles gelogd met actor; reserve-rij ONGEWIJZIGD.
--   T16c — beheerder A slaagt (premie): 12 componenten + 6 mutaties + 3 kpi's;
--          reserve-rij ONGEWIJZIGD.
--   T16d — mutatie-mismatch → OPER_MUTATIE_ONGELIJK / COMP_MUTATIE_ONGELIJK.
--   T16e — periode zonder reserve-rij → OPER_/COMP_RESERVE_ONTBREEKT.
--   T16f — structureel: geen fonds-parameter; anon geen EXECUTE; verkeerde
--          keys → ONGELDIGE_MUTATIES/COMPONENTEN; JSON-null → ONGELDIGE_WAARDE.
--   T16g — tenant-isolatie: de saves van A raakten fonds B niet; authenticated
--          kan T16-rijen niet DELETEN (deny-by-default).
--
-- Self-seeding (T14/T15-patroon; 2 fondsen + 3 users via trigger maak_profiel).
-- Alles in één transactie met ROLLBACK — laat niets achter.
--
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed als tabel-eigenaar (RLS omzeild). Vaste UUID's voor de test. ────────
insert into public.fondsen (id, naam, slug) values
  ('61111111-1111-1111-1111-111111111111', 'T16 Fonds A', 't16-fonds-a'),
  ('62222222-2222-2222-2222-222222222222', 'T16 Fonds B', 't16-fonds-b');

insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','t16-a-beheer@test.local',
   '{"naam":"A Beheerder","fonds_id":"61111111-1111-1111-1111-111111111111"}', now(), now()),
  ('6bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','t16-a-lid@test.local',
   '{"naam":"A Lid","fonds_id":"61111111-1111-1111-1111-111111111111"}', now(), now()),
  ('6ccccccc-cccc-cccc-cccc-cccccccccccc','authenticated','authenticated','t16-b-beheer@test.local',
   '{"naam":"B Beheerder","fonds_id":"62222222-2222-2222-2222-222222222222"}', now(), now());

update public.profielen set rol = 'beheerder'  where id = '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.profielen set rol = 'bestuurder' where id = '6bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
update public.profielen set rol = 'beheerder'  where id = '6ccccccc-cccc-cccc-cccc-cccccccccccc';

-- Fonds A: twee periodes met oper- en depot-reserve (oper 8 → 9; depot
-- 42,4 → 41) + één periode ZONDER reserve-rijen (2026Q3, voor T16e).
insert into public.fonds_stuurinfo_periode (fonds_id, periode, peildatum, bron, volgorde) values
  ('61111111-1111-1111-1111-111111111111', '2026Q1', date '2026-03-31', 'test', 8105),
  ('61111111-1111-1111-1111-111111111111', '2026Q2', date '2026-06-30', 'test', 8106),
  ('61111111-1111-1111-1111-111111111111', '2026Q3', date '2026-09-30', 'test', 8107);
insert into public.fonds_stuurinfo_reserve
  (fonds_id, periode, reserve_key, label, stand, pct_waarde, volgorde) values
  ('61111111-1111-1111-1111-111111111111', '2026Q1', 'operationele_reserve', 'Operationele reserve',  8.0, 0.3, 3),
  ('61111111-1111-1111-1111-111111111111', '2026Q2', 'operationele_reserve', 'Operationele reserve',  9.0, 0.4, 3),
  ('61111111-1111-1111-1111-111111111111', '2026Q1', 'compensatiedepot',     'Compensatiedepot',     42.4, 1.9, 8),
  ('61111111-1111-1111-1111-111111111111', '2026Q2', 'compensatiedepot',     'Compensatiedepot',     41.0, 1.8, 8);

-- Fonds B: één periode + reserves (mag door niets van A geraakt worden).
insert into public.fonds_stuurinfo_periode (fonds_id, periode, peildatum, bron, volgorde) values
  ('62222222-2222-2222-2222-222222222222', '2026Q2', date '2026-06-30', 'test', 8106);
insert into public.fonds_stuurinfo_reserve
  (fonds_id, periode, reserve_key, label, stand, pct_waarde, volgorde) values
  ('62222222-2222-2222-2222-222222222222', '2026Q2', 'operationele_reserve', 'Operationele reserve',  4.0, 0.4, 3),
  ('62222222-2222-2222-2222-222222222222', '2026Q2', 'compensatiedepot',     'Compensatiedepot',     18.0, 1.8, 8);

-- Sinds T17 telt de operationele save de afgeleide risicoresultaten mee. Voor
-- Q2 zijn alle drie premiebronnen en beide toegekende dekkingen verplicht.
-- Resultaat PP/WZP + AO/PVI = (1,1-0,3) + (0,1+1,0-0,4) = 1,5.
insert into public.fonds_stuurinfo_reeks
  (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde) values
  ('61111111-1111-1111-1111-111111111111', '2026Q2', 'premie_component', 'risico_ppwzp',     'Risicopremie PP/WZP', 1,  1.1),
  ('61111111-1111-1111-1111-111111111111', '2026Q2', 'premie_component', 'risico_aop',       'Risicopremie AOP',    2,  0.1),
  ('61111111-1111-1111-1111-111111111111', '2026Q2', 'premie_component', 'risico_pvi',       'Risicopremie PVI',    3,  1.0),
  ('61111111-1111-1111-1111-111111111111', '2026Q2', 'risicodekking',     'ppwzp_toegekend', 'Toegekende PP/WZP',  1, -0.3),
  ('61111111-1111-1111-1111-111111111111', '2026Q2', 'risicodekking',     'aopvi_toegekend', 'Toegekende AO/PVI',  2, -0.4);

-- ════════════════════════════════════════════════════════════════════════════
-- T16a — RPC-rolgate: bestuurder → weigering (beide RPC's).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claim.sub to '6bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

do $$
declare gelukt boolean;
begin
  gelukt := false;
  begin
    perform public.stuurinfo_operationeel_opslaan(
      '2026Q2', 'handmatig',
      '{"premie_kostenopslag":0,"beschermingsrendement":-0.1,"overrendement":1.3,"gemist_rendement_twk":0.1,"twk_invaar":0.2,"verrekening_reserves":0.2,"overig":-1.4,"kosten":-0.8}'::jsonb,
      8.0, 6.0, 12.0,
      '{"uitvoeringskosten":1.9,"vermogensbeheer":0.9,"bestuur_overig":0.3}'::jsonb,
      '{"uitvoeringskosten":2.1,"vermogensbeheer":1.0,"bestuur_overig":0.2}'::jsonb);
    gelukt := true;
  exception when insufficient_privilege then
    gelukt := false; -- verwacht: RLS-rolgate weigert de reeks-insert
  end;
  if gelukt then
    raise exception 'LEK T16a: BESTUURDER kon via de oper-RPC schrijven (rolgate geschonden).';
  end if;

  gelukt := false;
  begin
    perform public.stuurinfo_premie_opslaan(
      '2026Q2', 'handmatig',
      '{"spaarpremie":15.8,"risico_ppwzp":1.1,"risico_aop":0.1,"risico_pvi":1.0,"opslag_uitvoeringskosten":0.6,"opslag_toekomstige_kosten":0.4}'::jsonb,
      '{"spaarpremie":26.31,"risico_ppwzp":1.84,"risico_aop":0.12,"risico_pvi":1.68,"opslag_uitvoeringskosten":0.97,"opslag_toekomstige_kosten":0.71}'::jsonb,
      '{"premie":0,"beschermingsrendement":-0.1,"overrendement":0.2,"onttrekkingen":-1.6,"verrekening_reserves":0,"overig":0.1}'::jsonb,
      6.5, 60, 40);
    gelukt := true;
  exception when insufficient_privilege then
    gelukt := false;
  end;
  if gelukt then
    raise exception 'LEK T16a: BESTUURDER kon via de premie-RPC schrijven (rolgate geschonden).';
  end if;
  raise notice 'OK T16a: beide RPC''s geweigerd voor niet-privileged bestuurder (RLS-rolgate).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T16b — beheerder A slaagt (operationeel); reserve-rij ongewijzigd; gelogd.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claim.sub to '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

do $$
declare n_mut int; n_kosten int; n_kpi int; n_log int; r record;
begin
  -- Mutaties sluiten exact: 8,0 - 0,5 + 1,5 risicoresultaat = 9,0.
  perform public.stuurinfo_operationeel_opslaan(
    '2026Q2', 'handmatig',
    '{"premie_kostenopslag":0,"beschermingsrendement":-0.1,"overrendement":1.3,"gemist_rendement_twk":0.1,"twk_invaar":0.2,"verrekening_reserves":0.2,"overig":-1.4,"kosten":-0.8}'::jsonb,
    8.0, 6.0, 12.0,
    '{"uitvoeringskosten":1.9,"vermogensbeheer":0.9,"bestuur_overig":0.3}'::jsonb,
    '{"uitvoeringskosten":2.1,"vermogensbeheer":1.0,"bestuur_overig":0.2}'::jsonb);

  select count(*) into n_mut from public.fonds_stuurinfo_reeks
   where fonds_id = '61111111-1111-1111-1111-111111111111' and periode = '2026Q2'
     and reeks_key = 'oper_mutatie';
  select count(*) into n_kosten from public.fonds_stuurinfo_reeks
   where fonds_id = '61111111-1111-1111-1111-111111111111' and periode = '2026Q2'
     and reeks_key in ('oper_kosten_realisatie','oper_kosten_begroot');
  select count(*) into n_kpi from public.fonds_stuurinfo_kpi
   where fonds_id = '61111111-1111-1111-1111-111111111111' and periode = '2026Q2'
     and kpi_key in ('oper_norm','oper_band_onder','oper_band_boven');
  if n_mut <> 8 or n_kosten <> 6 or n_kpi <> 3 then
    raise exception 'REGRESSIE T16b: oper-save incompleet (mutaties=%, kosten=%, kpi=%).',
      n_mut, n_kosten, n_kpi;
  end if;

  -- Eén bron per bedrag: de RPC raakte de reserve-rij NIET.
  select * into r from public.fonds_stuurinfo_reserve
   where fonds_id = '61111111-1111-1111-1111-111111111111' and periode = '2026Q2'
     and reserve_key = 'operationele_reserve';
  if r.stand is distinct from 9.0::numeric or r.ondergrens is not null then
    raise exception 'LEK T16b: de oper-RPC wijzigde de reserve-rij (stand=%, onder=%) — die is van de balans-save.',
      r.stand, r.ondergrens;
  end if;

  -- Elke write gelogd met actor + bron (8 mutaties + 6 kosten + 3 kpi's).
  select count(*) into n_log from public.fonds_stuurinfo_log
   where fonds_id = '61111111-1111-1111-1111-111111111111' and periode = '2026Q2'
     and gebruiker_id = '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and invoer_bron = 'handmatig'
     and (veld_key like 'oper_%');
  if n_log < 17 then
    raise exception 'REGRESSIE T16b: verwacht >= 17 oper-logregels, gevonden %.', n_log;
  end if;
  raise notice 'OK T16b: oper-save compleet; reserve-rij ongemoeid; volledig gelogd.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T16c — beheerder A slaagt (premie); reserve-rij ongewijzigd.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare n_comp int; n_mut int; n_kpi int; r record;
begin
  -- Mutaties sluiten exact: 42,4 − 1,4 = 41,0 = depotstand.
  perform public.stuurinfo_premie_opslaan(
    '2026Q2', 'handmatig',
    '{"spaarpremie":15.8,"risico_ppwzp":1.1,"risico_aop":0.1,"risico_pvi":1.0,"opslag_uitvoeringskosten":0.6,"opslag_toekomstige_kosten":0.4}'::jsonb,
    '{"spaarpremie":26.31,"risico_ppwzp":1.84,"risico_aop":0.12,"risico_pvi":1.68,"opslag_uitvoeringskosten":0.97,"opslag_toekomstige_kosten":0.71}'::jsonb,
    '{"premie":0,"beschermingsrendement":-0.1,"overrendement":0.2,"onttrekkingen":-1.6,"verrekening_reserves":0,"overig":0.1}'::jsonb,
    6.5, 60, 40);

  select count(*) into n_comp from public.fonds_stuurinfo_reeks
   where fonds_id = '61111111-1111-1111-1111-111111111111' and periode = '2026Q2'
     and reeks_key in ('premie_component','premie_component_pct');
  select count(*) into n_mut from public.fonds_stuurinfo_reeks
   where fonds_id = '61111111-1111-1111-1111-111111111111' and periode = '2026Q2'
     and reeks_key = 'comp_mutatie';
  select count(*) into n_kpi from public.fonds_stuurinfo_kpi
   where fonds_id = '61111111-1111-1111-1111-111111111111' and periode = '2026Q2'
     and kpi_key in ('comp_toekenning_jaar','comp_startomvang','comp_ondergrens_pct');
  if n_comp <> 12 or n_mut <> 6 or n_kpi <> 3 then
    raise exception 'REGRESSIE T16c: premie-save incompleet (componenten=%, mutaties=%, kpi=%).',
      n_comp, n_mut, n_kpi;
  end if;

  select * into r from public.fonds_stuurinfo_reserve
   where fonds_id = '61111111-1111-1111-1111-111111111111' and periode = '2026Q2'
     and reserve_key = 'compensatiedepot';
  if r.stand is distinct from 41.0::numeric then
    raise exception 'LEK T16c: de premie-RPC wijzigde de depot-reserve-rij (stand=%).', r.stand;
  end if;
  raise notice 'OK T16c: premie-save compleet; depot-reserve-rij ongemoeid.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T16d — mutatie-mismatch → OPER_/COMP_MUTATIE_ONGELIJK.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare gelukt boolean; melding text;
begin
  gelukt := false;
  begin
    -- 8,0 + 0,5 = 8,5 ≠ 9,0 → hard geweigerd.
    perform public.stuurinfo_operationeel_opslaan(
      '2026Q2', 'handmatig',
      '{"premie_kostenopslag":0,"beschermingsrendement":-0.1,"overrendement":0.8,"gemist_rendement_twk":0.1,"twk_invaar":0.2,"verrekening_reserves":0.2,"overig":0.1,"kosten":-0.8}'::jsonb,
      8.0, 6.0, 12.0,
      '{"uitvoeringskosten":1.9,"vermogensbeheer":0.9,"bestuur_overig":0.3}'::jsonb,
      '{"uitvoeringskosten":2.1,"vermogensbeheer":1.0,"bestuur_overig":0.2}'::jsonb);
    gelukt := true;
  exception when others then
    melding := sqlerrm;
  end;
  if gelukt or melding not like '%OPER_MUTATIE_ONGELIJK%' then
    raise exception 'LEK T16d: oper-RPC accepteerde mutaties die niet op de standen sluiten (melding=%).',
      coalesce(melding, '—');
  end if;

  gelukt := false;
  begin
    -- 42,4 − 1,0 = 41,4 ≠ 41,0 → hard geweigerd.
    perform public.stuurinfo_premie_opslaan(
      '2026Q2', 'handmatig',
      '{"spaarpremie":15.8,"risico_ppwzp":1.1,"risico_aop":0.1,"risico_pvi":1.0,"opslag_uitvoeringskosten":0.6,"opslag_toekomstige_kosten":0.4}'::jsonb,
      '{"spaarpremie":26.31,"risico_ppwzp":1.84,"risico_aop":0.12,"risico_pvi":1.68,"opslag_uitvoeringskosten":0.97,"opslag_toekomstige_kosten":0.71}'::jsonb,
      '{"premie":0,"beschermingsrendement":-0.1,"overrendement":0.2,"onttrekkingen":-1.2,"verrekening_reserves":0,"overig":0.1}'::jsonb,
      6.5, 60, 40);
    gelukt := true;
  exception when others then
    melding := sqlerrm;
  end;
  if gelukt or melding not like '%COMP_MUTATIE_ONGELIJK%' then
    raise exception 'LEK T16d: premie-RPC accepteerde mutaties die niet op de standen sluiten (melding=%).',
      coalesce(melding, '—');
  end if;
  raise notice 'OK T16d: inconsistente mutatiesom → OPER_/COMP_MUTATIE_ONGELIJK (DB-niveau).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T16e — periode zonder reserve-rij → OPER_/COMP_RESERVE_ONTBREEKT.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare gelukt boolean; melding text;
begin
  gelukt := false;
  begin
    perform public.stuurinfo_operationeel_opslaan(
      '2026Q3', 'handmatig',
      '{"premie_kostenopslag":0,"beschermingsrendement":0,"overrendement":1,"gemist_rendement_twk":0,"twk_invaar":0,"verrekening_reserves":0,"overig":0,"kosten":0}'::jsonb,
      8.0, null, null,
      '{"uitvoeringskosten":1,"vermogensbeheer":1,"bestuur_overig":0}'::jsonb,
      '{"uitvoeringskosten":1,"vermogensbeheer":1,"bestuur_overig":0}'::jsonb);
    gelukt := true;
  exception when others then
    melding := sqlerrm;
  end;
  if gelukt or melding not like '%OPER_RESERVE_ONTBREEKT%' then
    raise exception 'LEK T16e: oper-RPC accepteerde een periode zonder reserve-rij (melding=%).',
      coalesce(melding, '—');
  end if;

  gelukt := false;
  begin
    perform public.stuurinfo_premie_opslaan(
      '2026Q3', 'handmatig',
      '{"spaarpremie":1,"risico_ppwzp":0,"risico_aop":0,"risico_pvi":0,"opslag_uitvoeringskosten":0,"opslag_toekomstige_kosten":0}'::jsonb,
      '{"spaarpremie":1,"risico_ppwzp":0,"risico_aop":0,"risico_pvi":0,"opslag_uitvoeringskosten":0,"opslag_toekomstige_kosten":0}'::jsonb,
      '{"premie":0,"beschermingsrendement":0,"overrendement":0,"onttrekkingen":0,"verrekening_reserves":0,"overig":0}'::jsonb,
      0, null, null);
    gelukt := true;
  exception when others then
    melding := sqlerrm;
  end;
  if gelukt or melding not like '%COMP_RESERVE_ONTBREEKT%' then
    raise exception 'LEK T16e: premie-RPC accepteerde een periode zonder depot-rij (melding=%).',
      coalesce(melding, '—');
  end if;
  raise notice 'OK T16e: periode zonder balans-stand → OPER_/COMP_RESERVE_ONTBREEKT ("eerst balans opslaan").';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T16f — structureel: geen fonds-parameter; anon geen EXECUTE; allowlists.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare args text; gelukt boolean; melding text;
begin
  for args in
    select pg_get_function_arguments(oid)
      from pg_proc
     where proname in ('stuurinfo_operationeel_opslaan','stuurinfo_premie_opslaan')
  loop
    if args ilike '%fonds%' then
      raise exception 'LEK T16f: RPC heeft een fonds-parameter (%) — fonds_id moet uit auth.uid() komen.', args;
    end if;
  end loop;
  if (select count(*) from pg_proc
       where proname in ('stuurinfo_operationeel_opslaan','stuurinfo_premie_opslaan')) <> 2 then
    raise exception 'REGRESSIE T16f: niet beide T16-RPC''s bestaan.';
  end if;

  -- Grant-hygiëne als RUNTIME-assertie (T14b-les: drop+recreate reset de ACL).
  if has_function_privilege('anon',
       'public.stuurinfo_operationeel_opslaan(text,text,jsonb,numeric,numeric,numeric,jsonb,jsonb)',
       'execute') then
    raise exception 'LEK T16f: anon heeft EXECUTE op stuurinfo_operationeel_opslaan.';
  end if;
  if has_function_privilege('anon',
       'public.stuurinfo_premie_opslaan(text,text,jsonb,jsonb,jsonb,numeric,numeric,numeric)',
       'execute') then
    raise exception 'LEK T16f: anon heeft EXECUTE op stuurinfo_premie_opslaan.';
  end if;

  -- Afgeleide/onbekende mutatie-key → ONGELDIGE_MUTATIES.
  gelukt := false;
  begin
    perform public.stuurinfo_operationeel_opslaan(
      '2026Q2', 'handmatig',
      '{"premie_kostenopslag":0,"beschermingsrendement":-0.1,"overrendement":1.3,"gemist_rendement_twk":0.1,"twk_invaar":0.2,"verrekening_reserves":0.2,"overig":0.1,"ultimo":9}'::jsonb,
      8.0, 6.0, 12.0,
      '{"uitvoeringskosten":1.9,"vermogensbeheer":0.9,"bestuur_overig":0.3}'::jsonb,
      '{"uitvoeringskosten":2.1,"vermogensbeheer":1.0,"bestuur_overig":0.2}'::jsonb);
    gelukt := true;
  exception when others then
    melding := sqlerrm;
  end;
  if gelukt or melding not like '%ONGELDIGE_MUTATIES%' then
    raise exception 'LEK T16f: oper-RPC accepteerde een afgeleide mutatie-key (melding=%).',
      coalesce(melding, '—');
  end if;

  -- JSON-null in de mutaties → ONGELDIGE_WAARDE (sum() negeert null stil).
  gelukt := false;
  begin
    perform public.stuurinfo_operationeel_opslaan(
      '2026Q2', 'handmatig',
      '{"premie_kostenopslag":null,"beschermingsrendement":-0.1,"overrendement":1.4,"gemist_rendement_twk":0.1,"twk_invaar":0.2,"verrekening_reserves":0.2,"overig":0.1,"kosten":-0.9}'::jsonb,
      8.0, 6.0, 12.0,
      '{"uitvoeringskosten":1.9,"vermogensbeheer":0.9,"bestuur_overig":0.3}'::jsonb,
      '{"uitvoeringskosten":2.1,"vermogensbeheer":1.0,"bestuur_overig":0.2}'::jsonb);
    gelukt := true;
  exception when others then
    melding := sqlerrm;
  end;
  if gelukt or melding not like '%ONGELDIGE_WAARDE%' then
    raise exception 'LEK T16f: oper-RPC accepteerde een JSON-null-mutatiewaarde (melding=%).',
      coalesce(melding, '—');
  end if;

  -- Onvolledige componentenset → ONGELDIGE_COMPONENTEN.
  gelukt := false;
  begin
    perform public.stuurinfo_premie_opslaan(
      '2026Q2', 'handmatig',
      '{"spaarpremie":15.8,"risico_ppwzp":1.1,"risico_aop":0.1,"risico_pvi":1.0,"opslag_uitvoeringskosten":0.6}'::jsonb,
      '{"spaarpremie":26.31,"risico_ppwzp":1.84,"risico_aop":0.12,"risico_pvi":1.68,"opslag_uitvoeringskosten":0.97,"opslag_toekomstige_kosten":0.71}'::jsonb,
      '{"premie":0,"beschermingsrendement":-0.1,"overrendement":0.2,"onttrekkingen":-1.6,"verrekening_reserves":0,"overig":0.1}'::jsonb,
      6.5, 60, 40);
    gelukt := true;
  exception when others then
    melding := sqlerrm;
  end;
  if gelukt or melding not like '%ONGELDIGE_COMPONENTEN%' then
    raise exception 'LEK T16f: premie-RPC accepteerde een onvolledige componentenset (melding=%).',
      coalesce(melding, '—');
  end if;
  raise notice 'OK T16f: geen fonds-parameter; grants en allowlists hard op DB-niveau.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T16g — tenant-isolatie + deny-delete.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare geraakt int;
begin
  -- Beheerder A kan de nieuwe T16-rijen niet DELETEN (geen policy).
  delete from public.fonds_stuurinfo_reeks
   where fonds_id = '61111111-1111-1111-1111-111111111111'
     and reeks_key in ('oper_mutatie','premie_component','comp_mutatie');
  get diagnostics geraakt = row_count;
  if geraakt <> 0 then
    raise exception 'LEK T16g: authenticated kon % T16-rij(en) DELETEN (deny-by-default kapot).', geraakt;
  end if;
  raise notice 'OK T16g-1: geen delete op T16-reeksrijen (deny-by-default).';
end $$;

reset role;

do $$
declare n int; r record;
begin
  -- Als eigenaar (ziet alles): fonds B is door niets van A geraakt.
  select count(*) into n from public.fonds_stuurinfo_reeks
   where fonds_id = '62222222-2222-2222-2222-222222222222';
  if n <> 0 then
    raise exception 'LEK T16g: fonds B kreeg % reeks-rij(en) — de RPC-runs van A raakten fonds B.', n;
  end if;
  select count(*) into n from public.fonds_stuurinfo_kpi
   where fonds_id = '62222222-2222-2222-2222-222222222222';
  if n <> 0 then
    raise exception 'LEK T16g: fonds B kreeg % kpi-rij(en).', n;
  end if;
  select * into r from public.fonds_stuurinfo_reserve
   where fonds_id = '62222222-2222-2222-2222-222222222222' and reserve_key = 'compensatiedepot';
  if r.stand is distinct from 18.0::numeric then
    raise exception 'LEK T16g: de depot-rij van fonds B is gewijzigd (stand=%).', r.stand;
  end if;
  raise notice 'OK T16g-2: fonds B volledig ongemoeid (tenant-isolatie).';
end $$;

rollback;

-- ============================================================================
-- Alles geslaagd als psql exit 0 gaf en je de "OK …"-notices zag (T16a–T16g).
-- Elke "LEK:"/"REGRESSIE" doet raise exception → non-zero exit → CI faalt.
-- Vereist dat 2026_07_18_t16_stuurinfo_oper_premie.sql is toegepast.
-- ============================================================================
