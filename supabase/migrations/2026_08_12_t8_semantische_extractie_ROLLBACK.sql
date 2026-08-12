-- ============================================================================
-- ROLLBACK 2026-08-12 (T8) — semantische extractie: functie, stap, hints terug.
-- ----------------------------------------------------------------------------
-- Draait 2026_08_12_t8_semantische_extractie.sql terug. Puur additief was de
-- forward-migratie, dus rollback = de schrijffunctie droppen, de stap-CHECK
-- herstellen naar de T7-set (zonder 'semantische_extractie'), de catalogus-hints
-- leegmaken en de skip-index droppen.
--
-- LET OP: er mogen dan geen document_processing_jobs meer met
-- stap='semantische_extractie' openstaan (anders faalt de CHECK-herstel). Zet
-- eerst de flag SEMANTISCHE_EXTRACTIE uit en laat/verwijder lopende jobs.
-- Idempotent. Plak in Supabase → SQL Editor → Run.
-- ============================================================================

begin;

drop function if exists
  public.fn_schrijf_semantische_extractie(uuid,uuid,text,text,text,text,text,jsonb);

drop index if exists public.idx_extraction_run_doc_catalog;

-- Herstel de stap-CHECK naar de set van vóór T8 (zonder 'semantische_extractie').
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
    'validatie','scan','extractie','ocr','chunking','embedding','indexering'
  ));

-- Catalogus-hints terug naar NULL (T7-uitgangsstand).
update public.concepts set normalization = null
  where key in ('solidariteitsreserve.bovengrens','franchise','invaarmethodiek');

commit;
