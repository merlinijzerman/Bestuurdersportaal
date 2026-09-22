-- ============================================================================
-- #434 T4-F — fondsbrede adapterstand: gedragstest onder ÉCHTE RLS.
-- ----------------------------------------------------------------------------
-- Dit is de test die de vorige ronde ontbrak. Het applicatiepad bewees het
-- FONDSFILTER, maar niet het leesrecht eronder: de selectpolicy op
-- `governance_log` is `gebruiker_id = auth.uid() or public.mag_audit(fonds_id)`
-- en `mag_audit()` vereist de aparte grant `governance_audit_read`, die
-- `fonds.config.manage` niet geeft. Een beheerder zag dus alleen zijn EIGEN
-- beurten en kreeg die gepresenteerd als de stand van het fonds.
--
-- Getoetste scenario's:
--   F1 — BASELINE: een beheerder ziet via de gewone tabel maar ÉÉN van de twee
--        fondsregels. Dit is de bevinding zelf, hier vastgelegd zodat zij niet
--        stil terug kan komen.
--   F2 — De definer-functie levert BEIDE fondsregels: eigen beurt én die van de
--        collega.
--   F3 — CROSS-TENANT: geen enkele regel van fonds B komt mee.
--   F4 — ROLGATE: een bestuurder van hetzelfde fonds wordt geweigerd (42501).
--   F5 — ZONDER SESSIE: anon wordt geweigerd (28000); de functie is niet via
--        de service-role of een lege sessie te misbruiken.
--   F6 — De uitvoer draagt UITSLUITEND `adapters`; geen modus, model,
--        gebruiker, correlatie of welke andere metasleutel dan ook.
--   F7 — Een onleesbare regel komt als NULL terug in plaats van de hele stand
--        te laten klappen — en is dus telbaar als overgeslagen.
--   F8 — De limiet is begrensd; een aanroeper kan er geen onbegrensde lezing
--        van maken.
--
-- Self-seeding (2 fondsen + 3 users via de auth-trigger), alles in één
-- transactie met ROLLBACK — laat niets achter.
--
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw en afbraak, authenticated per scenario — de meting
--      gebeurt onder RLS, niet onder BYPASSRLS. Bij F5 expliciet anon.
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
  -- 2 eigen regels (de geldige en de onleesbare); die van het A-lid ontbreekt.
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
-- F2/F3/F6/F7 — de definer-functie: fondsbreed, tenantdicht, inhoudsvrij.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  n_rijen   int;
  n_null    int;
  n_adapter int;
  v_namen   text[];
  v_sleutel text;
begin
  select count(*), count(*) filter (where r is null)
    into n_rijen, n_null
    from public.fn_adapterstand_fonds() r;

  -- Drie regels van fonds A: twee leesbaar, één onleesbaar (NULL).
  if n_rijen <> 3 then
    raise exception 'F2: verwacht 3 regels uit fonds A, kreeg %', n_rijen;
  end if;
  if n_null <> 1 then
    raise exception 'F7: een onleesbare regel hoort als NULL terug te komen; kreeg % NULL(s)', n_null;
  end if;

  -- F2 — de beurt van de COLLEGA zit erbij. Zonder deze regel is het geen
  -- fondsstand maar een persoonlijke stand met een fondslabel.
  select array_agg(distinct e ->> 'naam' order by e ->> 'naam')
    into v_namen
    from public.fn_adapterstand_fonds() r,
         lateral jsonb_array_elements(coalesce(r -> 'adapters', '[]'::jsonb)) e;
  if v_namen is distinct from array['microsoft-sharepoint','supabase-rag'] then
    raise exception 'F2: verwacht beide adapters van fonds A, kreeg %', v_namen;
  end if;

  -- F3 — CROSS-TENANT. De regel van fonds B draagt herkenbare tellers (7777
  -- bytes, 7 downloads); die mogen nergens opduiken.
  if exists (
    select 1 from public.fn_adapterstand_fonds() r,
         lateral jsonb_array_elements(coalesce(r -> 'adapters', '[]'::jsonb)) e
     where (e ->> 'bytes') = '7777' or (e ->> 'downloads') = '7'
  ) then
    raise exception 'F3: LEK — een regel van fonds B komt mee in de stand van fonds A';
  end if;

  -- F6 — uitsluitend de sleutel `adapters`. Geen modus, model, methode,
  -- opgehaald, geselecteerd of correlatie: dit pad is geen auditinzage.
  select string_agg(distinct k, ',')
    into v_sleutel
    from public.fn_adapterstand_fonds() r,
         lateral jsonb_object_keys(r) k;
  if v_sleutel is distinct from 'adapters' then
    raise exception 'F6: de functie geeft meer vrij dan `adapters` (sleutels: %)', v_sleutel;
  end if;

  -- En de rij zelf is de gesloten vorm: 22 velden, geen identifier.
  select count(*) into n_adapter
    from public.fn_adapterstand_fonds() r,
         lateral jsonb_array_elements(coalesce(r -> 'adapters', '[]'::jsonb)) e,
         lateral jsonb_object_keys(e) k;
  if n_adapter <> 44 then
    raise exception 'F6: verwacht 2 rijen van 22 velden, kreeg % velden', n_adapter;
  end if;

  raise notice 'OK F2/F3/F6/F7: fondsbreed, tenantdicht, uitsluitend gesloten adaptertellers.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- F8 — de limiet is begrensd.
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
    raise exception 'F8: een onbegrensde limiet werd geaccepteerd';
  end if;
  -- Positieve controle: binnen bereik mag wél, anders bewijst F8 niets.
  perform public.fn_adapterstand_fonds(1);
  raise notice 'OK F8: limiet begrensd (1 mag, 100000 niet).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- F4 — ROLGATE: een bestuurder van HETZELFDE fonds wordt geweigerd.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"da222222-2222-4222-8222-222222222222"}';

do $$
declare gelukt boolean := false;
begin
  begin
    perform public.fn_adapterstand_fonds();
    gelukt := true;
  exception when sqlstate '42501' then gelukt := false;
  end;
  if gelukt then
    raise exception 'F4: een bestuurder kreeg de fondsbrede adapterstand';
  end if;
  raise notice 'OK F4: rolgate weigert een bestuurder van hetzelfde fonds.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- F5 — ZONDER SESSIE: anon wordt geweigerd. auth.uid() is dan null.
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
    raise exception 'F5: zonder sessie werd de fondsbrede adapterstand geleverd';
  end if;
  raise notice 'OK F5: zonder sessie geweigerd (geen execute-recht of geen auth.uid()).';
end $$;

reset role;

select 'T4-F fondsbrede adapterstand: alle gedragstests geslaagd' as uitkomst;

rollback;
