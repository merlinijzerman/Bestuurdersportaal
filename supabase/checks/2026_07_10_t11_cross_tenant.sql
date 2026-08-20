-- ============================================================================
-- T11 — Cross-tenant + rolgate testsuite voor de stuurinformatie-/klantbeeld-data.
-- ----------------------------------------------------------------------------
-- Doel: onder ÉCHTE RLS bewijzen dat de drie T11-datatabellen (fonds_stuurinfo_kpi,
-- fonds_stuurinfo_reeks, fonds_klantbeeld_cohort) tenant-geïsoleerd zijn, dat de
-- schrijf-ROLGATE hard is (alleen voorzitter/beheerder van het eigen fonds) en dat
-- er GEEN cross-tenant write of DELETE-lek is (geen delete-policy = deny-by-default).
-- Elke overtreding → raise exception → psql exit-code <> 0 → CI faalt.
--
-- Getoetste scenario's (werkopdracht T11, acceptatiecriteria 1/4/5):
--   T11a — SELECT-isolatie: fonds A ziet GEEN stuurinfo/klantbeeld-rij van fonds B.
--   T11b — Rolgate NEGATIEF: een bestuurder van A mag GEEN KPI schrijven.
--   T11c — Rolgate POSITIEF: een beheerder van A mag WEL een KPI schrijven.
--   T11d — Cross-tenant WRITE: beheerder van A mag GEEN rij voor fonds B schrijven.
--   T11e — DELETE deny-by-default: geen delete-policy → delete raakt 0 rijen.
--
-- Self-seeding (2 fondsen + 3 users via auth-trigger maak_profiel; rol daarna als
-- tabel-eigenaar gezet). Alles in één transactie met ROLLBACK — laat niets achter.
--
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed als tabel-eigenaar (RLS omzeild). Vaste UUID's voor de test. ────────
insert into public.fondsen (id, naam, slug) values
  ('11111111-1111-1111-1111-111111111111', 'T11 Fonds A', 't11-fonds-a'),
  ('22222222-2222-2222-2222-222222222222', 'T11 Fonds B', 't11-fonds-b');

insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','t11-a-beheer@test.local',
   '{"naam":"A Beheerder","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','t11-a-lid@test.local',
   '{"naam":"A Lid","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','authenticated','authenticated','t11-b-beheer@test.local',
   '{"naam":"B Beheerder","fonds_id":"22222222-2222-2222-2222-222222222222"}', now(), now());

update public.profielen set rol = 'beheerder'  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.profielen set rol = 'bestuurder' where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
update public.profielen set rol = 'beheerder'  where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

-- Periode-registry (T13): kpi/reeks dragen sinds 2026_07_16_t13 een verplichte
-- periode-kolom + FK naar fonds_stuurinfo_periode. Seed één periode per fonds.
insert into public.fonds_stuurinfo_periode (fonds_id, periode, peildatum, bron, volgorde) values
  ('11111111-1111-1111-1111-111111111111', '2026Q1', date '2026-03-31', 'test', 1),
  ('22222222-2222-2222-2222-222222222222', '2026Q1', date '2026-03-31', 'test', 1);

-- Data-rijen voor fonds B (eigenaar-insert; RLS omzeild bij seed).
insert into public.fonds_stuurinfo_kpi (fonds_id, periode, kpi_key, label, waarde, eenheid)
  values ('22222222-2222-2222-2222-222222222222', '2026Q1', 'financieringsgraad', 'FG', 111.0, 'pct');
insert into public.fonds_stuurinfo_reeks (fonds_id, periode, reeks_key, punt_key, waarde)
  values ('22222222-2222-2222-2222-222222222222', '2026Q1', 'trend_fg', '00', 111.0);
insert into public.fonds_klantbeeld_cohort (fonds_id, leeftijd, aantal)
  values ('22222222-2222-2222-2222-222222222222', 45, 1234);

-- ════════════════════════════════════════════════════════════════════════════
-- T11a — SELECT-isolatie: fonds A ziet GÉÉN stuurinfo/klantbeeld-rij van fonds B.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claim.sub to 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

do $$
declare n int;
begin
  select
    (select count(*) from public.fonds_stuurinfo_kpi     where fonds_id='22222222-2222-2222-2222-222222222222')
  + (select count(*) from public.fonds_stuurinfo_reeks   where fonds_id='22222222-2222-2222-2222-222222222222')
  + (select count(*) from public.fonds_klantbeeld_cohort where fonds_id='22222222-2222-2222-2222-222222222222')
  into n;
  if n <> 0 then
    raise exception 'LEK T11a: fonds A ziet % rij(en) stuurinfo/klantbeeld van fonds B (cross-tenant leesisolatie kapot).', n;
  end if;
  raise notice 'OK T11a: fonds A ziet geen enkele stuurinfo/klantbeeld-rij van fonds B (3 tabellen).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T11b — Rolgate NEGATIEF: een bestuurder (niet-privileged) mag geen KPI schrijven.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claim.sub to 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

do $$
declare gelukt boolean := false;
begin
  begin
    insert into public.fonds_stuurinfo_kpi (fonds_id, periode, kpi_key, label, waarde, eenheid)
    values ('11111111-1111-1111-1111-111111111111', '2026Q1', 'poging', 'X', 1, 'pct');
    gelukt := true;
  exception when insufficient_privilege then
    gelukt := false; -- verwacht: RLS WITH CHECK (rol) weigert
  end;
  if gelukt then
    raise exception 'LEK T11b: bestuurder kon een KPI SCHRIJVEN (rolgate geschonden).';
  end if;
  raise notice 'OK T11b: KPI-INSERT geweigerd voor niet-privileged bestuurder.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T11c — Rolgate POSITIEF: een beheerder van fonds A mag WEL een KPI schrijven.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claim.sub to 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

do $$
declare n int;
begin
  insert into public.fonds_stuurinfo_kpi (fonds_id, periode, kpi_key, label, waarde, eenheid)
  values ('11111111-1111-1111-1111-111111111111', '2026Q1', 'financieringsgraad', 'FG', 102.4, 'pct');
  select count(*) into n from public.fonds_stuurinfo_kpi
   where fonds_id='11111111-1111-1111-1111-111111111111';
  if n <> 1 then
    raise exception 'REGRESSIE T11c: beheerder kon eigen KPI niet schrijven (n=%).', n;
  end if;
  raise notice 'OK T11c: beheerder schrijft eigen KPI (rolgate laat privileged door).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T11d — Cross-tenant WRITE: beheerder van A mag GEEN rij voor fonds B schrijven.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare gelukt boolean := false;
begin
  begin
    insert into public.fonds_klantbeeld_cohort (fonds_id, leeftijd, aantal)
    values ('22222222-2222-2222-2222-222222222222', 30, 99);
    gelukt := true;
  exception when insufficient_privilege then
    gelukt := false; -- verwacht: WITH CHECK op fonds_id weigert vreemd fonds
  end;
  if gelukt then
    raise exception 'LEK T11d: beheerder van A kon een cohort-rij voor fonds B SCHRIJVEN (cross-tenant write).';
  end if;
  raise notice 'OK T11d: cross-tenant write (A→B) geweigerd.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T11e — DELETE deny-by-default: er is GEEN delete-policy, dus een DELETE raakt
--        0 rijen (de rijen zijn niet zichtbaar voor DELETE onder RLS).
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare geraakt int;
begin
  delete from public.fonds_stuurinfo_kpi
   where fonds_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics geraakt = row_count;
  if geraakt <> 0 then
    raise exception 'LEK T11e: DELETE raakte % rij(en) — er is een delete-lek (deny-by-default geschonden).', geraakt;
  end if;
  raise notice 'OK T11e: DELETE raakt 0 rijen (geen delete-policy = deny-by-default).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T11f — UPDATE-rolgate NEGATIEF: een bestuurder van A mag GEEN KPI bijwerken.
--        De UPDATE-USING-clause eist een privileged rol → de rij is onzichtbaar
--        voor UPDATE → 0 rijen geraakt (geen mutatie).
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claim.sub to 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

do $$
declare geraakt int;
begin
  update public.fonds_stuurinfo_kpi set waarde = 999
   where fonds_id = '11111111-1111-1111-1111-111111111111' and kpi_key = 'financieringsgraad';
  get diagnostics geraakt = row_count;
  if geraakt <> 0 then
    raise exception 'LEK T11f: bestuurder kon % KPI-rij(en) UPDATEN (UPDATE-rolgate geschonden).', geraakt;
  end if;
  raise notice 'OK T11f: KPI-UPDATE raakt 0 rijen voor niet-privileged bestuurder (rolgate).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T11g — Cross-tenant UPDATE-move NEGATIEF: beheerder van A mag een eigen rij
--        niet naar fonds B "verplaatsen" (WITH CHECK op fonds_id weigert).
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claim.sub to 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

do $$
declare gelukt boolean := false;
begin
  begin
    update public.fonds_stuurinfo_kpi
       set fonds_id = '22222222-2222-2222-2222-222222222222'
     where fonds_id = '11111111-1111-1111-1111-111111111111' and kpi_key = 'financieringsgraad';
    gelukt := true;
  exception when insufficient_privilege then
    gelukt := false; -- verwacht: WITH CHECK op de nieuwe fonds_id weigert
  end;
  if gelukt then
    raise exception 'LEK T11g: beheerder van A kon een eigen KPI-rij naar fonds B verplaatsen (cross-tenant UPDATE-move).';
  end if;
  raise notice 'OK T11g: cross-tenant UPDATE-move (A→B) geweigerd (WITH CHECK).';
end $$;

reset role;

rollback;

-- ============================================================================
-- Alles geslaagd als psql exit 0 gaf en je de "OK …"-notices zag (T11a–T11e).
-- Elke "LEK:"/"REGRESSIE" doet raise exception → non-zero exit → CI faalt.
-- ============================================================================
