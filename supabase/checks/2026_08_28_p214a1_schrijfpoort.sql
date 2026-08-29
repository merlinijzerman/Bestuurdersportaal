-- ============================================================================
-- Statische gate 2026-08-28 — #214-a1 schrijfpoort (besluit 0194). PRODUCTIEFIX.
-- ----------------------------------------------------------------------------
-- Bewaakt de revokes van p214a1_02/03/04 tegen grant-drift. Familie #209/#212.
-- Zuiver structureel. Uitvoeren: psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand.
--
-- ASSERTIEF, niet slechts bevestigend (eis 0194): de gate toetst NIET alleen dat
-- de toegestane kolommen schrijfbaar zijn, maar ook ASSERTIEF het ONTBREKEN van
-- een tabelbrede UPDATE-grant — want één `grant update on procedure_stappen to
-- authenticated` opent alle kolommen stil weer (kolomgrants zijn opsommend).
-- ============================================================================
do $$
declare
  bewaakt_stap text[] := array['status','voltooid_op','voltooid_door'];
  hergrant_stap text[] := array[
    'id','procedure_id','volgorde','naam','beschrijving','vereist_besluit','geschatte_dagen',
    'eigenaar_naam','deadline','blokkerende_afhankelijkheden','herbevestiging_nodig','heropend_op','fase_code'
  ];
  k text;
  fn text;
begin
  -- ── procedure_stappen: de bewaakte kolommen hebben GEEN authenticated-UPDATE …
  foreach k in array bewaakt_stap loop
    if has_column_privilege('authenticated','public.procedure_stappen',k,'update') then
      raise exception 'FAALT: authenticated heeft UPDATE op procedure_stappen.% (kolom-revoke weg).', k;
    end if;
  end loop;
  -- … de her-verleende kolommen hebben hem WÉL …
  foreach k in array hergrant_stap loop
    if not has_column_privilege('authenticated','public.procedure_stappen',k,'update') then
      raise exception 'FAALT: authenticated mist UPDATE op procedure_stappen.% (her-grant te breed ingetrokken).', k;
    end if;
  end loop;
  -- … en er is ASSERTIEF GEEN tabelbrede UPDATE-grant (die zou alle kolommen heropenen).
  if exists (select 1 from information_schema.role_table_grants
             where table_schema='public' and table_name='procedure_stappen'
               and grantee='authenticated' and privilege_type='UPDATE') then
    raise exception 'FAALT: tabelbrede UPDATE-grant op procedure_stappen voor authenticated (opent alle kolommen).';
  end if;
  -- DELETE is ingetrokken (reviewbevinding); INSERT blijft (aanmaakpad).
  if has_table_privilege('authenticated','public.procedure_stappen','delete') then
    raise exception 'FAALT: authenticated heeft DELETE op procedure_stappen (revoke weg).';
  end if;
  if not has_table_privilege('authenticated','public.procedure_stappen','insert') then
    raise exception 'FAALT: authenticated mist INSERT op procedure_stappen (aanmaakpad kapot).';
  end if;
  -- INSERT-poort tegen status/voltooiing bij aanmaken (p214a1_04).
  if to_regprocedure('public.fn_guard_stap_insert()') is null then
    raise exception 'FAALT: fn_guard_stap_insert() ontbreekt (INSERT-omzeiling open).';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                 where c.relname='procedure_stappen' and t.tgname='trg_guard_stap_insert' and not t.tgisinternal) then
    raise exception 'FAALT: trigger trg_guard_stap_insert ontbreekt op procedure_stappen.';
  end if;

  -- ── procedure_besluiten: geen tabelbrede UPDATE en geen DELETE; INSERT + SELECT blijven.
  if exists (select 1 from information_schema.role_table_grants
             where table_schema='public' and table_name='procedure_besluiten'
               and grantee='authenticated' and privilege_type='UPDATE') then
    raise exception 'FAALT: tabelbrede UPDATE-grant op procedure_besluiten voor authenticated.';
  end if;
  if has_table_privilege('authenticated','public.procedure_besluiten','delete') then
    raise exception 'FAALT: authenticated heeft DELETE op procedure_besluiten (revoke weg).';
  end if;
  if not has_table_privilege('authenticated','public.procedure_besluiten','insert') then
    raise exception 'FAALT: authenticated mist INSERT op procedure_besluiten (te breed ingetrokken).';
  end if;

  -- ── De drie schrijf-RPC's: SECURITY DEFINER, execute alleen voor authenticated.
  foreach fn in array array[
    'public.fn_stap_afronden(uuid, uuid)',
    'public.fn_stap_activeren(uuid, uuid)',
    'public.fn_stap_heropenen(uuid, uuid, text)'
  ] loop
    if to_regprocedure(fn) is null then
      raise exception 'FAALT: RPC % ontbreekt.', fn;
    end if;
    if not (select prosecdef from pg_proc where oid = to_regprocedure(fn)) then
      raise exception 'FAALT: RPC % is niet SECURITY DEFINER.', fn;
    end if;
    if not has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'FAALT: authenticated mist execute op %.', fn;
    end if;
    if has_function_privilege('service_role', fn, 'execute') then
      raise exception 'FAALT: service_role heeft execute op % (geen mens erachter).', fn;
    end if;
    if has_function_privilege('anon', fn, 'execute') then
      raise exception 'FAALT: anon heeft execute op % (ongeauthenticeerd pad).', fn;
    end if;
  end loop;

  raise notice 'OK: #214-a1 schrijfpoort intact (3 kolommen + INSERT-poort + geen tabel-UPDATE/DELETE; besluiten UPDATE/DELETE-revoke; drie RPC''s SECURITY DEFINER + alleen authenticated).';
end $$;
