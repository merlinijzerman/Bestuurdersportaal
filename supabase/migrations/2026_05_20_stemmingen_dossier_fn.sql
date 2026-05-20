-- ============================================================
--  Migratie 2026-05-20b — fn_build_decision_dossier uitbreiden met stemverslagen
--
--  Aanvulling op 2026_05_20_stemmingen.sql. De view-builder
--  fn_build_decision_dossier wordt gebruikt door (a) de live dossier-API
--  en (b) de snapshot-trigger. Door hier een 'stemverslagen'-key toe te
--  voegen, worden gesloten/ingetrokken stemmingen vanaf nu ook in de
--  decision_audit_snapshots-payload opgenomen (VERGADERINGEN-V2-ONTWERP §7.6).
--
--  Open stemmingen worden bewust uitgesloten — die hebben geen
--  vastliggende uitslag en horen niet in een snapshot.
--
--  `create or replace function`, idempotent. Plak in SQL Editor → Run.
-- ============================================================

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
    -- Nieuw: gesloten/ingetrokken stemmingen (open uitgesloten — geen vaste uitslag)
    'stemverslagen', coalesce((select jsonb_agg(to_jsonb(s.*) order by s.geopend_op desc)
                              from public.stemmingen s
                             where s.decision_id = d.id
                               and s.status in ('gesloten','ingetrokken')), '[]'::jsonb)
  )
    from public.decision_objects d
   where d.id = p_decision_id;
$$;

-- ============================================================
--  Verificatie:
--   select jsonb_object_keys(public.fn_build_decision_dossier(
--     (select id from public.decision_objects limit 1)));
--   → moet 'stemverslagen' bevatten
-- ============================================================
