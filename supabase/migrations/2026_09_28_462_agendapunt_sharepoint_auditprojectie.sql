-- #462 PR-5 — gesloten auditprojectie voor automatisch geraadpleegde
-- SharePoint-koppelingen. De basisviewer ziet niets; alleen de bestaande
-- bronviewer ziet lokale UUID-refs en inhoudsarme tellingen. Nooit namen,
-- paden, URL's, Graph-id's, prompts of documentinhoud.
-- ROLLBACK: ../rollbacks/2026_09_28_462_agendapunt_sharepoint_auditprojectie_ROLLBACK.sql

create or replace function public.meta_agendapunt_sharepoint_projectie(p_meta jsonb)
returns jsonb
language plpgsql immutable
set search_path = public, pg_temp
as $fn$
declare
  v jsonb := p_meta -> 'agendapunt_sharepoint';
begin
  if v is null then return '{}'::jsonb; end if;
  if jsonb_typeof(v) <> 'object'
     or (v - array['document_refs','map_refs','kandidaten','gebruikte_documenten','afgekapt']) <> '{}'::jsonb
     or (select count(*) from jsonb_object_keys(v)) <> 5
     or jsonb_typeof(v->'document_refs') <> 'array'
     or jsonb_typeof(v->'map_refs') <> 'array'
     or jsonb_array_length(v->'document_refs') > 25
     or jsonb_array_length(v->'map_refs') > 25
     or exists (
       select 1 from jsonb_array_elements(v->'document_refs') e
        where jsonb_typeof(e) <> 'string'
           or e #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     )
     or exists (
       select 1 from jsonb_array_elements(v->'map_refs') e
        where jsonb_typeof(e) <> 'string'
           or e #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     )
     or jsonb_typeof(v->'kandidaten') <> 'number'
     or (v->>'kandidaten')::numeric < 0
     or floor((v->>'kandidaten')::numeric) <> (v->>'kandidaten')::numeric
     or jsonb_typeof(v->'gebruikte_documenten') <> 'number'
     or (v->>'gebruikte_documenten')::numeric < 0
     or floor((v->>'gebruikte_documenten')::numeric) <> (v->>'gebruikte_documenten')::numeric
     or jsonb_typeof(v->'afgekapt') <> 'boolean'
  then
    raise exception 'agendapunt_sharepoint_auditmeta_ongeldig'
      using errcode = 'check_violation';
  end if;
  return jsonb_build_object('agendapunt_sharepoint', v);
end;
$fn$;

revoke all on function public.meta_agendapunt_sharepoint_projectie(jsonb) from public, anon;
grant execute on function public.meta_agendapunt_sharepoint_projectie(jsonb) to authenticated;

create or replace function public.meta_bronniveau(p_meta jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select public.meta_basisniveau(p_meta)
    || public.meta_projectie(p_meta, true)
    || public.meta_agendapunt_sharepoint_projectie(p_meta);
$$;

revoke all on function public.meta_bronniveau(jsonb) from public, anon;
grant execute on function public.meta_bronniveau(jsonb) to authenticated;
