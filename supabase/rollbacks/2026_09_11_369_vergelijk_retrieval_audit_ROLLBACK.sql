-- Rollback #369. Verwijdert uitsluitend de nieuwe auditvorm en heropent de
-- voorgaande vijf-argumentfunctie. comparison_run-rijen zijn append-only: deze
-- rollback verwijdert geen historische runs; de drie kolommen kunnen daarom
-- alleen worden gedropt als er nog geen #369-run is geschreven.

begin;

-- Houd de controle en het droppen van de auditkolommen in hetzelfde slot.
-- Zonder deze grendel zou de rollback ook na een geslaagde vergelijking de
-- duurzame provenance van historische runs wissen.
set local lock_timeout = '5s';
lock table public.comparison_run, public.comparison_results in access exclusive mode;
do $$
begin
  if exists (select 1 from public.comparison_run)
     or exists (select 1 from public.comparison_results) then
    raise exception '369_rollback_geweigerd_bestaande_runs' using errcode = '23514';
  end if;
end $$;

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
