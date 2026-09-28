-- #438 PR2 — werkelijk toegepast effort-niveau in de inhoudsvrije gateway-log.
-- Geen modelactivatie, tenantwijziging, promptinhoud of nieuwe browsertoegang.

begin;

alter table ai_gateway_private.gateway_log
  add column if not exists effort text
    check (effort is null or effort in ('minimal','low','medium','high','xhigh','max'));

comment on column ai_gateway_private.gateway_log.effort is
  'Werkelijk door het providermodel toegepast effort-niveau; NULL voor modellen zonder effort.';

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
    tokens_thinking, tokens_totaal, effort,
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
    nullif(p->>'effort',''),
    p->>'correlatie_id',
    nullif(p->>'actie_id','')::uuid,
    nullif(p->>'label','')
  )
  returning id into v_id;
  return v_id;
end;
$$;

comment on function ai_gateway_private.schrijf_log(jsonb) is
  'Schrijft één inhoudsvrije gateway-auditregel, inclusief werkelijk toegepast effort (#438).';

commit;

