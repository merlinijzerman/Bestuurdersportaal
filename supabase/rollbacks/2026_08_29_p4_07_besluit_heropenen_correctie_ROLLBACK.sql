-- ROLLBACK van 2026_08_29_p4_07 (P4 tranche 7). Herstelt de tranche-6-toestand:
-- matrix zonder besloten→heropend, fn_besluit_status_omslag zonder §6.3-guard, en
-- verwijdert fn_besluit_heropenen_correctie. LET OP: niet terugdraaien als er al
-- besluiten via de correctie-RPC zijn heropend (spoor blijft, gedrag verdwijnt).
begin;
drop function if exists public.fn_besluit_heropenen_correctie(uuid, text, text);

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

create or replace function public.fn_besluit_status_omslag(
  p_decision_id uuid,
  p_target      text,
  p_reden       text,
  p_motivering  text,
  p_open_elders jsonb default null   -- INFORMATIEF: telling per zwaarte van open
                                     -- vereisten ELDERS in het dossier. Niet-vorderend,
                                     -- stuurt geen eis → mag caller-bepaald zijn (Q1).
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
  v_procid     uuid;
  v_rij        public.decision_objects;
  v_is_besluit boolean;
  v_open       jsonb := jsonb_build_object('kritiek','[]'::jsonb,'vereist','[]'::jsonb,'optioneel','[]'::jsonb);
  v_deel       jsonb;
  v_stap       record;
  v_heeft_open boolean := false;
begin
  -- ── Eigen slot ──
  if v_actor is null then
    raise exception 'Niet ingelogd.' using errcode = '42501';
  end if;
  select pr.rol, pr.naam, pr.fonds_id into v_rol, v_naam, v_actorfonds
    from public.profielen pr where pr.id = v_actor;
  select d.status, d.fonds_id, d.procedure_id into v_oude, v_decfonds, v_procid
    from public.decision_objects d where d.id = p_decision_id;
  if not found then
    raise exception 'Decision Object niet gevonden.' using errcode = '23514';
  end if;
  if v_rol is null or v_actorfonds is distinct from v_decfonds then
    raise exception 'Niet bevoegd om de status van dit besluit te wijzigen.' using errcode = '42501';
  end if;
  -- NB (reviewbevinding #6): dit slot toetst rol-in-fonds, niet de capability
  -- `decisions.manage` rechtstreeks. Vandaag equivalent — alle vier de rollen (de
  -- enige die profielen_rol_check toestaat) dragen decisions.manage (0193 §5). De
  -- koppeling is impliciet: haalt een latere wijziging de capability bij een rol weg,
  -- dan volgt deze RPC niet mee. P4's status-feitenmatrix formaliseert welke
  -- rol/capability welke statusovergang mag; tot dan is deze gelijkstelling bewust.

  v_is_besluit := p_target in ('besloten','voorwaardelijk_besloten');

  -- ── Open voor het besluitmoment — in SQL, NIET meegegeven (zie kop). ──
  -- Unie over de vereist_besluit-stappen van de procedure; per stap de D10-getrouwe
  -- fn_stap_open_per_zwaarte. In het interim is besluitmoment_stap leeg, dus de
  -- §7-unie {stap N} ∪ {besluitmoment_stap = N} valt samen met de eigen stap.
  if v_is_besluit then
    for v_stap in
      select ps.id from public.procedure_stappen ps
       where ps.procedure_id = v_procid and ps.vereist_besluit = true
    loop
      -- Decision-scoped (reviewbevinding #2/#3): geef p_decision_id EXPLICIET mee, zodat
      -- de open-check dít besluit beoordeelt en niet de (verwisselbare) primary.
      v_deel := public.fn_stap_open_per_zwaarte(v_stap.id, p_decision_id);
      if v_deel ? 'error' then
        -- Fail-closed (#8): een onbepaalbare open-telling mag geen besluit stil
        -- doorlaten. Vandaag onbereikbaar (de stap komt uit dezelfde query), maar het
        -- patroon moet fail-closed zijn, niet "tel als niets open".
        raise exception 'Openstaande-vereisten-telling faalde voor stap % (%).', v_stap.id, v_deel->>'error'
          using errcode = '23514';
      end if;
      v_open := jsonb_build_object(
        'kritiek',   (v_open->'kritiek')   || coalesce(v_deel->'kritiek',   '[]'::jsonb),
        'vereist',   (v_open->'vereist')   || coalesce(v_deel->'vereist',   '[]'::jsonb),
        'optioneel', (v_open->'optioneel') || coalesce(v_deel->'optioneel', '[]'::jsonb));
    end loop;
    v_heeft_open := jsonb_array_length(v_open->'kritiek') > 0
                 or jsonb_array_length(v_open->'vereist') > 0;

    -- ── I2: besluit met iets open boven optioneel vereist een motivering. ──
    if v_heeft_open and (p_motivering is null or length(btrim(p_motivering)) < 10) then
      raise exception 'Een besluit met openstaande vereisten vereist een motivering van minimaal 10 tekens.'
        using errcode = 'PC002';
    end if;
  end if;

  -- ── Kern (atomair): de overgang zelf (I4-trigger valideert), dan de events. ──
  update public.decision_objects set status = p_target
   where id = p_decision_id
  returning * into v_rij;

  if v_is_besluit and v_heeft_open then
    insert into public.governance_events
      (decision_id, event_type, actor_id, actor_naam, object_type, object_id, reden, nieuwe_waarde)
    values (p_decision_id, 'besluit_genomen_met_openstaande_vereisten', v_actor, v_naam,
            'decision_object', p_decision_id, p_motivering,
            jsonb_build_object(
              'target_status',           p_target,
              'actor_rol',               v_rol,        -- momentopname (Q2): niet naderhand herleiden
              'open_voor_besluitmoment', v_open,       -- SQL-berekend, gezaghebbend
              'open_elders',             coalesce(p_open_elders, 'null'::jsonb), -- informatief (Q1)
              'motivering',              p_motivering));
  end if;

  insert into public.governance_events
    (decision_id, event_type, actor_id, actor_naam, object_type, object_id, reden, oude_waarde, nieuwe_waarde)
  values (p_decision_id, 'status_gewijzigd', v_actor, v_naam,
          'decision_object', p_decision_id, p_reden,
          jsonb_build_object('status', v_oude),
          jsonb_build_object('status', p_target, 'actor_rol', v_rol));

  return to_jsonb(v_rij);
end $$;
revoke all on function public.fn_besluit_status_omslag(uuid, text, text, text, jsonb) from public, anon, service_role;
grant execute on function public.fn_besluit_status_omslag(uuid, text, text, text, jsonb) to authenticated;

commit;
