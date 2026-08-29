-- P3 / PR-D (#168) — readiness-ontmanteling, DB-laag (uitfaseringsstap 3). Besluit 0187/0193.
-- ---------------------------------------------------------------------------
-- Pas nu niets de readiness-functies meer leest (de statusroute-gate en de
-- dossier-view zijn in stap 1/2 omgezet naar de besluitmoment-telling), worden ze
-- gedropt. HAND-APPLIED. Rollback:
--   supabase/rollbacks/2026_08_28_p3d_01_readiness_drop_ROLLBACK.sql
--
-- OBJECT-INVENTARIS (bevinding review): de readiness-migraties (d7c_readiness_unie,
-- readiness_blokkerend_ambiguiteit_fix, readiness_uitsluiting) deden UITSLUITEND een
-- `create or replace` op fn_decision_readiness_check; ze maakten geen tabel/enum/
-- kolom/index. Het droppen van de twee functies verwijdert dus álle readiness-
-- specifieke objecten — er blijft niets verweesds achter. Gedeelde D10/I1-objecten
-- (procedure_bewijs.requirement_sleutel + idx_procbewijs_req_sleutel, en de tabel
-- procedure_requirement_uitsluiting) zijn GEEN readiness-objecten en blijven staan.
--
-- fn_build_decision_dossier embedde `readiness` in de snapshot-payload; die key
-- vervalt hier (nieuwe snapshots dragen 'm niet meer). Bestaande, append-only
-- snapshots houden hun readiness-key — afschrift-feitenkaart leest die optioneel en
-- valt voor nieuwe dossiers terug op de evidence (§443-slot: oude afschriften
-- ongewijzigd).

begin;

-- 1. fn_build_decision_dossier ZONDER de readiness-key (verder identiek).
--    Eerst herdefiniëren, dán droppen: een functie-naar-functie-aanroep is in
--    Postgres geen harde dependency, dus de drop zou anders een kapotte call
--    achterlaten.
create or replace function public.fn_build_decision_dossier(p_decision_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'decision', to_jsonb(d.*),
    'procedure', (select to_jsonb(p.*) from public.procedures p where p.id = d.procedure_id),
    'steps', coalesce((select jsonb_agg(to_jsonb(ps.*) order by ps.volgorde, ps.id)
                        from public.procedure_stappen ps where ps.procedure_id = d.procedure_id), '[]'::jsonb),
    'bewijs', coalesce((select jsonb_agg(to_jsonb(pb.*) order by ps.volgorde, pb.toegevoegd_op, pb.id)
                         from public.procedure_stappen ps
                         join public.procedure_bewijs pb on pb.stap_id = ps.id
                        where ps.procedure_id = d.procedure_id), '[]'::jsonb),
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
grant execute on function public.fn_build_decision_dossier(uuid) to authenticated, service_role;

-- 2. De readiness-functies droppen (overview eerst — hij roept check aan).
drop function if exists public.fn_decision_readiness_overview(uuid);
drop function if exists public.fn_decision_readiness_check(uuid, text);

commit;
