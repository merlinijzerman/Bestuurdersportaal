-- Handmatige rollback voor 2026_09_28_ai_gateway_effort_observability.sql.
-- Fail-closed zodra terugdraaien werkelijk gebruikte effortdata zou verliezen.

begin;

do $$
begin
  if exists (select 1 from ai_gateway_private.gateway_log where effort is not null) then
    raise exception 'Rollback #438 PR2 geweigerd: gateway_log bevat effortwaarden';
  end if;
end;
$$;

create or replace function ai_gateway_private.schrijf_log(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ai_gateway_private, public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'AI-gateway: schrijf_log verwacht een jsonb-object';
  end if;
  insert into ai_gateway_private.gateway_log (
    fonds_id, actor_soort, actor_id, proces, taaktype, taakgroep, modaliteit,
    provider, model, profiel_id, config_versie, poort_config_versie,
    resultaat, stop_reden, latency_ms,
    tokens_in, tokens_out, tokens_cache_lezen, tokens_cache_creatie,
    tokens_thinking, tokens_totaal,
    correlatie_id, actie_id, label
  ) values (
    nullif(p->>'fonds_id','')::uuid,
    p->>'actor_soort',
    nullif(p->>'actor_id','')::uuid,
    nullif(p->>'proces',''),
    p->>'taaktype',
    nullif(p->>'taakgroep',''),
    coalesce(nullif(p->>'modaliteit',''), 'tekst'),
    p->>'provider',
    p->>'model',
    nullif(p->>'profiel_id',''),
    nullif(p->>'config_versie','')::integer,
    nullif(p->>'poort_config_versie','')::bigint,
    p->>'resultaat',
    nullif(p->>'stop_reden',''),
    nullif(p->>'latency_ms','')::integer,
    coalesce(nullif(p->>'tokens_in','')::integer, 0),
    coalesce(nullif(p->>'tokens_out','')::integer, 0),
    coalesce(nullif(p->>'tokens_cache_lezen','')::integer, 0),
    coalesce(nullif(p->>'tokens_cache_creatie','')::integer, 0),
    nullif(p->>'tokens_thinking','')::integer,
    coalesce(nullif(p->>'tokens_totaal','')::integer, 0),
    p->>'correlatie_id',
    nullif(p->>'actie_id','')::uuid,
    nullif(p->>'label','')
  )
  returning id into v_id;
  return v_id;
end;
$$;

alter table ai_gateway_private.gateway_log drop column if exists effort;

comment on function ai_gateway_private.schrijf_log(jsonb) is
  'Schrijft één inhoudsvrije gateway-auditregel, inclusief thinking-tokenobservability (#438).';

commit;

