-- P3 / PR-D (#168) — atomaire besluitstatus-omslag met vastlegging. Besluit 0193.
-- ---------------------------------------------------------------------------
-- Reviewbevinding (HOOG): de §4.4-vastlegging mocht niet zwakker zijn dan PR-C's
-- afronding. In de eerste versie schreef de route de statusupdate en het
-- `besluit_genomen_met_openstaande_vereisten`-event als LOSSE calls: faalde de
-- event-insert ná de geslaagde update, dan stond het besluit vast zónder de
-- append-only vastlegging. Hier wordt het één transactie — net als PR-C's
-- fn_stap_afronden_met_afwijking. HAND-APPLIED. Rollback:
--   supabase/rollbacks/2026_08_28_p3d_02_fn_besluit_status_omslag_ROLLBACK.sql
--
-- EIGEN SLOT: aanroepbare SECURITY DEFINER-RPC → toetst zelf dat auth.uid() een
-- profiel heeft met een rol binnen het fonds van het besluit (alle vier de rollen
-- dragen decisions.manage, dus rol-in-fonds == de capability die de route eist).
-- I2 (motivering-minimumlengte) wordt hier DB-afgedwongen, niet alleen in de route.
-- I4 (toegestane-overgangenmatrix) blijft bij de trigger fn_decision_status_check op
-- de UPDATE. search_path bevat extensions vanwege de govevent-hashtrigger (digest()).

begin;

create or replace function public.fn_besluit_status_omslag(
  p_decision_id uuid,
  p_target      text,
  p_reden       text,
  p_motivering  text,
  p_openstaand  jsonb   -- null = niets open boven optioneel; anders {kritiek,vereist,...}
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
  v_oude       text;
  v_decfonds   uuid;
  v_rij        public.decision_objects;
begin
  -- ── Eigen slot ──
  if v_actor is null then
    raise exception 'Niet ingelogd.' using errcode = '42501';
  end if;
  select pr.rol, pr.naam, pr.fonds_id into v_rol, v_naam, v_actorfonds
    from public.profielen pr where pr.id = v_actor;
  select d.status, d.fonds_id into v_oude, v_decfonds
    from public.decision_objects d where d.id = p_decision_id;
  if not found then
    raise exception 'Decision Object niet gevonden.' using errcode = '23514';
  end if;
  if v_rol is null or v_actorfonds is distinct from v_decfonds then
    raise exception 'Niet bevoegd om de status van dit besluit te wijzigen.' using errcode = '42501';
  end if;

  -- ── I2: besluit met iets open boven optioneel vereist een motivering. ──
  if p_openstaand is not null
     and (p_motivering is null or length(btrim(p_motivering)) < 10) then
    raise exception 'Een besluit met openstaande vereisten vereist een motivering van minimaal 10 tekens.'
      using errcode = 'PC002';
  end if;

  -- ── Kern (atomair): de overgang zelf (I4-trigger valideert), dan de events. ──
  update public.decision_objects set status = p_target
   where id = p_decision_id
  returning * into v_rij;

  if p_openstaand is not null then
    insert into public.governance_events
      (decision_id, event_type, actor_id, actor_naam, object_type, object_id, reden, nieuwe_waarde)
    values (p_decision_id, 'besluit_genomen_met_openstaande_vereisten', v_actor, v_naam,
            'decision_object', p_decision_id, p_motivering,
            jsonb_build_object('target_status', p_target, 'openstaand', p_openstaand));
  end if;

  insert into public.governance_events
    (decision_id, event_type, actor_id, actor_naam, object_type, object_id, reden, oude_waarde, nieuwe_waarde)
  values (p_decision_id, 'status_gewijzigd', v_actor, v_naam,
          'decision_object', p_decision_id, p_reden,
          jsonb_build_object('status', v_oude), jsonb_build_object('status', p_target));

  return to_jsonb(v_rij);
end $$;
revoke all on function public.fn_besluit_status_omslag(uuid, text, text, text, jsonb) from public, anon, service_role;
grant execute on function public.fn_besluit_status_omslag(uuid, text, text, text, jsonb) to authenticated;

commit;
