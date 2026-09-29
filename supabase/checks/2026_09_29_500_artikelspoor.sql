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
     and (c.structuur_label ilike '%artikel 150d%' or c.tekst ilike 'artikel 150d%'
          or c.tekst ilike 'art. 150d%' or c.tekst ilike 'art 150d%');
  if not ('05000000-0000-0000-0000-00000000c395'::uuid = any(v_ids)) then
    raise exception 'SEED FAALT A1: fondsgebruiker A ziet de gepubliceerde MvT-passage niet.';
  end if;
  if '05000000-0000-0000-0000-00000000c0b1'::uuid = any(v_ids) then
    raise exception 'LEK A1: de opzoeking toont een fondsdocument (fonds B).';
  end if;
  raise notice 'OK A1: opzoeking vindt de MvT-passage, geen fondsdocument.';

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

reset role;

rollback;
