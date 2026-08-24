-- ROLLBACK van
-- supabase/migrations/2026_08_22_bewijs_requirement_binding_hardening.sql
--
-- Voer dit uit vóór de rollback van de basismigratie van 18 augustus.
-- Bestaande auditregels en beslismoment-snapshots blijven append-only staan.

begin;

drop trigger if exists trg_procedure_bewijs_audit on public.procedure_bewijs;
drop trigger if exists trg_procedure_bewijs_validate_binding on public.procedure_bewijs;
drop trigger if exists trg_requirement_instance_validate_binding_sleutel
  on public.procedure_requirement_instance;

drop function if exists public.fn_audit_procedure_bewijs_mutation();
drop function if exists public.fn_validate_bewijs_requirement_binding();
drop function if exists public.fn_validate_requirement_instance_binding_sleutel();

drop index if exists public.idx_procedure_stappen_volgorde_uniek;
drop index if exists public.idx_procbewijs_req_sleutel;
create index if not exists idx_procbewijs_req_sleutel
  on public.procedure_bewijs(stap_id, requirement_sleutel)
  where requirement_sleutel is not null;

-- Herstel de dossierbuilder van 2026_05_20_stemmingen_dossier_fn.sql.
create or replace function public.fn_build_decision_dossier(p_decision_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'decision', to_jsonb(d.*),
    'procedure', (select to_jsonb(p.*) from public.procedures p where p.id = d.procedure_id),
    'assumptions', coalesce((select jsonb_agg(to_jsonb(a.*) order by a.aangemaakt_op)
                              from public.decision_assumptions a where a.decision_id = d.id), '[]'::jsonb),
    'risks',       coalesce((select jsonb_agg(to_jsonb(r.*) order by r.aangemaakt_op)
                              from public.decision_risks r where r.decision_id = d.id), '[]'::jsonb),
    'dissent',     coalesce((select jsonb_agg(to_jsonb(x.*) order by x.aangemaakt_op)
                              from public.decision_dissent x where x.decision_id = d.id), '[]'::jsonb),
    'conditions',  coalesce((select jsonb_agg(to_jsonb(c.*) order by c.aangemaakt_op)
                              from public.decision_conditions c where c.decision_id = d.id), '[]'::jsonb),
    'actions',     coalesce((select jsonb_agg(to_jsonb(ac.*) order by ac.aangemaakt_op)
                              from public.decision_actions ac where ac.decision_id = d.id), '[]'::jsonb),
    'evaluations', coalesce((select jsonb_agg(to_jsonb(e.*) order by e.geplande_datum)
                              from public.decision_evaluations e where e.decision_id = d.id), '[]'::jsonb),
    'aiOutputs',   coalesce((select jsonb_agg(to_jsonb(ai.*) order by ai.aangemaakt_op)
                              from public.decision_ai_interactions ai where ai.decision_id = d.id), '[]'::jsonb),
    'events',      coalesce((select jsonb_agg(to_jsonb(g.*) order by g.tijdstip)
                              from public.governance_events g where g.decision_id = d.id), '[]'::jsonb),
    'stemverslagen', coalesce((select jsonb_agg(to_jsonb(s.*) order by s.geopend_op desc)
                                from public.stemmingen s
                               where s.decision_id = d.id
                                 and s.status in ('gesloten','ingetrokken')), '[]'::jsonb)
  )
    from public.decision_objects d
   where d.id = p_decision_id;
$$;

revoke all on function public.fn_build_decision_dossier(uuid) from public, anon;
grant execute on function public.fn_build_decision_dossier(uuid)
  to authenticated, service_role;

commit;
