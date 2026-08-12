-- ============================================================================
-- Migratie 2026-08-12 (T8) — async semantische extractie: queue-stap,
-- catalogus-hints en atomische schrijffunctie.
-- ----------------------------------------------------------------------------
-- WAAROM. T7 legde het datamodel (semantic_units / extraction_run / concepts).
-- T8 is de productie-extractiepijplijn die die tabellen vult. Deze migratie voegt
-- de drie DB-onderdelen toe die de pijplijn nodig heeft:
--   1. Een nieuwe `stap`-waarde 'semantische_extractie' op document_processing_jobs
--      zodat de bestaande async worker (claim-RPC + lease) de job kan dragen.
--   2. Normalisatie-/prompt-hints op concepts.normalization (de catalogus wordt
--      zelf-beschrijvend: de scherpe concept-omschrijving + enum-trefwoorden uit
--      S1 leven bij het concept, cureerbaar door de catalogus-eigenaar).
--   3. Eén atomische schrijffunctie fn_schrijf_semantische_extractie() die de
--      append-only extraction_run + de (niet-append-only) semantic_units in ÉÉN
--      transactie wegschrijft — zodat er nooit een 'geslaagde' run zonder units
--      of half-vervangen units achterblijft.
--
-- PUUR ADDITIEF + terugdraaibaar. Zolang de flag SEMANTISCHE_EXTRACTIE uit staat
-- enqueued/verwerkt de app niets — geen gedragswijziging. ROLLBACK-migratie dropt
-- de functie, herstelt de oude stap-CHECK en leegt de normalization-hints.
--
-- SCHRIJFPAD (besluit 0169, T7). extraction_run en semantic_units worden
-- UITSLUITEND server-side door de service-role beschreven. De schrijffunctie is
-- daarom SECURITY INVOKER (draait met de rechten van de aanroeper = service_role,
-- géén definer-bypass) en is EXECUTE-ontzegd aan public/anon/authenticated en
-- alléén aan service_role gegund (gate-H-hygiëne). extraction_run blijft
-- append-only (de functie INSERT alleen, nooit UPDATE/DELETE); semantic_units mag
-- de functie vervangen (delete-then-insert), want die tabel is bewust NIET
-- append-only.
--
-- Idempotent (drop/create if exists, on conflict, create or replace).
-- Transactioneel. EERST in Supabase draaien, DÁN code-deploy. Draai na deze
-- migratie de structurele gates (A–H) en de T8-gedragstoets.
-- ROLLBACK: 2026_08_12_t8_semantische_extractie_ROLLBACK.sql
-- Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
-- ============================================================================

begin;

-- ── 1. Nieuwe queue-stap 'semantische_extractie' ─────────────────────────────
-- De CHECK op document_processing_jobs.stap is inline (auto-genaamd). Zoek de
-- bestaande stap-CHECK op zijn definitie (bevat 'validatie') en vervang hem door
-- dezelfde set + de nieuwe stap. Idempotent: her-uitvoeren dropt en herbouwt.
do $$
declare cname text;
begin
  select conname into cname
    from pg_constraint
   where conrelid = 'public.document_processing_jobs'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%stap%validatie%';
  if cname is not null then
    execute format('alter table public.document_processing_jobs drop constraint %I', cname);
  end if;
end $$;

alter table public.document_processing_jobs
  add constraint document_processing_jobs_stap_check
  check (stap in (
    'validatie','scan','extractie','ocr','chunking','embedding','indexering',
    'semantische_extractie'
  ));

-- ── 2. Catalogus-hints op concepts.normalization ─────────────────────────────
-- De extractie geeft Haiku per concept een SCHERPE omschrijving mee (onderscheid
-- van naburige grootheden) en de deterministische normaliser gebruikt de enum-
-- trefwoorden voor policy_choice. Deze hints leven bij het concept (T7 hield de
-- kolom hiervoor vrij) zodat de catalogus-eigenaar ze kan cureren zonder codewijziging.
-- Vorm: { "omschrijving": text, "enums": [ { "waarde": text, "trefwoorden": [text] } ] }.
-- Idempotent: overschrijft de hint per key (jsonb_build_object).
update public.concepts set normalization = jsonb_build_object(
  'omschrijving',
  'De BOVENGRENS (maximum) van de solidariteitsreserve, uitgedrukt als percentage. ' ||
  'LET OP: dit is uitdrukkelijk NIET de ondergrens/minimum, NIET een premiepercentage ' ||
  'en NIET een andere reserve of buffer. Alleen het expliciete maximum/plafond van de ' ||
  'solidariteitsreserve telt.'
) where key = 'solidariteitsreserve.bovengrens';

update public.concepts set normalization = jsonb_build_object(
  'omschrijving',
  'De franchise: het deel van het salaris waarover GEEN pensioen wordt opgebouwd, ' ||
  'uitgedrukt als bedrag in euro''s. NIET het maximum pensioengevend salaris, NIET de ' ||
  'premiegrondslag, NIET een ander bedrag in het document.'
) where key = 'franchise';

update public.concepts set normalization = jsonb_build_object(
  'omschrijving',
  'De gekozen invaarmethodiek: de methode waarmee bestaande aanspraken worden omgezet ' ||
  'naar persoonlijke pensioenvermogens. Kies uit: ''standaard'' (de standaardmethode / ' ||
  'value-based, collectief) of ''individueel'' (de individuele methode / individuele toerekening).',
  'enums', jsonb_build_array(
    jsonb_build_object('waarde','standaard','trefwoorden', jsonb_build_array(
      'standaardmethode','standaard methode','standaardmethodiek','standaard invaarmethode',
      'value based','value-based','collectieve waardering','standaard','std')),
    jsonb_build_object('waarde','individueel','trefwoorden', jsonb_build_array(
      'individuele methode','individuele methodiek','individueel invaren',
      'individuele toerekening','individuele waardering','individueel'))
  )
) where key = 'invaarmethodiek';

-- transitiedatum blijft 'uitgesteld' (datum-disambiguatie niet gehaald, S1); T8
-- extraheert 'uitgesteld'-concepten niet, dus een omschrijving is hier niet nodig.

-- ── 3. Skip-index voor de idempotentie-check ─────────────────────────────────
-- De job slaat over als er al een GESLAAGDE run is voor (document_id, catalog_version).
create index if not exists idx_extraction_run_doc_catalog
  on public.extraction_run (document_id, catalog_version);

-- ── 4. Atomische schrijffunctie (append-only run + vervangbare units) ─────────
-- Schrijft in één transactie: (a) de extraction_run-header (append-only, één keer,
-- status meteen definitief), en bij status='geslaagd' (b) delete-then-insert van
-- de semantic_units voor dit document. Zo is er geen tussenstand waarin een
-- geslaagde run zonder units of half-vervangen units bestaat.
--
-- SECURITY INVOKER: draait met de rechten van de aanroeper. De enige aanroeper is
-- de service-role (worker in het beheer-project). Geen definer-bypass, en EXECUTE
-- is aan public/anon/authenticated ontzegd — een tenant-client kan de functie niet
-- aanroepen en dus geen extractie-provenance vervalsen.
create or replace function public.fn_schrijf_semantische_extractie(
  p_fonds_id          uuid,
  p_document_id       uuid,
  p_model             text,
  p_prompt_version    text,
  p_extractor_version text,
  p_catalog_version   text,
  p_status            text,     -- 'geslaagd' | 'mislukt'
  p_units             jsonb     -- array van units; genegeerd bij status<>'geslaagd'
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_run_id uuid;
begin
  if p_status not in ('geslaagd','mislukt') then
    raise exception 'fn_schrijf_semantische_extractie: ongeldige status %', p_status;
  end if;

  insert into public.extraction_run
    (fonds_id, document_id, model, prompt_version, extractor_version,
     catalog_version, status, finished_at)
  values
    (p_fonds_id, p_document_id, p_model, p_prompt_version, p_extractor_version,
     p_catalog_version, p_status, now())
  returning id into v_run_id;

  -- Alleen bij een geslaagde run de units vervangen. Een mislukte run laat de
  -- bestaande (mogelijk goede) units met rust en is puur provenance van de mislukking.
  if p_status = 'geslaagd' then
    delete from public.semantic_units where document_id = p_document_id;

    if p_units is not null and jsonb_typeof(p_units) = 'array' then
      insert into public.semantic_units
        (fonds_id, document_id, chunk_id, concept_id, type, statement, value_raw,
         value_num, value_date, value_text, value_unit, page, section, evidence,
         evidence_verified, confidence_signals, document_status, extraction_run_id)
      select
        p_fonds_id,
        p_document_id,
        nullif(u->>'chunk_id','')::uuid,
        (u->>'concept_id')::uuid,
        u->>'type',
        u->>'statement',
        u->>'value_raw',
        nullif(u->>'value_num','')::numeric,
        nullif(u->>'value_date','')::date,
        nullif(u->>'value_text','')::text,
        nullif(u->>'value_unit','')::text,
        nullif(u->>'page','')::int,
        nullif(u->>'section','')::text,
        u->>'evidence',
        coalesce((u->>'evidence_verified')::boolean, false),
        coalesce(u->'confidence_signals', '{}'::jsonb),
        nullif(u->>'document_status','')::text,
        v_run_id
      from jsonb_array_elements(p_units) as u;
    end if;
  end if;

  return v_run_id;
end $$;

comment on function public.fn_schrijf_semantische_extractie(uuid,uuid,text,text,text,text,text,jsonb) is
  'T8: atomische schrijf van één extraction_run (append-only) + vervanging van de '
  'semantic_units van dit document. SECURITY INVOKER, alleen door service_role '
  'aanroepbaar (EXECUTE ontzegd aan public/anon/authenticated).';

-- Gate-H-hygiëne: EXECUTE breed ontzeggen, dan gericht aan service_role.
revoke all on function
  public.fn_schrijf_semantische_extractie(uuid,uuid,text,text,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function
  public.fn_schrijf_semantische_extractie(uuid,uuid,text,text,text,text,text,jsonb)
  to service_role;

commit;

-- ── Verificatie (handmatig ná de migratie) ───────────────────────────────────
-- 1. stap-CHECK accepteert de nieuwe waarde:
--      insert into public.document_processing_jobs (document_id, stap)
--        values ('<bestaand doc>', 'semantische_extractie');   -- moet slagen
-- 2. Catalogus-hints gezet (3 actieve concepten):
--      select key, normalization->>'omschrijving' is not null as heeft_omschrijving
--        from public.concepts where key in
--        ('solidariteitsreserve.bovengrens','franchise','invaarmethodiek');   -- 3× t
-- 3. Functie-grants (gate H):
--      select has_function_privilege('anon',
--        'public.fn_schrijf_semantische_extractie(uuid,uuid,text,text,text,text,text,jsonb)','EXECUTE');          -- f
--      select has_function_privilege('authenticated',
--        'public.fn_schrijf_semantische_extractie(uuid,uuid,text,text,text,text,text,jsonb)','EXECUTE');          -- f
--      select has_function_privilege('service_role',
--        'public.fn_schrijf_semantische_extractie(uuid,uuid,text,text,text,text,text,jsonb)','EXECUTE');          -- t
-- 4. Structurele gates A–H schoon: supabase/checks/2026_07_31_r1_structurele_gates.sql
-- 5. Gedragstoets: supabase/checks/2026_08_12_t8_semantische_extractie.sql
