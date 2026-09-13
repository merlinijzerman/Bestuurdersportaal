-- Rollback #369. Verwijdert uitsluitend de nieuwe auditvorm en heropent de
-- voorgaande vijf-argumentfunctie. comparison_run-rijen zijn append-only: deze
-- rollback verwijdert geen historische runs; de drie kolommen kunnen daarom
-- alleen worden gedropt als er nog geen #369-run is geschreven.

begin;

drop function if exists public.fn_schrijf_vergelijking(text,text,text,text,jsonb,text,jsonb,jsonb);
grant execute on function public.fn_schrijf_vergelijking(text,text,text,text,jsonb)
  to authenticated;

alter table public.comparison_results
  drop column if exists doel_passage_ref,
  drop column if exists bron_passage_ref;

alter table public.comparison_run
  drop column if exists bronnen,
  drop column if exists retrieval_meta,
  drop column if exists correlation_id;

commit;
