-- ============================================================================
--  Gedragssuite AI-begrenzing (besluit 0180) — hoort bij
--  supabase/migrations/2026_08_16_ai_begrenzing.sql en …_rpc.sql.
--
--  WAT DEZE SUITE BEWIJST
--    DEEL 1 — STRUCTUUR: deny-by-default, append-only, kolomvries, gate E/H.
--    DEEL 2 — GEDRAG:    de acceptatiematrix uit het werkticket §8, voor zover
--                        in de database te bewijzen:
--                          * één actie reserveert precies één keer op gebruiker,
--                            fonds én globaal;
--                          * idempotentie: geen dubbele reservering, en een
--                            duplicaat komt NIET voorbij de preflight;
--                          * een sleutel hergebruiken met andere inhoud wordt
--                            geweigerd (geen quotum-bypass);
--                          * gebruiker op quotum blokkeert, fondsgenoot niet;
--                          * fonds op quotum blokkeert, ander fonds niet;
--                          * platformquotum blokkeert alles;
--                          * OCR heeft een eigen quotum en raakt de rest niet;
--                          * kill switch blokkeert nieuwe calls, ook de poort;
--                          * model buiten de allowlist of buiten zijn venster;
--                          * vier ogen: zelfgoedkeuring onmogelijk, ook buiten
--                            de UI om; intrekken door de aanvrager mag wél;
--                          * compare-and-swap: een quotumwijziging tussen
--                            aanvraag en goedkeuring maakt de aanvraag ongeldig;
--                          * een gespooft fonds-id komt nergens.
--
--  NIET hier te bewijzen (staat elders):
--    * Race-veiligheid vergt twee ECHT gelijktijdige verbindingen — twee sessies
--      binnen één transactieblok serialiseren per definitie en bewijzen niets.
--      Zie scripts/ai-quota-race.sh.
--    * De applicatiepoort en het foutcontract: core/lib/ai-poort.sanity.ts en
--      tests/cross-tenant/ai-poort.test.ts.
--
--  Zelf-seedend en volledig terugdraaiend: DEEL 2 draait in één transactie die
--  eindigt op `rollback`. Er blijft niets achter.
--
--  Draaien:  psql "$DB" -v ON_ERROR_STOP=1 -f supabase/checks/2026_08_16_ai_begrenzing.sql
--  psql exit 0 + de "OK #"-notices = groen; elke "LEK:"/"FAALT" → raise → non-zero exit.
-- ============================================================================

\echo '== DEEL 1 — STRUCTUUR =='

-- 1a. Alle acht tabellen: RLS aan, geen policy, anon/authenticated buiten.
do $$
declare
  t text;
  tabellen text[] := array[
    'ai_config_versie','ai_quota_config','ai_model_allowlist','ai_kill_switch',
    'ai_heractivering_verzoek','ai_heractivering_besluit','ai_actie','ai_verbruik_log'
  ];
  fouten text := '';
begin
  foreach t in array tabellen loop
    if not exists (select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
                    where ns.nspname='public' and c.relname=t and c.relrowsecurity) then
      fouten := fouten || format('  - %s: RLS staat uit%s', t, chr(10));
    end if;
    if exists (select 1 from pg_policies where schemaname='public' and tablename=t) then
      fouten := fouten || format('  - %s: draagt een policy (verwacht deny-by-default)%s', t, chr(10));
    end if;
    if has_table_privilege('anon','public.'||t,'SELECT')
       or has_table_privilege('authenticated','public.'||t,'SELECT') then
      fouten := fouten || format('  - %s: anon/authenticated kan lezen%s', t, chr(10));
    end if;
  end loop;
  if fouten <> '' then raise exception E'FAALT #1a:\n%', fouten; end if;
  raise notice 'OK #1a: acht tabellen deny-by-default, geen tenanttoegang.';
end $$;

-- 1b. Append-only ook in de GRANTS, niet alleen via een trigger.
do $$
declare
  t text;
  fouten text := '';
begin
  foreach t in array array['ai_verbruik_log','ai_heractivering_verzoek','ai_heractivering_besluit'] loop
    if has_table_privilege('service_role','public.'||t,'UPDATE')
       or has_table_privilege('service_role','public.'||t,'DELETE') then
      fouten := fouten || format('  - %s: service_role kan muteren%s', t, chr(10));
    end if;
    if not exists (select 1 from pg_trigger tg join pg_class c on c.oid=tg.tgrelid
                    where c.relname=t and tg.tgname='trg_'||t||'_no_update' and not tg.tgisinternal) then
      fouten := fouten || format('  - %s: mist de append-only-trigger%s', t, chr(10));
    end if;
  end loop;
  if fouten <> '' then raise exception E'FAALT #1b:\n%', fouten; end if;
  raise notice 'OK #1b: append-only afgedwongen via zowel grants als triggers.';
end $$;

-- 1c. Gate E en gate H op alle AI-functies.
do $$
declare
  r record;
  fouten text := '';
begin
  for r in
    select p.oid, p.proname, p.proconfig, p.prosecdef
      from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
     where ns.nspname='public' and p.proname like 'fn\_ai\_%'
  loop
    if r.prosecdef and (r.proconfig is null or not exists (
         select 1 from unnest(r.proconfig) c where c like 'search_path=%')) then
      fouten := fouten || format('  - %s: SECURITY DEFINER zonder vast search_path (gate E)%s', r.proname, chr(10));
    end if;
    if has_function_privilege('anon', r.oid, 'EXECUTE') then
      fouten := fouten || format('  - %s: anon heeft EXECUTE (gate H)%s', r.proname, chr(10));
    end if;
  end loop;
  if fouten <> '' then raise exception E'FAALT #1c:\n%', fouten; end if;
  raise notice 'OK #1c: gate E en gate H schoon op alle fn_ai_*-functies.';
end $$;

-- 1d. De actietype-tabel in SQL is identiek aan core/lib/ai-quota-kern.ts.
--     Loopt die uit de pas, dan meet de DB iets anders dan de UI toont.
do $$
declare
  v_verwacht text[] := array[
    'afschrift_concept','agendapunt_voorbereiding','aqlab_adhoc','aqlab_run',
    'besluit_concept','chat','document_ingest','embeddings_backfill',
    'generiek_curatie','notulen_bevestig','ocr','ocr_generiek','reindex_backfill','vergelijken'
  ];
  t text;
  fouten text := '';
begin
  foreach t in array v_verwacht loop
    if not exists (select 1 from public.fn_ai_actietype_spec(t)) then
      fouten := fouten || format('  - actietype %s ontbreekt in de SQL-spec%s', t, chr(10));
    end if;
  end loop;
  -- Onbekend type mag NOOIT een spec opleveren.
  if exists (select 1 from public.fn_ai_actietype_spec('gratis_tokens')) then
    fouten := fouten || '  - een onbekend actietype levert een spec op (fail-open!)' || chr(10);
  end if;
  -- OCR verbruikt nul AI-acties; de platformbrede types dragen geen fonds.
  if (select ai_acties from public.fn_ai_actietype_spec('ocr')) <> 0 then
    fouten := fouten || '  - ocr verbruikt een AI-actie (moet 0 zijn)' || chr(10);
  end if;
  if (select bereik from public.fn_ai_actietype_spec('generiek_curatie')) <> 'globaal' then
    fouten := fouten || '  - generiek_curatie is niet globaal' || chr(10);
  end if;
  if (select via_gebruiker from public.fn_ai_actietype_spec('document_ingest')) then
    fouten := fouten || '  - document_ingest is vanuit een sessie aanroepbaar' || chr(10);
  end if;
  if fouten <> '' then raise exception E'FAALT #1d:\n%', fouten; end if;
  raise notice 'OK #1d: actietype-spec compleet en fail-closed.';
end $$;

\echo '== DEEL 2 — GEDRAG =='

begin;

-- ── Seed ────────────────────────────────────────────────────────────────────
-- Twee fondsen, drie bestuurders (twee in fonds A, één in fonds B) en twee
-- platformbeheerders. Vaste UUID's conform het huisidioom.
insert into public.fondsen (id, naam, slug) values
  ('a1111111-1111-1111-1111-111111111111','Testfonds A','xtest-a'),
  ('a2222222-2222-2222-2222-222222222222','Testfonds B','xtest-b');

insert into auth.users (id, email, raw_user_meta_data) values
  ('b1111111-1111-1111-1111-111111111111','xtest-a1@example.invalid',
     jsonb_build_object('naam','A1','fonds_id','a1111111-1111-1111-1111-111111111111')),
  ('b2222222-2222-2222-2222-222222222222','xtest-a2@example.invalid',
     jsonb_build_object('naam','A2','fonds_id','a1111111-1111-1111-1111-111111111111')),
  ('b3333333-3333-3333-3333-333333333333','xtest-b1@example.invalid',
     jsonb_build_object('naam','B1','fonds_id','a2222222-2222-2222-2222-222222222222'));

-- Robuust in beide werelden: waar een auth-trigger het profiel al aanmaakt,
-- lijnt de upsert het fonds uit; waar die trigger ontbreekt, maakt hij het aan.
insert into public.profielen (id, naam, rol, fonds_id) values
  ('b1111111-1111-1111-1111-111111111111','A1','bestuurder','a1111111-1111-1111-1111-111111111111'),
  ('b2222222-2222-2222-2222-222222222222','A2','bestuurder','a1111111-1111-1111-1111-111111111111'),
  ('b3333333-3333-3333-3333-333333333333','B1','bestuurder','a2222222-2222-2222-2222-222222222222')
on conflict (id) do update set fonds_id = excluded.fonds_id, naam = excluded.naam;

insert into public.platform_identities (id, email, naam) values
  ('c1111111-1111-1111-1111-111111111111','xtest-merlin@example.invalid','Merlin test'),
  ('c2222222-2222-2222-2222-222222222222','xtest-robert@example.invalid','Robert test')
on conflict (id) do nothing;

-- Ruime quota als vertrekpunt; per test verlaagd waar nodig.
select public.fn_ai_quota_wijzigen('gebruiker_maand', 1000, 'c1111111-1111-1111-1111-111111111111');
select public.fn_ai_quota_wijzigen('fonds_maand',     2000, 'c1111111-1111-1111-1111-111111111111');
select public.fn_ai_quota_wijzigen('globaal_maand',   5000, 'c1111111-1111-1111-1111-111111111111');
select public.fn_ai_quota_wijzigen('ocr_fonds_maand', 1000, 'c1111111-1111-1111-1111-111111111111');

-- ── 2a. Eén actie telt precies één keer, op alle drie de niveaus ────────────
-- Alle tellercontroles meten een DELTA, nooit een absolute stand: deze suite
-- moet ook groen kunnen draaien tegen een omgeving waar al AI-verbruik in het
-- (append-only, dus onopruimbare) log staat.
do $$
declare
  v jsonb;
  v_maand date := (date_trunc('month',(now() at time zone 'UTC')))::date;
  v_gebr_voor int;
  v_fonds_voor int;
  v_glob_voor int;
begin
  select coalesce(sum(ai_acties),0) into v_gebr_voor from public.ai_verbruik_log
   where maand=v_maand and gebruiker_id='b1111111-1111-1111-1111-111111111111';
  select coalesce(sum(ai_acties),0) into v_fonds_voor from public.ai_verbruik_log
   where maand=v_maand and fonds_id='a1111111-1111-1111-1111-111111111111';
  select coalesce(sum(ai_acties),0) into v_glob_voor from public.ai_verbruik_log
   where maand=v_maand;

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111"}';
  v := public.fn_ai_preflight('chat','anthropic','claude-opus-4-8',0,'k-2a','vf-2a',false);
  reset role;

  if (v->>'toegestaan')::boolean is not true then
    raise exception 'FAALT #2a: normale actie geweigerd (%)', v->>'reden';
  end if;
  if (select coalesce(sum(ai_acties),0) from public.ai_verbruik_log
       where maand=v_maand and gebruiker_id='b1111111-1111-1111-1111-111111111111')
     <> v_gebr_voor + 1 then
    raise exception 'FAALT #2a: gebruikersteller nam niet met exact 1 toe';
  end if;
  if (select coalesce(sum(ai_acties),0) from public.ai_verbruik_log
       where maand=v_maand and fonds_id='a1111111-1111-1111-1111-111111111111')
     <> v_fonds_voor + 1 then
    raise exception 'FAALT #2a: fondsteller nam niet met exact 1 toe';
  end if;
  if (select coalesce(sum(ai_acties),0) from public.ai_verbruik_log where maand=v_maand)
     <> v_glob_voor + 1 then
    raise exception 'FAALT #2a: globale teller nam niet met exact 1 toe';
  end if;
  raise notice 'OK #2a: één actie, exact één reservering op gebruiker, fonds en globaal.';
end $$;

-- ── 2b. Idempotentie: duplicaat komt niet voorbij de preflight ──────────────
do $$
declare
  v jsonb;
begin
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111"}';
  v := public.fn_ai_preflight('chat','anthropic','claude-opus-4-8',0,'k-2a','vf-2a',false);
  reset role;

  if (v->>'toegestaan')::boolean is not false or v->>'uitkomst' <> 'duplicaat_in_uitvoering' then
    raise exception 'FAALT #2b: herhaald verzoek werd niet als duplicaat herkend (%)', v;
  end if;
  if (select count(*) from public.ai_verbruik_log
       where actietype='chat' and gebruiker_id='b1111111-1111-1111-1111-111111111111') <> 1 then
    raise exception 'FAALT #2b: het duplicaat heeft tóch gereserveerd';
  end if;
  raise notice 'OK #2b: duplicaat geweigerd, geen tweede reservering, geen providercall.';
end $$;

-- ── 2c. Sleutelhergebruik met andere inhoud = geen bypass ───────────────────
do $$
declare
  v jsonb;
begin
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111"}';
  v := public.fn_ai_preflight('chat','anthropic','claude-opus-4-8',0,'k-2a','ANDERE-vingerafdruk',false);
  reset role;

  if v->>'uitkomst' <> 'sleutel_conflict' then
    raise exception 'FAALT #2c: hergebruikte sleutel met andere inhoud werd niet geweigerd (%)', v;
  end if;
  raise notice 'OK #2c: sleutelhergebruik met andere inhoud geweigerd.';
end $$;

-- ── 2d. Afronden, daarna levert hetzelfde verzoek het vastgelegde resultaat ─
do $$
declare
  v jsonb;
  v_actie uuid;
begin
  select id into v_actie from public.ai_actie where idempotentie_sleutel='k-2a';
  perform public.fn_ai_actie_afronden(v_actie,'voltooid','gesprek:123');

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111"}';
  v := public.fn_ai_preflight('chat','anthropic','claude-opus-4-8',0,'k-2a','vf-2a',false);
  reset role;

  if v->>'uitkomst' <> 'duplicaat_voltooid' or v->>'resultaat_ref' <> 'gesprek:123' then
    raise exception 'FAALT #2d: voltooid duplicaat gaf niet het vastgelegde resultaat (%)', v;
  end if;
  raise notice 'OK #2d: voltooid duplicaat hergebruikt het resultaat zonder providercall.';
end $$;

-- ── 2e. Gebruiker op quotum; fondsgenoot kan door ──────────────────────────
do $$
declare
  v jsonb;
  v_n int;
begin
  -- Zet het gebruikersquotum PRECIES op de huidige stand van deze gebruiker:
  -- hij zit dan exact aan zijn grens, ongeacht wat er al in het log stond.
  select coalesce(sum(ai_acties),0) into v_n from public.ai_verbruik_log
   where maand=(date_trunc('month',(now() at time zone 'UTC')))::date
     and gebruiker_id='b1111111-1111-1111-1111-111111111111';
  perform public.fn_ai_quota_wijzigen('gebruiker_maand', v_n, 'c1111111-1111-1111-1111-111111111111');

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111"}';
  v := public.fn_ai_preflight('chat','anthropic','claude-opus-4-8',0,'k-2e','vf',false);
  reset role;
  if v->>'reden' <> 'quotum_gebruiker' then
    raise exception 'FAALT #2e: gebruiker op quotum werd niet geblokkeerd (%)', v;
  end if;
  if (v->>'reset_seconden')::int <= 0 then
    raise exception 'FAALT #2e: geen bruikbare Retry-After meegegeven';
  end if;

  -- Fondsgenoot met eigen tegoed moet gewoon door kunnen.
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b2222222-2222-2222-2222-222222222222"}';
  v := public.fn_ai_preflight('chat','anthropic','claude-opus-4-8',0,'k-2e2','vf',false);
  reset role;
  if (v->>'toegestaan')::boolean is not true then
    raise exception 'FAALT #2e: fondsgenoot ten onrechte geblokkeerd (%)', v->>'reden';
  end if;

  perform public.fn_ai_quota_wijzigen('gebruiker_maand', 1000, 'c1111111-1111-1111-1111-111111111111');
  raise notice 'OK #2e: gebruikersquotum blokkeert alleen die gebruiker.';
end $$;

-- ── 2f. Fonds op quotum; ander fonds kan door ──────────────────────────────
do $$
declare
  v jsonb;
  v_n int;
begin
  select coalesce(sum(ai_acties),0) into v_n from public.ai_verbruik_log
   where maand=(date_trunc('month',(now() at time zone 'UTC')))::date
     and fonds_id='a1111111-1111-1111-1111-111111111111';
  perform public.fn_ai_quota_wijzigen('fonds_maand', v_n, 'c1111111-1111-1111-1111-111111111111');

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111"}';
  v := public.fn_ai_preflight('chat','anthropic','claude-opus-4-8',0,'k-2f','vf',false);
  reset role;
  if v->>'reden' <> 'quotum_fonds' then
    raise exception 'FAALT #2f: fonds op quotum werd niet geblokkeerd (%)', v;
  end if;

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b3333333-3333-3333-3333-333333333333"}';
  v := public.fn_ai_preflight('chat','anthropic','claude-opus-4-8',0,'k-2f2','vf',false);
  reset role;
  if (v->>'toegestaan')::boolean is not true then
    raise exception 'FAALT #2f: het andere fonds werd meegetrokken (%)', v->>'reden';
  end if;

  perform public.fn_ai_quota_wijzigen('fonds_maand', 2000, 'c1111111-1111-1111-1111-111111111111');
  raise notice 'OK #2f: fondsquotum blokkeert alleen dat fonds.';
end $$;

-- ── 2g. Platformquotum blokkeert alles ─────────────────────────────────────
do $$
declare
  v jsonb;
  v_n int;
begin
  select coalesce(sum(ai_acties),0) into v_n from public.ai_verbruik_log
   where maand=(date_trunc('month',(now() at time zone 'UTC')))::date;
  perform public.fn_ai_quota_wijzigen('globaal_maand', v_n, 'c1111111-1111-1111-1111-111111111111');

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b3333333-3333-3333-3333-333333333333"}';
  v := public.fn_ai_preflight('chat','anthropic','claude-opus-4-8',0,'k-2g','vf',false);
  reset role;
  if v->>'reden' <> 'quotum_globaal' then
    raise exception 'FAALT #2g: platformquotum blokkeerde niet (%)', v;
  end if;

  perform public.fn_ai_quota_wijzigen('globaal_maand', 5000, 'c1111111-1111-1111-1111-111111111111');
  raise notice 'OK #2g: platformquotum blokkeert elk fonds.';
end $$;

-- ── 2h. OCR is een eigen grootheid ─────────────────────────────────────────
do $$
declare
  v jsonb;
  v_n int;
begin
  select coalesce(sum(ocr_paginas),0) into v_n from public.ai_verbruik_log
   where maand=(date_trunc('month',(now() at time zone 'UTC')))::date
     and fonds_id='a1111111-1111-1111-1111-111111111111';
  perform public.fn_ai_quota_wijzigen('ocr_fonds_maand', v_n + 10, 'c1111111-1111-1111-1111-111111111111');

  -- Binnen het paginaquotum: mag.
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111"}';
  v := public.fn_ai_preflight('ocr','mistral','mistral-ocr-latest',10,'k-2h','vf',false);
  reset role;
  if (v->>'toegestaan')::boolean is not true then
    raise exception 'FAALT #2h: OCR binnen het quotum geweigerd (%)', v->>'reden';
  end if;

  -- Eén pagina te veel: geblokkeerd.
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111"}';
  v := public.fn_ai_preflight('ocr','mistral','mistral-ocr-latest',1,'k-2h2','vf',false);
  reset role;
  if v->>'reden' <> 'quotum_ocr' then
    raise exception 'FAALT #2h: OCR over het quotum werd niet geblokkeerd (%)', v;
  end if;

  -- Niet-OCR blijft gewoon werken.
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111"}';
  v := public.fn_ai_preflight('chat','anthropic','claude-opus-4-8',0,'k-2h3','vf',false);
  reset role;
  if (v->>'toegestaan')::boolean is not true then
    raise exception 'FAALT #2h: een vol OCR-quotum blokkeerde ook de chat (%)', v->>'reden';
  end if;

  -- En OCR verbruikte geen AI-actie.
  if (select ai_acties from public.ai_verbruik_log where actietype='ocr' limit 1) <> 0 then
    raise exception 'FAALT #2h: OCR heeft een AI-actie verbruikt';
  end if;

  perform public.fn_ai_quota_wijzigen('ocr_fonds_maand', 1000, 'c1111111-1111-1111-1111-111111111111');
  raise notice 'OK #2h: OCR-quotum staat los van het AI-actiequotum.';
end $$;

-- ── 2i. Kill switch blokkeert nieuwe calls én de poort ─────────────────────
do $$
declare
  v jsonb;
begin
  perform public.fn_ai_switch_stoppen('anthropic','c1111111-1111-1111-1111-111111111111',
    'Kosten liepen sneller op dan verwacht.');

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111"}';
  v := public.fn_ai_preflight('chat','anthropic','claude-opus-4-8',0,'k-2i','vf',false);
  reset role;
  if v->>'reden' <> 'provider_gestopt' then
    raise exception 'FAALT #2i: gestopte provider liet een reservering door (%)', v;
  end if;

  -- De LIVE poort weigert eveneens — dat is de laag die een lopende
  -- meerstapsactie bij de volgende call stopt.
  v := public.fn_ai_poort_check('anthropic','claude-opus-4-8');
  if (v->>'toegestaan')::boolean is not false then
    raise exception 'FAALT #2i: de poort liet een gestopte provider door (%)', v;
  end if;

  -- Mistral is niet geraakt: alleen de gestopte provider ligt stil.
  v := public.fn_ai_poort_check('mistral','mistral-embed');
  if (v->>'toegestaan')::boolean is not true then
    raise exception 'FAALT #2i: een andere provider werd meegetrokken (%)', v;
  end if;
  raise notice 'OK #2i: providerstop blokkeert reservering én poort, zonder overslag.';
end $$;

-- ── 2j. Vier ogen: zelfgoedkeuring onmogelijk, intrekken mag ───────────────
do $$
declare
  v jsonb;
  v_verzoek uuid;
begin
  v := public.fn_ai_heractivering_aanvragen('anthropic','c1111111-1111-1111-1111-111111111111',
    'Verbruik is geanalyseerd en teruggebracht.');
  v_verzoek := (v->>'verzoek_id')::uuid;

  -- De schakelaar staat NIET aan tijdens een openstaand verzoek.
  if (select status from public.ai_kill_switch where sleutel='anthropic') <> 'heractivering_aangevraagd' then
    raise exception 'FAALT #2j: schakelaar staat niet op heractivering_aangevraagd';
  end if;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111"}';
  v := public.fn_ai_preflight('chat','anthropic','claude-opus-4-8',0,'k-2j','vf',false);
  reset role;
  if (v->>'toegestaan')::boolean is not false then
    raise exception 'FAALT #2j: een openstaand verzoek zette de kraan alvast open';
  end if;

  -- Zelfgoedkeuring via de RPC.
  begin
    perform public.fn_ai_heractivering_goedkeuren('anthropic','c1111111-1111-1111-1111-111111111111',null);
    raise exception 'LEK #2j: de aanvrager keurde zijn eigen verzoek goed via de RPC.';
  exception
    when check_violation then raise notice 'OK #2j-1: zelfgoedkeuring via de RPC geweigerd.';
  end;

  -- En BUITEN de RPC om, rechtstreeks in de tabel — dit is de eigenlijke eis:
  -- het vier-ogenprincipe mag niet van applicatiecode afhangen.
  begin
    insert into public.ai_heractivering_besluit
      (verzoek_id, aangevraagd_door, besluit, besloten_door)
    values (v_verzoek,'c1111111-1111-1111-1111-111111111111','goedgekeurd',
            'c1111111-1111-1111-1111-111111111111');
    raise exception 'LEK #2j: zelfgoedkeuring gelukt met een directe INSERT.';
  exception
    when check_violation then raise notice 'OK #2j-2: zelfgoedkeuring ook buiten de UI om geweigerd.';
  end;

  -- Een valse aanvrager verzinnen om de CHECK te omzeilen loopt vast op de
  -- composite-FK (denorm-lock).
  begin
    insert into public.ai_heractivering_besluit
      (verzoek_id, aangevraagd_door, besluit, besloten_door)
    values (v_verzoek,'c2222222-2222-2222-2222-222222222222','goedgekeurd',
            'c1111111-1111-1111-1111-111111111111');
    raise exception 'LEK #2j: een verzonnen aanvrager omzeilde de vier-ogencheck.';
  exception
    when foreign_key_violation then raise notice 'OK #2j-3: verzonnen aanvrager geblokkeerd door de denorm-lock.';
  end;
end $$;

-- ── 2k. Compare-and-swap: configuratiewijziging ongeldigt de aanvraag ──────
do $$
declare
  v jsonb;
begin
  -- Er staat nog een openstaand verzoek van 2j. Een QUOTUMWIJZIGING (dus geen
  -- nieuwe stop) moet de aanvraag al ongeldig maken — dat is precies waarom de
  -- CAS op de ALGEMENE configuratieversie loopt en niet op de switchversie.
  perform public.fn_ai_quota_wijzigen('fonds_maand', 1999, 'c1111111-1111-1111-1111-111111111111');

  begin
    perform public.fn_ai_heractivering_goedkeuren('anthropic','c2222222-2222-2222-2222-222222222222',null);
    raise exception 'LEK #2k: goedkeuring slaagde ondanks een tussentijdse configuratiewijziging.';
  exception
    when serialization_failure then raise notice 'OK #2k: configuratiewijziging maakt de aanvraag ongeldig.';
  end;
end $$;

-- ── 2l. Intrekken door de aanvrager mag; goedkeuring door de ander werkt ───
do $$
declare
  v jsonb;
begin
  -- Het verzoek uit 2j is niet meer goed te keuren; de aanvrager trekt het in.
  v := public.fn_ai_heractivering_intrekken('anthropic','c1111111-1111-1111-1111-111111111111');
  if v->>'status' <> 'gestopt' then
    raise exception 'FAALT #2l: intrekken bracht de schakelaar niet terug naar gestopt';
  end if;

  -- Een ander mag het verzoek van de aanvrager NIET intrekken (dat is afwijzen).
  v := public.fn_ai_heractivering_aanvragen('anthropic','c1111111-1111-1111-1111-111111111111',
    'Tweede poging na analyse van het verbruik.');
  begin
    perform public.fn_ai_heractivering_intrekken('anthropic','c2222222-2222-2222-2222-222222222222');
    raise exception 'LEK #2l: een ander trok het verzoek in.';
  exception
    when insufficient_privilege then raise notice 'OK #2l-1: alleen de aanvrager trekt zijn eigen verzoek in.';
  end;

  -- En nu het gelukkige pad: de tweede beheerder keurt goed.
  v := public.fn_ai_heractivering_goedkeuren('anthropic','c2222222-2222-2222-2222-222222222222',
    'Verbruik gecontroleerd, akkoord.');
  if v->>'status' <> 'actief' then
    raise exception 'FAALT #2l: goedkeuring door de tweede beheerder activeerde niet';
  end if;
  if (v->>'aangevraagd_door') = (v->>'goedgekeurd_door') then
    raise exception 'FAALT #2l: aanvrager en goedkeurder zijn dezelfde';
  end if;
  raise notice 'OK #2l-2: goedkeuring door een tweede beheerder activeert; beide actoren auditbaar.';
end $$;

-- ── 2m. Globale stop blokkeert alles ───────────────────────────────────────
do $$
declare
  v jsonb;
begin
  perform public.fn_ai_switch_stoppen('globaal','c1111111-1111-1111-1111-111111111111',
    'Platformbrede stop tijdens onderzoek.');

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b3333333-3333-3333-3333-333333333333"}';
  v := public.fn_ai_preflight('chat','anthropic','claude-opus-4-8',0,'k-2m','vf',false);
  reset role;
  if v->>'reden' <> 'globaal_gestopt' then
    raise exception 'FAALT #2m: globale stop liet een reservering door (%)', v;
  end if;

  v := public.fn_ai_poort_check('mistral','mistral-embed');
  if (v->>'toegestaan')::boolean is not false then
    raise exception 'FAALT #2m: globale stop liet de poort door voor mistral';
  end if;

  perform public.fn_ai_heractivering_aanvragen('globaal','c1111111-1111-1111-1111-111111111111','Onderzoek afgerond.');
  perform public.fn_ai_heractivering_goedkeuren('globaal','c2222222-2222-2222-2222-222222222222',null);
  raise notice 'OK #2m: globale stop blokkeert alle providers.';
end $$;

-- ── 2n. Model buiten de allowlist en buiten zijn venster ───────────────────
do $$
declare
  v jsonb;
begin
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111"}';
  v := public.fn_ai_preflight('chat','anthropic','claude-verzonnen-9',0,'k-2n','vf',false);
  reset role;
  if v->>'reden' <> 'model_niet_toegestaan' then
    raise exception 'FAALT #2n: een onbekend model werd toegelaten (%)', v;
  end if;

  -- Een AQLab-venster dat al voorbij is, geeft geen toegang meer — zonder dat
  -- er een beheerhandeling voor nodig was.
  perform public.fn_ai_allowlist_wijzigen('mistral','mistral-large-latest',true,
    now() - interval '2 hour', now() - interval '1 hour',
    'Intern AQLab-testvenster, inmiddels verstreken.','c1111111-1111-1111-1111-111111111111');

  v := public.fn_ai_poort_check('mistral','mistral-large-latest');
  if v->>'reden' <> 'model_buiten_venster' then
    raise exception 'FAALT #2n: een verstreken venster gaf nog toegang (%)', v;
  end if;

  -- Binnen het venster mag het wél.
  perform public.fn_ai_allowlist_wijzigen('mistral','mistral-large-latest',true,
    now() - interval '1 hour', now() + interval '1 hour',
    'Intern AQLab-testvenster, nu actief.','c1111111-1111-1111-1111-111111111111');
  v := public.fn_ai_poort_check('mistral','mistral-large-latest');
  if (v->>'toegestaan')::boolean is not true then
    raise exception 'FAALT #2n: binnen het venster werd het model geweigerd (%)', v;
  end if;
  raise notice 'OK #2n: allowlist en tijdvenster worden afgedwongen; expiratie is vanzelf.';
end $$;

-- ── 2o. fonds_id = null is geen bypass; systeempad is afgeschermd ──────────
do $$
declare
  v jsonb;
begin
  -- Een fondsgebonden actietype ZONDER fonds bestaat niet.
  v := public.fn_ai_preflight_systeem('document_ingest',null,'anthropic','claude-sonnet-4-5',0,'k-2o','vf',false);
  if v->>'reden' <> 'fonds_ontbreekt' then
    raise exception 'FAALT #2o: een fondsgebonden actie zonder fonds werd toegelaten (%)', v;
  end if;

  -- En andersom: een platformbreed actietype MET fonds evenmin — anders zou
  -- fondswerk stilzwijgend buiten het fondsquotum vallen.
  v := public.fn_ai_preflight_systeem('generiek_curatie','a1111111-1111-1111-1111-111111111111',
       'anthropic','claude-sonnet-4-5',0,'k-2o2','vf',false);
  if (v->>'toegestaan')::boolean is not false then
    raise exception 'FAALT #2o: een platformbreed actietype accepteerde een fonds (%)', v;
  end if;

  -- Een sessiegebonden actietype mag niet via het systeempad.
  v := public.fn_ai_preflight_systeem('chat','a1111111-1111-1111-1111-111111111111',
       'anthropic','claude-opus-4-8',0,'k-2o3','vf',false);
  if v->>'reden' <> 'actietype_niet_toegestaan_op_dit_pad' then
    raise exception 'FAALT #2o: chat was via het systeempad aanroepbaar (%)', v;
  end if;

  -- En een systeemactietype niet via een sessie.
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111"}';
  v := public.fn_ai_preflight('document_ingest','anthropic','claude-sonnet-4-5',0,'k-2o4','vf',false);
  reset role;
  if v->>'reden' <> 'actietype_niet_toegestaan_op_dit_pad' then
    raise exception 'FAALT #2o: document_ingest was vanuit een sessie aanroepbaar (%)', v;
  end if;
  raise notice 'OK #2o: fonds_id = null is geen bypass; de twee paden zijn gescheiden.';
end $$;

-- ── 2p. Een tenantsessie komt nergens rechtstreeks bij ─────────────────────
do $$
begin
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111"}';

  begin
    perform 1 from public.ai_verbruik_log limit 1;
    reset role;
    raise exception 'LEK #2p: authenticated kon het verbruikslog lezen.';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.fn_ai_preflight_systeem('document_ingest','a1111111-1111-1111-1111-111111111111',
      'anthropic','claude-sonnet-4-5',0,'k-2p','vf',false);
    reset role;
    raise exception 'LEK #2p: authenticated kon de systeem-preflight aanroepen.';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.fn_ai_switch_stoppen('globaal','c1111111-1111-1111-1111-111111111111','Poging vanuit een tenantsessie.');
    reset role;
    raise exception 'LEK #2p: authenticated kon de kill switch bedienen.';
  exception
    when insufficient_privilege then null;
  end;

  reset role;
  raise notice 'OK #2p: tenantsessie komt niet bij tellers, systeempad of beheer-RPC.';
end $$;

-- ── 2q. Vastgelopen actie blokkeert een nieuwe poging niet ─────────────────
do $$
declare
  v jsonb;
  v_voor int;
begin
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b2222222-2222-2222-2222-222222222222"}';
  v := public.fn_ai_preflight('chat','anthropic','claude-opus-4-8',0,'k-2q','vf-2q',false);
  reset role;

  -- Simuleer een crash: de lease is verstreken maar de actie staat nog open.
  -- (verloopt_op is bevroren; we verzetten de klok niet, dus we schrijven een
  --  tweede rij met een lease in het verleden via de reguliere weg is niet
  --  mogelijk — daarom toetsen we de opruimstap rechtstreeks.)
  update public.ai_actie set status = 'verlopen'
   where idempotentie_sleutel = 'k-2q';

  select count(*) into v_voor from public.ai_verbruik_log where actietype='chat';

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b2222222-2222-2222-2222-222222222222"}';
  v := public.fn_ai_preflight('chat','anthropic','claude-opus-4-8',0,'k-2q','vf-2q',false);
  reset role;

  if (v->>'toegestaan')::boolean is not true then
    raise exception 'FAALT #2q: een verlopen actie blokkeerde de nieuwe poging (%)', v->>'reden';
  end if;
  if (select count(*) from public.ai_verbruik_log where actietype='chat') <> v_voor + 1 then
    raise exception 'FAALT #2q: de nieuwe poging schreef geen eigen verbruiksregel';
  end if;
  raise notice 'OK #2q: verlopen actie geeft de sleutel vrij; de eerste poging blijft geteld.';
end $$;

rollback;

\echo '== AI-BEGRENZING GEDRAGSSUITE GROEN =='
