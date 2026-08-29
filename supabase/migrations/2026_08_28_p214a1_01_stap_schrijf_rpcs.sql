-- #214-a1 (besluit 0194) — PRODUCTIEFIX. De legitieme schrijfpaden naar de
-- bewaakte procedure_stappen-kolommen door SECURITY DEFINER-RPC's, vóór de
-- kolom-revoke (02). Staat op `main`/`preview` (zelfstandig van EPIC P).
-- ---------------------------------------------------------------------------
-- Meting METING-RLS-reikwijdte-214.md: procedure_stappen draagt een `for all`-
-- policy met alleen fondsisolatie en `authenticated` heeft tabel-brede UPDATE.
-- status/voltooid_op/voltooid_door zijn dus met één directe PostgREST-PATCH te
-- fabriceren — een verantwoordingsfeit dat elk fondslid kan verzinnen. Migratie 02
-- trekt UPDATE op die kolommen in; deze migratie legt de legitieme schrijfpaden
-- vast als SECURITY DEFINER-functies (draaien als owner, houden het recht ná de
-- revoke). Vorm = de kolom-revoke van PR-D op decision_objects.status (p3d_03).
--
-- N.B. de afwijkingskolommen (afgerond_met_afwijking, afwijking_*) bestaan alleen
-- op de epic (PR-C); hun revoke is #214-a2 en reist met de epic. Deze RPC's raken
-- ze niet — ze werken identiek op `main`.
--
-- Geverifieerd (0194 §A): de brekende `authenticated`-paden zijn de normale
-- afronding + handmatig activeren + de inline activatiecascade (PATCH-staproute)
-- en de stap-heropenen-route (+ compensatie). Alle omgelegd in dezelfde PR.
--
-- HAND-APPLIED. Rollback: supabase/rollbacks/2026_08_28_p214a1_01_stap_schrijf_rpcs_ROLLBACK.sql

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. fn_stap_afronden — normale afronding. Server zet voltooid_door=auth.uid()
--    (niet vervalsbaar) + dwingt status-machine en readiness (checklist/bewijs/
--    besluit) af. Activatiecascade blijft in de route (afgeleide toestand).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_stap_afronden(
  p_stap_id      uuid,
  p_procedure_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor      uuid := auth.uid();
  v_naam       text;
  v_actorfonds uuid;
  v_proc       record;
  v_stap       record;
  v_checklist_open int;
  v_bewijs_open    int;
begin
  if v_actor is null then
    raise exception 'Niet ingelogd.' using errcode = '42501';
  end if;
  select pr.naam, pr.fonds_id into v_naam, v_actorfonds
    from public.profielen pr where pr.id = v_actor;

  select p.id, p.fonds_id into v_proc
    from public.procedures p where p.id = p_procedure_id;
  if not found then
    raise exception 'Procedure niet gevonden (fail-closed).' using errcode = '23514';
  end if;
  if v_actorfonds is distinct from v_proc.fonds_id then
    raise exception 'Fondsgrens: afronding niet in het eigen fonds.' using errcode = '42501';
  end if;

  -- Eigen slot: FOR UPDATE serialiseert gelijktijdige afrondingen op dezelfde stap.
  select ps.id, ps.naam, ps.status, ps.volgorde, ps.vereist_besluit into v_stap
    from public.procedure_stappen ps
   where ps.id = p_stap_id and ps.procedure_id = p_procedure_id
   for update;
  if not found then
    raise exception 'Stap niet gevonden bij deze procedure.' using errcode = 'PC002';
  end if;
  if v_stap.status is distinct from 'actief' and v_stap.status is distinct from 'heropend' then
    raise exception 'Alleen een actieve of heropende stap kan worden afgerond.' using errcode = 'PC002';
  end if;

  -- Readiness-backstop (identiek aan de routepoort, nu gezaghebbend).
  select count(*) into v_checklist_open
    from public.procedure_checklist c
   where c.stap_id = p_stap_id and coalesce(c.actief, true) and not coalesce(c.voldaan, false);
  if v_checklist_open > 0 then
    raise exception 'Niet alle checklist-items zijn voldaan.' using errcode = 'PC002';
  end if;
  select count(*) into v_bewijs_open
    from public.procedure_checklist c
   where c.stap_id = p_stap_id and coalesce(c.actief, true) and coalesce(c.bewijs_vereist, false)
     and not exists (select 1 from public.procedure_bewijs b where b.stap_id = p_stap_id);
  if v_bewijs_open > 0 then
    raise exception 'Bewijsstukken vereist maar niet aanwezig.' using errcode = 'PC002';
  end if;
  if v_stap.vereist_besluit
     and not exists (select 1 from public.procedure_besluiten b where b.stap_id = p_stap_id) then
    raise exception 'Stap vereist een formeel besluit dat nog niet is vastgelegd.' using errcode = 'PC002';
  end if;

  update public.procedure_stappen
     set status = 'afgerond', voltooid_op = now(), voltooid_door = v_actor
   where id = p_stap_id;

  insert into public.procedure_log (procedure_id, event_type, actor_id, actor_naam, payload)
  values (p_procedure_id, 'stap_voltooid', v_actor, v_naam, jsonb_build_object('stap', v_stap.naam));

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fn_stap_afronden(uuid, uuid) from public, anon, service_role;
grant execute on function public.fn_stap_afronden(uuid, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. fn_stap_activeren — open/geblokkeerd → actief (inline cascade + handmatig).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_stap_activeren(
  p_stap_id      uuid,
  p_procedure_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor      uuid := auth.uid();
  v_actorfonds uuid;
  v_proc       record;
  v_stap       record;
begin
  if v_actor is null then
    raise exception 'Niet ingelogd.' using errcode = '42501';
  end if;
  select pr.fonds_id into v_actorfonds from public.profielen pr where pr.id = v_actor;
  select p.id, p.fonds_id into v_proc from public.procedures p where p.id = p_procedure_id;
  if not found then
    raise exception 'Procedure niet gevonden (fail-closed).' using errcode = '23514';
  end if;
  if v_actorfonds is distinct from v_proc.fonds_id then
    raise exception 'Fondsgrens: activering niet in het eigen fonds.' using errcode = '42501';
  end if;

  select ps.id, ps.status into v_stap
    from public.procedure_stappen ps
   where ps.id = p_stap_id and ps.procedure_id = p_procedure_id
   for update;
  if not found then
    raise exception 'Stap niet gevonden bij deze procedure.' using errcode = 'PC002';
  end if;
  if v_stap.status = 'actief' then
    return jsonb_build_object('ok', true, 'onveranderd', true);
  end if;
  if v_stap.status is distinct from 'open' and v_stap.status is distinct from 'geblokkeerd' then
    raise exception 'Alleen een open of geblokkeerde stap kan worden geactiveerd.' using errcode = 'PC002';
  end if;

  update public.procedure_stappen set status = 'actief' where id = p_stap_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fn_stap_activeren(uuid, uuid) from public, anon, service_role;
grant execute on function public.fn_stap_activeren(uuid, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. fn_stap_heropenen — afgerond → heropend, ATOMAIR met het auditspoor.
--    Vervangt de best-effort route-compensatie. Rolgate {voorzitter, beheerder}
--    identiek aan de oude route-inner-gate. Motivering verplicht.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_stap_heropenen(
  p_stap_id      uuid,
  p_procedure_id uuid,
  p_motivering   text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor      uuid := auth.uid();
  v_rol        text;
  v_naam       text;
  v_actorfonds uuid;
  v_proc       record;
  v_stap       record;
  v_dec_id     uuid;
  v_herbevestigen int[];
begin
  if v_actor is null then
    raise exception 'Niet ingelogd.' using errcode = '42501';
  end if;
  select pr.rol, pr.naam, pr.fonds_id into v_rol, v_naam, v_actorfonds
    from public.profielen pr where pr.id = v_actor;

  select p.id, p.fonds_id into v_proc from public.procedures p where p.id = p_procedure_id;
  if not found then
    raise exception 'Procedure niet gevonden (fail-closed).' using errcode = '23514';
  end if;
  if v_rol is distinct from 'voorzitter' and v_rol is distinct from 'beheerder' then
    raise exception 'Alleen voorzitter of beheerder kan een stap heropenen.' using errcode = '42501';
  end if;
  if v_actorfonds is distinct from v_proc.fonds_id then
    raise exception 'Fondsgrens: heropenen niet in het eigen fonds.' using errcode = '42501';
  end if;
  if p_motivering is null or length(btrim(p_motivering)) < 1 then
    raise exception 'Heropenen vereist een motivering.' using errcode = 'PC002';
  end if;

  select ps.id, ps.naam, ps.status, ps.volgorde into v_stap
    from public.procedure_stappen ps
   where ps.id = p_stap_id and ps.procedure_id = p_procedure_id
   for update;
  if not found then
    raise exception 'Stap niet gevonden bij deze procedure.' using errcode = 'PC002';
  end if;
  if v_stap.status is distinct from 'afgerond' then
    raise exception 'Alleen een afgeronde stap kan worden heropend.' using errcode = 'PC002';
  end if;

  update public.procedure_stappen set status = 'heropend', heropend_op = now() where id = p_stap_id;

  -- Afhankelijke, reeds afgeronde stappen markeren (niet terugzetten).
  select coalesce(array_agg(ps.volgorde order by ps.volgorde), '{}') into v_herbevestigen
    from public.procedure_stappen ps
   where ps.procedure_id = p_procedure_id
     and ps.status = 'afgerond'
     and v_stap.volgorde = any(ps.blokkerende_afhankelijkheden);
  if array_length(v_herbevestigen, 1) is not null then
    update public.procedure_stappen ps set herbevestiging_nodig = true
     where ps.procedure_id = p_procedure_id
       and ps.status = 'afgerond'
       and v_stap.volgorde = any(ps.blokkerende_afhankelijkheden);
  end if;

  -- Append-only audit op het primaire Decision Object (motivering verplicht).
  select d.id into v_dec_id
    from public.decision_objects d
   where d.procedure_id = p_procedure_id and d.is_primary_decision = true
   limit 1;
  if v_dec_id is null then
    raise exception 'Geen primair Decision Object voor de procedure (fail-closed).' using errcode = '23514';
  end if;
  insert into public.governance_events
    (decision_id, event_type, actor_id, actor_naam, object_type, object_id,
     oude_waarde, nieuwe_waarde, reden)
  values (v_dec_id, 'stap_heropend', v_actor, v_naam, 'procedure_stap', p_stap_id,
          jsonb_build_object('status', 'afgerond'),
          jsonb_build_object('status', 'heropend', 'herbevestiging_gemarkeerd', v_herbevestigen),
          p_motivering);

  update public.procedures set status = 'heropend', afgerond_op = null
   where id = p_procedure_id and status = 'afgerond';

  insert into public.procedure_log (procedure_id, event_type, actor_id, actor_naam, payload)
  values (p_procedure_id, 'stap_heropend', v_actor, v_naam,
          jsonb_build_object('stap', v_stap.naam, 'motivering', p_motivering,
                             'herbevestiging', v_herbevestigen));

  return jsonb_build_object('ok', true, 'herbevestiging_nodig', v_herbevestigen);
end $$;

revoke all on function public.fn_stap_heropenen(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.fn_stap_heropenen(uuid, uuid, text) to authenticated;

commit;
