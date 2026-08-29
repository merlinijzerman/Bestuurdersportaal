-- P4 tranche 7 (#169, besluit 0194 D §6.3) — heropenen-ter-correctie vanuit besloten.
-- ---------------------------------------------------------------------------
-- §6.3: vanuit 'besloten' laat de matrix nu ook 'heropend' toe (een bindingsfout
-- herstellen zonder 'afgesloten' als misleidende doorgang). Onder de bestaande
-- rol decisions.manage (geen aparte capability). Twee dingen dwingen de eerlijkheid:
--   • GETYPEERDE reden (correctie_bindingsfout | gewijzigde_omstandigheden) +
--     motivering + eigen govevent — het spoor vertelt zélf dat dit een correctie is.
--   • Het loopt UITSLUITEND via fn_besluit_heropenen_correctie; het generieke
--     fn_besluit_status_omslag WEIGERT besloten→heropend (PC003), zodat de typering
--     niet te omzeilen is (ook niet met een directe RPC-aanroep).
-- LET OP — dit is heropenen van een BESLUIT (decision_objects), te onderscheiden
-- van heropenen-van-een-PROCEDURE (tranche 6, fn_procedure_heropenen).
-- I1 blijft heel: 'heropend' stelt geen feit (lege rij in de status-feitenmatrix, T4).
-- HAND-APPLIED. Rollback: supabase/rollbacks/2026_08_29_p4_07_besluit_heropenen_correctie_ROLLBACK.sql

begin;

-- 1. Transitiematrix: + besloten→heropend (bovenop tranche 6's beeindigd-randen).
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
    'besloten',                   jsonb_build_array('in_uitvoering','afgesloten','beeindigd','heropend'),
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
    'beeindigd',                  jsonb_build_array('heropend')
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

-- 2. Guard op het generieke pad: besloten→heropend uitsluitend via de correctie-RPC.
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

  -- §6.3 (P4/0194 D): heropenen-ter-correctie vanuit 'besloten' vereist een
  -- GETYPEERDE reden en loopt UITSLUITEND via fn_besluit_heropenen_correctie —
  -- niet via dit generieke pad, anders is de typering te omzeilen (ook bij een
  -- directe RPC-aanroep). De transitiematrix laat de rand toe; dit slot dwingt af
  -- dat besloten→heropend alleen langs het getypeerde pad gaat.
  if v_oude = 'besloten' and p_target = 'heropend' then
    raise exception 'Heropenen vanuit besloten loopt via fn_besluit_heropenen_correctie (getypeerde reden vereist).'
      using errcode = 'PC003';
  end if;

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

-- 3. De correctie-RPC met getypeerde reden.
create or replace function public.fn_besluit_heropenen_correctie(
  p_decision_id uuid,
  p_reden_type  text,
  p_motivering  text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_rol text; v_naam text; v_afonds uuid;
  v_dec record;
begin
  if v_actor is null then raise exception 'Niet ingelogd.' using errcode='42501'; end if;
  select pr.rol, pr.naam, pr.fonds_id into v_rol, v_naam, v_afonds
    from public.profielen pr where pr.id = v_actor;
  select d.id, d.status, d.fonds_id, d.procedure_id into v_dec
    from public.decision_objects d where d.id = p_decision_id;
  if v_dec.id is null then raise exception 'Decision Object niet gevonden.' using errcode='23514'; end if;
  if v_rol is null or v_afonds is distinct from v_dec.fonds_id then
    raise exception 'Niet bevoegd om dit besluit te heropenen.' using errcode='42501'; end if;
  -- Getypeerde reden (0194 D): het spoor vertelt zelf dat dit een correctie was.
  if p_reden_type is distinct from 'correctie_bindingsfout'
     and p_reden_type is distinct from 'gewijzigde_omstandigheden' then
    raise exception 'Ongeldig reden-type; kies correctie_bindingsfout of gewijzigde_omstandigheden.' using errcode='PC002';
  end if;
  if p_motivering is null or length(btrim(p_motivering)) < 10 then
    raise exception 'Heropenen-ter-correctie vereist een motivering van minimaal 10 tekens.' using errcode='PC002';
  end if;
  if v_dec.status is distinct from 'besloten' then
    raise exception 'Heropenen-ter-correctie kan alleen vanuit besloten.' using errcode='PC002';
  end if;

  update public.decision_objects set status = 'heropend' where id = p_decision_id;  -- matrix laat besloten→heropend toe

  insert into public.governance_events
    (decision_id, event_type, actor_id, actor_naam, object_type, object_id, oude_waarde, nieuwe_waarde, reden)
  values (p_decision_id, 'besluit_heropend_ter_correctie', v_actor, v_naam, 'decision_object', p_decision_id,
          jsonb_build_object('status','besloten'),
          jsonb_build_object('status','heropend','reden_type',p_reden_type,'actor_rol',v_rol),
          p_motivering);
  insert into public.procedure_log (procedure_id, event_type, actor_id, actor_naam, payload)
  values (v_dec.procedure_id, 'besluit_heropend_ter_correctie', v_actor, v_naam,
          jsonb_build_object('reden_type',p_reden_type,'motivering',p_motivering,'actor_rol',v_rol));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.fn_besluit_heropenen_correctie(uuid, text, text) from public, anon, service_role;
grant execute on function public.fn_besluit_heropenen_correctie(uuid, text, text) to authenticated;

commit;
