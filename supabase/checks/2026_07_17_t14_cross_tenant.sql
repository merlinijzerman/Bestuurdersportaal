-- ============================================================================
-- T14 — Cross-tenant + audit-testsuite voor de stuurinfo-invoerlaag.
-- ----------------------------------------------------------------------------
-- Doel: onder ÉCHTE RLS bewijzen dat (1) het nieuwe auditlog fonds_stuurinfo_log
-- tenant-geïsoleerd en append-only is, (2) de capture-trigger elke mutatie logt
-- (met actor + invoerbron) maar no-op-upserts NIET, (3) de RPC
-- stuurinfo_balans_opslaan de RLS-rolgate respecteert (bestuurder → weigering),
-- structureel geen fonds-parameter heeft (fonds volgt auth.uid()) en de
-- DB-validaties (balansevenwicht, gekoppelde standen) hard afdwingt.
-- Elke overtreding → raise exception → psql exit-code <> 0 → CI faalt.
--
-- Scenario's (werkopdracht T14, decisions/0075):
--   T14a — log SELECT-isolatie: fonds A ziet GEEN logregels van fonds B.
--   T14b — append-only: authenticated raakt 0 logrijen (geen policy); de
--          eigenaar/service krijgt een exception (fn_log_append_only).
--   T14c — capture-trigger: reserve-INSERT/UPDATE logt (actor, bron, oud→nieuw);
--          een no-op-upsert produceert GEEN logregel.
--   T14d — RPC-rolgate: bestuurder → RLS-weigering; beheerder van A slaagt en
--          reeks/reserve/kpi/registry + logregels staan er consistent.
--   T14e — RPC kent geen fonds-parameter (structureel) en raakte fonds B niet.
--   T14f — RPC-validaties: BALANS_SLUIT_NIET, GEKOPPELDE_STAND_ONGELIJK en
--          ONGELDIGE_WAARDE (JSON-null; T14b).
--   T14g — directe log-INSERT begrensd (T14b): cross-tenant geweigerd, rolgate
--          geweigerd, actor-spoofing (gebruiker_id ≠ auth.uid()) geweigerd.
--   NB: T14c toetst mede de T14b-hardening (volledige kolomdekking: ook een
--   volgorde- of invoer_bron-wijziging logt; alleen échte no-ops loggen niet).
--
-- Self-seeding (T13-patroon; 2 fondsen + 3 users via auth-trigger maak_profiel).
-- Alles in één transactie met ROLLBACK — laat niets achter.
--
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed als tabel-eigenaar (RLS omzeild). Vaste UUID's voor de test. ────────
insert into public.fondsen (id, naam, slug) values
  ('41111111-1111-1111-1111-111111111111', 'T14 Fonds A', 't14-fonds-a'),
  ('42222222-2222-2222-2222-222222222222', 'T14 Fonds B', 't14-fonds-b');

insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','t14-a-beheer@test.local',
   '{"naam":"A Beheerder","fonds_id":"41111111-1111-1111-1111-111111111111"}', now(), now()),
  ('4bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','t14-a-lid@test.local',
   '{"naam":"A Lid","fonds_id":"41111111-1111-1111-1111-111111111111"}', now(), now()),
  ('4ccccccc-cccc-cccc-cccc-cccccccccccc','authenticated','authenticated','t14-b-beheer@test.local',
   '{"naam":"B Beheerder","fonds_id":"42222222-2222-2222-2222-222222222222"}', now(), now());

update public.profielen set rol = 'beheerder'  where id = '4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.profielen set rol = 'bestuurder' where id = '4bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
update public.profielen set rol = 'beheerder'  where id = '4ccccccc-cccc-cccc-cccc-cccccccccccc';

-- Data + dus logregels voor fonds B (eigenaar-insert; capture-trigger vuurt met
-- actor null — het seed-/systeempad).
insert into public.fonds_stuurinfo_periode (fonds_id, periode, peildatum, bron, volgorde)
  values ('42222222-2222-2222-2222-222222222222', '2026Q2', date '2026-06-30', 'test', 8106);
insert into public.fonds_stuurinfo_reserve (fonds_id, periode, reserve_key, label, stand, pct_waarde, ondergrens, bovengrens, volgorde)
  values ('42222222-2222-2222-2222-222222222222', '2026Q2', 'solidariteitsreserve', 'Solidariteitsreserve', 34, 3.4, 1.5, 5.0, 1);

do $$
declare n int;
begin
  select count(*) into n from public.fonds_stuurinfo_log
   where fonds_id = '42222222-2222-2222-2222-222222222222';
  if n < 2 then
    raise exception 'REGRESSIE T14-seed: capture-trigger logde de eigenaar-seed niet (n=%).', n;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T14a — log SELECT-isolatie: fonds A ziet GEEN logregels van fonds B.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claim.sub to '4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

do $$
declare n int;
begin
  select count(*) into n from public.fonds_stuurinfo_log
   where fonds_id = '42222222-2222-2222-2222-222222222222';
  if n <> 0 then
    raise exception 'LEK T14a: fonds A ziet % logregel(s) van fonds B (cross-tenant leesisolatie kapot).', n;
  end if;
  raise notice 'OK T14a: fonds A ziet geen enkele logregel van fonds B.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T14c — capture-trigger + no-op-guard (beheerder van A schrijft direct).
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare n1 int; n2 int; n3 int; regel record;
begin
  -- Registry-rij + reserve-rij als beheerder (invoerbron 'handmatig').
  insert into public.fonds_stuurinfo_periode (fonds_id, periode, peildatum, bron, volgorde, invoer_bron)
  values ('41111111-1111-1111-1111-111111111111', '2026Q1', date '2026-03-31', 'handmatig', 8105, 'handmatig');
  insert into public.fonds_stuurinfo_reserve (fonds_id, periode, reserve_key, label, stand, pct_waarde, volgorde, invoer_bron)
  values ('41111111-1111-1111-1111-111111111111', '2026Q1', 'kostenreserve', 'Kostenreserve', 40, 1.7, 4, 'handmatig');

  select count(*) into n1 from public.fonds_stuurinfo_log
   where fonds_id = '41111111-1111-1111-1111-111111111111';
  if n1 <> 2 then
    raise exception 'REGRESSIE T14c: verwacht 2 logregels na 2 inserts, gevonden %.', n1;
  end if;

  -- Actor + bron + veld_key correct vastgelegd?
  select * into regel from public.fonds_stuurinfo_log
   where fonds_id = '41111111-1111-1111-1111-111111111111' and tabel = 'reserve';
  if regel.gebruiker_id is distinct from '4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     or regel.invoer_bron is distinct from 'handmatig'
     or regel.veld_key is distinct from 'kostenreserve'
     or regel.oude_waarde is not null then
    raise exception 'REGRESSIE T14c: logregel mist actor/bron/veld (actor=%, bron=%, veld=%).',
      regel.gebruiker_id, regel.invoer_bron, regel.veld_key;
  end if;

  -- No-op-update (zelfde waarden) → GEEN extra logregel.
  update public.fonds_stuurinfo_reserve set stand = 40, pct_waarde = 1.7
   where fonds_id = '41111111-1111-1111-1111-111111111111' and periode = '2026Q1'
     and reserve_key = 'kostenreserve';
  select count(*) into n2 from public.fonds_stuurinfo_log
   where fonds_id = '41111111-1111-1111-1111-111111111111';
  if n2 <> n1 then
    raise exception 'REGRESSIE T14c: no-op-update produceerde tóch een logregel (%->%).', n1, n2;
  end if;

  -- Echte wijziging → logregel MET oude_waarde.
  update public.fonds_stuurinfo_reserve set stand = 41
   where fonds_id = '41111111-1111-1111-1111-111111111111' and periode = '2026Q1'
     and reserve_key = 'kostenreserve';
  select count(*) into n3 from public.fonds_stuurinfo_log
   where fonds_id = '41111111-1111-1111-1111-111111111111';
  if n3 <> n1 + 1 then
    raise exception 'REGRESSIE T14c: wijziging niet gelogd (%->%).', n1, n3;
  end if;
  select * into regel from public.fonds_stuurinfo_log
   where fonds_id = '41111111-1111-1111-1111-111111111111' and tabel = 'reserve'
     and oude_waarde is not null
   order by aangemaakt desc, id desc limit 1;
  if (regel.oude_waarde->>'stand')::numeric is distinct from 40
     or (regel.nieuwe_waarde->>'stand')::numeric is distinct from 41 then
    raise exception 'REGRESSIE T14c: oud→nieuw niet correct gelogd (oud=%, nieuw=%).',
      regel.oude_waarde, regel.nieuwe_waarde;
  end if;

  -- T14b-hardening: VOLLEDIGE kolomdekking. Een wijziging van een kolom die
  -- buiten de oude subset-payload viel (volgorde) én een bron-wissel met
  -- gelijke waarden moeten beide een logregel opleveren.
  update public.fonds_stuurinfo_reserve set volgorde = 5
   where fonds_id = '41111111-1111-1111-1111-111111111111' and periode = '2026Q1'
     and reserve_key = 'kostenreserve';
  select count(*) into n2 from public.fonds_stuurinfo_log
   where fonds_id = '41111111-1111-1111-1111-111111111111';
  if n2 <> n3 + 1 then
    raise exception 'LEK T14c: volgorde-wijziging NIET gelogd (kolomdekking onvolledig, audit-M1).';
  end if;
  update public.fonds_stuurinfo_reserve set invoer_bron = 'upload'
   where fonds_id = '41111111-1111-1111-1111-111111111111' and periode = '2026Q1'
     and reserve_key = 'kostenreserve';
  select count(*) into n3 from public.fonds_stuurinfo_log
   where fonds_id = '41111111-1111-1111-1111-111111111111';
  if n3 <> n2 + 1 then
    raise exception 'LEK T14c: invoer_bron-wissel NIET gelogd (bron kan onauditeerbaar driften).';
  end if;
  raise notice 'OK T14c: capture logt actor/bron/oud→nieuw over ALLE kolommen; no-op-upsert logt niet.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T14b — append-only: authenticated raakt 0 logrijen; eigenaar krijgt exception.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare geraakt int;
begin
  update public.fonds_stuurinfo_log set veld_key = 'gehackt'
   where fonds_id = '41111111-1111-1111-1111-111111111111';
  get diagnostics geraakt = row_count;
  if geraakt <> 0 then
    raise exception 'LEK T14b: authenticated kon % logregel(s) UPDATEN (geen policy verwacht).', geraakt;
  end if;
  delete from public.fonds_stuurinfo_log
   where fonds_id = '41111111-1111-1111-1111-111111111111';
  get diagnostics geraakt = row_count;
  if geraakt <> 0 then
    raise exception 'LEK T14b: authenticated kon % logregel(s) DELETEN (geen policy verwacht).', geraakt;
  end if;
  raise notice 'OK T14b-1: authenticated raakt 0 logrijen (deny-by-default).';
end $$;

reset role;

do $$
declare gelukt boolean := false;
begin
  begin
    update public.fonds_stuurinfo_log set veld_key = 'gehackt'
     where fonds_id = '41111111-1111-1111-1111-111111111111';
    gelukt := true;
  exception when others then
    gelukt := false; -- verwacht: fn_log_append_only raise exception
  end;
  if gelukt then
    raise exception 'LEK T14b: eigenaar kon een logregel UPDATEN (append-only trigger ontbreekt).';
  end if;
  begin
    delete from public.fonds_stuurinfo_log
     where fonds_id = '41111111-1111-1111-1111-111111111111';
    gelukt := true;
  exception when others then
    gelukt := false;
  end;
  if gelukt then
    raise exception 'LEK T14b: eigenaar kon een logregel DELETEN (append-only trigger ontbreekt).';
  end if;
  raise notice 'OK T14b-2: UPDATE/DELETE op het log geblokkeerd door fn_log_append_only (ook eigenaar).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T14g — directe log-INSERT begrensd (T14b): cross-tenant, rolgate en
--        actor-spoofing worden alle drie door de WITH CHECK geweigerd; een
--        eigen-fonds-insert op eigen naam blijft mogelijk (gedocumenteerd
--        restpunt — zelfde vorm als fonds_config_log).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claim.sub to '4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

do $$
declare gelukt boolean := false;
begin
  -- (a) Cross-tenant: beheerder A → logregel voor fonds B.
  begin
    insert into public.fonds_stuurinfo_log
      (fonds_id, periode, tabel, veld_key, nieuwe_waarde, gebruiker_id)
    values ('42222222-2222-2222-2222-222222222222', '2026Q2', 'kpi', 'nep',
            '{"waarde":1}'::jsonb, '4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    gelukt := true;
  exception when insufficient_privilege then
    gelukt := false;
  end;
  if gelukt then
    raise exception 'LEK T14g: beheerder van A kon een logregel voor fonds B inserten (cross-tenant).';
  end if;
  -- (b) Actor-spoofing: beheerder A → logregel op naam van collega (uuid B-beheerder).
  begin
    insert into public.fonds_stuurinfo_log
      (fonds_id, periode, tabel, veld_key, nieuwe_waarde, gebruiker_id, gebruiker_naam)
    values ('41111111-1111-1111-1111-111111111111', '2026Q1', 'kpi', 'nep',
            '{"waarde":1}'::jsonb, '4ccccccc-cccc-cccc-cccc-cccccccccccc', 'B Beheerder');
    gelukt := true;
  exception when insufficient_privilege then
    gelukt := false;
  end;
  if gelukt then
    raise exception 'LEK T14g: beheerder kon een logregel op andermans naam inserten (actor-spoofing).';
  end if;
  raise notice 'OK T14g-1: cross-tenant en gespoofte log-inserts geweigerd (WITH CHECK).';
end $$;

set local request.jwt.claim.sub to '4bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

do $$
declare gelukt boolean := false;
begin
  -- (c) Rolgate: bestuurder → directe logregel voor het eigen fonds.
  begin
    insert into public.fonds_stuurinfo_log
      (fonds_id, periode, tabel, veld_key, nieuwe_waarde, gebruiker_id)
    values ('41111111-1111-1111-1111-111111111111', '2026Q1', 'kpi', 'nep',
            '{"waarde":1}'::jsonb, '4bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    gelukt := true;
  exception when insufficient_privilege then
    gelukt := false;
  end;
  if gelukt then
    raise exception 'LEK T14g: bestuurder kon direct een logregel inserten (rolgate geschonden).';
  end if;
  raise notice 'OK T14g-2: directe log-insert geweigerd voor niet-privileged bestuurder.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T14d — RPC-rolgate: bestuurder → weigering; beheerder slaagt consistent.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claim.sub to '4bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

do $$
declare gelukt boolean := false;
begin
  begin
    perform public.stuurinfo_balans_opslaan(
      '2026Q2', date '2026-06-30', 'handmatig', 'handmatig',
      '{"belegd":2400,"overig":80}'::jsonb,
      '{"ev_toets_mvev":10,"ev_toets_oper":9,"ev_toets_overig":2,"ev_soli":78,"ev_comp":41,"tv":2328,"vuk":8,"overig":4}'::jsonb,
      '[{"reserve_key":"solidariteitsreserve","label":"Solidariteitsreserve","stand":78,"pct_waarde":3.4,"ondergrens":1.5,"bovengrens":5.0,"volgorde":1},
        {"reserve_key":"mvev_reserve","label":"MVEV-reserve","stand":10,"pct_waarde":0.4,"ondergrens":null,"bovengrens":null,"volgorde":2},
        {"reserve_key":"operationele_reserve","label":"Operationele reserve","stand":9,"pct_waarde":0.4,"ondergrens":null,"bovengrens":null,"volgorde":3},
        {"reserve_key":"kostenreserve","label":"Kostenreserve","stand":40,"pct_waarde":1.7,"ondergrens":null,"bovengrens":null,"volgorde":4},
        {"reserve_key":"ao_reserve","label":"AO-reserve","stand":19,"pct_waarde":0.8,"ondergrens":null,"bovengrens":null,"volgorde":5},
        {"reserve_key":"ppwzp_reserve","label":"PP/Wzp-reserve","stand":7,"pct_waarde":0.3,"ondergrens":null,"bovengrens":null,"volgorde":6},
        {"reserve_key":"ppwzp_reserve_eerbiedigend","label":"PP/Wzp-reserve eerbiedigend","stand":0.1,"pct_waarde":0,"ondergrens":null,"bovengrens":null,"volgorde":7},
        {"reserve_key":"compensatiedepot","label":"Compensatiedepot","stand":41,"pct_waarde":1.8,"ondergrens":null,"bovengrens":null,"volgorde":8}]'::jsonb,
      106.0);
    gelukt := true;
  exception when insufficient_privilege then
    gelukt := false; -- verwacht: RLS-rolgate weigert de eerste insert
  end;
  if gelukt then
    raise exception 'LEK T14d: BESTUURDER kon via de RPC stuurinfo schrijven (rolgate geschonden).';
  end if;
  raise notice 'OK T14d-1: RPC geweigerd voor niet-privileged bestuurder (RLS-rolgate).';
end $$;

set local request.jwt.claim.sub to '4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

do $$
declare n_reeks int; n_res int; n_kpi int; n_per int; n_log int; v_soli numeric; v_ev numeric;
begin
  perform public.stuurinfo_balans_opslaan(
    '2026Q2', date '2026-06-30', 'handmatig', 'handmatig',
    '{"belegd":2400,"overig":80}'::jsonb,
    '{"ev_toets_mvev":10,"ev_toets_oper":9,"ev_toets_overig":2,"ev_soli":78,"ev_comp":41,"tv":2328,"vuk":8,"overig":4}'::jsonb,
    '[{"reserve_key":"solidariteitsreserve","label":"Solidariteitsreserve","stand":78,"pct_waarde":3.4,"ondergrens":1.5,"bovengrens":5.0,"volgorde":1},
      {"reserve_key":"mvev_reserve","label":"MVEV-reserve","stand":10,"pct_waarde":0.4,"ondergrens":null,"bovengrens":null,"volgorde":2},
      {"reserve_key":"operationele_reserve","label":"Operationele reserve","stand":9,"pct_waarde":0.4,"ondergrens":null,"bovengrens":null,"volgorde":3},
      {"reserve_key":"kostenreserve","label":"Kostenreserve","stand":40,"pct_waarde":1.7,"ondergrens":null,"bovengrens":null,"volgorde":4},
      {"reserve_key":"ao_reserve","label":"AO-reserve","stand":19,"pct_waarde":0.8,"ondergrens":null,"bovengrens":null,"volgorde":5},
      {"reserve_key":"ppwzp_reserve","label":"PP/Wzp-reserve","stand":7,"pct_waarde":0.3,"ondergrens":null,"bovengrens":null,"volgorde":6},
      {"reserve_key":"ppwzp_reserve_eerbiedigend","label":"PP/Wzp-reserve eerbiedigend","stand":0.1,"pct_waarde":0,"ondergrens":null,"bovengrens":null,"volgorde":7},
      {"reserve_key":"compensatiedepot","label":"Compensatiedepot","stand":41,"pct_waarde":1.8,"ondergrens":null,"bovengrens":null,"volgorde":8}]'::jsonb,
    106.0);

  select count(*) into n_reeks from public.fonds_stuurinfo_reeks
   where fonds_id = '41111111-1111-1111-1111-111111111111' and periode = '2026Q2';
  select count(*) into n_res from public.fonds_stuurinfo_reserve
   where fonds_id = '41111111-1111-1111-1111-111111111111' and periode = '2026Q2';
  select count(*) into n_kpi from public.fonds_stuurinfo_kpi
   where fonds_id = '41111111-1111-1111-1111-111111111111' and periode = '2026Q2';
  select count(*) into n_per from public.fonds_stuurinfo_periode
   where fonds_id = '41111111-1111-1111-1111-111111111111' and periode = '2026Q2';
  if n_reeks <> 10 or n_res <> 8 or n_kpi <> 1 or n_per <> 1 then
    raise exception 'REGRESSIE T14d: RPC-save incompleet (reeks=%, reserve=%, kpi=%, periode=%).',
      n_reeks, n_res, n_kpi, n_per;
  end if;

  -- Eén bron per bedrag: reserve-stand soli == balanswaarde ev_soli.
  select stand into v_soli from public.fonds_stuurinfo_reserve
   where fonds_id = '41111111-1111-1111-1111-111111111111' and periode = '2026Q2'
     and reserve_key = 'solidariteitsreserve';
  select waarde into v_ev from public.fonds_stuurinfo_reeks
   where fonds_id = '41111111-1111-1111-1111-111111111111' and periode = '2026Q2'
     and reeks_key = 'balans_passiva' and punt_key = 'ev_soli';
  if v_soli is distinct from v_ev then
    raise exception 'REGRESSIE T14d: reserve↔reeks-desync (soli reserve=%, balans=%).', v_soli, v_ev;
  end if;

  -- Elke RPC-write gelogd met actor + bron.
  select count(*) into n_log from public.fonds_stuurinfo_log
   where fonds_id = '41111111-1111-1111-1111-111111111111' and periode = '2026Q2'
     and gebruiker_id = '4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and invoer_bron = 'handmatig';
  if n_log < 20 then
    raise exception 'REGRESSIE T14d: verwacht >= 20 logregels (registry+10 reeks+8 reserve+kpi), gevonden %.', n_log;
  end if;
  raise notice 'OK T14d-2: RPC-save compleet + consistent (reeks/reserve/kpi/registry) + volledig gelogd.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T14e — RPC kent geen fonds-parameter en raakte fonds B niet.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare args text; n int;
begin
  select pg_get_function_arguments(oid) into args
    from pg_proc where proname = 'stuurinfo_balans_opslaan';
  if args is null then
    raise exception 'REGRESSIE T14e: RPC stuurinfo_balans_opslaan bestaat niet.';
  end if;
  if args ilike '%fonds%' then
    raise exception 'LEK T14e: RPC heeft een fonds-parameter (%) — fonds_id moet uit auth.uid() komen.', args;
  end if;
  raise notice 'OK T14e-1: RPC heeft geen fonds-parameter (fonds volgt auth.uid()).';
end $$;

reset role;

do $$
declare n int;
begin
  -- Als eigenaar (ziet alles): fonds B heeft nog exact de seed-rijen.
  select count(*) into n from public.fonds_stuurinfo_reserve
   where fonds_id = '42222222-2222-2222-2222-222222222222';
  if n <> 1 then
    raise exception 'LEK T14e: fonds B heeft % reserve-rij(en) — de RPC-run van A raakte fonds B.', n;
  end if;
  raise notice 'OK T14e-2: de RPC-save van fonds A raakte fonds B niet.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T14f — RPC-validaties: balansevenwicht + gekoppelde standen (DB-niveau).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claim.sub to '4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

do $$
declare gelukt boolean := false; melding text;
begin
  begin
    perform public.stuurinfo_balans_opslaan(
      '2026Q2', date '2026-06-30', 'handmatig', 'handmatig',
      '{"belegd":2401,"overig":80}'::jsonb,  -- activa 2481 vs passiva 2480
      '{"ev_toets_mvev":10,"ev_toets_oper":9,"ev_toets_overig":2,"ev_soli":78,"ev_comp":41,"tv":2328,"vuk":8,"overig":4}'::jsonb,
      '[{"reserve_key":"solidariteitsreserve","label":"Solidariteitsreserve","stand":78,"pct_waarde":3.4,"ondergrens":1.5,"bovengrens":5.0,"volgorde":1},
        {"reserve_key":"mvev_reserve","label":"MVEV-reserve","stand":10,"pct_waarde":0.4,"ondergrens":null,"bovengrens":null,"volgorde":2},
        {"reserve_key":"operationele_reserve","label":"Operationele reserve","stand":9,"pct_waarde":0.4,"ondergrens":null,"bovengrens":null,"volgorde":3},
        {"reserve_key":"kostenreserve","label":"Kostenreserve","stand":40,"pct_waarde":1.7,"ondergrens":null,"bovengrens":null,"volgorde":4},
        {"reserve_key":"ao_reserve","label":"AO-reserve","stand":19,"pct_waarde":0.8,"ondergrens":null,"bovengrens":null,"volgorde":5},
        {"reserve_key":"ppwzp_reserve","label":"PP/Wzp-reserve","stand":7,"pct_waarde":0.3,"ondergrens":null,"bovengrens":null,"volgorde":6},
        {"reserve_key":"ppwzp_reserve_eerbiedigend","label":"PP/Wzp-reserve eerbiedigend","stand":0.1,"pct_waarde":0,"ondergrens":null,"bovengrens":null,"volgorde":7},
        {"reserve_key":"compensatiedepot","label":"Compensatiedepot","stand":41,"pct_waarde":1.8,"ondergrens":null,"bovengrens":null,"volgorde":8}]'::jsonb,
      106.0);
    gelukt := true;
  exception when others then
    gelukt := false;
    melding := sqlerrm;
  end;
  if gelukt or melding not like '%BALANS_SLUIT_NIET%' then
    raise exception 'LEK T14f: RPC accepteerde een niet-sluitende balans (melding=%).', coalesce(melding, '—');
  end if;
  raise notice 'OK T14f-1: niet-sluitende balans → BALANS_SLUIT_NIET (DB-niveau).';
end $$;

do $$
declare gelukt boolean := false; melding text;
begin
  begin
    perform public.stuurinfo_balans_opslaan(
      '2026Q2', date '2026-06-30', 'handmatig', 'handmatig',
      '{"belegd":2400,"overig":80}'::jsonb,
      '{"ev_toets_mvev":10,"ev_toets_oper":9,"ev_toets_overig":2,"ev_soli":78,"ev_comp":41,"tv":2328,"vuk":8,"overig":4}'::jsonb,
      -- soli-stand 79 wijkt af van balans (78) → één-bron-per-bedrag geschonden
      '[{"reserve_key":"solidariteitsreserve","label":"Solidariteitsreserve","stand":79,"pct_waarde":3.4,"ondergrens":1.5,"bovengrens":5.0,"volgorde":1},
        {"reserve_key":"mvev_reserve","label":"MVEV-reserve","stand":10,"pct_waarde":0.4,"ondergrens":null,"bovengrens":null,"volgorde":2},
        {"reserve_key":"operationele_reserve","label":"Operationele reserve","stand":9,"pct_waarde":0.4,"ondergrens":null,"bovengrens":null,"volgorde":3},
        {"reserve_key":"kostenreserve","label":"Kostenreserve","stand":40,"pct_waarde":1.7,"ondergrens":null,"bovengrens":null,"volgorde":4},
        {"reserve_key":"ao_reserve","label":"AO-reserve","stand":19,"pct_waarde":0.8,"ondergrens":null,"bovengrens":null,"volgorde":5},
        {"reserve_key":"ppwzp_reserve","label":"PP/Wzp-reserve","stand":7,"pct_waarde":0.3,"ondergrens":null,"bovengrens":null,"volgorde":6},
        {"reserve_key":"ppwzp_reserve_eerbiedigend","label":"PP/Wzp-reserve eerbiedigend","stand":0.1,"pct_waarde":0,"ondergrens":null,"bovengrens":null,"volgorde":7},
        {"reserve_key":"compensatiedepot","label":"Compensatiedepot","stand":41,"pct_waarde":1.8,"ondergrens":null,"bovengrens":null,"volgorde":8}]'::jsonb,
      106.0);
    gelukt := true;
  exception when others then
    gelukt := false;
    melding := sqlerrm;
  end;
  if gelukt or melding not like '%GEKOPPELDE_STAND_ONGELIJK%' then
    raise exception 'LEK T14f: RPC accepteerde een afwijkende gekoppelde stand (melding=%).', coalesce(melding, '—');
  end if;
  raise notice 'OK T14f-2: afwijkende gekoppelde reservestand → GEKOPPELDE_STAND_ONGELIJK (DB-niveau).';
end $$;

do $$
declare gelukt boolean := false; melding text;
begin
  -- (T14b) JSON-null passeerde de som-check stil (sum() negeert null) —
  -- de waarde-typecheck moet dit hard weigeren.
  begin
    perform public.stuurinfo_balans_opslaan(
      '2026Q2', date '2026-06-30', 'handmatig', 'handmatig',
      '{"belegd":null,"overig":2480}'::jsonb,
      '{"ev_toets_mvev":10,"ev_toets_oper":9,"ev_toets_overig":2,"ev_soli":78,"ev_comp":41,"tv":2328,"vuk":8,"overig":4}'::jsonb,
      '[{"reserve_key":"solidariteitsreserve","label":"Solidariteitsreserve","stand":78,"pct_waarde":3.4,"ondergrens":1.5,"bovengrens":5.0,"volgorde":1},
        {"reserve_key":"mvev_reserve","label":"MVEV-reserve","stand":10,"pct_waarde":0.4,"ondergrens":null,"bovengrens":null,"volgorde":2},
        {"reserve_key":"operationele_reserve","label":"Operationele reserve","stand":9,"pct_waarde":0.4,"ondergrens":null,"bovengrens":null,"volgorde":3},
        {"reserve_key":"kostenreserve","label":"Kostenreserve","stand":40,"pct_waarde":1.7,"ondergrens":null,"bovengrens":null,"volgorde":4},
        {"reserve_key":"ao_reserve","label":"AO-reserve","stand":19,"pct_waarde":0.8,"ondergrens":null,"bovengrens":null,"volgorde":5},
        {"reserve_key":"ppwzp_reserve","label":"PP/Wzp-reserve","stand":7,"pct_waarde":0.3,"ondergrens":null,"bovengrens":null,"volgorde":6},
        {"reserve_key":"ppwzp_reserve_eerbiedigend","label":"PP/Wzp-reserve eerbiedigend","stand":0.1,"pct_waarde":0,"ondergrens":null,"bovengrens":null,"volgorde":7},
        {"reserve_key":"compensatiedepot","label":"Compensatiedepot","stand":41,"pct_waarde":1.8,"ondergrens":null,"bovengrens":null,"volgorde":8}]'::jsonb,
      106.0);
    gelukt := true;
  exception when others then
    gelukt := false;
    melding := sqlerrm;
  end;
  if gelukt or melding not like '%ONGELDIGE_WAARDE%' then
    raise exception 'LEK T14f: RPC accepteerde een JSON-null-balanswaarde (melding=%).', coalesce(melding, '—');
  end if;
  raise notice 'OK T14f-3: JSON-null-balanswaarde → ONGELDIGE_WAARDE (T14b-typecheck).';
end $$;

reset role;

rollback;

-- ============================================================================
-- Alles geslaagd als psql exit 0 gaf en je de "OK …"-notices zag (T14a–T14g).
-- Elke "LEK:"/"REGRESSIE" doet raise exception → non-zero exit → CI faalt.
-- Vereist dat óók 2026_07_17_t14b_stuurinfo_audit_hardening.sql is toegepast
-- (volledige kolomdekking, actor-check, ONGELDIGE_WAARDE).
-- ============================================================================
