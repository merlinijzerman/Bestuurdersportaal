-- #256 — bediening voor procedure beëindigen/heropenen.
-- ---------------------------------------------------------------------------
-- P4 leverde de beveiligde statusovergang. Deze voorwaartse aanvulling maakt
-- die overgang auditinhoudelijk compleet voor de UI: bij beëindigen worden alle
-- niet-terminale stappen atomair 'vervallen', inclusief een server-side snapshot
-- van de oorspronkelijke stapstatussen en open vereisten per zwaarte. Bij
-- heropenen worden uitsluitend die gesnapshotte stappen hersteld. Heropenen
-- draagt bovendien een getypeerde reden; dit is uitdrukkelijk niet het §6.3-pad
-- voor heropenen van een besluit.
--
-- HAND-APPLIED. Rollback: 2026_08_31_p5d_procedure_beeindigen_bediening_ROLLBACK.sql

begin;

create or replace function public.fn_procedure_beeindigen(
  p_procedure_id uuid,
  p_reden        text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_rol text;
  v_naam text;
  v_actorfonds uuid;
  v_proc record;
  v_dec record;
  v_vervallen_stappen jsonb := '[]'::jsonb;
  v_open_vereisten jsonb := jsonb_build_object('kritiek', 0, 'vereist', 0, 'optioneel', 0);
  v_aantal_stappen int := 0;
begin
  if v_actor is null then
    raise exception 'Niet ingelogd.' using errcode = '42501';
  end if;
  select pr.rol, pr.naam, pr.fonds_id into v_rol, v_naam, v_actorfonds
    from public.profielen pr where pr.id = v_actor;
  select p.id, p.fonds_id into v_proc
    from public.procedures p where p.id = p_procedure_id for update;
  if not found then
    raise exception 'Procedure niet gevonden (fail-closed).' using errcode = '23514';
  end if;
  if v_rol is distinct from 'voorzitter' and v_rol is distinct from 'bestuurder' then
    raise exception 'Alleen voorzitter of bestuurder kan dit proces beëindigen.' using errcode = '42501';
  end if;
  if v_actorfonds is distinct from v_proc.fonds_id then
    raise exception 'Fondsgrens: dit proces beëindigen kan alleen in het eigen fonds.' using errcode = '42501';
  end if;
  if p_reden is null or length(btrim(p_reden)) < 10 then
    raise exception 'Dit proces beëindigen vereist een motivering van minimaal 10 tekens.' using errcode = 'PC002';
  end if;

  select d.id, d.status into v_dec
    from public.decision_objects d
   where d.procedure_id = p_procedure_id and d.is_primary_decision = true
   limit 1 for update;
  if v_dec.id is null then
    raise exception 'Geen primair Decision Object voor de procedure (fail-closed).' using errcode = '23514';
  end if;
  if v_dec.status = 'beeindigd' then
    raise exception 'Dit proces is al beëindigd.' using errcode = 'PC002';
  end if;

  -- Snapshot vóór de mutatie: alleen deze stappen worden bij heropenen hersteld.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', ps.id,
      'naam', ps.naam,
      'status', ps.status
    ) order by ps.volgorde), '[]'::jsonb)
    into v_vervallen_stappen
    from public.procedure_stappen ps
   where ps.procedure_id = p_procedure_id
     and ps.status not in ('afgerond', 'vervallen');
  v_aantal_stappen := jsonb_array_length(v_vervallen_stappen);

  -- Hergebruik de gezaghebbende P4-open-berekening en dedupliceer op de
  -- bindingssleutel: een besluitmoment-arm mag dezelfde vereiste niet dubbel
  -- laten tellen in het auditfeit.
  select jsonb_build_object(
    'kritiek', count(distinct sleutel) filter (where zwaarte = 'kritiek'),
    'vereist', count(distinct sleutel) filter (where zwaarte = 'vereist'),
    'optioneel', count(distinct sleutel) filter (where zwaarte = 'optioneel')
  ) into v_open_vereisten
  from (
    select 'kritiek'::text as zwaarte, item->>'requirement_sleutel' as sleutel
      from public.procedure_stappen ps
      cross join lateral jsonb_array_elements(
        public.fn_stap_open_per_zwaarte(ps.id, v_dec.id)->'kritiek'
      ) item
     where ps.procedure_id = p_procedure_id
    union all
    select 'vereist'::text, item->>'requirement_sleutel'
      from public.procedure_stappen ps
      cross join lateral jsonb_array_elements(
        public.fn_stap_open_per_zwaarte(ps.id, v_dec.id)->'vereist'
      ) item
     where ps.procedure_id = p_procedure_id
    union all
    select 'optioneel'::text, item->>'requirement_sleutel'
      from public.procedure_stappen ps
      cross join lateral jsonb_array_elements(
        public.fn_stap_open_per_zwaarte(ps.id, v_dec.id)->'optioneel'
      ) item
     where ps.procedure_id = p_procedure_id
  ) open_vereisten;
  v_open_vereisten := coalesce(v_open_vereisten, jsonb_build_object('kritiek', 0, 'vereist', 0, 'optioneel', 0));

  update public.procedure_stappen
     set status = 'vervallen'
   where procedure_id = p_procedure_id
     and status not in ('afgerond', 'vervallen');

  update public.decision_objects set status = 'beeindigd' where id = v_dec.id;

  insert into public.governance_events
    (decision_id, event_type, actor_id, actor_naam, object_type, object_id, nieuwe_waarde, reden)
  values (v_dec.id, 'procedure_beeindigd', v_actor, v_naam, 'procedure', p_procedure_id,
          jsonb_build_object(
            'status', 'beeindigd',
            'rol_op_moment', v_rol,
            'vervallen_stappen', v_vervallen_stappen,
            'openstaande_vereisten', v_open_vereisten
          ), p_reden);

  insert into public.procedure_log (procedure_id, event_type, actor_id, actor_naam, payload)
  values (p_procedure_id, 'procedure_beeindigd', v_actor, v_naam,
          jsonb_build_object(
            'motivering', p_reden,
            'rol_op_moment', v_rol,
            'vervallen_stappen', v_vervallen_stappen,
            'aantal_vervallen_stappen', v_aantal_stappen,
            'openstaande_vereisten', v_open_vereisten
          ));

  return jsonb_build_object(
    'ok', true,
    'aantal_vervallen_stappen', v_aantal_stappen,
    'openstaande_vereisten', v_open_vereisten
  );
end $$;

revoke all on function public.fn_procedure_beeindigen(uuid, text) from public, anon, service_role;
grant execute on function public.fn_procedure_beeindigen(uuid, text) to authenticated;

-- De oude tweeargumentsignatuur mag niet als ontsnappingspad naast de verplichte
-- reden-categorie blijven bestaan.
drop function if exists public.fn_procedure_heropenen(uuid, text);

create function public.fn_procedure_heropenen(
  p_procedure_id uuid,
  p_reden        text,
  p_reden_type   text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_rol text;
  v_naam text;
  v_actorfonds uuid;
  v_proc record;
  v_dec record;
  v_snapshot jsonb;
  v_hersteld int := 0;
begin
  if v_actor is null then
    raise exception 'Niet ingelogd.' using errcode = '42501';
  end if;
  select pr.rol, pr.naam, pr.fonds_id into v_rol, v_naam, v_actorfonds
    from public.profielen pr where pr.id = v_actor;
  select p.id, p.fonds_id into v_proc
    from public.procedures p where p.id = p_procedure_id for update;
  if not found then
    raise exception 'Procedure niet gevonden (fail-closed).' using errcode = '23514';
  end if;
  if v_rol is distinct from 'voorzitter' and v_rol is distinct from 'bestuurder' then
    raise exception 'Alleen voorzitter of bestuurder kan dit proces heropenen.' using errcode = '42501';
  end if;
  if v_actorfonds is distinct from v_proc.fonds_id then
    raise exception 'Fondsgrens: dit proces heropenen kan alleen in het eigen fonds.' using errcode = '42501';
  end if;
  if p_reden is null or length(btrim(p_reden)) < 10 then
    raise exception 'Dit proces heropenen vereist een motivering van minimaal 10 tekens.' using errcode = 'PC002';
  end if;
  if p_reden_type not in ('ten_onrechte_beeindigd', 'hervat_na_gewijzigde_omstandigheden') then
    raise exception 'Kies een geldige reden om dit proces te heropenen.' using errcode = 'PC002';
  end if;

  select d.id, d.status into v_dec
    from public.decision_objects d
   where d.procedure_id = p_procedure_id and d.is_primary_decision = true
   limit 1 for update;
  if v_dec.id is null then
    raise exception 'Geen primair Decision Object voor de procedure (fail-closed).' using errcode = '23514';
  end if;
  if v_dec.status is distinct from 'beeindigd' then
    raise exception 'Alleen een beëindigd proces kan worden heropend.' using errcode = 'PC002';
  end if;

  select pl.payload->'vervallen_stappen' into v_snapshot
    from public.procedure_log pl
   where pl.procedure_id = p_procedure_id
     and pl.event_type = 'procedure_beeindigd'
   order by pl.tijdstip desc
   limit 1;
  if v_snapshot is null then
    raise exception 'Beëindigingssnapshot ontbreekt; dit proces kan niet veilig worden heropend.' using errcode = 'PC002';
  end if;

  update public.procedure_stappen ps
     set status = herstel.status
    from jsonb_to_recordset(v_snapshot) as herstel(id uuid, naam text, status text)
   where ps.id = herstel.id
     and ps.procedure_id = p_procedure_id
     and ps.status = 'vervallen';
  get diagnostics v_hersteld = row_count;

  update public.decision_objects set status = 'heropend' where id = v_dec.id;

  insert into public.governance_events
    (decision_id, event_type, actor_id, actor_naam, object_type, object_id, oude_waarde, nieuwe_waarde, reden)
  values (v_dec.id, 'procedure_heropend', v_actor, v_naam, 'procedure', p_procedure_id,
          jsonb_build_object('status', 'beeindigd'),
          jsonb_build_object(
            'status', 'heropend',
            'rol_op_moment', v_rol,
            'reden_type', p_reden_type,
            'herstelde_stappen', v_hersteld
          ), p_reden);

  insert into public.procedure_log (procedure_id, event_type, actor_id, actor_naam, payload)
  values (p_procedure_id, 'procedure_heropend', v_actor, v_naam,
          jsonb_build_object(
            'motivering', p_reden,
            'reden_type', p_reden_type,
            'rol_op_moment', v_rol,
            'herstelde_stappen', v_hersteld
          ));

  return jsonb_build_object('ok', true, 'herstelde_stappen', v_hersteld);
end $$;

revoke all on function public.fn_procedure_heropenen(uuid, text, text) from public, anon, service_role;
grant execute on function public.fn_procedure_heropenen(uuid, text, text) to authenticated;

-- Eindcontrole binnen dezelfde transactie: een handmatige Preview-run mag nooit
-- als groen worden behandeld als de verplichte reden-categorie, het oude
-- ontsnappingspad of de browserrechten niet exact in de beoogde eindstaat staan.
do $$
begin
  if to_regprocedure('public.fn_procedure_beeindigen(uuid,text)') is null
     or to_regprocedure('public.fn_procedure_heropenen(uuid,text,text)') is null
     or to_regprocedure('public.fn_procedure_heropenen(uuid,text)') is not null then
    raise exception 'P5d FAALT: procedure-RPC-signaturen onvolledig of oud ontsnappingspad nog aanwezig.';
  end if;
  if not has_function_privilege('authenticated', 'public.fn_procedure_beeindigen(uuid,text)'::regprocedure, 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.fn_procedure_heropenen(uuid,text,text)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'public.fn_procedure_beeindigen(uuid,text)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'public.fn_procedure_heropenen(uuid,text,text)'::regprocedure, 'EXECUTE') then
    raise exception 'P5d FAALT: execute-rechten van de procedure-RPC''s zijn niet fail-closed.';
  end if;
  raise notice 'P5d OK: procedure-RPC''s, verplichte reden-categorie en grants zijn volledig toegepast.';
end $$;

commit;
