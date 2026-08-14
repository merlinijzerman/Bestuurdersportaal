-- ============================================================================
-- T17 — Cross-tenant + één-bron-testsuite voor tab 3 (Biometrische rendementen).
-- ----------------------------------------------------------------------------
-- Doel: onder ÉCHTE RLS bewijzen dat (1) de biometrie-write (batch-upsert op
-- fonds_stuurinfo_reeks, GEEN RPC) de RLS-rolgate respecteert (bestuurder →
-- weigering, beheerder → slaagt + gelogd) en fonds B nooit raakt; (2) de
-- één-bron-koppeling met tabs 5/6 hard is geborgd in de vervangen RPC's:
--   - soli-RPC leidt het netto langleven-resultaat af uit de langleven-reeks
--     (SOLI_LANGLEVEN_ONTBREEKT als die onvolledig is) en de eindstand sluit
--     inclusief die afgeleide post;
--   - oper-RPC telt de resultaten PP/WZP en AO/PVI (risicopremie tab 7 +
--     toegekend tab 3) mee in de som-check (OPER_PREMIE_ONTBREEKT /
--     OPER_BIOMETRIE_ONTBREEKT bij ontbrekende bron; OPER_MUTATIE_ONGELIJK bij
--     drift); (3) de nieuwe reeks-rijen deny-by-default blijven (geen delete).
-- Elke overtreding → raise exception → psql exit-code <> 0 → CI faalt.
--
-- Scenario's (werkopdracht T17, decisions/0078):
--   T17a — RLS-rolgate: bestuurder kan geen langleven-reeksrij schrijven.
--   T17b — beheerder A schrijft langleven (3) + risicodekking (2), gelogd.
--   T17c — soli-RPC: slaagt met afgeleid netto langleven (eindstand sluit);
--          periode zonder langleven-reeks → SOLI_LANGLEVEN_ONTBREEKT.
--   T17d — oper-RPC: slaagt met de meegetelde resultaten (stand sluit);
--          premie zonder risicodekking → OPER_BIOMETRIE_ONTBREEKT;
--          risicodekking zonder premie → OPER_PREMIE_ONTBREEKT.
--   T17e — tenant-isolatie: A raakte fonds B niet; authenticated kan
--          langleven/risicodekking-rijen niet DELETEN (deny-by-default).
--
-- Self-seeding (T14–T16-patroon; 2 fondsen + 3 users via trigger maak_profiel).
-- Alles in één transactie met ROLLBACK — laat niets achter.
--
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed als tabel-eigenaar (RLS omzeild). Vaste UUID's voor de test. ────────
insert into public.fondsen (id, naam, slug) values
  ('71111111-1111-1111-1111-111111111111', 'T17 Fonds A', 't17-fonds-a'),
  ('72222222-2222-2222-2222-222222222222', 'T17 Fonds B', 't17-fonds-b');

insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','t17-a-beheer@test.local',
   '{"naam":"A Beheerder","fonds_id":"71111111-1111-1111-1111-111111111111"}', now(), now()),
  ('7bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','t17-a-lid@test.local',
   '{"naam":"A Lid","fonds_id":"71111111-1111-1111-1111-111111111111"}', now(), now()),
  ('7ccccccc-cccc-cccc-cccc-cccccccccccc','authenticated','authenticated','t17-b-beheer@test.local',
   '{"naam":"B Beheerder","fonds_id":"72222222-2222-2222-2222-222222222222"}', now(), now());

update public.profielen set rol = 'beheerder'  where id = '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.profielen set rol = 'bestuurder' where id = '7bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
update public.profielen set rol = 'beheerder'  where id = '7ccccccc-cccc-cccc-cccc-cccccccccccc';

-- Fonds A: vijf periodes met gerichte inrichting per scenario.
--   Q1: soli-reserve 68, ZONDER langleven (T17c → SOLI_LANGLEVEN_ONTBREEKT).
--   Q2: soli 78 + oper 9,0 + langleven + risicodekking + premie_component
--       (T17c/T17d happy paths — sluit exact).
--   Q3: oper 9,0 + premie_component, GEEN risicodekking (T17d → BIOMETRIE).
--   Q4: oper 9,0 + risicodekking, GEEN premie_component (T17d → PREMIE).
--   Q5: registry-only (T17a/T17b — biometrie-write onder rolgate).
insert into public.fonds_stuurinfo_periode (fonds_id, periode, peildatum, bron, volgorde) values
  ('71111111-1111-1111-1111-111111111111', '2026Q1', date '2026-03-31', 'test', 8205),
  ('71111111-1111-1111-1111-111111111111', '2026Q2', date '2026-06-30', 'test', 8206),
  ('71111111-1111-1111-1111-111111111111', '2026Q3', date '2026-09-30', 'test', 8207),
  ('71111111-1111-1111-1111-111111111111', '2026Q4', date '2026-12-31', 'test', 8208),
  ('71111111-1111-1111-1111-111111111111', '2027Q1', date '2027-03-31', 'test', 8209);

insert into public.fonds_stuurinfo_reserve
  (fonds_id, periode, reserve_key, label, stand, pct_waarde, ondergrens, bovengrens, volgorde) values
  ('71111111-1111-1111-1111-111111111111', '2026Q1', 'solidariteitsreserve', 'Solidariteitsreserve', 68.0, 3.0, 1.5, 5.0, 1),
  ('71111111-1111-1111-1111-111111111111', '2026Q2', 'solidariteitsreserve', 'Solidariteitsreserve', 78.0, 3.3, 1.5, 5.0, 1);
insert into public.fonds_stuurinfo_reserve
  (fonds_id, periode, reserve_key, label, stand, pct_waarde, volgorde) values
  ('71111111-1111-1111-1111-111111111111', '2026Q1', 'operationele_reserve', 'Operationele reserve', 8.0, 0.3, 3),
  ('71111111-1111-1111-1111-111111111111', '2026Q2', 'operationele_reserve', 'Operationele reserve', 9.0, 0.4, 3),
  ('71111111-1111-1111-1111-111111111111', '2026Q3', 'operationele_reserve', 'Operationele reserve', 9.0, 0.4, 3),
  ('71111111-1111-1111-1111-111111111111', '2026Q4', 'operationele_reserve', 'Operationele reserve', 9.0, 0.4, 3);

-- Q2 langleven (micro+macro+vrijval = −0,6) + risicodekking (≤ 0).
insert into public.fonds_stuurinfo_reeks (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde) values
  ('71111111-1111-1111-1111-111111111111', '2026Q2', 'langleven', 'micro',   'Micro-langleven', 1, -0.8),
  ('71111111-1111-1111-1111-111111111111', '2026Q2', 'langleven', 'macro',   'Macro-langleven', 2, -1.2),
  ('71111111-1111-1111-1111-111111111111', '2026Q2', 'langleven', 'vrijval', 'Vrijval bij overlijden', 3, 1.4),
  ('71111111-1111-1111-1111-111111111111', '2026Q2', 'risicodekking', 'ppwzp_toegekend', 'Toegekende PP/WZP', 1, -0.3),
  ('71111111-1111-1111-1111-111111111111', '2026Q2', 'risicodekking', 'aopvi_toegekend', 'Toegekende AO/PVI', 2, -0.4);
-- Binnengekomen risicopremies (tab 7) Q2/Q3: risico_ppwzp 1,1; aop 0,1; pvi 1,0.
insert into public.fonds_stuurinfo_reeks (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde) values
  ('71111111-1111-1111-1111-111111111111', '2026Q2', 'premie_component', 'risico_ppwzp', 'Risicopremie PP/WZP', 2, 1.1),
  ('71111111-1111-1111-1111-111111111111', '2026Q2', 'premie_component', 'risico_aop',   'Risicopremie AOP',   3, 0.1),
  ('71111111-1111-1111-1111-111111111111', '2026Q2', 'premie_component', 'risico_pvi',   'Risicopremie PVI',   4, 1.0),
  ('71111111-1111-1111-1111-111111111111', '2026Q3', 'premie_component', 'risico_ppwzp', 'Risicopremie PP/WZP', 2, 1.1),
  ('71111111-1111-1111-1111-111111111111', '2026Q3', 'premie_component', 'risico_aop',   'Risicopremie AOP',   3, 0.1),
  ('71111111-1111-1111-1111-111111111111', '2026Q3', 'premie_component', 'risico_pvi',   'Risicopremie PVI',   4, 1.0);
-- Q4 risicodekking WEL, premie_component NIET (T17d → OPER_PREMIE_ONTBREEKT).
insert into public.fonds_stuurinfo_reeks (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde) values
  ('71111111-1111-1111-1111-111111111111', '2026Q4', 'risicodekking', 'ppwzp_toegekend', 'Toegekende PP/WZP', 1, -0.3),
  ('71111111-1111-1111-1111-111111111111', '2026Q4', 'risicodekking', 'aopvi_toegekend', 'Toegekende AO/PVI', 2, -0.4);

-- Fonds B: één periode + soli/oper-reserve (mag door niets van A geraakt worden).
insert into public.fonds_stuurinfo_periode (fonds_id, periode, peildatum, bron, volgorde) values
  ('72222222-2222-2222-2222-222222222222', '2026Q2', date '2026-06-30', 'test', 8206);
insert into public.fonds_stuurinfo_reserve
  (fonds_id, periode, reserve_key, label, stand, pct_waarde, volgorde) values
  ('72222222-2222-2222-2222-222222222222', '2026Q2', 'solidariteitsreserve', 'Solidariteitsreserve', 34.0, 3.4, 1),
  ('72222222-2222-2222-2222-222222222222', '2026Q2', 'operationele_reserve', 'Operationele reserve',  4.0, 0.4, 3);

-- ════════════════════════════════════════════════════════════════════════════
-- T17a — RLS-rolgate: bestuurder kan geen langleven-reeksrij schrijven.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"7bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}';

do $$
declare gelukt boolean := false;
begin
  begin
    insert into public.fonds_stuurinfo_reeks (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde, invoer_bron)
    values ('71111111-1111-1111-1111-111111111111', '2027Q1', 'langleven', 'micro', 'Micro-langleven', 1, -0.5, 'handmatig');
    gelukt := true;
  exception when insufficient_privilege then
    gelukt := false; -- verwacht: RLS-schrijfpolicy eist voorzitter/beheerder
  end;
  if gelukt then
    raise exception 'LEK T17a: BESTUURDER kon een langleven-reeksrij schrijven (rolgate geschonden).';
  end if;
  raise notice 'OK T17a: biometrie-write geweigerd voor niet-privileged bestuurder (RLS-rolgate).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T17b — beheerder A schrijft langleven (3) + risicodekking (2), gelogd.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

do $$
declare n_reeks int; n_log int;
begin
  insert into public.fonds_stuurinfo_reeks (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde, invoer_bron)
  values
    ('71111111-1111-1111-1111-111111111111', '2027Q1', 'langleven', 'micro',   'Micro-langleven', 1, -0.5, 'handmatig'),
    ('71111111-1111-1111-1111-111111111111', '2027Q1', 'langleven', 'macro',   'Macro-langleven', 2, -0.7, 'handmatig'),
    ('71111111-1111-1111-1111-111111111111', '2027Q1', 'langleven', 'vrijval', 'Vrijval bij overlijden', 3, 0.9, 'handmatig'),
    ('71111111-1111-1111-1111-111111111111', '2027Q1', 'risicodekking', 'ppwzp_toegekend', 'Toegekende PP/WZP', 1, -0.2, 'handmatig'),
    ('71111111-1111-1111-1111-111111111111', '2027Q1', 'risicodekking', 'aopvi_toegekend', 'Toegekende AO/PVI', 2, -0.3, 'handmatig');

  select count(*) into n_reeks from public.fonds_stuurinfo_reeks
   where fonds_id = '71111111-1111-1111-1111-111111111111' and periode = '2027Q1'
     and reeks_key in ('langleven', 'risicodekking');
  if n_reeks <> 5 then
    raise exception 'REGRESSIE T17b: verwacht 5 biometrie-rijen, gevonden %.', n_reeks;
  end if;

  -- Elke write append-only gelogd met actor + bron (T14-capture-trigger).
  select count(*) into n_log from public.fonds_stuurinfo_log
   where fonds_id = '71111111-1111-1111-1111-111111111111' and periode = '2027Q1'
     and tabel = 'reeks' and gebruiker_id = '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     and invoer_bron = 'handmatig';
  if n_log < 5 then
    raise exception 'REGRESSIE T17b: verwacht >= 5 logregels voor de biometrie-write, gevonden %.', n_log;
  end if;
  raise notice 'OK T17b: beheerder schreef langleven + risicodekking; volledig append-only gelogd.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T17c — soli-RPC: afgeleid netto langleven + SOLI_LANGLEVEN_ONTBREEKT.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare gelukt boolean; melding text; v_micro numeric;
begin
  -- Succes op Q2: 68 + (1,1+4,6+4,9) + langleven(−0,6) − 0 = 78 = balans-stand.
  perform public.stuurinfo_soli_opslaan(
    '2026Q2', 'handmatig',
    '{"premie":1.1,"rendement":4.6,"overrendementsbijdrage":4.9}'::jsonb,
    0, 1.5, 5.0);

  -- Eén bron: er is GEEN opgeslagen soli_vulling.micro_langleven-rij meer.
  select count(*) into v_micro from public.fonds_stuurinfo_reeks
   where fonds_id = '71111111-1111-1111-1111-111111111111' and periode = '2026Q2'
     and reeks_key = 'soli_vulling' and punt_key = 'micro_langleven';
  if v_micro <> 0 then
    raise exception 'LEK T17c: de soli-RPC schreef alsnog een micro_langleven-rij (dubbele opslag).';
  end if;

  -- SOLI_LANGLEVEN_ONTBREEKT op Q1 (soli-reserve aanwezig, geen langleven-reeks).
  gelukt := false;
  begin
    perform public.stuurinfo_soli_opslaan(
      '2026Q1', 'handmatig',
      '{"premie":1.0,"rendement":1.0,"overrendementsbijdrage":1.0}'::jsonb,
      0, 1.5, 5.0);
    gelukt := true;
  exception when others then
    melding := sqlerrm;
  end;
  if gelukt or melding not like '%SOLI_LANGLEVEN_ONTBREEKT%' then
    raise exception 'LEK T17c: soli-RPC accepteerde een periode zonder langleven-reeks (melding=%).',
      coalesce(melding, '—');
  end if;
  raise notice 'OK T17c: soli-RPC leidt netto langleven af (één bron); zonder reeks → SOLI_LANGLEVEN_ONTBREEKT.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T17d — oper-RPC: resultaten meegeteld + ONTBREEKT-checks.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare gelukt boolean; melding text;
  -- som(8) = −0,5; resultaten +0,8 (PP/WZP) +0,7 (AO/PVI) → 8,0 + 1,0 = 9,0.
  mutaties jsonb := '{"premie_kostenopslag":0,"beschermingsrendement":-0.1,"overrendement":0.4,"gemist_rendement_twk":0.1,"twk_invaar":0.2,"verrekening_reserves":0.0,"overig":-0.3,"kosten":-0.8}'::jsonb;
  kr jsonb := '{"uitvoeringskosten":1.9,"vermogensbeheer":0.9,"bestuur_overig":0.3}'::jsonb;
  kb jsonb := '{"uitvoeringskosten":2.1,"vermogensbeheer":1.0,"bestuur_overig":0.2}'::jsonb;
begin
  -- Succes op Q2 (premie_component + risicodekking aanwezig; som sluit).
  perform public.stuurinfo_operationeel_opslaan('2026Q2', 'handmatig', mutaties, 8.0, 6.0, 12.0, kr, kb);
  raise notice 'OK T17d-1: oper-RPC telt de resultaten PP/WZP + AO/PVI mee; stand sluit (9,0).';

  -- Q3: premie_component WEL, risicodekking NIET → OPER_BIOMETRIE_ONTBREEKT.
  gelukt := false;
  begin
    perform public.stuurinfo_operationeel_opslaan('2026Q3', 'handmatig', mutaties, 8.0, 6.0, 12.0, kr, kb);
    gelukt := true;
  exception when others then melding := sqlerrm;
  end;
  if gelukt or melding not like '%OPER_BIOMETRIE_ONTBREEKT%' then
    raise exception 'LEK T17d: oper-RPC accepteerde een periode zonder risicodekking (melding=%).',
      coalesce(melding, '—');
  end if;

  -- Q4: risicodekking WEL, premie_component NIET → OPER_PREMIE_ONTBREEKT.
  gelukt := false;
  begin
    perform public.stuurinfo_operationeel_opslaan('2026Q4', 'handmatig', mutaties, 8.0, 6.0, 12.0, kr, kb);
    gelukt := true;
  exception when others then melding := sqlerrm;
  end;
  if gelukt or melding not like '%OPER_PREMIE_ONTBREEKT%' then
    raise exception 'LEK T17d: oper-RPC accepteerde een periode zonder risicopremies (melding=%).',
      coalesce(melding, '—');
  end if;
  raise notice 'OK T17d-2: ontbrekende bron → OPER_BIOMETRIE_ONTBREEKT / OPER_PREMIE_ONTBREEKT.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T17e — tenant-isolatie + deny-delete.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare geraakt int;
begin
  delete from public.fonds_stuurinfo_reeks
   where fonds_id = '71111111-1111-1111-1111-111111111111'
     and reeks_key in ('langleven', 'risicodekking');
  get diagnostics geraakt = row_count;
  if geraakt <> 0 then
    raise exception 'LEK T17e: authenticated kon % biometrie-rij(en) DELETEN (deny-by-default kapot).', geraakt;
  end if;
  raise notice 'OK T17e-1: geen delete op langleven/risicodekking-rijen (deny-by-default).';
end $$;

reset role;

do $$
declare n int;
begin
  -- Als eigenaar (ziet alles): fonds B heeft geen biometrie-rijen gekregen.
  select count(*) into n from public.fonds_stuurinfo_reeks
   where fonds_id = '72222222-2222-2222-2222-222222222222'
     and reeks_key in ('langleven', 'risicodekking');
  if n <> 0 then
    raise exception 'LEK T17e: fonds B kreeg % biometrie-rij(en) — de run van A raakte fonds B.', n;
  end if;
  -- Fonds B soli/oper-reserve ongewijzigd.
  if exists (
    select 1 from public.fonds_stuurinfo_reserve
     where fonds_id = '72222222-2222-2222-2222-222222222222' and periode = '2026Q2'
       and ((reserve_key = 'solidariteitsreserve' and stand is distinct from 34.0)
         or (reserve_key = 'operationele_reserve' and stand is distinct from 4.0))
  ) then
    raise exception 'LEK T17e: de reserve-rijen van fonds B zijn gewijzigd.';
  end if;
  raise notice 'OK T17e-2: fonds B volledig ongemoeid (tenant-isolatie).';
end $$;

rollback;

-- ============================================================================
-- Alles geslaagd als psql exit 0 gaf en je de "OK …"-notices zag (T17a–T17e).
-- Elke "LEK:"/"REGRESSIE" doet raise exception → non-zero exit → CI faalt.
-- Vereist dat 2026_07_19_t17_stuurinfo_biometrie.sql is toegepast (bovenop
-- t13–t16); de biometrie-write heeft geen eigen RPC (batch-upsert op reeks).
-- ============================================================================
