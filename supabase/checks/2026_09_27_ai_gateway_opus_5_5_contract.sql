-- #438 PR1 — databasecontract voor Opus 5.5/Sonnet 5.
-- ROL: postgres voor catalogus/asserties; schrijfscenario's draaien via
-- `set local role ai_gateway`. Alles staat in één transactie en rolt terug.

begin;
grant ai_gateway to postgres;

do $$
declare
  v_id uuid;
  v_legacy ai_gateway_private.gateway_log%rowtype;
  v_nieuw ai_gateway_private.gateway_log%rowtype;
  v_constraint text;
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'ai_gateway_private'
       and table_name = 'gateway_log'
       and column_name = 'tokens_thinking'
       and data_type = 'integer'
       and is_nullable = 'YES'
  ) then
    raise exception 'FAALT #438-DB1: nullable integer tokens_thinking ontbreekt';
  end if;

  select string_agg(pg_get_constraintdef(c.oid), E'\n') into v_constraint
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
   where n.nspname = 'ai_gateway_private'
     and r.relname = 'gateway_log'
     and c.contype = 'c';

  if v_constraint not like '%contextvenster%'
     or v_constraint not like '%pauze%'
     or v_constraint not like '%weigering%'
     or v_constraint not like '%tokens_thinking <= tokens_out%' then
    raise exception 'FAALT #438-DB2: stopredenen/subsetconstraint onvolledig: %', v_constraint;
  end if;

  set local role ai_gateway;
  v_id := ai_gateway_private.schrijf_log(jsonb_build_object(
    'actor_soort', 'systeem', 'proces', 'test-438',
    'taaktype', 'aqlab_generatie', 'provider', 'anthropic',
    'model', 'claude-opus-4-8', 'resultaat', 'ok', 'stop_reden', 'einde',
    'tokens_in', 10, 'tokens_out', 5, 'tokens_totaal', 15,
    'correlatie_id', 'test-438-legacy'
  ));
  reset role;
  select * into v_legacy from ai_gateway_private.gateway_log where id = v_id;
  if v_legacy.tokens_thinking is not null then
    raise exception 'FAALT #438-DB3: legacycall kreeg een verzonnen thinkingtelling';
  end if;

  set local role ai_gateway;
  v_id := ai_gateway_private.schrijf_log(jsonb_build_object(
    'actor_soort', 'systeem', 'proces', 'test-438',
    'taaktype', 'aqlab_generatie', 'provider', 'anthropic',
    'model', 'claude-opus-5-5', 'resultaat', 'ok', 'stop_reden', 'weigering',
    'tokens_in', 10, 'tokens_out', 9, 'tokens_thinking', 6, 'tokens_totaal', 19,
    'correlatie_id', 'test-438-new'
  ));
  reset role;
  select * into v_nieuw from ai_gateway_private.gateway_log where id = v_id;
  if v_nieuw.stop_reden <> 'weigering'
     or v_nieuw.tokens_thinking <> 6
     or v_nieuw.tokens_out <> 9
     or v_nieuw.tokens_totaal <> 19 then
    raise exception 'FAALT #438-DB4: nieuwe observabilitywaarden niet intact: %', to_jsonb(v_nieuw);
  end if;

  begin
    set local role ai_gateway;
    perform ai_gateway_private.schrijf_log(jsonb_build_object(
      'actor_soort', 'systeem', 'proces', 'test-438',
      'taaktype', 'aqlab_generatie', 'provider', 'anthropic',
      'model', 'claude-opus-5-5', 'resultaat', 'ok', 'stop_reden', 'einde',
      'tokens_in', 10, 'tokens_out', 2, 'tokens_thinking', 3, 'tokens_totaal', 12,
      'correlatie_id', 'test-438-invalid'
    ));
    reset role;
    raise exception 'FAALT #438-DB5: thinking > output werd toegestaan';
  exception
    when check_violation then reset role;
  end;

  raise notice 'OK #438-DB: nullable legacywaarde, nieuwe stopredenen, thinking-subset en minimale schrijfrol.';
end;
$$;

rollback;
