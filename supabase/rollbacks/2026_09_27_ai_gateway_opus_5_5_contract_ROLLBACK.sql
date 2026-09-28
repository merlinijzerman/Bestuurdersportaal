-- Handmatige rollback voor 2026_09_27_ai_gateway_opus_5_5_contract.sql.
-- Fail-closed zodra nieuwe data niet zonder verlies in het oude contract past.

begin;

do $$
begin
  if exists (
    select 1
      from ai_gateway_private.gateway_log
     where stop_reden in ('contextvenster', 'pauze', 'weigering')
        or tokens_thinking is not null
  ) then
    raise exception 'Rollback #438 geweigerd: gateway_log bevat nieuwe stopredenen of thinking-tokenwaarden';
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
    tokens_in, tokens_out, tokens_cache_lezen, tokens_cache_creatie, tokens_totaal,
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
    coalesce(nullif(p->>'tokens_totaal','')::integer, 0),
    p->>'correlatie_id',
    nullif(p->>'actie_id','')::uuid,
    nullif(p->>'label','')
  )
  returning id into v_id;
  return v_id;
end;
$$;

alter table ai_gateway_private.gateway_log
  drop constraint if exists gateway_log_stop_reden_check;

alter table ai_gateway_private.gateway_log
  add constraint gateway_log_stop_reden_check
  check (stop_reden is null or stop_reden in ('einde','max_tokens','stop_sequence','tool','onbekend'));

alter table ai_gateway_private.gateway_log
  drop column if exists tokens_thinking;

comment on function ai_gateway_private.schrijf_log(jsonb) is
  'Schrijft één inhoudsvrije gateway-auditregel; alleen de minimale gatewayrol heeft EXECUTE.';

commit;
