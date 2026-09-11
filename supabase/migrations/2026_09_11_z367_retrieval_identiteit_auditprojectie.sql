-- ============================================================================
-- #367 — correlation-id en inhoudsvrije bronresolutiestatus in de auditprojectie
-- ----------------------------------------------------------------------------
-- Deze additieve migratie sorteert bewust NA de reeds uitgebrachte
-- 2026_09_11_toelating_auditprojectie.sql. Daardoor leveren zowel een upgrade
-- als een verse, alfabetisch afgespeelde migratiereeks dezelfde wrappers op.
-- Append-only rijen worden niet herschreven; alleen de read-time projectie
-- wordt cumulatief uitgebreid.
-- ============================================================================

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
          and (p_meta->'contextbron_resolutie' - 'volledig' - 'reden' - 'kandidaatcap') = '{}'::jsonb
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
          and (p_meta->'contextbron_resolutie' - 'volledig' - 'reden' - 'kandidaatcap') = '{}'::jsonb
         then jsonb_build_object('contextbron_resolutie', p_meta->'contextbron_resolutie')
         else '{}'::jsonb
       end;
$$;

revoke all on function public.meta_basisniveau(jsonb) from public, anon;
revoke all on function public.meta_bronniveau(jsonb) from public, anon;
grant execute on function public.meta_basisniveau(jsonb) to authenticated;
grant execute on function public.meta_bronniveau(jsonb) to authenticated;

do $$
declare
  v_meta jsonb := '{"correlation_id":"corr-367","contextbron_resolutie":{"volledig":false,"reden":"kandidaatcap","kandidaatcap":2000},"zoekvraag":"Naam Persoon"}'::jsonb;
begin
  if public.meta_basisniveau(v_meta)->>'correlation_id' <> 'corr-367'
     or public.meta_bronniveau(v_meta)->>'correlation_id' <> 'corr-367' then
    raise exception '#367: correlation_id verdwijnt uit de auditprojectie';
  end if;
  if public.meta_basisniveau(v_meta) ? 'zoekvraag'
     or public.meta_bronniveau(v_meta) ? 'zoekvraag' then
    raise exception '#367: inhoud lekt door de correlation-projectie';
  end if;
  if public.meta_basisniveau(v_meta)->'contextbron_resolutie' <> v_meta->'contextbron_resolutie'
     or public.meta_bronniveau(v_meta)->'contextbron_resolutie' <> v_meta->'contextbron_resolutie' then
    raise exception '#367: inhoudsvrije contextbron_resolutie verdwijnt uit de auditprojectie';
  end if;
end;
$$;
