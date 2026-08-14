-- ============================================================================
-- T13 — Cross-tenant + rolgate testsuite voor het periodemodel + de reserves.
-- ----------------------------------------------------------------------------
-- Doel: onder ÉCHTE RLS bewijzen dat de twee T13-tabellen (fonds_stuurinfo_periode,
-- fonds_stuurinfo_reserve) tenant-geïsoleerd zijn, dat de schrijf-ROLGATE hard is
-- (alleen voorzitter/beheerder van het eigen fonds) en dat er GEEN cross-tenant
-- write of DELETE-lek is (geen delete-policy = deny-by-default). Elke overtreding
-- → raise exception → psql exit-code <> 0 → CI faalt.
--
-- Getoetste scenario's (werkopdracht T13, acceptatiecriterium cross-tenant):
--   T13a — SELECT-isolatie: fonds A ziet GEEN periode/reserve van fonds B.
--   T13b — Rolgate NEGATIEF: een bestuurder van A mag GEEN periode/reserve schrijven.
--   T13c — Rolgate POSITIEF: een beheerder van A mag WEL periode + reserve schrijven.
--   T13d — Cross-tenant WRITE: beheerder van A mag GEEN rij voor fonds B schrijven
--          (reserve én registry).
--   T13e — DELETE deny-by-default: geen delete-policy → delete raakt 0 rijen.
--   T13f — Cross-tenant UPDATE-move: beheerder van A kan reserve/registry niet naar B verplaatsen.
--   T13g — UPDATE-rolgate: een bestuurder (niet-privileged) werkt 0 rijen bij.
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
  ('31111111-1111-1111-1111-111111111111', 'T13 Fonds A', 't13-fonds-a'),
  ('32222222-2222-2222-2222-222222222222', 'T13 Fonds B', 't13-fonds-b');

insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','t13-a-beheer@test.local',
   '{"naam":"A Beheerder","fonds_id":"31111111-1111-1111-1111-111111111111"}', now(), now()),
  ('3bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','t13-a-lid@test.local',
   '{"naam":"A Lid","fonds_id":"31111111-1111-1111-1111-111111111111"}', now(), now()),
  ('3ccccccc-cccc-cccc-cccc-cccccccccccc','authenticated','authenticated','t13-b-beheer@test.local',
   '{"naam":"B Beheerder","fonds_id":"32222222-2222-2222-2222-222222222222"}', now(), now());

update public.profielen set rol = 'beheerder'  where id = '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.profielen set rol = 'bestuurder' where id = '3bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
update public.profielen set rol = 'beheerder'  where id = '3ccccccc-cccc-cccc-cccc-cccccccccccc';

-- Data-rijen voor fonds B (eigenaar-insert; RLS omzeild bij seed).
insert into public.fonds_stuurinfo_periode (fonds_id, periode, peildatum, bron, volgorde)
  values ('32222222-2222-2222-2222-222222222222', '2026Q2', date '2026-06-30', 'test', 2);
insert into public.fonds_stuurinfo_reserve (fonds_id, periode, reserve_key, label, stand, pct_waarde, ondergrens, bovengrens, volgorde)
  values ('32222222-2222-2222-2222-222222222222', '2026Q2', 'solidariteitsreserve', 'Solidariteitsreserve', 34, 3.4, 1.5, 5.0, 1);

-- ════════════════════════════════════════════════════════════════════════════
-- T13a — SELECT-isolatie: fonds A ziet GÉÉN periode/reserve van fonds B.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

do $$
declare n int;
begin
  select
    (select count(*) from public.fonds_stuurinfo_periode where fonds_id='32222222-2222-2222-2222-222222222222')
  + (select count(*) from public.fonds_stuurinfo_reserve where fonds_id='32222222-2222-2222-2222-222222222222')
  into n;
  if n <> 0 then
    raise exception 'LEK T13a: fonds A ziet % rij(en) periode/reserve van fonds B (cross-tenant leesisolatie kapot).', n;
  end if;
  raise notice 'OK T13a: fonds A ziet geen enkele periode-/reserve-rij van fonds B.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T13b — Rolgate NEGATIEF: een bestuurder (niet-privileged) mag niets schrijven.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"3bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}';

do $$
declare gelukt boolean := false;
begin
  begin
    insert into public.fonds_stuurinfo_periode (fonds_id, periode, peildatum, bron, volgorde)
    values ('31111111-1111-1111-1111-111111111111', '2026Q2', date '2026-06-30', 'test', 2);
    gelukt := true;
  exception when insufficient_privilege then
    gelukt := false; -- verwacht: RLS WITH CHECK (rol) weigert
  end;
  if gelukt then
    raise exception 'LEK T13b: bestuurder kon een PERIODE SCHRIJVEN (rolgate geschonden).';
  end if;
  raise notice 'OK T13b: periode-INSERT geweigerd voor niet-privileged bestuurder.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T13c — Rolgate POSITIEF: een beheerder van fonds A mag WEL periode + reserve
--        schrijven (in deze volgorde: de reserve-FK eist de registry-rij).
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

do $$
declare n int;
begin
  insert into public.fonds_stuurinfo_periode (fonds_id, periode, peildatum, bron, volgorde)
  values ('31111111-1111-1111-1111-111111111111', '2026Q2', date '2026-06-30', 'test', 2);
  insert into public.fonds_stuurinfo_reserve (fonds_id, periode, reserve_key, label, stand, pct_waarde, volgorde)
  values ('31111111-1111-1111-1111-111111111111', '2026Q2', 'mvev_reserve', 'MVEV-reserve', 10, 0.4, 2);
  select
    (select count(*) from public.fonds_stuurinfo_periode where fonds_id='31111111-1111-1111-1111-111111111111')
  + (select count(*) from public.fonds_stuurinfo_reserve where fonds_id='31111111-1111-1111-1111-111111111111')
  into n;
  if n <> 2 then
    raise exception 'REGRESSIE T13c: beheerder kon eigen periode/reserve niet schrijven (n=%).', n;
  end if;
  raise notice 'OK T13c: beheerder schrijft eigen periode + reserve (rolgate laat privileged door).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T13d — Cross-tenant WRITE: beheerder van A mag GEEN reserve voor fonds B schrijven.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare gelukt boolean := false;
begin
  begin
    insert into public.fonds_stuurinfo_reserve (fonds_id, periode, reserve_key, label, stand, volgorde)
    values ('32222222-2222-2222-2222-222222222222', '2026Q2', 'poging', 'X', 1, 9);
    gelukt := true;
  exception when insufficient_privilege then
    gelukt := false; -- verwacht: WITH CHECK op fonds_id weigert vreemd fonds
  end;
  if gelukt then
    raise exception 'LEK T13d: beheerder van A kon een reserve voor fonds B SCHRIJVEN (cross-tenant write).';
  end if;
  begin
    insert into public.fonds_stuurinfo_periode (fonds_id, periode, peildatum, bron, volgorde)
    values ('32222222-2222-2222-2222-222222222222', '2026Q3', date '2026-09-30', 'test', 3);
    gelukt := true;
  exception when insufficient_privilege then
    gelukt := false; -- verwacht: WITH CHECK op fonds_id weigert vreemd fonds
  end;
  if gelukt then
    raise exception 'LEK T13d: beheerder van A kon een PERIODE voor fonds B SCHRIJVEN (cross-tenant write).';
  end if;
  raise notice 'OK T13d: cross-tenant write (A→B) geweigerd op reserve én registry.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T13e — DELETE deny-by-default: er is GEEN delete-policy, dus een DELETE raakt
--        0 rijen (de rijen zijn niet zichtbaar voor DELETE onder RLS).
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare geraakt int;
begin
  delete from public.fonds_stuurinfo_reserve
   where fonds_id = '31111111-1111-1111-1111-111111111111';
  get diagnostics geraakt = row_count;
  if geraakt <> 0 then
    raise exception 'LEK T13e: DELETE raakte % reserve-rij(en) — delete-lek (deny-by-default geschonden).', geraakt;
  end if;
  delete from public.fonds_stuurinfo_periode
   where fonds_id = '31111111-1111-1111-1111-111111111111';
  get diagnostics geraakt = row_count;
  if geraakt <> 0 then
    raise exception 'LEK T13e: DELETE raakte % periode-rij(en) — delete-lek (deny-by-default geschonden).', geraakt;
  end if;
  raise notice 'OK T13e: DELETE raakt 0 rijen op periode én reserve (geen delete-policy).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T13f — Cross-tenant UPDATE-move NEGATIEF: beheerder van A mag een eigen
--        reserve-rij niet naar fonds B "verplaatsen" (WITH CHECK weigert).
--        Idem voor de registry-rij zelf.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare gelukt boolean := false;
begin
  begin
    update public.fonds_stuurinfo_reserve
       set fonds_id = '32222222-2222-2222-2222-222222222222'
     where fonds_id = '31111111-1111-1111-1111-111111111111' and reserve_key = 'mvev_reserve';
    gelukt := true;
  exception when insufficient_privilege then
    gelukt := false; -- verwacht: WITH CHECK op de nieuwe fonds_id weigert
  end;
  if gelukt then
    raise exception 'LEK T13f: beheerder van A kon een reserve-rij naar fonds B verplaatsen (cross-tenant UPDATE-move).';
  end if;
  begin
    update public.fonds_stuurinfo_periode
       set fonds_id = '32222222-2222-2222-2222-222222222222'
     where fonds_id = '31111111-1111-1111-1111-111111111111' and periode = '2026Q2';
    gelukt := true;
  exception when insufficient_privilege or foreign_key_violation then
    -- insufficient_privilege verwacht (WITH CHECK); foreign_key_violation kan
    -- theoretisch eerder vuren via de kind-FK's — beide betekenen: geen move.
    gelukt := false;
  end;
  if gelukt then
    raise exception 'LEK T13f: beheerder van A kon een registry-rij naar fonds B verplaatsen (cross-tenant UPDATE-move).';
  end if;
  raise notice 'OK T13f: cross-tenant UPDATE-move (A→B) geweigerd op reserve én registry (WITH CHECK).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T13g — UPDATE-rolgate NEGATIEF: een bestuurder van A mag GEEN periode of
--        reserve bijwerken. De UPDATE-USING-clause eist een privileged rol →
--        de rijen zijn onzichtbaar voor UPDATE → 0 rijen geraakt.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"3bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}';

do $$
declare geraakt int;
begin
  update public.fonds_stuurinfo_periode set bron = 'gehackt'
   where fonds_id = '31111111-1111-1111-1111-111111111111';
  get diagnostics geraakt = row_count;
  if geraakt <> 0 then
    raise exception 'LEK T13g: bestuurder kon % periode-rij(en) UPDATEN (UPDATE-rolgate geschonden).', geraakt;
  end if;
  update public.fonds_stuurinfo_reserve set stand = 999
   where fonds_id = '31111111-1111-1111-1111-111111111111';
  get diagnostics geraakt = row_count;
  if geraakt <> 0 then
    raise exception 'LEK T13g: bestuurder kon % reserve-rij(en) UPDATEN (UPDATE-rolgate geschonden).', geraakt;
  end if;
  raise notice 'OK T13g: UPDATE raakt 0 rijen voor niet-privileged bestuurder (rolgate op beide tabellen).';
end $$;

reset role;

rollback;

-- ============================================================================
-- Alles geslaagd als psql exit 0 gaf en je de "OK …"-notices zag (T13a–T13g).
-- Elke "LEK:"/"REGRESSIE" doet raise exception → non-zero exit → CI faalt.
-- ============================================================================
