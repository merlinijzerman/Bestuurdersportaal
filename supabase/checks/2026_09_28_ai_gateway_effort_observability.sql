-- #438 PR2 — werkelijk toegepast effort in de inhoudsvrije gateway-audit.
-- ROL: postgres voor catalogus/asserties; schrijfscenario's draaien via
-- `set local role ai_gateway`. Alles staat in één transactie en rolt terug.

begin;
grant ai_gateway to postgres;

do $$
declare
  v_id uuid;
  v_legacy ai_gateway_private.gateway_log%rowtype;
  v_effort ai_gateway_private.gateway_log%rowtype;
  v_constraint text;
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'ai_gateway_private'
       and table_name = 'gateway_log'
       and column_name = 'effort'
       and data_type = 'text'
       and is_nullable = 'YES'
  ) then
    raise exception 'FAALT #438-DB6: nullable textkolom effort ontbreekt';
  end if;

  select string_agg(pg_get_constraintdef(c.oid), E'\n') into v_constraint
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
   where n.nspname = 'ai_gateway_private'
     and r.relname = 'gateway_log'
     and c.contype = 'c';

  if v_constraint not like '%minimal%'
     or v_constraint not like '%low%'
     or v_constraint not like '%medium%'
     or v_constraint not like '%high%'
     or v_constraint not like '%xhigh%'
     or v_constraint not like '%max%' then
    raise exception 'FAALT #438-DB7: effortconstraint onvolledig: %', v_constraint;
  end if;

  if not has_function_privilege(
    'ai_gateway', 'ai_gateway_private.schrijf_log(jsonb)', 'execute'
  ) then
    raise exception 'FAALT #438-DB8: ai_gateway verloor execute op schrijf_log';
  end if;

  set local role ai_gateway;
  v_id := ai_gateway_private.schrijf_log(jsonb_build_object(
    'actor_soort', 'systeem', 'proces', 'test-438-pr2',
    'taaktype', 'chat_generatie', 'provider', 'anthropic',
    'model', 'claude-opus-4-8', 'resultaat', 'ok', 'stop_reden', 'einde',
    'tokens_in', 10, 'tokens_out', 5, 'tokens_totaal', 15,
    'correlatie_id', 'test-438-pr2-legacy'
  ));
  reset role;
  select * into v_legacy from ai_gateway_private.gateway_log where id = v_id;
  if v_legacy.effort is not null then
    raise exception 'FAALT #438-DB9: legacycall kreeg een verzonnen effortwaarde';
  end if;

  set local role ai_gateway;
  v_id := ai_gateway_private.schrijf_log(jsonb_build_object(
    'actor_soort', 'systeem', 'proces', 'test-438-pr2',
    'taaktype', 'chat_generatie', 'provider', 'anthropic',
    'model', 'claude-opus-5-5', 'resultaat', 'ok', 'stop_reden', 'einde',
    'tokens_in', 10, 'tokens_out', 9, 'tokens_totaal', 19,
    'effort', 'xhigh', 'correlatie_id', 'test-438-pr2-effort'
  ));
  reset role;
  select * into v_effort from ai_gateway_private.gateway_log where id = v_id;
  if v_effort.effort <> 'xhigh' then
    raise exception 'FAALT #438-DB10: effortwaarde niet intact: %', to_jsonb(v_effort);
  end if;

  begin
    set local role ai_gateway;
    perform ai_gateway_private.schrijf_log(jsonb_build_object(
      'actor_soort', 'systeem', 'proces', 'test-438-pr2',
      'taaktype', 'chat_generatie', 'provider', 'anthropic',
      'model', 'claude-opus-5-5', 'resultaat', 'ok', 'stop_reden', 'einde',
      'tokens_in', 10, 'tokens_out', 2, 'tokens_totaal', 12,
      'effort', 'ultra', 'correlatie_id', 'test-438-pr2-invalid'
    ));
    reset role;
    raise exception 'FAALT #438-DB11: onbekende effortwaarde werd toegestaan';
  exception
    when check_violation then reset role;
  end;

  raise notice 'OK #438-DB PR2: nullable legacywaarde, gesloten effortlijst en minimale schrijfrol.';
end;
$$;

rollback;
