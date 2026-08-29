-- P4 tranche 6 (#169, besluit 0194 B/C/E) — procedures.beeindigen + heropenen.
-- ---------------------------------------------------------------------------
-- Beëindigen = een procedure stoppen vóór het einde (§5.2). Heropenen-PROCEDURE
-- (0194 E, expliciet ONDERSCHEIDEN van heropenen-BESLUIT §6.3): terug uit
-- 'beeindigd'. Beide: capability voorzitter+bestuurder (map), én in de RPC een
-- inner rolgate + fondsgrens + VERPLICHTE motivering (I2) + append-only
-- governance_event met de actor-rol als MOMENTOPNAME (0194 B). Vorm = fn_stap_heropenen.
--
-- De canonieke toestand is decision_objects.status ('beeindigd'/'heropend'), die
-- de dossierstatus voedt (fn_dossierstatus_van_decision, p4_01). procedures.status
-- (legacy fallback, eigen CHECK zonder 'beeindigd') wordt bewust NIET aangeraakt.
--
-- 1. De transitiematrix (fn_decision_status_check) krijgt de beeindigd-randen:
--    elke levende status → 'beeindigd'; 'beeindigd' → 'heropend'. (§6.3
--    besloten→heropend-BESLUIT komt in tranche 7.)
-- HAND-APPLIED. Rollback: supabase/rollbacks/2026_08_29_p4_06_procedure_beeindigen_heropenen_ROLLBACK.sql

begin;

-- ── 1. Transitiematrix + beeindigd-randen ──────────────────────────────────
create or replace function public.fn_decision_status_check()
returns trigger language plpgsql as $$
declare
  toegestaan jsonb := jsonb_build_object(
    'concept',                    jsonb_build_array('in_onderbouwing','geannuleerd','beeindigd'),
    'in_onderbouwing',            jsonb_build_array('in_validatie','teruggezet','geannuleerd','beeindigd'),
    'in_validatie',               jsonb_build_array('in_review','teruggezet','geescaleerd','beeindigd'),
    'in_review',                  jsonb_build_array('geagendeerd','teruggezet','geescaleerd','beeindigd'),
    'geagendeerd',                jsonb_build_array('in_bespreking','aangehouden','beeindigd'),
    'in_bespreking',              jsonb_build_array('besloten','voorwaardelijk_besloten','aangehouden','teruggezet','afgewezen','beeindigd'),
    'besloten',                   jsonb_build_array('in_uitvoering','afgesloten','beeindigd'),
    'voorwaardelijk_besloten',    jsonb_build_array('in_uitvoering','heropend','beeindigd'),
    'in_uitvoering',              jsonb_build_array('in_evaluatie','geescaleerd','beeindigd'),
    'in_evaluatie',               jsonb_build_array('afgesloten','heropend','beeindigd'),
    'afgesloten',                 jsonb_build_array('heropend'),
    'teruggezet',                 jsonb_build_array('in_onderbouwing','in_validatie','beeindigd'),
    'geescaleerd',                jsonb_build_array('in_validatie','in_review','aangehouden','beeindigd'),
    'aangehouden',                jsonb_build_array('in_review','geagendeerd','geannuleerd','beeindigd'),
    'heropend',                   jsonb_build_array('in_onderbouwing','in_validatie','beeindigd'),
    'afgewezen',                  jsonb_build_array(),
    'geannuleerd',                jsonb_build_array(),
    'beeindigd',                  jsonb_build_array('heropend')   -- alleen terug via heropenen-procedure
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

-- ── 2. Gedeelde helper: rol/fonds/motivering + primair besluit ─────────────
-- (Inline in beide RPC's gehouden; geen aparte helper om het slot per RPC te bewaren.)

-- ── 3. fn_procedure_beeindigen ─────────────────────────────────────────────
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
  v_rol   text;
  v_naam  text;
  v_afonds uuid;
  v_proc  record;
  v_dec_id uuid;
begin
  if v_actor is null then
    raise exception 'Niet ingelogd.' using errcode = '42501';
  end if;
  select pr.rol, pr.naam, pr.fonds_id into v_rol, v_naam, v_afonds
    from public.profielen pr where pr.id = v_actor;
  select p.id, p.fonds_id into v_proc from public.procedures p where p.id = p_procedure_id for update;
  if not found then
    raise exception 'Procedure niet gevonden (fail-closed).' using errcode = '23514';
  end if;
  if v_rol is distinct from 'voorzitter' and v_rol is distinct from 'bestuurder' then
    raise exception 'Alleen voorzitter of bestuurder kan een procedure beëindigen.' using errcode = '42501';
  end if;
  if v_afonds is distinct from v_proc.fonds_id then
    raise exception 'Fondsgrens: beëindigen niet in het eigen fonds.' using errcode = '42501';
  end if;
  if p_reden is null or length(btrim(p_reden)) < 10 then
    raise exception 'Beëindigen vereist een motivering van minimaal 10 tekens.' using errcode = 'PC002';
  end if;

  select d.id into v_dec_id
    from public.decision_objects d
   where d.procedure_id = p_procedure_id and d.is_primary_decision = true
   limit 1;
  if v_dec_id is null then
    raise exception 'Geen primair Decision Object voor de procedure (fail-closed).' using errcode = '23514';
  end if;

  -- I1: leg eerst het beëindigingsfeit vast; daarna leest de matrix precies dit
  -- event vóór de statusclaim. Alles zit in dezelfde transactie.
  insert into public.governance_events
    (decision_id, event_type, actor_id, actor_naam, object_type, object_id, nieuwe_waarde, reden)
  values (v_dec_id, 'procedure_beeindigd', v_actor, v_naam, 'procedure', p_procedure_id,
          jsonb_build_object('status', 'beeindigd', 'rol_op_moment', v_rol), p_reden);

  perform public.fn_toets_besluitstatus_feit(v_dec_id, 'beeindigd', p_reden, null);

  -- Kern: besluitstatus → beeindigd (transitiematrix laat de rand toe).
  update public.decision_objects set status = 'beeindigd' where id = v_dec_id;

  insert into public.procedure_log (procedure_id, event_type, actor_id, actor_naam, payload)
  values (p_procedure_id, 'procedure_beeindigd', v_actor, v_naam,
          jsonb_build_object('motivering', p_reden, 'rol_op_moment', v_rol));

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fn_procedure_beeindigen(uuid, text) from public, anon, service_role;
grant execute on function public.fn_procedure_beeindigen(uuid, text) to authenticated;

-- ── 4. fn_procedure_heropenen (procedure — 0194 E, ≠ heropenen-besluit) ─────
create or replace function public.fn_procedure_heropenen(
  p_procedure_id uuid,
  p_reden        text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_rol   text;
  v_naam  text;
  v_afonds uuid;
  v_proc  record;
  v_dec   record;
begin
  if v_actor is null then
    raise exception 'Niet ingelogd.' using errcode = '42501';
  end if;
  select pr.rol, pr.naam, pr.fonds_id into v_rol, v_naam, v_afonds
    from public.profielen pr where pr.id = v_actor;
  select p.id, p.fonds_id into v_proc from public.procedures p where p.id = p_procedure_id for update;
  if not found then
    raise exception 'Procedure niet gevonden (fail-closed).' using errcode = '23514';
  end if;
  if v_rol is distinct from 'voorzitter' and v_rol is distinct from 'bestuurder' then
    raise exception 'Alleen voorzitter of bestuurder kan een procedure heropenen.' using errcode = '42501';
  end if;
  if v_afonds is distinct from v_proc.fonds_id then
    raise exception 'Fondsgrens: heropenen niet in het eigen fonds.' using errcode = '42501';
  end if;
  if p_reden is null or length(btrim(p_reden)) < 10 then
    raise exception 'Heropenen vereist een motivering van minimaal 10 tekens.' using errcode = 'PC002';
  end if;

  select d.id, d.status into v_dec
    from public.decision_objects d
   where d.procedure_id = p_procedure_id and d.is_primary_decision = true
   limit 1;
  if v_dec.id is null then
    raise exception 'Geen primair Decision Object voor de procedure (fail-closed).' using errcode = '23514';
  end if;
  if v_dec.status is distinct from 'beeindigd' then
    raise exception 'Alleen een beëindigde procedure kan worden heropend.' using errcode = 'PC002';
  end if;

  update public.decision_objects set status = 'heropend' where id = v_dec.id;

  insert into public.governance_events
    (decision_id, event_type, actor_id, actor_naam, object_type, object_id, oude_waarde, nieuwe_waarde, reden)
  values (v_dec.id, 'procedure_heropend', v_actor, v_naam, 'procedure', p_procedure_id,
          jsonb_build_object('status', 'beeindigd'),
          jsonb_build_object('status', 'heropend', 'rol_op_moment', v_rol), p_reden);

  insert into public.procedure_log (procedure_id, event_type, actor_id, actor_naam, payload)
  values (p_procedure_id, 'procedure_heropend', v_actor, v_naam,
          jsonb_build_object('motivering', p_reden, 'rol_op_moment', v_rol));

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fn_procedure_heropenen(uuid, text) from public, anon, service_role;
grant execute on function public.fn_procedure_heropenen(uuid, text) to authenticated;

commit;
