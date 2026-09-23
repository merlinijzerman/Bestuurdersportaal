-- ============================================================================
-- #434 T4-F — adapterstand onder het auditbeleid van 0119: gedragstest.
-- ----------------------------------------------------------------------------
-- Dit is de test die twee reviewrondes achtereen ontbrak. Ronde 1 bewees het
-- FONDSFILTER maar niet het leesrecht eronder. Ronde 2 loste dat op met een
-- ROLGATE — precies het alternatief dat besluit 0119 heeft verworpen, en zonder
-- de inzageregel die dat besluit eist.
--
-- Wat hier wordt gemeten is dus niet "werkt de functie", maar "houdt zij zich
-- aan 0119". Zie besluit 0214: operationele tellers zijn géén uitzondering.
--
-- Getoetste scenario's:
--   F1  — BASELINE: een beheerder ziet via de gewone tabel maar ÉÉN van de twee
--         fondsregels. Dit is de bevinding zelf, hier vastgelegd zodat zij niet
--         stil terug kan komen.
--   F2  — ZONDER `governance_audit_read`: de functie levert alleen de eigen
--         beurten, meldt `fondsbreed = false` én schrijft GEEN inzageregel — je
--         eigen spoor inzien is geen inzage in dat van een ander. De ROL doet er
--         daarbij niet toe: de kijker is beheerder.
--   F3  — MÉT de capability: het hele fonds, inclusief de beurt van de collega,
--         en `fondsbreed = true`.
--   F4  — De inzageregel wordt daadwerkelijk geschreven: precies één, met
--         `bronniveau = false` en een scope zonder inhoud.
--   F5  — CROSS-TENANT: geen enkele regel van fonds B komt mee, ook niet met de
--         capability — `mag_audit()` is per fonds.
--   F6  — Een grant op fonds B opent fonds A niet.
--   F7  — ZONDER SESSIE: anon wordt geweigerd (28000).
--   F8  — De uitvoer draagt UITSLUITEND `adapters`; geen modus, model,
--         gebruiker, correlatie of welke andere metasleutel dan ook.
--   F9  — Een onleesbare regel komt als JSON-null terug in plaats van de hele
--         stand te laten klappen — en is dus telbaar als overgeslagen.
--   F10 — De limiet is begrensd; een aanroeper kan er geen onbegrensde lezing
--         van maken.
--   F11 — MÉT de capability laat de RLS-policy op de TABEL ook collega-regels
--         door. Dat is de eigenschap waartegen de applicatie-terugval een
--         expliciet `gebruiker_id`-filter zet: die terugval schrijft geen
--         inzageregel, dus zonder dat filter was zij ongelogde inzage.
--
-- Self-seeding (2 fondsen + 3 users via de auth-trigger), alles in één
-- transactie met ROLLBACK — laat niets achter.
--
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw en afbraak, authenticated per scenario — de meting
--      gebeurt onder RLS, niet onder BYPASSRLS. Bij F7 expliciet anon.
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

insert into public.fondsen (id, naam, slug) values
  ('d1111111-1111-4111-8111-111111111111', 'F434 Fonds A', 'f434-fonds-a'),
  ('d2222222-2222-4222-8222-222222222222', 'F434 Fonds B', 'f434-fonds-b');

insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
values
  ('da111111-1111-4111-8111-111111111111','authenticated','authenticated','f434-a-beheer@test.local',
   '{"naam":"A Beheerder","fonds_id":"d1111111-1111-4111-8111-111111111111"}', now(), now()),
  ('da222222-2222-4222-8222-222222222222','authenticated','authenticated','f434-a-lid@test.local',
   '{"naam":"A Lid","fonds_id":"d1111111-1111-4111-8111-111111111111"}', now(), now()),
  ('da333333-3333-4333-8333-333333333333','authenticated','authenticated','f434-b-beheer@test.local',
   '{"naam":"B Beheerder","fonds_id":"d2222222-2222-4222-8222-222222222222"}', now(), now());

update public.profielen set rol = 'beheerder'  where id = 'da111111-1111-4111-8111-111111111111';
update public.profielen set rol = 'bestuurder' where id = 'da222222-2222-4222-8222-222222222222';
update public.profielen set rol = 'beheerder'  where id = 'da333333-3333-4333-8333-333333333333';

do $$
begin
  if (select fonds_id from public.profielen where id='da111111-1111-4111-8111-111111111111')
       is distinct from 'd1111111-1111-4111-8111-111111111111'::uuid
     or (select rol from public.profielen where id='da222222-2222-4222-8222-222222222222') <> 'bestuurder' then
    raise exception 'SEED FAALT: profielen niet correct (rol/fonds).';
  end if;
end $$;

-- Drie auditregels: twee in fonds A (van verschillende gebruikers) en één in
-- fonds B. Plus één onleesbare regel in fonds A voor F7.
insert into public.governance_log (gebruiker_id, fonds_id, modus, retrieval_meta) values
  ('da111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111','documenten',
   '{"methode":"hybride_rrf","opgehaald":20,"geselecteerd":8,"adapters":[{"naam":"supabase-rag","methode":"hybride_rrf","resultaat":"treffers","netwerkpogingen":1,"latency_ms":12,"downloads":0,"bytes":0,"throttles":0,"retries":0,"kandidaten_voor_poort":20,"kandidaten_na_poort":8,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":3,"opgenomen_documenten":2}]}'::jsonb),
  ('da222222-2222-4222-8222-222222222222','d1111111-1111-4111-8111-111111111111','documenten',
   '{"methode":"hybride_rrf","opgehaald":5,"geselecteerd":2,"adapters":[{"naam":"microsoft-sharepoint","methode":"sharepoint_live","resultaat":"leeg","netwerkpogingen":2,"latency_ms":40,"downloads":0,"bytes":0,"throttles":0,"retries":0,"kandidaten_voor_poort":5,"kandidaten_na_poort":0,"afwijzing_root":1,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":0,"opgenomen_documenten":0}]}'::jsonb),
  ('da333333-3333-4333-8333-333333333333','d2222222-2222-4222-8222-222222222222','documenten',
   '{"methode":"hybride_rrf","opgehaald":9,"geselecteerd":9,"adapters":[{"naam":"microsoft-sharepoint","methode":"sharepoint_live","resultaat":"treffers","netwerkpogingen":7,"latency_ms":77,"downloads":7,"bytes":7777,"throttles":0,"retries":0,"kandidaten_voor_poort":9,"kandidaten_na_poort":9,"afwijzing_root":0,"afwijzing_mapping":0,"afwijzing_binding":0,"afwijzing_rechten":0,"afwijzing_versie":0,"afwijzing_download":0,"afwijzing_extractie":0,"afwijzing_lokalisatie":0,"afwijzing_grens":0,"opgenomen_passages":9,"opgenomen_documenten":9}]}'::jsonb),
  ('da111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111','documenten',
   '{"methode":"geen","adapters":[{"naam":"supabase-rag","bron_url":"https://host/pad/doc.docx"}]}'::jsonb);

-- ════════════════════════════════════════════════════════════════════════════
-- F1 — BASELINE: de bevinding zelf. Zonder governance_audit_read ziet de
--      beheerder via de tabel alleen zijn EIGEN regels.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"da111111-1111-4111-8111-111111111111"}';

do $$
declare n_eigen int; n_totaal int;
begin
  select count(*) into n_eigen from public.governance_log
   where fonds_id = 'd1111111-1111-4111-8111-111111111111';
  if n_eigen <> 2 then
    raise exception 'F1: verwacht 2 EIGEN regels via de tabel, kreeg % — de RLS-aanname klopt niet meer', n_eigen;
  end if;
  select count(*) into n_totaal from public.governance_log;
  if n_totaal <> 2 then
    raise exception 'F1: de beheerder ziet % regels via de tabel; verwacht uitsluitend de eigen 2', n_totaal;
  end if;
  raise notice 'OK F1: het tabelpad levert uitsluitend eigen beurten (2 van 3 in fonds A).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- F2 — ZONDER de capability: eigen beurten, fondsbreed = false, GEEN inzage.
--      De kijker is BEHEERDER. Dat is het hele punt: de rol geeft geen inzage.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v         jsonb;
  n_inzage  int;
  v_namen   text[];
begin
  select count(*) into n_inzage from public.governance_audit_inzage;

  v := public.fn_adapterstand_fonds();

  if (v ->> 'fondsbreed') <> 'false' then
    raise exception 'F2: een beheerder ZONDER governance_audit_read kreeg de fondsbrede stand';
  end if;
  if jsonb_array_length(v -> 'rijen') <> 2 then
    raise exception 'F2: verwacht 2 eigen regels, kreeg %', jsonb_array_length(v -> 'rijen');
  end if;

  select array_agg(distinct e ->> 'naam' order by e ->> 'naam')
    into v_namen
    from jsonb_array_elements(v -> 'rijen') r,
         lateral jsonb_array_elements(coalesce(r -> 'adapters', '[]'::jsonb)) e;
  if v_namen is distinct from array['supabase-rag'] then
    raise exception 'F2: de stand bevat een beurt van een ander (%)', v_namen;
  end if;

  if (select count(*) from public.governance_audit_inzage) <> n_inzage then
    raise exception 'F2: er is een inzageregel geschreven voor een EIGEN-standlezing';
  end if;
  raise notice 'OK F2: zonder capability alleen eigen beurten, geen inzageregel — ondanks rol beheerder.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- F3/F4/F5/F8/F9 — MÉT de capability. Toekennen als tabel-eigenaar: de
--      grants-tabel is deny-by-default en voor authenticated onleesbaar.
-- ════════════════════════════════════════════════════════════════════════════
reset role;
insert into public.governance_audit_grants (gebruiker_id, fonds_id, capability, motivering)
values ('da111111-1111-4111-8111-111111111111',
        'd1111111-1111-4111-8111-111111111111',
        'governance_audit_read', 'F434-test: fondsbrede adapterstand');

set local role authenticated;
set local request.jwt.claims to '{"sub":"da111111-1111-4111-8111-111111111111"}';

-- F11 — WAAROM DE TERUGVAL EEN EXPLICIET GEBRUIKERSFILTER NODIG HEEFT.
-- Met de capability laat de RLS-policy op `governance_log` óók de regels van
-- collega's door. Het applicatiepad valt bij een ontbrekende RPC terug op deze
-- tabel en schrijft dán geen inzageregel — dus zonder een eigen
-- `gebruiker_id`-filter zou die terugval ongelogde inzage opleveren en zich ook
-- nog "alleen uw eigen beurten" noemen. Dit scenario legt de RLS-eigenschap
-- vast waar dat filter tegen beschermt; verandert zij, dan hoort dit rood te
-- worden en niet stil te kloppen.
do $$
declare n_zichtbaar int; n_eigen int;
begin
  select count(*) into n_zichtbaar from public.governance_log
   where fonds_id = 'd1111111-1111-4111-8111-111111111111';
  if n_zichtbaar <> 3 then
    raise exception 'F11: met governance_audit_read verwacht 3 zichtbare regels via de tabel, kreeg %', n_zichtbaar;
  end if;
  select count(*) into n_eigen from public.governance_log
   where fonds_id = 'd1111111-1111-4111-8111-111111111111'
     and gebruiker_id = 'da111111-1111-4111-8111-111111111111';
  if n_eigen <> 2 then
    raise exception 'F11: het expliciete gebruikersfilter levert % regels, verwacht 2', n_eigen;
  end if;
  raise notice 'OK F11: met de grant toont de TABEL 3 regels; een expliciet gebruikersfilter beperkt tot de eigen 2.';
end $$;

do $$
declare
  v         jsonb;
  n_inzage  int;
  v_namen   text[];
  n_null    int;
  v_sleutel text;
  n_velden  int;
  v_scope   jsonb;
  v_bron    boolean;
begin
  select count(*) into n_inzage from public.governance_audit_inzage;

  v := public.fn_adapterstand_fonds();

  -- F3 — fondsbreed, inclusief de beurt van de collega.
  if (v ->> 'fondsbreed') <> 'true' then
    raise exception 'F3: met governance_audit_read werd toch de eigen stand geleverd';
  end if;
  if jsonb_array_length(v -> 'rijen') <> 3 then
    raise exception 'F3: verwacht 3 regels uit fonds A, kreeg %', jsonb_array_length(v -> 'rijen');
  end if;
  select array_agg(distinct e ->> 'naam' order by e ->> 'naam')
    into v_namen
    from jsonb_array_elements(v -> 'rijen') r,
         lateral jsonb_array_elements(coalesce(r -> 'adapters', '[]'::jsonb)) e;
  if v_namen is distinct from array['microsoft-sharepoint','supabase-rag'] then
    raise exception 'F3: verwacht beide adapters van fonds A, kreeg % — zonder de beurt van de collega is dit geen fondsstand', v_namen;
  end if;

  -- F4 — precies één inzageregel, inhoudsvrij en op basisniveau.
  if (select count(*) from public.governance_audit_inzage) <> n_inzage + 1 then
    raise exception 'F4: verwacht precies één nieuwe inzageregel, kreeg %',
      (select count(*) from public.governance_audit_inzage) - n_inzage;
  end if;
  select scope, bronniveau into v_scope, v_bron
    from public.governance_audit_inzage
   order by tijdstip desc limit 1;
  if v_bron then
    raise exception 'F4: de inzageregel claimt bronniveau; deze uitvoer is basisniveau';
  end if;
  if v_scope ->> 'weergave' is distinct from 'adapterstand' then
    raise exception 'F4: de inzageregel benoemt de weergave niet (scope: %)', v_scope;
  end if;

  -- F5 — CROSS-TENANT. De regel van fonds B draagt herkenbare tellers (7777
  -- bytes, 7 downloads); die mogen nergens opduiken, ook niet mét de grant.
  if exists (
    select 1 from jsonb_array_elements(v -> 'rijen') r,
         lateral jsonb_array_elements(coalesce(r -> 'adapters', '[]'::jsonb)) e
     where (e ->> 'bytes') = '7777' or (e ->> 'downloads') = '7'
  ) then
    raise exception 'F5: LEK — een regel van fonds B komt mee in de stand van fonds A';
  end if;

  -- F8 — uitsluitend de sleutel `adapters` per regel.
  -- De onleesbare regel is JSON-null en heeft geen sleutels; die overslaan,
  -- anders werpt jsonb_object_keys op een scalar.
  select string_agg(distinct k, ',')
    into v_sleutel
    from (select r from jsonb_array_elements(v -> 'rijen') r
           where jsonb_typeof(r) = 'object') o,
         lateral jsonb_object_keys(o.r) k;
  if v_sleutel is distinct from 'adapters' then
    raise exception 'F8: de functie geeft meer vrij dan `adapters` (sleutels: %)', v_sleutel;
  end if;
  select count(*) into n_velden
    from jsonb_array_elements(v -> 'rijen') r,
         lateral jsonb_array_elements(coalesce(r -> 'adapters', '[]'::jsonb)) e,
         lateral jsonb_object_keys(e) k;
  if n_velden <> 44 then
    raise exception 'F8: verwacht 2 rijen van 22 velden, kreeg % velden', n_velden;
  end if;

  -- F9 — de onleesbare regel is JSON-null, niet weggelaten.
  select count(*) into n_null
    from jsonb_array_elements(v -> 'rijen') r
   where jsonb_typeof(r) = 'null';
  if n_null <> 1 then
    raise exception 'F9: een onleesbare regel hoort als JSON-null terug te komen; kreeg % null(s)', n_null;
  end if;

  raise notice 'OK F3/F4/F5/F8/F9: fondsbreed met inzageregel, tenantdicht, uitsluitend gesloten adaptertellers.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- F10 — de limiet is begrensd.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare gelukt boolean := false;
begin
  begin
    perform public.fn_adapterstand_fonds(100000);
    gelukt := true;
  exception when sqlstate '22023' then gelukt := false;
  end;
  if gelukt then
    raise exception 'F10: een onbegrensde limiet werd geaccepteerd';
  end if;
  -- Positieve controle: binnen bereik mag wél, anders bewijst F10 niets.
  perform public.fn_adapterstand_fonds(1);
  raise notice 'OK F10: limiet begrensd (1 mag, 100000 niet).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- F6 — een grant op fonds B opent fonds A niet. `mag_audit()` is per fonds.
-- ════════════════════════════════════════════════════════════════════════════
reset role;
insert into public.governance_audit_grants (gebruiker_id, fonds_id, capability, motivering)
values ('da222222-2222-4222-8222-222222222222',
        'd2222222-2222-4222-8222-222222222222',
        'governance_audit_read', 'F434-test: grant op het VERKEERDE fonds');

set local role authenticated;
set local request.jwt.claims to '{"sub":"da222222-2222-4222-8222-222222222222"}';

do $$
declare v jsonb;
begin
  v := public.fn_adapterstand_fonds();
  if (v ->> 'fondsbreed') <> 'false' then
    raise exception 'F6: een grant op fonds B gaf fondsbrede inzage in fonds A';
  end if;
  if jsonb_array_length(v -> 'rijen') <> 1 then
    raise exception 'F6: verwacht uitsluitend de ene eigen regel, kreeg %', jsonb_array_length(v -> 'rijen');
  end if;
  raise notice 'OK F6: een grant op een ander fonds opent het eigen fonds niet.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- F7 — ZONDER SESSIE: anon wordt geweigerd. auth.uid() is dan null.
-- ════════════════════════════════════════════════════════════════════════════
set local role anon;
set local request.jwt.claims to '';

do $$
declare gelukt boolean := false;
begin
  begin
    perform public.fn_adapterstand_fonds();
    gelukt := true;
  exception when others then gelukt := false;
  end;
  if gelukt then
    raise exception 'F7: zonder sessie werd de adapterstand geleverd';
  end if;
  raise notice 'OK F7: zonder sessie geweigerd (geen execute-recht of geen auth.uid()).';
end $$;

reset role;

select 'T4-F adapterstand onder 0119: alle gedragstests geslaagd' as uitkomst;

rollback;
