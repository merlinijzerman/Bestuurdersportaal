-- ============================================================================
-- Gedragstoets 2026-08-13 (T5) — comparison_results + fn_schrijf_vergelijking
-- ----------------------------------------------------------------------------
-- Draai dit ná migratie 2026_08_13_t5_vergelijking.sql tegen de doeldatabase.
-- Dekt de toetsbare acceptatiecriteria van T5 die in de DB te borgen zijn:
--   • RLS-test: fonds B ziet geen comparison_results van fonds A.
--   • Schrijfpad: authenticated heeft GEEN directe INSERT op comparison_results/
--     comparison_run; schrijven kan alleen via fn_schrijf_vergelijking.
--   • fn_schrijf_vergelijking bepaalt fonds_id server-side uit auth.uid() (de
--     geschreven rijen dragen het fonds van de aanroeper, niet iets uit de request).
--   • Tenant-guard: een bevinding die naar een document van een ánder fonds wijst,
--     wordt geweigerd (42501).
--   • verschil_type_ruw / method CHECK dwingt de toegestane waarden af.
--   • comparison_results is append-only.
--
-- Zelf-seedend (2 fondsen + 2 users via de auth-trigger). Alles in één transactie
-- met ROLLBACK: de database blijft ongewijzigd. psql exit 0 + de "OK #"-notices =
-- groen; elke "LEK:"/"FAALT" → raise exception → non-zero exit.
-- ============================================================================

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 1 — STRUCTUUR (als eigenaar)                                        ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- 1a. Tabel bestaat mét RLS.
-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw en afbraak, authenticated per scenario — de meting
--      gebeurt onder RLS, niet onder BYPASSRLS.
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_class c
                   where c.relnamespace='public'::regnamespace
                     and c.relname='comparison_results' and c.relkind='r') then
    raise exception 'DEEL 1a FAALT: tabel public.comparison_results ontbreekt.';
  end if;
  if not (select relrowsecurity from pg_class
            where relnamespace='public'::regnamespace and relname='comparison_results') then
    raise exception 'DEEL 1a FAALT: RLS staat uit op public.comparison_results.';
  end if;
  raise notice 'DEEL 1a OK: comparison_results aanwezig met RLS aan.';
end $$;

-- 1b. Twee append-only triggers.
do $$
declare ontbreekt text := '';
begin
  if not exists (select 1 from pg_trigger where tgrelid='public.comparison_results'::regclass
                   and tgname='trg_comparison_results_no_update' and not tgisinternal) then
    ontbreekt := ontbreekt || '  - no_update'||chr(10);
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.comparison_results'::regclass
                   and tgname='trg_comparison_results_no_delete' and not tgisinternal) then
    ontbreekt := ontbreekt || '  - no_delete'||chr(10);
  end if;
  if ontbreekt <> '' then
    raise exception E'DEEL 1b FAALT: ontbrekende append-only triggers:\n%', ontbreekt;
  end if;
  raise notice 'DEEL 1b OK: comparison_results append-only afgedwongen.';
end $$;

-- 1c. EXECUTE-hygiëne op de #369-schrijffunctie: anon niet, authenticated wel;
-- de oude variant zonder retrievalprovenance is dicht.
do $$
begin
  if has_function_privilege('anon','public.fn_schrijf_vergelijking(text,text,text,text,jsonb,text,jsonb,jsonb)','execute') then
    raise exception 'DEEL 1c FAALT: anon mag fn_schrijf_vergelijking uitvoeren.';
  end if;
  if not has_function_privilege('authenticated','public.fn_schrijf_vergelijking(text,text,text,text,jsonb,text,jsonb,jsonb)','execute') then
    raise exception 'DEEL 1c FAALT: authenticated mag fn_schrijf_vergelijking NIET uitvoeren.';
  end if;
  if has_function_privilege('authenticated','public.fn_schrijf_vergelijking(text,text,text,text,jsonb)','execute') then
    raise exception 'DEEL 1c FAALT: oude functie zonder provenance is nog uitvoerbaar.';
  end if;
  raise notice 'DEEL 1c OK: EXECUTE-hygiëne op fn_schrijf_vergelijking.';
end $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 2 — GEDRAG (constraints + RLS + schrijfpad). begin ... rollback.    ║
-- ╚════════════════════════════════════════════════════════════════════════╝
begin;

-- Seed 2 fondsen.
insert into public.fondsen (id, naam, slug)
values ('11111111-1111-1111-1111-111111111111','T5 Testfonds A','t5-fonds-a'),
       ('22222222-2222-2222-2222-222222222222','T5 Testfonds B','t5-fonds-b');

-- 2 users via de auth-trigger maak_profiel(): A in fonds A, B in fonds B.
insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','t5-a@test.local',
   '{"naam":"Test A","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','t5-b@test.local',
   '{"naam":"Test B","fonds_id":"22222222-2222-2222-2222-222222222222"}', now(), now());

-- Twee documenten per fonds (bron + doel), als eigenaar.
insert into public.documenten (id, fonds_id, bibliotheek, bron, titel, context)
values ('d1a11111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','fonds','Intern','transitieplan_v3 (A)','algemeen'),
       ('d1b11111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','fonds','Intern','transitieplan_v4 (A)','algemeen'),
       ('d2a22222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222','fonds','Intern','transitieplan_v3 (B)','algemeen');

-- ── Impersoneer user A (fonds A) ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

-- #1: A mag GEEN directe INSERT op comparison_results (schrijven alleen via functie).
do $$
begin
  insert into public.comparison_results
    (comparison_run_id, fonds_id, finding_key, dimensie, bron_document_id, doel_document_id,
     verschil_type_ruw, method)
  values (uuid_generate_v4(),'11111111-1111-1111-1111-111111111111','fk','d',
          'd1a11111-1111-1111-1111-111111111111','d1b11111-1111-1111-1111-111111111111','gelijk','llm');
  raise exception 'LEK #1: authenticated schreef direct in comparison_results — geen INSERT-grant verwacht.';
exception
  when insufficient_privilege then raise notice 'OK #1: directe INSERT op comparison_results geweigerd.';
  when others then if sqlstate='42501' then raise notice 'OK #1: directe INSERT op comparison_results geweigerd.'; else raise; end if;
end $$;

-- #1b: A mag ook GEEN directe INSERT op comparison_run (de header-tabel; schrijven
-- alleen via de DEFINER-functie). Dekt de tweede helft van de scope-claim boven.
do $$
begin
  insert into public.comparison_run (fonds_id, mode, model, prompt_version, comparator_version)
  values ('11111111-1111-1111-1111-111111111111','symmetrisch','opus','pv1','cmp1');
  raise exception 'LEK #1b: authenticated schreef direct in comparison_run — geen INSERT-grant verwacht.';
exception
  when insufficient_privilege then raise notice 'OK #1b: directe INSERT op comparison_run geweigerd.';
  when others then if sqlstate='42501' then raise notice 'OK #1b: directe INSERT op comparison_run geweigerd.'; else raise; end if;
end $$;

-- #2 (schrijfpad + server-side fonds): A schrijft via de functie een symmetrische
-- vergelijking (bron v3 → doel v4). De geschreven rijen dragen fonds A.
do $$
declare v_run uuid; n int; f jsonb;
begin
  f := jsonb_build_array(
    jsonb_build_object(
      'finding_key','fk-bovengrens','dimensie','solidariteitsreserve.bovengrens',
      'bron_document_id','d1a11111-1111-1111-1111-111111111111','bron_value','7,5%','bron_page',37,
      'bron_passage_ref','passage-a',
      'doel_document_id','d1b11111-1111-1111-1111-111111111111','doel_value','6,0%','doel_page',37,
      'doel_passage_ref','passage-b',
      'verschil_type_ruw','verschilt','method','deterministisch'),
    jsonb_build_object(
      'finding_key','fk-franchise','dimensie','franchise',
      'bron_document_id','d1a11111-1111-1111-1111-111111111111','bron_value','17.545',
      'doel_document_id','d1b11111-1111-1111-1111-111111111111','doel_value','17.545',
      'verschil_type_ruw','gelijk','method','deterministisch'));
  v_run := public.fn_schrijf_vergelijking(
    'symmetrisch','opus','pv1','cmp1', f, 't5-check-correlation',
    '{"pogingen":[{"document_id":"doc_v1_5816172404264aa4c3e22f65eb2668695e8788cae4b78683767fd0e9de1bc5b8","dimensie":"franchise","methode":"fts_dutch_ranked","opgehaald":2,"geselecteerd":1}],"toelating":{"geweigerd":1,"categorieen":{"buiten_scope":1},"gronden":{"buiten_server_scope":1}}}'::jsonb,
    '[{"citation_id":"citation_v1_3222f0f54f849f31db43e5a5e19755f8c973ed3bce092c683eaf5211efe90564","passage_ref":"passage-a","document_id":"doc_v1_5816172404264aa4c3e22f65eb2668695e8788cae4b78683767fd0e9de1bc5b8","pagina":37,"bibliotheek":"fonds","bronsoort":"fonds","documentstatus":"vastgesteld","bronstatus":null,"geldig_tot":null,"actueel":true,"versie":{"soort":"hash","waarde":"v1","gecontroleerdOp":"2026-09-11T00:00:00Z"}}]'::jsonb
  );
  select count(*) into n from public.comparison_results
    where comparison_run_id=v_run and fonds_id='11111111-1111-1111-1111-111111111111';
  if n <> 2 then raise exception 'REGRESSIE #2: verwacht 2 bevindingen in fonds A, kreeg %.', n; end if;
  if not exists (select 1 from public.comparison_results
                  where comparison_run_id=v_run and finding_key='fk-bovengrens'
                    and bron_passage_ref='passage-a' and doel_passage_ref='passage-b') then
    raise exception 'REGRESSIE #2: evidence verloor de providerneutrale passage-ref.';
  end if;
  if exists (select 1 from public.comparison_run where id=v_run
               and fonds_id <> '11111111-1111-1111-1111-111111111111') then
    raise exception 'LEK #2: comparison_run kreeg een ander fonds dan dat van de aanroeper.';
  end if;
  if not exists (select 1 from public.comparison_run where id=v_run
                  and correlation_id='t5-check-correlation'
                  and retrieval_meta->>'correlation_id'='t5-check-correlation'
                  and retrieval_meta->'toelating'->>'geweigerd'='1'
                  and jsonb_array_length(bronnen)=1
                  and bronnen->0->>'citation_id'='citation_v1_3222f0f54f849f31db43e5a5e19755f8c973ed3bce092c683eaf5211efe90564'
                  and bronnen->0->>'actueel'='true'
                  and bronnen->0 ? 'documentstatus'
                  and bronnen->0 ? 'bronstatus'
                  and bronnen->0 ? 'geldig_tot') then
    raise exception 'REGRESSIE #2: correlation/retrieval/bronnen niet duurzaam op comparison_run.';
  end if;
  raise notice 'OK #2: schrijven via functie schrijft 2 bevindingen met fonds A (server-side).';
end $$;

-- #3 (tenant-guard): een bevinding die naar een document van fonds B wijst → 42501.
do $$
declare f jsonb;
begin
  f := jsonb_build_array(jsonb_build_object(
    'finding_key','fk-x','dimensie','franchise',
    'bron_document_id','d1a11111-1111-1111-1111-111111111111',
    'doel_document_id','d2a22222-2222-2222-2222-222222222222',   -- fonds B!
    'verschil_type_ruw','verschilt','method','llm'));
  perform public.fn_schrijf_vergelijking(
    'symmetrisch','opus','pv1','cmp1', f, 't5-check-vreemd', '{"pogingen":[]}'::jsonb,
    '[{"citation_id":"citation_v1_0ee58b3f548d5c1b2f35af05f4ec542403c8e97b351f0da27348ad119279b8b0","passage_ref":"x","document_id":"doc_v1_37f437130c12750d773cf1af2a7d13c13d472d4fa9deed302ba32b3f0c2b784b","bibliotheek":"fonds","bronsoort":"fonds","documentstatus":"vastgesteld","bronstatus":null,"geldig_tot":null,"actueel":true,"versie":{"soort":"hash","waarde":"v1"}}]'::jsonb
  );
  raise exception 'LEK #3: bevinding naar een document van fonds B TOEGESTAAN — tenant-guard werkt niet.';
exception
  when others then
    if sqlstate='42501' then raise notice 'OK #3: bevinding naar vreemd document geweigerd (tenant-guard).';
    elsif sqlstate='P0001' and sqlerrm like 'LEK:%' then raise;
    else raise;
    end if;
end $$;

-- #3b (bronprovenance): eigen findings met een opaque bron van fonds B → 42501.
-- Hiermee bewijst de check de nieuwe #369-bronvalidatie afzonderlijk van de
-- bestaande document-FK's in p_findings.
do $$
declare f jsonb;
begin
  f := jsonb_build_array(jsonb_build_object(
    'finding_key','fk-bron-x','dimensie','franchise',
    'bron_document_id','d1a11111-1111-1111-1111-111111111111',
    'doel_document_id','d1b11111-1111-1111-1111-111111111111',
    'verschil_type_ruw','verschilt','method','llm'));
  perform public.fn_schrijf_vergelijking(
    'symmetrisch','opus','pv1','cmp1', f, 't5-check-vreemde-bron', '{"pogingen":[]}'::jsonb,
    '[{"citation_id":"citation_v1_0ee58b3f548d5c1b2f35af05f4ec542403c8e97b351f0da27348ad119279b8b0","passage_ref":"x","document_id":"doc_v1_37f437130c12750d773cf1af2a7d13c13d472d4fa9deed302ba32b3f0c2b784b","bibliotheek":"fonds","bronsoort":"fonds","documentstatus":"vastgesteld","bronstatus":null,"geldig_tot":null,"actueel":true,"versie":{"soort":"hash","waarde":"v1"}}]'::jsonb
  );
  raise exception 'LEK #3b: opaque bron van fonds B TOEGESTAAN — tenant-guard werkt niet.';
exception
  when others then
    if sqlstate='42501' then raise notice 'OK #3b: opaque bron van vreemd fonds geweigerd.';
    elsif sqlstate='P0001' and sqlerrm like 'LEK:%' then raise;
    else raise;
    end if;
end $$;

-- #3c (citationbinding): een lokaal ordinaal of een niet-passende opaque
-- citation-id mag ook bij een document uit het eigen fonds niet duurzaam worden.
do $$
declare f jsonb;
begin
  f := jsonb_build_array(jsonb_build_object(
    'finding_key','fk-citation-x','dimensie','franchise',
    'bron_document_id','d1a11111-1111-1111-1111-111111111111',
    'doel_document_id','d1b11111-1111-1111-1111-111111111111',
    'verschil_type_ruw','verschilt','method','llm'));
  perform public.fn_schrijf_vergelijking(
    'symmetrisch','opus','pv1','cmp1', f, 't5-check-citationbinding', '{"pogingen":[]}'::jsonb,
    '[{"citation_id":1,"passage_ref":"passage-a","document_id":"doc_v1_5816172404264aa4c3e22f65eb2668695e8788cae4b78683767fd0e9de1bc5b8","bibliotheek":"fonds","bronsoort":"fonds","documentstatus":"vastgesteld","bronstatus":null,"geldig_tot":null,"actueel":true,"versie":{"soort":"hash","waarde":"v1"}}]'::jsonb
  );
  raise exception 'LEK #3c: lokale/niet-passende citation-id TOEGESTAAN.';
exception
  when others then
    if sqlstate='42501' then raise notice 'OK #3c: citation-id cryptografisch aan bron/passage/versie gebonden.';
    elsif sqlstate='P0001' and sqlerrm like 'LEK:%' then raise;
    else raise;
    end if;
end $$;

-- #3d (retrievalaudit): ook een opaque poging voor fonds B wordt geweigerd.
do $$
declare f jsonb;
begin
  f := jsonb_build_array(jsonb_build_object(
    'finding_key','fk-poging-x','dimensie','franchise',
    'bron_document_id','d1a11111-1111-1111-1111-111111111111',
    'doel_document_id','d1b11111-1111-1111-1111-111111111111',
    'verschil_type_ruw','verschilt','method','llm'));
  perform public.fn_schrijf_vergelijking(
    'symmetrisch','opus','pv1','cmp1', f, 't5-check-vreemde-poging',
    '{"pogingen":[{"document_id":"doc_v1_37f437130c12750d773cf1af2a7d13c13d472d4fa9deed302ba32b3f0c2b784b","dimensie":"franchise","methode":"geen","opgehaald":0,"geselecteerd":0}]}'::jsonb,
    '[]'::jsonb
  );
  raise exception 'LEK #3d: opaque retrievalpoging van fonds B TOEGESTAAN.';
exception
  when others then
    if sqlstate='42501' then raise notice 'OK #3d: opaque retrievalpoging van vreemd fonds geweigerd.';
    elsif sqlstate='P0001' and sqlerrm like 'LEK:%' then raise;
    else raise;
    end if;
end $$;

-- #4 (CHECK): een ongeldige verschil_type_ruw via de functie → check-violation.
do $$
declare f jsonb;
begin
  f := jsonb_build_array(jsonb_build_object(
    'finding_key','fk-y','dimensie','franchise',
    'bron_document_id','d1a11111-1111-1111-1111-111111111111',
    'doel_document_id','d1b11111-1111-1111-1111-111111111111',
    'verschil_type_ruw','onbekend','method','llm'));   -- niet toegestaan
  perform public.fn_schrijf_vergelijking(
    'symmetrisch','opus','pv1','cmp1', f, 't5-check-constraint', '{"pogingen":[]}'::jsonb, '[]'::jsonb
  );
  raise exception 'LEK #4: ongeldige verschil_type_ruw TOEGESTAAN — CHECK werkt niet.';
exception
  when check_violation then raise notice 'OK #4: ongeldige verschil_type_ruw geweigerd (CHECK).';
  when others then if sqlstate='23514' then raise notice 'OK #4: ongeldige verschil_type_ruw geweigerd (CHECK).'; else raise; end if;
end $$;

reset role;

-- ── Impersoneer user B (fonds B): leesisolatie ──────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}';

-- #5 (leesisolatie): B ziet GEEN comparison_results van fonds A.
do $$
declare n int;
begin
  select count(*) into n from public.comparison_results
    where fonds_id='11111111-1111-1111-1111-111111111111';
  if n <> 0 then raise exception 'LEK #5: B ziet comparison_results van fonds A (tenant-isolatie kapot).'; end if;
  raise notice 'OK #5: comparison_results van fonds A onzichtbaar voor B (RLS).';
end $$;

reset role;

-- #6 (append-only): een comparison_results-rij is niet muteerbaar (ook als eigenaar).
do $$
begin
  update public.comparison_results set method='llm' where true;
  raise exception 'LEK #6: UPDATE op comparison_results SLAAGDE — append-only-trigger werkt niet.';
exception
  when others then
    if sqlstate='P0001' and sqlerrm like 'LEK:%' then raise; end if;
    raise notice 'OK #6: UPDATE op comparison_results geblokkeerd (append-only).';
end $$;

rollback;

-- ============================================================================
-- Groen als psql exit 0 gaf en je de "OK #1/#1b/#2..#6"-notices + de DEEL 1-OK's zag.
-- Elke "LEK:"/"FAALT" doet raise exception → non-zero exit → CI faalt.
-- ============================================================================
