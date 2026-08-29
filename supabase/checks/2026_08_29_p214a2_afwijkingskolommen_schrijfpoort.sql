-- ============================================================================
-- Statische gate 2026-08-29 — #214-a2 afwijkingskolommen (besluit 0194).
-- ----------------------------------------------------------------------------
-- Dunne, additieve epic-aanvulling op #214-a1. A1 trekt de tabelbrede UPDATE in
-- en her-verleent alleen de kolommen die op main bestaan; daardoor vallen deze
-- vier epic-kolommen fail-closed. Deze aparte gate maakt die afhankelijkheid
-- expliciet en bewaakt haar tegen latere grant-drift, zonder A1 te herschrijven.
--
-- Zuiver structureel. Uitvoeren als postgres:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f dit-bestand
-- ROL: postgres — deze catalogusgate moet kolom- en functieprivileges voor alle
-- rollen kunnen zien; browsergedrag blijft in de bestaande a1/P3C-gedragstoetsen.
-- ============================================================================
do $$
declare
  bewaakt text[] := array[
    'afgerond_met_afwijking',
    'afwijking_motivering',
    'afwijking_snapshot',
    'afwijking_door'
  ];
  k text;
  fn text := 'public.fn_stap_afronden_met_afwijking(uuid, uuid, text, boolean)';
begin
  foreach k in array bewaakt loop
    if not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'procedure_stappen'
         and column_name = k
    ) then
      raise exception 'FAALT: #214-a2 verwacht procedure_stappen.%, maar de kolom ontbreekt.', k;
    end if;

    if has_column_privilege('authenticated', 'public.procedure_stappen', k, 'update') then
      raise exception 'FAALT: authenticated heeft UPDATE op procedure_stappen.% (#214-a2-revoke weg).', k;
    end if;
  end loop;

  -- Het enige legitieme browserpad schrijft de vier kolommen als eigenaar, maar
  -- blijft zelf alleen voor authenticated aanroepbaar en draagt een eigen rol-/fondsgrendel.
  if to_regprocedure(fn) is null then
    raise exception 'FAALT: afwijkings-RPC % ontbreekt.', fn;
  end if;
  if not (select prosecdef from pg_proc where oid = to_regprocedure(fn)) then
    raise exception 'FAALT: afwijkings-RPC % is niet SECURITY DEFINER.', fn;
  end if;
  if not has_function_privilege('authenticated', fn, 'execute') then
    raise exception 'FAALT: authenticated mist execute op afwijkings-RPC %.', fn;
  end if;
  if has_function_privilege('anon', fn, 'execute') then
    raise exception 'FAALT: anon heeft execute op afwijkings-RPC %.', fn;
  end if;
  if has_function_privilege('service_role', fn, 'execute') then
    raise exception 'FAALT: service_role heeft execute op afwijkings-RPC % (geen mens erachter).', fn;
  end if;

  raise notice 'OK: #214-a2 schrijfpoort intact (vier afwijkingskolommen niet UPDATE-baar; afwijkings-RPC SECURITY DEFINER en alleen authenticated).';
end $$;
