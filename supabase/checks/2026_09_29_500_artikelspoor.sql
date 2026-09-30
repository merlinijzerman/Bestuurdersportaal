-- ============================================================================
-- #500 — Gericht artikelspoor: toelating via de BESTAANDE zoek_chunks.
-- ----------------------------------------------------------------------------
-- De app (core/lib/rag.ts, `vulAanMetArtikelkandidaten`) voegt bij een
-- juridische vraag met een expliciet artikel exact gelabelde passages toe aan
-- de kandidatenset. Een nieuwe passage komt er alleen in als de BESTAANDE RPC
-- `zoek_chunks` haar — met hetzelfde filterblok als het hoofdspoor en een
-- frasequery '"artikel 150d" OR "art 150d"' — onder RLS teruggeeft. Er is geen
-- migratie en geen RPC-wijziging; deze check bewijst dat die toelating in de
-- DATABASE doet wat de app aanneemt.
--
-- Scenario's (onder échte RLS, als fondsgebruiker A):
--   A1 — de opzoeking (label/tekstbegin op juridische documenten) vindt de
--        gepubliceerde MvT-passage en nooit een fondsdocument: juridische
--        typen bestaan alleen generiek (W7), dus fonds B valt er per
--        constructie buiten.
--   A2 — de frasequery laat de kopregelpassage "Artikel 150d Pensioenwet en
--        artikel 145c Wvb (Transitieplan)" toe, en ook een frase in lopende
--        tekst (die de app daarna op exactheid wegfiltert).
--   A3 — strikt: "artikel 150" en "artikel 150c" raken de 150d-passage niet;
--        een vervolgpassage zonder de frase wordt niet toegelaten.
--   A4 — filters blijven gelden: een concept- en een gearchiveerde kopie van
--        dezelfde passage, en de passage in fonds B, komen er niet door —
--        ook niet als de app hun document-id meegeeft.
--   A5 — modus 'actueel' en de review-vervalgate gelden ook op dit spoor.
--   A6 — de opzoeking is exact in de database (regex met woordgrens, zoals
--        `artikelOpzoekfilter`): "artikel 150" treft 150c/150d niet.
--
-- HOTFIX PRODUCTIETIME-OUT (#500, 29-09-2026). De app laat nieuwe passages
-- niet meer toe via `zoek_chunks` (57014 op Productie), maar via een
-- id-begrensde opvraging onder RLS met EXPLICIET dezelfde semantiek
-- (core/lib/retrieval/artikeltoelating.ts). A1–A6 hierboven blijven de
-- referentie voor wat `zoek_chunks` doet; M bewijst de pariteit:
--   M1 — voor elke scenario uit de gedeelde matrix
--        (tests/cross-tenant/fixtures/500-artikeltoelating-matrix.json, ook
--        gelezen door de app-laagtest) geldt onder echte RLS:
--        nieuwe toelating == zoek_chunks == verwacht. Dezelfde rijen
--        toegelaten, en vooral dezelfde GEWEIGERD: ander fonds, concept/niet
--        vastgesteld, gearchiveerd, actief=false, geldig_tot < peildatum,
--        geldig_vanaf > peildatum, verlopen volgende_review, bronstatus niet
--        actief, andere bronsoort, buiten documentscope, niet aangewezen,
--        geen frase.
--   M2 — negatieve controle: laat één toelatingsregel weg en ten minste één
--        scenario wordt rood. Elke regel doet dus aantoonbaar werk.
-- De performance-eis staat in 2026_09_29_500_artikelspoor_performance.sql.
--
-- Self-seeding in één transactie met ROLLBACK — laat geen data achter.
-- Uitvoeren:  psql "$DB" -f dit-bestand
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw en afbraak; authenticated (fondsgebruiker A) voor
--      A1–A5 — de toelating wordt onder RLS gemeten, niet onder BYPASSRLS.
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

insert into public.fondsen (id, naam, slug) values
  ('05000000-1111-1111-1111-111111111111', 'Artikelspoor fonds A', 'artikelspoor-fonds-a'),
  ('05000000-2222-2222-2222-222222222222', 'Artikelspoor fonds B', 'artikelspoor-fonds-b');

insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
values
  ('05000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','art-a@test.local',
   '{"naam":"Art A","fonds_id":"05000000-1111-1111-1111-111111111111"}', now(), now());

do $$
begin
  if (select fonds_id from public.profielen where id='05000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
       is distinct from '05000000-1111-1111-1111-111111111111'::uuid then
    raise exception 'SEED FAALT: profiel Art A niet aan fonds A gekoppeld (trigger maak_profiel).';
  end if;
end $$;

-- Documenten: de gepubliceerde MvT, een conceptkopie, een gearchiveerde kopie,
-- een MvT met verlopen review, en een fondsdocument van fonds B.
insert into public.documenten
  (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief,
   documenttype, wetsgeschiedenis_subtype, dossiernummer, normgewicht,
   wettelijk_regime, extern_url, documentdatum, volgende_review)
values
  ('05000000-0000-0000-0000-0000000000a1', null, 'generiek', 'Extern',
   'Memorie van toelichting — Kamerstukken II 2021/22, 36 067, nr. 3',
   'van_kracht', 'actief', true, 'wetsgeschiedenis', 'memorie_van_toelichting', '36067',
   'informatief', 'beide', 'https://zoek.officielebekendmakingen.nl/kst-36067-3.html', '2022-03-30', null),
  ('05000000-0000-0000-0000-0000000000a2', null, 'generiek', 'Extern',
   'Conceptkopie — Kamerstukken II 2021/22, 36 067, nr. 3',
   'concept', 'actief', true, 'wetsgeschiedenis', 'memorie_van_toelichting', '36067',
   'informatief', 'beide', 'https://zoek.officielebekendmakingen.nl/kst-36067-3.html', '2022-03-30', null),
  ('05000000-0000-0000-0000-0000000000a3', null, 'generiek', 'Extern',
   'Gearchiveerde kopie — Kamerstukken II 2021/22, 36 067, nr. 3',
   'gearchiveerd', 'actief', true, 'wetsgeschiedenis', 'memorie_van_toelichting', '36067',
   'informatief', 'beide', 'https://zoek.officielebekendmakingen.nl/kst-36067-3.html', '2022-03-30', null),
  ('05000000-0000-0000-0000-0000000000a4', null, 'generiek', 'Extern',
   'Review verlopen — Kamerstukken II 2021/22, 36 067, nr. 3',
   'van_kracht', 'actief', true, 'wetsgeschiedenis', 'memorie_van_toelichting', '36067',
   'informatief', 'beide', 'https://zoek.officielebekendmakingen.nl/kst-36067-3.html', '2022-03-30', '2020-01-01');

insert into public.documenten (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief)
values
  ('05000000-0000-0000-0000-0000000000b1', '05000000-2222-2222-2222-222222222222', 'fonds',
   'Intern', 'Fonds B — notitie transitieplan', 'vastgesteld', 'actief', true);

insert into public.document_chunks (id, document_id, chunk_index, pagina, tekst, structuur_type, structuur_label)
values
  ('05000000-0000-0000-0000-00000000c395', '05000000-0000-0000-0000-0000000000a1', 395, 395,
   E'Artikel 150d Pensioenwet en artikel 145c Wvb (Transitieplan)\nHet transitieplan legt de keuzes van sociale partners vast.',
   'artikel', 'Artikelsgewijze toelichting — Artikel 150d'),
  ('05000000-0000-0000-0000-00000000c396', '05000000-0000-0000-0000-0000000000a1', 396, 395,
   'Daarnaast beschrijft het plan de compensatie en het evenwicht tussen de generaties.',
   'artikel', 'Artikelsgewijze toelichting — Artikel 150d'),
  ('05000000-0000-0000-0000-00000000c394', '05000000-0000-0000-0000-0000000000a1', 394, 394,
   E'Artikel 150c Pensioenwet (Invaarbesluit)\nHet invaarbesluit wordt genomen door het fonds.',
   'artikel', 'Artikelsgewijze toelichting — Artikel 150c'),
  ('05000000-0000-0000-0000-00000000c086', '05000000-0000-0000-0000-0000000000a1', 86, 86,
   'Sociale partners stellen een transitieplan op (artikel 150d Pensioenwet).',
   'paragraaf', '§4.2'),
  ('05000000-0000-0000-0000-00000000c0a2', '05000000-0000-0000-0000-0000000000a2', 395, 395,
   E'Artikel 150d Pensioenwet en artikel 145c Wvb (Transitieplan)\nConcepttekst.',
   'artikel', 'Artikelsgewijze toelichting — Artikel 150d'),
  ('05000000-0000-0000-0000-00000000c0a3', '05000000-0000-0000-0000-0000000000a3', 395, 395,
   E'Artikel 150d Pensioenwet en artikel 145c Wvb (Transitieplan)\nGearchiveerde tekst.',
   'artikel', 'Artikelsgewijze toelichting — Artikel 150d'),
  ('05000000-0000-0000-0000-00000000c0a4', '05000000-0000-0000-0000-0000000000a4', 395, 395,
   E'Artikel 150d Pensioenwet en artikel 145c Wvb (Transitieplan)\nVerlopen review.',
   'artikel', 'Artikelsgewijze toelichting — Artikel 150d'),
  ('05000000-0000-0000-0000-00000000c0b1', '05000000-0000-0000-0000-0000000000b1', 0, 1,
   E'Artikel 150d Pensioenwet (Transitieplan)\nInterne notitie van fonds B.',
   'artikel', 'Artikel 150d');

-- ── M: pariteitsmatrix (gedeeld met de app-laagtest) ────────────────────────
\set matrix500 `cat tests/cross-tenant/fixtures/500-artikeltoelating-matrix.json`
select set_config('art500.matrix', :'matrix500', true);

insert into public.procedures (id, fonds_id, template_code, titel)
values ('05001000-0000-0000-0000-0000000000f1', '05000000-1111-1111-1111-111111111111',
        'art500-test', 'Artikelspoor dossier');

insert into public.documenten
  (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief,
   geldig_vanaf, geldig_tot, volgende_review, procesinstantie_id)
select r.document_id, r.fonds_id, r.bibliotheek,
       case when r.bibliotheek = 'generiek' then 'Extern' else 'Intern' end,
       'Matrix — ' || r.sleutel, r.status, r.bronstatus, r.actief,
       r.geldig_vanaf, r.geldig_tot, r.volgende_review, r.procesinstantie_id
  from jsonb_to_recordset(current_setting('art500.matrix')::jsonb -> 'rijen') as r(
       sleutel text, document_id uuid, fonds_id uuid, bibliotheek text, status text,
       bronstatus text, actief boolean, geldig_vanaf date, geldig_tot date,
       volgende_review date, procesinstantie_id uuid);

insert into public.document_chunks (id, document_id, chunk_index, pagina, tekst, structuur_type, structuur_label)
select r.chunk_id, r.document_id, 0, 1,
       case when r.frase then E'Artikel 150d Pensioenwet (Transitieplan)\nMatrixrij ' || r.sleutel
            else 'Vervolgtekst zonder de verwijzing, matrixrij ' || r.sleutel end,
       'artikel', 'Artikel 150d'
  from jsonb_to_recordset(current_setting('art500.matrix')::jsonb -> 'rijen') as r(
       sleutel text, document_id uuid, chunk_id uuid, frase boolean);

-- ── Onder RLS, als fondsgebruiker A ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"05000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

do $$
declare
  v_fonds  uuid := '05000000-1111-1111-1111-111111111111';
  v_frase  text := '"artikel 150d" OR "art 150d"';
  v_alle   uuid[] := array[
    '05000000-0000-0000-0000-0000000000a1','05000000-0000-0000-0000-0000000000a2',
    '05000000-0000-0000-0000-0000000000a3','05000000-0000-0000-0000-0000000000a4',
    '05000000-0000-0000-0000-0000000000b1']::uuid[];
  v_ids    uuid[];
begin
  -- A1 — de opzoeking (zelfde predicaat als de app, via de documentrij).
  select coalesce(array_agg(c.id), array[]::uuid[]) into v_ids
    from public.document_chunks c
    join public.documenten d on d.id = c.document_id
   where d.documenttype in ('wetgeving','wetsgeschiedenis')
     and (c.structuur_label ~* '(^|[^a-z])artikel +150d([^0-9a-z]|$)'
          or c.tekst ~* '^(artikel|art[.]?) +150d([^0-9a-z]|$)');
  if not ('05000000-0000-0000-0000-00000000c395'::uuid = any(v_ids)) then
    raise exception 'SEED FAALT A1: fondsgebruiker A ziet de gepubliceerde MvT-passage niet.';
  end if;
  if '05000000-0000-0000-0000-00000000c0b1'::uuid = any(v_ids) then
    raise exception 'LEK A1: de opzoeking toont een fondsdocument (fonds B).';
  end if;
  if '05000000-0000-0000-0000-00000000c394'::uuid = any(v_ids) then
    raise exception 'LEK A1: de exacte opzoeking op 150d vindt de 150c-passage.';
  end if;
  if not ('05000000-0000-0000-0000-00000000c396'::uuid = any(v_ids)) then
    raise exception 'FAAL A1: de vervolgpassage met hetzelfde 150d-label ontbreekt in de opzoeking.';
  end if;
  raise notice 'OK A1: exacte opzoeking vindt de 150d-passages, geen 150c en geen fondsdocument.';

  -- A6 — de opzoeking is EXACT in de database (reviewpunt PR #501): een
  -- prefix op "artikel 150" mag 150c/150d niet treffen, zodat buurlabels de
  -- exacte passage niet uit de limiet van de app kunnen drukken.
  select coalesce(array_agg(c.id), array[]::uuid[]) into v_ids
    from public.document_chunks c
    join public.documenten d on d.id = c.document_id
   where d.documenttype in ('wetgeving','wetsgeschiedenis')
     and (c.structuur_label ~* '(^|[^a-z])artikel +150([^0-9a-z]|$)'
          or c.tekst ~* '^(artikel|art[.]?) +150([^0-9a-z]|$)');
  if cardinality(v_ids) <> 0 then
    raise exception 'LEK A6: opzoeking op artikel 150 treft % buurpassage(s) (150c/150d).', cardinality(v_ids);
  end if;
  raise notice 'OK A6: opzoeking op artikel 150 treft 150c/150d niet.';

  -- A2/A4/A5 — toelating via zoek_chunks, alle documenten meegegeven.
  select coalesce(array_agg(id), array[]::uuid[]) into v_ids
    from public.zoek_chunks(p_query => v_frase, p_limit => 200, p_document_ids => v_alle,
                            p_modus => 'actueel', p_peildatum => date '2026-09-29',
                            p_fonds_id => v_fonds);
  if not ('05000000-0000-0000-0000-00000000c395'::uuid = any(v_ids)) then
    raise exception 'FAAL A2: de kopregelpassage artikel 150d wordt niet toegelaten.';
  end if;
  if not ('05000000-0000-0000-0000-00000000c086'::uuid = any(v_ids)) then
    raise exception 'FAAL A2: een frase in lopende tekst hoort ook terug te komen (app filtert op exactheid).';
  end if;
  raise notice 'OK A2: frasequery laat de exacte passage toe.';

  if '05000000-0000-0000-0000-00000000c396'::uuid = any(v_ids) then
    raise exception 'ONVERWACHT A3: vervolgpassage zonder frase toegelaten.';
  end if;
  if '05000000-0000-0000-0000-00000000c394'::uuid = any(v_ids) then
    raise exception 'LEK A3: artikel 150c toegelaten op een 150d-frase.';
  end if;
  if '05000000-0000-0000-0000-00000000c0a2'::uuid = any(v_ids) then
    raise exception 'LEK A4: conceptkopie toegelaten.';
  end if;
  if '05000000-0000-0000-0000-00000000c0a3'::uuid = any(v_ids) then
    raise exception 'LEK A4: gearchiveerde kopie toegelaten.';
  end if;
  if '05000000-0000-0000-0000-00000000c0b1'::uuid = any(v_ids) then
    raise exception 'LEK A4: passage van fonds B toegelaten.';
  end if;
  if '05000000-0000-0000-0000-00000000c0a4'::uuid = any(v_ids) then
    raise exception 'LEK A5: passage met verlopen review toegelaten.';
  end if;
  raise notice 'OK A4/A5: concept, gearchiveerd, fonds B en verlopen review blijven buiten.';

  -- A3 — strikt: buurartikelen raken 150d niet.
  select coalesce(array_agg(id), array[]::uuid[]) into v_ids
    from public.zoek_chunks(p_query => '"artikel 150" OR "art 150"', p_limit => 200,
                            p_document_ids => v_alle, p_fonds_id => v_fonds);
  if '05000000-0000-0000-0000-00000000c395'::uuid = any(v_ids) then
    raise exception 'LEK A3: frase artikel 150 raakt de 150d-passage.';
  end if;
  select coalesce(array_agg(id), array[]::uuid[]) into v_ids
    from public.zoek_chunks(p_query => '"artikel 150c" OR "art 150c"', p_limit => 200,
                            p_document_ids => v_alle, p_fonds_id => v_fonds);
  if not ('05000000-0000-0000-0000-00000000c394'::uuid = any(v_ids))
     or '05000000-0000-0000-0000-00000000c395'::uuid = any(v_ids) then
    raise exception 'FAAL A3: artikel 150c-frase selecteert niet precies de 150c-passage.';
  end if;
  raise notice 'OK A3: buurartikelen 150 en 150c raken 150d niet.';
end $$;

-- ── M1/M2 — pariteit: nieuwe toelating == zoek_chunks == verwacht ──────────
do $$
declare
  m          jsonb := current_setting('art500.matrix')::jsonb;
  v_frase    text  := m->>'frase';
  v_regels   text[] := array['exacte_id','document_actief','niet_gearchiveerd','documentscope',
                             'modus_actueel','bronstatus','documentstatus','procesinstantie',
                             'bronsoort','fonds','generiek_gepubliceerd','generiek_review','frase'];
  v_alle     uuid[];
  v_ids      uuid[];
  s          jsonb;
  p          jsonb;
  v_modus    text;
  v_peil     date;
  v_fonds    uuid;
  v_scope    uuid[];
  v_bronst   text[];
  v_docst    text[];
  v_proc     uuid[];
  v_bronsrt  text[];
  v_docs     uuid[];
  v_ref      uuid[];
  v_nieuw    uuid[];
  v_verwacht uuid[];
  v_zonder   uuid[];
  v_regel    text;
  v_rood     jsonb := '{}'::jsonb;
  v_n        int := 0;
begin
  select array_agg((r->>'chunk_id')::uuid) into v_alle from jsonb_array_elements(m->'rijen') r;
  select array_agg((r->>'chunk_id')::uuid) into v_ids
    from jsonb_array_elements(m->'rijen') r where (r->>'aangewezen')::boolean;

  -- Seedcontrole: fondsgebruiker A ziet precies de rijen van fonds A + generiek.
  if (select count(*) from public.document_chunks where id = any(v_alle))
     <> (select count(*) from jsonb_array_elements(m->'rijen') r where r->>'sleutel' not like 'b\_%') then
    raise exception 'SEED FAALT M: RLS-zichtbaarheid van de matrix wijkt af.';
  end if;

  create temp table art500_vlaggen (id uuid, regels jsonb) on commit drop;
  for s in select * from jsonb_array_elements(m->'scenarios') loop
    p        := s->'parameters';
    v_modus  := coalesce(p->>'modus', 'alles');
    v_peil   := (p->>'peildatum')::date;
    v_fonds  := (p->>'fonds_id')::uuid;
    v_scope  := case when jsonb_typeof(p->'documentscope') = 'array'
                     then array(select jsonb_array_elements_text(p->'documentscope'))::uuid[] end;
    v_bronst := case when jsonb_typeof(p->'bronstatus') = 'array'
                     then array(select jsonb_array_elements_text(p->'bronstatus')) end;
    v_docst  := case when jsonb_typeof(p->'documentstatus') = 'array'
                     then array(select jsonb_array_elements_text(p->'documentstatus')) end;
    v_proc   := case when jsonb_typeof(p->'procesinstantie_ids') = 'array'
                     then array(select jsonb_array_elements_text(p->'procesinstantie_ids'))::uuid[] end;
    v_bronsrt := case when jsonb_typeof(p->'bronsoort') = 'array'
                     then array(select jsonb_array_elements_text(p->'bronsoort')) end;
    select coalesce(array_agg((r->>'chunk_id')::uuid order by (r->>'chunk_id')), '{}')
      into v_verwacht
      from jsonb_array_elements(m->'rijen') r
     where r->>'sleutel' in (select jsonb_array_elements_text(s->'toegelaten'));

    -- (1) Referentie: de OUDE toelating — zoek_chunks met de documenten van de
    --     aangewezen passages (binnen de scope), gefilterd op de aangewezen id's.
    select array_agg(distinct document_id) into v_docs
      from public.document_chunks
     where id = any(v_ids) and (v_scope is null or document_id = any(v_scope));
    select coalesce(array_agg(z.id order by z.id), '{}') into v_ref
      from public.zoek_chunks(
             p_query => v_frase, p_limit => 200, p_document_ids => coalesce(v_docs, '{}'::uuid[]),
             p_bronstatus => v_bronst, p_documentstatus => v_docst,
             p_procesinstantie_ids => v_proc, p_modus => v_modus, p_peildatum => v_peil,
             p_bronsoort => v_bronsrt, p_fonds_id => v_fonds) z
     where z.id = any(v_ids);

    -- (2) De NIEUWE toelating: dezelfde regels als TOELATINGSREGELS in
    --     core/lib/retrieval/artikeltoelating.ts (+ de DB-zijdige frase), per
    --     regel een vlag, onder RLS over de matrixrijen.
    truncate art500_vlaggen;
    insert into art500_vlaggen
    select c.id, jsonb_build_object(
      'exacte_id',            c.id = any(v_ids),
      'document_actief',      d.actief is true,
      'niet_gearchiveerd',    c.documentstatus is distinct from 'gearchiveerd',
      'documentscope',        v_scope is null or c.document_id = any(v_scope),
      'modus_actueel',        v_modus is distinct from 'actueel' or coalesce(
                                c.documentstatus in ('vastgesteld','van_kracht')
                                and coalesce(c.bronstatus,'actief') = 'actief'
                                and (c.geldig_vanaf is null or c.geldig_vanaf <= v_peil)
                                and (c.geldig_tot   is null or c.geldig_tot   >= v_peil), false),
      'bronstatus',           v_bronst is null or coalesce(coalesce(c.bronstatus,'actief') = any(v_bronst), false),
      'documentstatus',       v_docst is null or coalesce(c.documentstatus = any(v_docst), false),
      'procesinstantie',      v_proc is null or coalesce(c.procesinstantie_id = any(v_proc), false),
      'bronsoort',            v_bronsrt is null or coalesce(c.bibliotheek = any(v_bronsrt), false),
      'fonds',                v_fonds is null or coalesce(d.fonds_id = v_fonds, false) or c.bibliotheek is not distinct from 'generiek',
      'generiek_gepubliceerd', c.bibliotheek is distinct from 'generiek'
                                or (c.documentstatus is not distinct from 'van_kracht' and coalesce(c.bronstatus,'actief') = 'actief'),
      'generiek_review',      c.bibliotheek is distinct from 'generiek' or d.volgende_review is null or d.volgende_review >= v_peil,
      'frase',                c.zoek_vector @@ websearch_to_tsquery('dutch', v_frase))
      from public.document_chunks c
      join public.documenten d on d.id = c.document_id
     where c.id = any(v_alle);

    select coalesce(array_agg(id order by id), '{}') into v_nieuw
      from art500_vlaggen v
     where not exists (select 1 from jsonb_each(v.regels) e where e.value <> 'true'::jsonb);

    if v_ref is distinct from v_verwacht then
      raise exception 'FAAL M1 [%]: zoek_chunks laat % toe, matrix verwacht %.', s->>'naam', v_ref, v_verwacht;
    end if;
    if v_nieuw is distinct from v_ref then
      raise exception 'LEK M1 [%]: nieuwe toelating % ≠ zoek_chunks %.', s->>'naam', v_nieuw, v_ref;
    end if;

    -- M2: per weggelaten regel — wordt dit scenario rood?
    foreach v_regel in array v_regels loop
      select coalesce(array_agg(id order by id), '{}') into v_zonder
        from art500_vlaggen v
       where not exists (select 1 from jsonb_each(v.regels) e
                          where e.key <> v_regel and e.value <> 'true'::jsonb);
      if v_zonder is distinct from v_verwacht then
        v_rood := jsonb_set(v_rood, array[v_regel], to_jsonb(s->>'naam'));
      end if;
    end loop;
    v_n := v_n + 1;
    raise notice 'OK M1 [%]: % toegelaten, nieuw == zoek_chunks == verwacht.', s->>'naam', cardinality(v_nieuw);
  end loop;

  foreach v_regel in array v_regels loop
    if not (v_rood ? v_regel) then
      raise exception 'FAAL M2: regel % weglaten maakt geen enkel scenario rood — de matrix dekt haar niet.', v_regel;
    end if;
  end loop;
  raise notice 'OK M2: elk van de % regels weglaten maakt ten minste één van % scenario''s rood (%).',
    cardinality(v_regels), v_n, v_rood;
end $$;

reset role;

rollback;
