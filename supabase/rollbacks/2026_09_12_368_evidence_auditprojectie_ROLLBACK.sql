-- Rollback #368 — herstel de cumulatieve #367-wrappers.

create or replace function public.meta_basisniveau(p_meta jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select public.meta_projectie(p_meta, false)
    || case
         when jsonb_typeof(p_meta) = 'object'
          and jsonb_typeof(p_meta->'correlation_id') = 'string'
          and length(p_meta->>'correlation_id') > 0
         then jsonb_build_object('correlation_id', p_meta->'correlation_id')
         else '{}'::jsonb
       end
    || case
         when jsonb_typeof(p_meta->'contextbron_resolutie') = 'object'
          and jsonb_typeof(p_meta->'contextbron_resolutie'->'volledig') = 'boolean'
          and jsonb_typeof(p_meta->'contextbron_resolutie'->'reden') = 'string'
          and p_meta->'contextbron_resolutie'->>'reden' in (
            'opgelost','kandidaatcap','ontbrekende_ref','ontbrekende_binding',
            'private_scope_ontbreekt','providerfout'
          )
          and jsonb_typeof(p_meta->'contextbron_resolutie'->'kandidaatcap') = 'number'
          and p_meta->'contextbron_resolutie'->'kandidaatcap' = '2000'::jsonb
          and ((p_meta->'contextbron_resolutie') - 'volledig' - 'reden' - 'kandidaatcap') = '{}'::jsonb
         then jsonb_build_object('contextbron_resolutie', p_meta->'contextbron_resolutie')
         else '{}'::jsonb
       end;
$$;

create or replace function public.meta_bronniveau(p_meta jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select public.meta_projectie(p_meta, true)
    || case
         when jsonb_typeof(p_meta) = 'object'
          and jsonb_typeof(p_meta->'correlation_id') = 'string'
          and length(p_meta->>'correlation_id') > 0
         then jsonb_build_object('correlation_id', p_meta->'correlation_id')
         else '{}'::jsonb
       end
    || case
         when jsonb_typeof(p_meta->'contextbron_resolutie') = 'object'
          and jsonb_typeof(p_meta->'contextbron_resolutie'->'volledig') = 'boolean'
          and jsonb_typeof(p_meta->'contextbron_resolutie'->'reden') = 'string'
          and p_meta->'contextbron_resolutie'->>'reden' in (
            'opgelost','kandidaatcap','ontbrekende_ref','ontbrekende_binding',
            'private_scope_ontbreekt','providerfout'
          )
          and jsonb_typeof(p_meta->'contextbron_resolutie'->'kandidaatcap') = 'number'
          and p_meta->'contextbron_resolutie'->'kandidaatcap' = '2000'::jsonb
          and ((p_meta->'contextbron_resolutie') - 'volledig' - 'reden' - 'kandidaatcap') = '{}'::jsonb
         then jsonb_build_object('contextbron_resolutie', p_meta->'contextbron_resolutie')
         else '{}'::jsonb
       end;
$$;

revoke all on function public.meta_basisniveau(jsonb) from public, anon;
revoke all on function public.meta_bronniveau(jsonb) from public, anon;
grant execute on function public.meta_basisniveau(jsonb) to authenticated;
grant execute on function public.meta_bronniveau(jsonb) to authenticated;
