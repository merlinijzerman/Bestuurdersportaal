-- ============================================================================
-- Regressiecheck Increment G — RAG-filtering vóór retrieval (TO §6.2 #1-12).
-- ----------------------------------------------------------------------------
-- DETERMINISTISCH + non-destructief: het hele blok draait in één
-- begin; do $$ ... $$; rollback; — het zaait een gecontroleerde testset
-- (documenten + chunks met variërende status/bronstatus/geldigheid), roept de
-- nieuwe zoek_chunks-signatuur per modus/peildatum aan, en assert welke
-- document-id's wél/niet terugkomen. De rollback maakt de seed ongedaan, dus er
-- blijft niets achter. Draai in de Supabase SQL-editor (rol postgres = bypass
-- RLS; dat is hier gewenst, we testen de FILTERLAAG, niet RLS — zie de
-- ROL-regel hierboven voor waar RLS wél gedekt is).
--
-- De zoek_vector is generated (to_tsvector('dutch', tekst)); elke seed-chunk
-- bevat het token 'zorgvuldigheidsbeginsel' zodat de FTS-query alle seed-rijen
-- matcht. De BEFORE INSERT-trigger fn_chunk_denorm_before_insert denormaliseert
-- status/bronstatus/geldigheid uit het seed-document naar de chunk — exact zoals
-- in productie, dus we toetsen de échte denorm-keten.
--
-- Het filterpredicaat is in zoek_chunks (FTS) en in BEIDE armen van
-- zoek_chunks_hybride identiek (zie migratie 2026_06_20g). Deze check toetst het
-- via zoek_chunks; test G-h bevestigt dat het hybride pad hetzelfde filtert.
--
-- Peildatum is vastgepind op 2026-06-20 zodat de geldigheidstests stabiel zijn,
-- onafhankelijk van current_date.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres (BYPASSRLS), bewust — dit toetst de FILTERLAAG in zoek_chunks
--      (status/bronstatus/geldigheid), niet RLS. Cross-tenant RLS is gedekt
--      door t3_cross_tenant en retrieval-fondsdiscipline door t4; beide draaien
--      sinds 21-08-2026 in de gate.
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

begin;

-- Self-seeding: een schone CI-database bevat bewust geen demo-fonds.
insert into public.fondsen (id, naam, slug)
values ('6f000000-0000-0000-0000-000000000001', 'Retrieval filter testfonds', 'retrieval-filter-testfonds');

do $$
declare
  v_fonds   uuid;
  v_q       text := 'zorgvuldigheidsbeginsel';
  v_peil    date := date '2026-06-20';

  -- seed-document-id's
  d_vast        uuid; -- vastgesteld + bronstatus actief             → actueel IN
  d_kracht      uuid; -- van_kracht + bronstatus NULL (≡actief)       → actueel IN (#9)
  d_concept     uuid; -- concept + bronstatus actief                  → actueel UIT (#3/#10)
  d_hist        uuid; -- van_kracht + bronstatus historisch           → actueel UIT (#1)
  d_uitg        uuid; -- van_kracht + bronstatus uitgesloten          → actueel UIT (#2)
  d_verv        uuid; -- historisch + bronstatus actief               → actueel UIT (documentstatus)
  d_verlopen    uuid; -- van_kracht + geldig_tot < peil               → actueel UIT (#11)
  d_toekomst    uuid; -- van_kracht + geldig_vanaf > peil             → actueel UIT (#11)
  d_periode     uuid; -- vastgesteld + geldig 2026-01-01..2026-12-31  → actueel IN  (#11)
  d_generiek    uuid; -- generiek (bibliotheek) + van_kracht/actief   → bronsoort-filter (#13-24-deel)

  v_actueel uuid[];
  v_alles   uuid[];
  v_hist    uuid[];
  v_filt    uuid[];
  fails     int := 0;
begin
  -- Gebruik uitsluitend het synthetische testfonds; generieke docs krijgen
  -- fonds_id NULL.
  v_fonds := '6f000000-0000-0000-0000-000000000001';

  -- ── seed documenten (status/bronstatus/geldigheid expliciet) ───────────────
  insert into public.documenten (fonds_id, bibliotheek, bron, titel, status, bronstatus, geldig_vanaf, geldig_tot)
  values (v_fonds,'fonds','Intern','G-seed vastgesteld','vastgesteld','actief', null, null) returning id into d_vast;
  insert into public.documenten (fonds_id, bibliotheek, bron, titel, status, bronstatus, geldig_vanaf, geldig_tot)
  values (v_fonds,'fonds','Intern','G-seed van_kracht NULL-bronstatus','van_kracht', null, null, null) returning id into d_kracht;
  insert into public.documenten (fonds_id, bibliotheek, bron, titel, status, bronstatus, geldig_vanaf, geldig_tot)
  values (v_fonds,'fonds','Intern','G-seed concept-actief','concept','actief', null, null) returning id into d_concept;
  insert into public.documenten (fonds_id, bibliotheek, bron, titel, status, bronstatus, geldig_vanaf, geldig_tot)
  values (v_fonds,'fonds','Intern','G-seed historisch','van_kracht','historisch', null, null) returning id into d_hist;
  insert into public.documenten (fonds_id, bibliotheek, bron, titel, status, bronstatus, geldig_vanaf, geldig_tot)
  values (v_fonds,'fonds','Intern','G-seed uitgesloten','van_kracht','uitgesloten', null, null) returning id into d_uitg;
  insert into public.documenten (fonds_id, bibliotheek, bron, titel, status, bronstatus, geldig_vanaf, geldig_tot)
  values (v_fonds,'fonds','Intern','G-seed historische status','historisch','actief', null, null) returning id into d_verv;
  insert into public.documenten (fonds_id, bibliotheek, bron, titel, status, bronstatus, geldig_vanaf, geldig_tot)
  values (v_fonds,'fonds','Intern','G-seed verlopen','van_kracht','actief', date '2025-01-01', date '2026-01-01') returning id into d_verlopen;
  insert into public.documenten (fonds_id, bibliotheek, bron, titel, status, bronstatus, geldig_vanaf, geldig_tot)
  values (v_fonds,'fonds','Intern','G-seed toekomst','van_kracht','actief', date '2027-01-01', null) returning id into d_toekomst;
  insert into public.documenten (fonds_id, bibliotheek, bron, titel, status, bronstatus, geldig_vanaf, geldig_tot)
  values (v_fonds,'fonds','Intern','G-seed geldige periode','vastgesteld','actief', date '2026-01-01', date '2026-12-31') returning id into d_periode;
  insert into public.documenten (fonds_id, bibliotheek, bron, titel, status, bronstatus, geldig_vanaf, geldig_tot)
  values (null,'generiek','DNB','G-seed generiek','van_kracht','actief', null, null) returning id into d_generiek;

  -- ── seed chunks (één per doc; token matcht de FTS-query) ───────────────────
  insert into public.document_chunks (document_id, chunk_index, tekst)
  select id, 0, 'Het zorgvuldigheidsbeginsel staat centraal in dit fragment.'
  from (values (d_vast),(d_kracht),(d_concept),(d_hist),(d_uitg),(d_verv),
               (d_verlopen),(d_toekomst),(d_periode),(d_generiek)) as t(id);

  -- ── retrieval-sets ophalen ────────────────────────────────────────────────
  select array_agg(distinct document_id) into v_actueel
    from public.zoek_chunks(p_query => v_q, p_limit => 200, p_modus => 'actueel', p_peildatum => v_peil);
  select array_agg(distinct document_id) into v_alles
    from public.zoek_chunks(p_query => v_q, p_limit => 200, p_modus => 'alles', p_peildatum => v_peil);
  select array_agg(distinct document_id) into v_hist
    from public.zoek_chunks(p_query => v_q, p_limit => 200, p_modus => 'historisch', p_peildatum => v_peil);

  -- ── ASSERTS ───────────────────────────────────────────────────────────────
  -- #1 actuele vraag gebruikt geen bronstatus=historisch
  if not (d_hist <> all(v_actueel)) then fails:=fails+1; raise notice 'FAIL #1 historisch lekt in actueel'; else raise notice 'OK   #1 historisch niet in actueel'; end if;
  -- #2 actuele vraag gebruikt geen bronstatus=uitgesloten
  if not (d_uitg <> all(v_actueel)) then fails:=fails+1; raise notice 'FAIL #2 uitgesloten lekt in actueel'; else raise notice 'OK   #2 uitgesloten niet in actueel'; end if;
  -- #3 + #10 concept (ook met bronstatus=actief) niet als actuele bron
  if not (d_concept <> all(v_actueel)) then fails:=fails+1; raise notice 'FAIL #3/#10 concept-actief lekt in actueel'; else raise notice 'OK   #3/#10 concept-actief niet in actueel'; end if;
  -- #9 NULL-bronstatus breekt retrieval niet (≡ actief): van_kracht/NULL IS actueel, en zit in alles
  if not (d_kracht = any(v_actueel)) then fails:=fails+1; raise notice 'FAIL #9 NULL-bronstatus niet in actueel'; else raise notice 'OK   #9 NULL-bronstatus telt als actief'; end if;
  if not (d_kracht = any(v_alles)) then fails:=fails+1; raise notice 'FAIL #9b NULL-bronstatus weg in alles (retrieval gebroken)'; else raise notice 'OK   #9b NULL-bronstatus zichtbaar in alles'; end if;
  -- vastgesteld/actief IS actueel
  if not (d_vast = any(v_actueel)) then fails:=fails+1; raise notice 'FAIL vastgesteld/actief niet in actueel'; else raise notice 'OK   vastgesteld/actief in actueel'; end if;
  -- documentstatus historisch niet actueel
  if not (d_verv <> all(v_actueel)) then fails:=fails+1; raise notice 'FAIL documentstatus historisch lekt in actueel'; else raise notice 'OK   documentstatus historisch niet in actueel'; end if;
  -- #11 verlopen (geldig_tot < peil) en toekomst (geldig_vanaf > peil) eruit; geldige periode erin
  if not (d_verlopen <> all(v_actueel)) then fails:=fails+1; raise notice 'FAIL #11 verlopen lekt in actueel'; else raise notice 'OK   #11 verlopen niet in actueel'; end if;
  if not (d_toekomst <> all(v_actueel)) then fails:=fails+1; raise notice 'FAIL #11 nog-niet-geldig lekt in actueel'; else raise notice 'OK   #11 nog-niet-geldig niet in actueel'; end if;
  if not (d_periode = any(v_actueel)) then fails:=fails+1; raise notice 'FAIL #11 geldige periode niet in actueel'; else raise notice 'OK   #11 geldige periode in actueel'; end if;
  -- defaults = huidig gedrag: 'alles' levert alle 10 seed-docs
  if not (array_length(v_alles,1) >= 10) then fails:=fails+1; raise notice 'FAIL alles-default filtert (verwacht >=10, kreeg %)', coalesce(array_length(v_alles,1),0); else raise notice 'OK   alles-default = huidig gedrag (% docs)', array_length(v_alles,1); end if;
  -- #4 historisch-modus toont oude bronnen/documenten (geen actueel-restrictie)
  if not (d_hist = any(v_hist) and d_verv = any(v_hist)) then fails:=fails+1; raise notice 'FAIL #4 historisch-modus mist historische bronnen/documenten'; else raise notice 'OK   #4 historisch-modus toont historische bronnen/documenten'; end if;

  -- orthogonale filters
  select array_agg(distinct document_id) into v_filt
    from public.zoek_chunks(p_query => v_q, p_limit => 200, p_modus => 'alles', p_bronstatus => array['historisch']);
  if not (v_filt = array[d_hist]) then fails:=fails+1; raise notice 'FAIL p_bronstatus-filter (verwacht alleen d_hist, kreeg %)', v_filt; else raise notice 'OK   p_bronstatus-filter isoleert historisch'; end if;

  select array_agg(distinct document_id) into v_filt
    from public.zoek_chunks(p_query => v_q, p_limit => 200, p_modus => 'alles', p_documentstatus => array['concept']);
  if not (v_filt = array[d_concept]) then fails:=fails+1; raise notice 'FAIL p_documentstatus-filter (verwacht alleen d_concept, kreeg %)', v_filt; else raise notice 'OK   p_documentstatus-filter isoleert concept'; end if;

  select array_agg(distinct document_id) into v_filt
    from public.zoek_chunks(p_query => v_q, p_limit => 200, p_modus => 'alles', p_bronsoort => array['generiek']);
  if not (v_filt = array[d_generiek]) then fails:=fails+1; raise notice 'FAIL p_bronsoort-filter (verwacht alleen d_generiek, kreeg %)', v_filt; else raise notice 'OK   p_bronsoort-filter isoleert generiek'; end if;

  -- #8 bronstatus-/documentstatuswijziging werkt door ZONDER herupload (denorm-trigger)
  update public.documenten set bronstatus = 'historisch' where id = d_vast;
  select array_agg(distinct document_id) into v_actueel
    from public.zoek_chunks(p_query => v_q, p_limit => 200, p_modus => 'actueel', p_peildatum => v_peil);
  if not (d_vast <> all(v_actueel)) then fails:=fails+1; raise notice 'FAIL #8 statuswijziging werkt niet door in retrieval'; else raise notice 'OK   #8 statuswijziging werkt door zonder herupload'; end if;

  -- G-h hybride pad: zelfde predicaat fireet ook in zoek_chunks_hybride (FTS-arm;
  -- seed-chunks hebben geen embedding → vec-arm leeg, fts-arm filtert). Dummy-vector.
  select array_agg(distinct document_id) into v_filt
    from public.zoek_chunks_hybride(
      p_query => v_q,
      p_embedding => ('[' || array_to_string(array_fill(0::real, array[1024]), ',') || ']')::vector,
      p_limit => 200, p_kandidaten => 200,
      p_modus => 'actueel', p_peildatum => v_peil);
  if not (d_concept <> all(coalesce(v_filt, array[]::uuid[]))) then fails:=fails+1; raise notice 'FAIL G-h hybride actueel laat concept door'; else raise notice 'OK   G-h hybride actueel sluit concept uit'; end if;

  -- ── samenvatting ──────────────────────────────────────────────────────────
  if fails > 0 then
    raise exception 'G-REGRESSIE: % assert(s) GEFAALD — zie de FAIL-notices hierboven.', fails;
  else
    raise notice '────────────────────────────────────────';
    raise notice 'G-REGRESSIE: alle filter-asserts GESLAAGD.';
  end if;
end $$;

rollback;

-- ============================================================================
-- Niet in dit SQL-blok (route-/UI-/TS-niveau; aparte verificatie):
--   #5  besluitvorming-modus prioriteert besluitbronnen     → lib/weeg-bronsoort + route-smoke
--   #6  retrieval-log toont toegepaste filters              → RetrievalMeta sanity + governance_log-inspectie
--   #7  bronkaarten tonen status/bronstatus/datum/peildatum → UI-smoke (app/(dashboard)/ai)
--   #12 besluitvorming neemt Decision Object-registratie mee → route-smoke (fn_build_decision_dossier-injectie)
--   #13-24 bronsoort-weging (#17/#18/#24)                    → lib/weeg-bronsoort.sanity.ts
--          bronsoort-isolatie (#15/#16/#19/#20/#23)          → 2026_07_08_t3_cross_tenant.sql +
--                                                              2026_07_08_t4_retrieval_fondsdiscipline.sql
--          (stond hier: 2026_06_20e_verificatie_en_regressie.sql — dat is een
--           HANDMATIGE checklist met placeholders die niet in de gate draait;
--           gecorrigeerd 21-08-2026)
--          bronkaart-labels (#21)                            → lib/bronsoort.sanity.ts (bestaand)
-- ============================================================================
