-- ============================================================================
-- T15 — Cross-tenant + consistentie-testsuite voor tabs 4/5 (spreiding/soli).
-- ----------------------------------------------------------------------------
-- Doel: onder ÉCHTE RLS bewijzen dat (1) de RPC stuurinfo_soli_opslaan de
-- RLS-rolgate respecteert (bestuurder → weigering), structureel geen
-- fonds-parameter heeft en fonds B nooit raakt, (2) de harde consistentie-
-- checks werken (SOLI_RESERVE_ONTBREEKT, SOLI_EINDSTAND_ONGELIJK,
-- ONGELDIGE_VULLING/WAARDE), (3) de grenzen-update alleen de band raakt
-- (stand blijft van de balans — één bron per bedrag) en gelogd wordt, en
-- (4) de nieuwe reeks-/kpi-rijen deny-by-default blijven (geen delete).
-- Elke overtreding → raise exception → psql exit-code <> 0 → CI faalt.
--
-- Scenario's (werkopdracht T15, decisions/0076):
--   T15a — RPC-rolgate: bestuurder → RLS-weigering (insufficient_privilege).
--   T15b — beheerder A slaagt: 4 vullingsbronnen + uitdeling-kpi + grenzen-
--          update, alles gelogd met actor; stand/pct van de reserve ONGEWIJZIGD.
--   T15c — eindstand-mismatch → SOLI_EINDSTAND_ONGELIJK (vulling sluit niet
--          op de balans-stand).
--   T15d — periode zonder soli-reserve-rij → SOLI_RESERVE_ONTBREEKT
--          ("sla eerst de balans op").
--   T15e — structureel: geen fonds-parameter; verkeerde vulling-keys →
--          ONGELDIGE_VULLING; JSON-null → ONGELDIGE_WAARDE.
--   T15f — tenant-isolatie: de saves van A raakten fonds B niet; authenticated
--          kan soli_vulling-rijen niet DELETEN (deny-by-default).
--
-- Self-seeding (T14-patroon; 2 fondsen + 3 users via auth-trigger maak_profiel).
-- Alles in één transactie met ROLLBACK — laat niets achter.
--
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed als tabel-eigenaar (RLS omzeild). Vaste UUID's voor de test. ────────
insert into public.fondsen (id, naam, slug) values
  ('51111111-1111-1111-1111-111111111111', 'T15 Fonds A', 't15-fonds-a'),
  ('52222222-2222-2222-2222-222222222222', 'T15 Fonds B', 't15-fonds-b');

insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('5aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','t15-a-beheer@test.local',
   '{"naam":"A Beheerder","fonds_id":"51111111-1111-1111-1111-111111111111"}', now(), now()),
  ('5bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','t15-a-lid@test.local',
   '{"naam":"A Lid","fonds_id":"51111111-1111-1111-1111-111111111111"}', now(), now()),
  ('5ccccccc-cccc-cccc-cccc-cccccccccccc','authenticated','authenticated','t15-b-beheer@test.local',
   '{"naam":"B Beheerder","fonds_id":"52222222-2222-2222-2222-222222222222"}', now(), now());

update public.profielen set rol = 'beheerder'  where id = '5aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.profielen set rol = 'bestuurder' where id = '5bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
update public.profielen set rol = 'beheerder'  where id = '5ccccccc-cccc-cccc-cccc-cccccccccccc';

-- Fonds A: twee periodes met soli-reserve (Q1 stand 68 → Q2 stand 78, band
-- 1,5–5,0) + één periode ZONDER soli-rij (2026Q3, voor T15d).
insert into public.fonds_stuurinfo_periode (fonds_id, periode, peildatum, bron, volgorde) values
  ('51111111-1111-1111-1111-111111111111', '2026Q1', date '2026-03-31', 'test', 8105),
  ('51111111-1111-1111-1111-111111111111', '2026Q2', date '2026-06-30', 'test', 8106),
  ('51111111-1111-1111-1111-111111111111', '2026Q3', date '2026-09-30', 'test', 8107);
insert into public.fonds_stuurinfo_reserve
  (fonds_id, periode, reserve_key, label, stand, pct_waarde, ondergrens, bovengrens, volgorde) values
  ('51111111-1111-1111-1111-111111111111', '2026Q1', 'solidariteitsreserve', 'Solidariteitsreserve', 68, 3.0, 1.5, 5.0, 1),
  ('51111111-1111-1111-1111-111111111111', '2026Q2', 'solidariteitsreserve', 'Solidariteitsreserve', 78, 3.3, 1.5, 5.0, 1);

-- Netto langleven is sinds T17 één afgeleide bron uit tab 3. Seed Q2 voor de
-- happy paths en Q3 zodat de ontbrekende reserve (niet de bronvalidatie) wordt
-- getest. Netto Q2 = -0,6; Q3 = 0.
insert into public.fonds_stuurinfo_reeks
  (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde) values
  ('51111111-1111-1111-1111-111111111111', '2026Q2', 'langleven', 'micro',   'Micro-langleven', 1, -0.8),
  ('51111111-1111-1111-1111-111111111111', '2026Q2', 'langleven', 'macro',   'Macro-langleven', 2, -1.2),
  ('51111111-1111-1111-1111-111111111111', '2026Q2', 'langleven', 'vrijval', 'Vrijval',         3,  1.4),
  ('51111111-1111-1111-1111-111111111111', '2026Q3', 'langleven', 'micro',   'Micro-langleven', 1,  0.0),
  ('51111111-1111-1111-1111-111111111111', '2026Q3', 'langleven', 'macro',   'Macro-langleven', 2,  0.0),
  ('51111111-1111-1111-1111-111111111111', '2026Q3', 'langleven', 'vrijval', 'Vrijval',         3,  0.0);

-- Fonds B: één periode + soli-rij (mag door niets van A geraakt worden).
insert into public.fonds_stuurinfo_periode (fonds_id, periode, peildatum, bron, volgorde) values
  ('52222222-2222-2222-2222-222222222222', '2026Q2', date '2026-06-30', 'test', 8106);
insert into public.fonds_stuurinfo_reserve
  (fonds_id, periode, reserve_key, label, stand, pct_waarde, ondergrens, bovengrens, volgorde) values
  ('52222222-2222-2222-2222-222222222222', '2026Q2', 'solidariteitsreserve', 'Solidariteitsreserve', 34, 3.4, 1.5, 5.0, 1);

-- ════════════════════════════════════════════════════════════════════════════
-- T15a — RPC-rolgate: bestuurder → weigering.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"5bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}';

do $$
declare gelukt boolean := false;
begin
  begin
    perform public.stuurinfo_soli_opslaan(
      '2026Q2', 'handmatig',
      '{"premie":1.1,"rendement":4.6,"overrendementsbijdrage":4.9}'::jsonb,
      0, 1.5, 5.0);
    gelukt := true;
  exception when insufficient_privilege then
    gelukt := false; -- verwacht: RLS-rolgate weigert de reeks-insert
  end;
  if gelukt then
    raise exception 'LEK T15a: BESTUURDER kon via de RPC soli-data schrijven (rolgate geschonden).';
  end if;
  raise notice 'OK T15a: RPC geweigerd voor niet-privileged bestuurder (RLS-rolgate).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T15b — beheerder A slaagt; grenzen-update raakt alleen de band; alles gelogd.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"5aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

do $$
declare n_reeks int; n_kpi int; n_log int; r record;
begin
  -- Vulling sluit exact: 68 + (1,1+4,6−0,6+4,9) − 0 = 78 = balans-stand.
  -- Grenzen bewust gewijzigd (1,5→2,0 / 5,0→6,0) om de update te bewijzen.
  perform public.stuurinfo_soli_opslaan(
    '2026Q2', 'handmatig',
    '{"premie":1.1,"rendement":4.6,"overrendementsbijdrage":4.9}'::jsonb,
    0, 2.0, 6.0);

  select count(*) into n_reeks from public.fonds_stuurinfo_reeks
   where fonds_id = '51111111-1111-1111-1111-111111111111' and periode = '2026Q2'
     and reeks_key = 'soli_vulling';
  select count(*) into n_kpi from public.fonds_stuurinfo_kpi
   where fonds_id = '51111111-1111-1111-1111-111111111111' and periode = '2026Q2'
     and kpi_key = 'soli_uitdeling';
  if n_reeks <> 3 or n_kpi <> 1 then
    raise exception 'REGRESSIE T15b: RPC-save incompleet (vulling=%, uitdeling-kpi=%).', n_reeks, n_kpi;
  end if;

  -- Eén bron per bedrag: de reserve-UPDATE raakte ALLEEN de grenzen.
  select * into r from public.fonds_stuurinfo_reserve
   where fonds_id = '51111111-1111-1111-1111-111111111111' and periode = '2026Q2'
     and reserve_key = 'solidariteitsreserve';
  if r.ondergrens is distinct from 2.0 or r.bovengrens is distinct from 6.0 then
    raise exception 'REGRESSIE T15b: grenzen niet bijgewerkt (onder=%, boven=%).', r.ondergrens, r.bovengrens;
  end if;
  if r.stand is distinct from 78::numeric or r.pct_waarde is distinct from 3.3 then
    raise exception 'LEK T15b: de soli-RPC wijzigde stand/pct (%/%) — die zijn van de balans-save.',
      r.stand, r.pct_waarde;
  end if;

  -- Elke write gelogd met actor + bron (3 reeks + 1 kpi + 1 reserve-update).
  select count(*) into n_log from public.fonds_stuurinfo_log
   where fonds_id = '51111111-1111-1111-1111-111111111111' and periode = '2026Q2'
     and gebruiker_id = '5aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and invoer_bron = 'handmatig';
  if n_log < 5 then
    raise exception 'REGRESSIE T15b: verwacht >= 5 logregels (3 vulling + uitdeling + grenzen), gevonden %.', n_log;
  end if;
  raise notice 'OK T15b: soli-save compleet; grenzen-update raakt alleen de band; volledig gelogd.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T15c — eindstand-mismatch → SOLI_EINDSTAND_ONGELIJK.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare gelukt boolean := false; melding text;
begin
  begin
    -- 68 + (1,1+4,6−0,6+3,9) − 0 = 77 ≠ 78 → hard geweigerd.
    perform public.stuurinfo_soli_opslaan(
      '2026Q2', 'handmatig',
      '{"premie":1.1,"rendement":4.6,"overrendementsbijdrage":3.9}'::jsonb,
      0, 2.0, 6.0);
    gelukt := true;
  exception when others then
    gelukt := false;
    melding := sqlerrm;
  end;
  if gelukt or melding not like '%SOLI_EINDSTAND_ONGELIJK%' then
    raise exception 'LEK T15c: RPC accepteerde een vulling die niet op de balans-stand sluit (melding=%).',
      coalesce(melding, '—');
  end if;
  raise notice 'OK T15c: inconsistente eindstand → SOLI_EINDSTAND_ONGELIJK (DB-niveau).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T15d — periode zonder soli-reserve-rij → SOLI_RESERVE_ONTBREEKT.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare gelukt boolean := false; melding text;
begin
  begin
    perform public.stuurinfo_soli_opslaan(
      '2026Q3', 'handmatig',
      '{"premie":1,"rendement":1,"overrendementsbijdrage":1}'::jsonb,
      0, 1.5, 5.0);
    gelukt := true;
  exception when others then
    gelukt := false;
    melding := sqlerrm;
  end;
  if gelukt or melding not like '%SOLI_RESERVE_ONTBREEKT%' then
    raise exception 'LEK T15d: RPC accepteerde een periode zonder soli-reserve-rij (melding=%).',
      coalesce(melding, '—');
  end if;
  raise notice 'OK T15d: periode zonder balans-stand → SOLI_RESERVE_ONTBREEKT ("eerst balans opslaan").';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T15e — structureel: geen fonds-parameter; allowlist + typechecks.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare args text; gelukt boolean; melding text;
begin
  select pg_get_function_arguments(oid) into args
    from pg_proc where proname = 'stuurinfo_soli_opslaan';
  if args is null then
    raise exception 'REGRESSIE T15e: RPC stuurinfo_soli_opslaan bestaat niet.';
  end if;
  if args ilike '%fonds%' then
    raise exception 'LEK T15e: RPC heeft een fonds-parameter (%) — fonds_id moet uit auth.uid() komen.', args;
  end if;

  -- Grant-hygiëne als RUNTIME-assertie (RLS-review T15): een drop+recreate
  -- reset de ACL naar default (PUBLIC erft EXECUTE — de T14b-les). Toets de
  -- werkelijke DB-staat, niet alleen de migratietekst.
  if has_function_privilege('anon',
       'public.stuurinfo_soli_opslaan(text,text,jsonb,numeric,numeric,numeric)', 'execute') then
    raise exception 'LEK T15e: anon heeft EXECUTE op stuurinfo_soli_opslaan (revoke ontbreekt/gereset).';
  end if;
  if has_function_privilege('anon',
       'public.stuurinfo_balans_opslaan(text,date,text,text,jsonb,jsonb,jsonb,numeric)', 'execute') then
    raise exception 'LEK T15e: anon heeft EXECUTE op stuurinfo_balans_opslaan (T14b-revoke gereset).';
  end if;

  -- Verkeerde vulling-keys → ONGELDIGE_VULLING.
  gelukt := false;
  begin
    perform public.stuurinfo_soli_opslaan(
      '2026Q2', 'handmatig',
      '{"premie":1.1,"rendement":4.6,"eindstand":4.9}'::jsonb,
      0, 2.0, 6.0);
    gelukt := true;
  exception when others then
    melding := sqlerrm;
  end;
  if gelukt or melding not like '%ONGELDIGE_VULLING%' then
    raise exception 'LEK T15e: RPC accepteerde een afgeleide/onbekende vulling-key (melding=%).',
      coalesce(melding, '—');
  end if;

  -- JSON-null → ONGELDIGE_WAARDE (T14b-les: sum() negeert null stil).
  gelukt := false;
  begin
    perform public.stuurinfo_soli_opslaan(
      '2026Q2', 'handmatig',
      '{"premie":null,"rendement":10.0,"overrendementsbijdrage":0.6}'::jsonb,
      0, 2.0, 6.0);
    gelukt := true;
  exception when others then
    melding := sqlerrm;
  end;
  if gelukt or melding not like '%ONGELDIGE_WAARDE%' then
    raise exception 'LEK T15e: RPC accepteerde een JSON-null-vullingswaarde (melding=%).',
      coalesce(melding, '—');
  end if;
  raise notice 'OK T15e: geen fonds-parameter; allowlist en typechecks hard op DB-niveau.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T15f — tenant-isolatie + deny-delete.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare geraakt int;
begin
  -- Beheerder A kan de nieuwe soli_vulling-rijen niet DELETEN (geen policy).
  delete from public.fonds_stuurinfo_reeks
   where fonds_id = '51111111-1111-1111-1111-111111111111' and reeks_key = 'soli_vulling';
  get diagnostics geraakt = row_count;
  if geraakt <> 0 then
    raise exception 'LEK T15f: authenticated kon % soli_vulling-rij(en) DELETEN (deny-by-default kapot).', geraakt;
  end if;
  raise notice 'OK T15f-1: geen delete op soli_vulling-rijen (deny-by-default).';
end $$;

reset role;

do $$
declare n int; r record;
begin
  -- Als eigenaar (ziet alles): fonds B is door niets van A geraakt.
  select count(*) into n from public.fonds_stuurinfo_reeks
   where fonds_id = '52222222-2222-2222-2222-222222222222';
  if n <> 0 then
    raise exception 'LEK T15f: fonds B kreeg % reeks-rij(en) — de RPC-run van A raakte fonds B.', n;
  end if;
  select * into r from public.fonds_stuurinfo_reserve
   where fonds_id = '52222222-2222-2222-2222-222222222222' and reserve_key = 'solidariteitsreserve';
  if r.ondergrens is distinct from 1.5 or r.bovengrens is distinct from 5.0
     or r.stand is distinct from 34::numeric then
    raise exception 'LEK T15f: de soli-rij van fonds B is gewijzigd (onder=%, boven=%, stand=%).',
      r.ondergrens, r.bovengrens, r.stand;
  end if;
  raise notice 'OK T15f-2: fonds B volledig ongemoeid (tenant-isolatie).';
end $$;

rollback;

-- ============================================================================
-- Alles geslaagd als psql exit 0 gaf en je de "OK …"-notices zag (T15a–T15f).
-- Elke "LEK:"/"REGRESSIE" doet raise exception → non-zero exit → CI faalt.
-- Vereist dat 2026_07_17_t15_stuurinfo_spreiding_soli.sql is toegepast.
-- ============================================================================
