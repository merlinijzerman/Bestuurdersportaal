-- ROLLBACK van 2026_08_29_p4_06 (P4 tranche 6). Herstelt de transitiematrix
-- zonder beeindigd-randen en verwijdert de twee procedure-RPC's. LET OP: draai
-- niet terug als er al decision_objects met status 'beeindigd' bestaan.
begin;
drop function if exists public.fn_procedure_beeindigen(uuid, text);
drop function if exists public.fn_procedure_heropenen(uuid, text);

create or replace function public.fn_decision_status_check()
returns trigger language plpgsql as $$
declare
  toegestaan jsonb := jsonb_build_object(
    'concept',                    jsonb_build_array('in_onderbouwing','geannuleerd'),
    'in_onderbouwing',            jsonb_build_array('in_validatie','teruggezet','geannuleerd'),
    'in_validatie',               jsonb_build_array('in_review','teruggezet','geescaleerd'),
    'in_review',                  jsonb_build_array('geagendeerd','teruggezet','geescaleerd'),
    'geagendeerd',                jsonb_build_array('in_bespreking','aangehouden'),
    'in_bespreking',              jsonb_build_array('besloten','voorwaardelijk_besloten','aangehouden','teruggezet','afgewezen'),
    'besloten',                   jsonb_build_array('in_uitvoering','afgesloten'),
    'voorwaardelijk_besloten',    jsonb_build_array('in_uitvoering','heropend'),
    'in_uitvoering',              jsonb_build_array('in_evaluatie','geescaleerd'),
    'in_evaluatie',               jsonb_build_array('afgesloten','heropend'),
    'afgesloten',                 jsonb_build_array('heropend'),
    'teruggezet',                 jsonb_build_array('in_onderbouwing','in_validatie'),
    'geescaleerd',                jsonb_build_array('in_validatie','in_review','aangehouden'),
    'aangehouden',                jsonb_build_array('in_review','geagendeerd','geannuleerd'),
    'heropend',                   jsonb_build_array('in_onderbouwing','in_validatie'),
    'afgewezen',                  jsonb_build_array(),
    'geannuleerd',                jsonb_build_array()
  );
  toegestane_arr text[];
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  toegestane_arr := array(
    select jsonb_array_elements_text(coalesce(toegestaan -> old.status, '[]'::jsonb))
  );
  if not (new.status = any (toegestane_arr)) then
    raise exception
      'Ongeldige statusovergang van % naar %. Toegestaan: %',
      old.status, new.status, toegestane_arr;
  end if;
  return new;
end;
$$;
commit;
