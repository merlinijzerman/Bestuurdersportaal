-- ============================================================================
-- #493 V-1 — juridische rol per zijde in het vergelijkingsauditspoor.
-- ----------------------------------------------------------------------------
-- Draai ná migratie 2026_09_29_493_vergelijk_juridische_rollen.sql. Bewijst in
-- de DATABASE (niet alleen in TypeScript):
--   J1  — zonder `juridische_duiding` is comparison_run.retrieval_meta exact het
--         #369-spoor (geen extra sleutel): niet-juridisch blijft ongewijzigd.
--   J2  — wet ↔ memorie van toelichting (beide generiek) wordt duurzaam
--         vastgelegd: verhouding + per zijde rol, dossier, datum, normgewicht,
--         regime; alleen opaque documentidentiteit, geen titel, extra sleutels
--         weggeprojecteerd. Ook de pogingen van generieke documenten (namespace
--         `generiek`) worden aanvaard.
--   J3  — negatieve controle: de MvT als `geldend_recht` → 42501. Dit is de
--         DB-kant van "wet en toelichting nooit als gelijkwaardige normen".
--   J4  — metadata die niet exact bij het document hoort (MvT als 'bindend')
--         → 42501: een aanroeper kan geen normgewicht verzinnen.
--   J5  — `onbekend` mag niets beweren (geen documentbinding) — kaal aanvaard,
--         met document_id geweigerd.
--   J6  — ongeldige vorm/verhouding → 22023.
--   J7  — de oude fondsnamespace voor een generiek document blijft geweigerd
--         (de reden van de namespacefix in vergelijk-productie.ts).
--
-- Zelf-seedend in één transactie met ROLLBACK — laat geen data achter.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw, afbraak en het berekenen van de opaque
--      documentidentiteiten; authenticated voor elke aanroep van
--      fn_schrijf_vergelijking — het fonds komt uit auth.uid() en de
--      DEFINER-validatie moet onder de echte aanroeperrol worden gemeten.
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

insert into public.fondsen (id, naam, slug)
values ('49300000-0000-0000-0000-00000000000a', 'V1 Testfonds', 'v1-493-fonds');

insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
values ('49300000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'v1-493@test.local',
        '{"naam":"V1 Test","fonds_id":"49300000-0000-0000-0000-00000000000a"}', now(), now());

-- Eén fondsdocument (niet-juridisch) en twee generieke juridische bronnen.
insert into public.documenten (id, fonds_id, bibliotheek, bron, titel, context)
values ('49300000-0000-0000-0000-0000000000f1', '49300000-0000-0000-0000-00000000000a',
        'fonds', 'Intern', 'Beleid v1', 'algemeen'),
       ('49300000-0000-0000-0000-0000000000f2', '49300000-0000-0000-0000-00000000000a',
        'fonds', 'Intern', 'Beleid v2', 'algemeen');

insert into public.documenten
  (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief,
   documenttype, normgewicht, wettelijk_regime, extern_url, documentdatum)
values
  ('49300000-0000-0000-0000-0000000000b1', null, 'generiek', 'Extern',
   'Pensioenwet — geconsolideerde tekst (BWBR0020809)', 'van_kracht', 'actief', true,
   'wetgeving', 'bindend', 'pw', 'https://wetten.overheid.nl/BWBR0020809', '2026-07-01');

insert into public.documenten
  (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief,
   documenttype, wetsgeschiedenis_subtype, dossiernummer, normgewicht,
   wettelijk_regime, extern_url, documentdatum)
values
  ('49300000-0000-0000-0000-0000000000b2', null, 'generiek', 'Extern',
   'Memorie van toelichting — Kamerstukken II 2021/22, 36 067, nr. 3', 'van_kracht', 'actief', true,
   'wetsgeschiedenis', 'memorie_van_toelichting', '36067', 'informatief',
   'beide', 'https://zoek.officielebekendmakingen.nl/kst-36067-3.html', '2022-03-30');

-- Opaque documentidentiteiten (#367) als postgres berekenen en als lokale
-- GUC doorgeven; de aanroeper hieronder kent geen database-id in het spoor.
select set_config('v1.' || naam, 'doc_v1_' || encode(extensions.digest(
         octet_length('bestuurdersportaal:doc:v1')::text || ':bestuurdersportaal:doc:v1|' ||
         octet_length(ns)::text || ':' || ns || '|' ||
         octet_length(id::text)::text || ':' || id::text,
         'sha256'), 'hex'), true)
  from (values
    ('fonds1', 'fonds:49300000-0000-0000-0000-00000000000a', '49300000-0000-0000-0000-0000000000f1'::uuid),
    ('wet', 'generiek', '49300000-0000-0000-0000-0000000000b1'::uuid),
    ('mvt', 'generiek', '49300000-0000-0000-0000-0000000000b2'::uuid),
    ('wet_fondsns', 'fonds:49300000-0000-0000-0000-00000000000a', '49300000-0000-0000-0000-0000000000b1'::uuid)
  ) as v(naam, ns, id);

-- Hulp: een geldige finding en de wet↔MvT-duiding.
create or replace function pg_temp.v1_findings(p_bron uuid, p_doel uuid) returns jsonb
language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'finding_key', 'fk-v1', 'dimensie', 'termijn',
    'bron_document_id', p_bron, 'bron_value', 'a',
    'doel_document_id', p_doel, 'doel_value', 'b',
    'verschil_type_ruw', 'verschilt', 'method', 'llm'));
$$;

create or replace function pg_temp.v1_duiding(p_mvt_rol text, p_mvt_normgewicht text) returns jsonb
language sql as $$
  select jsonb_build_object(
    'verhouding', 'norm_tegenover_toelichting',
    'zijden', jsonb_build_array(
      jsonb_build_object('zijde', 'bron', 'document_id', current_setting('v1.wet'),
        'rol', 'geldend_recht', 'documenttype', 'wetgeving', 'normgewicht', 'bindend',
        'wettelijk_regime', 'pw', 'documentdatum', '2026-07-01',
        'titel', 'mag niet in het spoor landen'),
      jsonb_build_object('zijde', 'doel', 'document_id', current_setting('v1.mvt'),
        'rol', p_mvt_rol, 'documenttype', 'wetsgeschiedenis',
        'wetsgeschiedenis_subtype', 'memorie_van_toelichting', 'dossiernummer', '36067',
        'normgewicht', p_mvt_normgewicht, 'wettelijk_regime', 'beide',
        'documentdatum', '2022-03-30')));
$$;

grant execute on function pg_temp.v1_findings(uuid, uuid) to authenticated;
grant execute on function pg_temp.v1_duiding(text, text) to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub":"49300000-0000-0000-0000-0000000000a1"}';

-- ── J1: zonder duiding bytegelijk aan #369 ─────────────────────────────────
do $$
declare v_run uuid; v_meta jsonb;
begin
  v_run := public.fn_schrijf_vergelijking('symmetrisch', 'opus', 'pv1', 'cmp1',
    pg_temp.v1_findings('49300000-0000-0000-0000-0000000000f1', '49300000-0000-0000-0000-0000000000f2'),
    'v1-j1',
    jsonb_build_object('pogingen', jsonb_build_array(jsonb_build_object(
      'document_id', current_setting('v1.fonds1'), 'dimensie', 'termijn',
      'methode', 'fts_dutch_ranked', 'opgehaald', 1, 'geselecteerd', 1))),
    '[]'::jsonb);
  select retrieval_meta into v_meta from public.comparison_run where id = v_run;
  if v_meta ? 'juridische_duiding' then
    raise exception 'REGRESSIE J1: niet-juridische vergelijking kreeg een juridische_duiding.';
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(v_meta) k) <> array['correlation_id', 'pogingen'] then
    raise exception 'REGRESSIE J1: retrieval_meta wijkt af van het #369-spoor: %', v_meta;
  end if;
  raise notice 'OK J1: zonder juridische duiding blijft het spoor ongewijzigd.';
end $$;

-- ── J2: wet ↔ MvT duurzaam, opaque en allowlist-geprojecteerd ─────────────
do $$
declare v_run uuid; v_jur jsonb; v_doel jsonb; v_bron jsonb;
begin
  v_run := public.fn_schrijf_vergelijking('symmetrisch', 'opus', 'pv1+jur-v1', 'cmp1',
    pg_temp.v1_findings('49300000-0000-0000-0000-0000000000b1', '49300000-0000-0000-0000-0000000000b2'),
    'v1-j2',
    jsonb_build_object(
      'pogingen', jsonb_build_array(
        jsonb_build_object('document_id', current_setting('v1.wet'), 'dimensie', 'termijn',
          'methode', 'fts_dutch_ranked', 'opgehaald', 1, 'geselecteerd', 1),
        jsonb_build_object('document_id', current_setting('v1.mvt'), 'dimensie', 'termijn',
          'methode', 'fts_dutch_ranked', 'opgehaald', 1, 'geselecteerd', 1)),
      'juridische_duiding', pg_temp.v1_duiding('wetsgeschiedenis', 'informatief')),
    '[]'::jsonb);
  select retrieval_meta->'juridische_duiding' into v_jur from public.comparison_run where id = v_run;
  if v_jur is null or v_jur->>'verhouding' <> 'norm_tegenover_toelichting'
     or jsonb_array_length(v_jur->'zijden') <> 2 then
    raise exception 'REGRESSIE J2: juridische duiding niet duurzaam vastgelegd: %', v_jur;
  end if;
  select z into v_bron from jsonb_array_elements(v_jur->'zijden') z where z->>'zijde' = 'bron';
  select z into v_doel from jsonb_array_elements(v_jur->'zijden') z where z->>'zijde' = 'doel';
  if v_bron->>'rol' <> 'geldend_recht' or v_doel->>'rol' <> 'wetsgeschiedenis'
     or v_doel->>'dossiernummer' <> '36067' or v_doel->>'documentdatum' <> '2022-03-30'
     or v_doel->>'normgewicht' <> 'informatief' or v_doel->>'wettelijk_regime' <> 'beide'
     or v_bron->>'wettelijk_regime' <> 'pw' or v_bron->>'normgewicht' <> 'bindend' then
    raise exception 'REGRESSIE J2: rol/dossier/datum/normgewicht/regime niet herleidbaar: %', v_jur;
  end if;
  if v_bron ? 'titel' or v_jur::text like '%49300000-%' or v_bron->>'document_id' not like 'doc_v1_%' then
    raise exception 'LEK J2: titel of database-id in het juridische auditspoor: %', v_jur;
  end if;
  raise notice 'OK J2: wet ↔ MvT met opaque identiteit en R-1-metadata vastgelegd.';
end $$;

-- ── J3: negatieve controle — MvT als geldend recht ────────────────────────
do $$
begin
  perform public.fn_schrijf_vergelijking('symmetrisch', 'opus', 'pv1', 'cmp1',
    pg_temp.v1_findings('49300000-0000-0000-0000-0000000000b1', '49300000-0000-0000-0000-0000000000b2'),
    'v1-j3', jsonb_build_object('pogingen', '[]'::jsonb,
      'juridische_duiding', pg_temp.v1_duiding('geldend_recht', 'informatief')), '[]'::jsonb);
  raise exception 'LEK J3: memorie van toelichting als geldend recht aanvaard.';
exception when others then
  if sqlstate <> '42501' then raise; end if;
  raise notice 'OK J3: MvT als geldend recht geweigerd (42501).';
end $$;

-- ── J4: verzonnen normgewicht ─────────────────────────────────────────────
do $$
begin
  perform public.fn_schrijf_vergelijking('symmetrisch', 'opus', 'pv1', 'cmp1',
    pg_temp.v1_findings('49300000-0000-0000-0000-0000000000b1', '49300000-0000-0000-0000-0000000000b2'),
    'v1-j4', jsonb_build_object('pogingen', '[]'::jsonb,
      'juridische_duiding', pg_temp.v1_duiding('wetsgeschiedenis', 'bindend')), '[]'::jsonb);
  raise exception 'LEK J4: MvT met verzonnen normgewicht bindend aanvaard.';
exception when others then
  if sqlstate <> '42501' then raise; end if;
  raise notice 'OK J4: afwijkende metadata geweigerd (42501).';
end $$;

-- ── J5: onbekend beweert niets ────────────────────────────────────────────
do $$
declare v_run uuid; v_jur jsonb;
begin
  v_run := public.fn_schrijf_vergelijking('symmetrisch', 'opus', 'pv1', 'cmp1',
    pg_temp.v1_findings('49300000-0000-0000-0000-0000000000b1', '49300000-0000-0000-0000-0000000000f1'),
    'v1-j5', jsonb_build_object('pogingen', '[]'::jsonb,
      'juridische_duiding', jsonb_build_object('verhouding', 'onbepaald', 'zijden', jsonb_build_array(
        jsonb_build_object('zijde', 'bron', 'rol', 'onbekend'),
        jsonb_build_object('zijde', 'doel', 'rol', 'onbekend')))), '[]'::jsonb);
  select retrieval_meta->'juridische_duiding' into v_jur from public.comparison_run where id = v_run;
  if v_jur->>'verhouding' <> 'onbepaald' or jsonb_array_length(v_jur->'zijden') <> 2 then
    raise exception 'REGRESSIE J5: neutrale duiding niet vastgelegd: %', v_jur;
  end if;
  begin
    perform public.fn_schrijf_vergelijking('symmetrisch', 'opus', 'pv1', 'cmp1',
      pg_temp.v1_findings('49300000-0000-0000-0000-0000000000b1', '49300000-0000-0000-0000-0000000000f1'),
      'v1-j5b', jsonb_build_object('pogingen', '[]'::jsonb,
        'juridische_duiding', jsonb_build_object('verhouding', 'onbepaald', 'zijden', jsonb_build_array(
          jsonb_build_object('zijde', 'bron', 'rol', 'onbekend',
            'document_id', current_setting('v1.wet'), 'normgewicht', 'bindend')))), '[]'::jsonb);
    raise exception 'LEK J5: onbekende rol met documentbinding/normgewicht aanvaard.';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;
  raise notice 'OK J5: onbekend degradeert neutraal en kan geen normstatus dragen.';
end $$;

-- ── J6: vorm ──────────────────────────────────────────────────────────────
do $$
begin
  perform public.fn_schrijf_vergelijking('symmetrisch', 'opus', 'pv1', 'cmp1',
    pg_temp.v1_findings('49300000-0000-0000-0000-0000000000b1', '49300000-0000-0000-0000-0000000000b2'),
    'v1-j6', jsonb_build_object('pogingen', '[]'::jsonb,
      'juridische_duiding', jsonb_build_object('verhouding', 'twee_normen', 'zijden', '[]'::jsonb)), '[]'::jsonb);
  raise exception 'LEK J6: ongeldige verhouding aanvaard.';
exception when others then
  if sqlstate <> '22023' then raise; end if;
  raise notice 'OK J6: ongeldige vorm geweigerd (22023).';
end $$;

-- ── J7: oude fondsnamespace voor een generiek document blijft dicht ────────
do $$
begin
  perform public.fn_schrijf_vergelijking('symmetrisch', 'opus', 'pv1', 'cmp1',
    pg_temp.v1_findings('49300000-0000-0000-0000-0000000000b1', '49300000-0000-0000-0000-0000000000b2'),
    'v1-j7',
    jsonb_build_object('pogingen', jsonb_build_array(jsonb_build_object(
      'document_id', current_setting('v1.wet_fondsns'), 'dimensie', 'termijn',
      'methode', 'fts_dutch_ranked', 'opgehaald', 0, 'geselecteerd', 0))),
    '[]'::jsonb);
  raise exception 'REGRESSIE J7: generiek document met fondsnamespace aanvaard.';
exception when others then
  if sqlstate <> '42501' then raise; end if;
  raise notice 'OK J7: generiek document vereist de namespace generiek (42501 bij fonds:).';
end $$;

reset role;
rollback;
