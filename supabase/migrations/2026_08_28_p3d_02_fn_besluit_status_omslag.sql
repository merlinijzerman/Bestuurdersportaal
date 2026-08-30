-- P3 / PR-D (#168) — atomaire besluitstatus-omslag met vastlegging. Besluit 0193.
-- ---------------------------------------------------------------------------
-- Reviewbevinding (HOOG): de §4.4-vastlegging mocht niet zwakker zijn dan PR-C's
-- afronding. In de eerste versie schreef de route de statusupdate en het
-- `besluit_genomen_met_openstaande_vereisten`-event als LOSSE calls: faalde de
-- event-insert ná de geslaagde update, dan stond het besluit vast zónder de
-- append-only vastlegging. Hier is het één transactie — net als PR-C's
-- fn_stap_afronden_met_afwijking.
--
-- Reviewbevinding vraag 2 (BLOKKEREND): de motivering is nu de énige controle op
-- een besluit-met-open (geen rolgate meer). Twee lekken gedicht:
--   1. `open` werd MEEGEGEVEN (p_openstaand). Een directe RPC-aanroeper gaf gewoon
--      null mee en ontliep de motiveringseis — een vervalsbare handtekening die
--      beslist of er verantwoording nodig is (zelfde les als p_actor bij PR-C).
--      Nu berekent de functie `open` ZELF in SQL, besluitmoment-scoped: de unie
--      van de open vereisten op de `vereist_besluit`-stappen van de procedure, via
--      de D10-getrouwe fn_stap_open_per_zwaarte (gepind tegen decision.ts). §7.
--   2. De statusomslag zelf was langs deze RPC te omzeilen (RLS op
--      decision_objects is `for all` fonds-only). Dat is een breder platformdefect
--      (#214). Voor `status` sluit PR-D het declaratief: kolomniveau-`revoke`
--      (2026_08_28_p3d_03) zodat `authenticated` `status` niet direct schrijft en
--      deze SECURITY DEFINER-RPC (owner) het enige pad is.
--
-- HAND-APPLIED. Rollback:
--   supabase/rollbacks/2026_08_28_p3d_02_fn_besluit_status_omslag_ROLLBACK.sql
--
-- EIGEN SLOT: aanroepbare SECURITY DEFINER-RPC → toetst zelf dat auth.uid() een
-- profiel heeft met een rol binnen het fonds van het besluit (alle vier de rollen
-- dragen decisions.manage, dus rol-in-fonds == de capability die de route eist;
-- de rol-verbreding en de asymmetrie met de stapafwijking staan in besluit 0193).
-- I2 (motivering-minimumlengte) wordt hier DB-afgedwongen. I4 (toegestane-
-- overgangenmatrix) blijft bij de trigger fn_decision_status_check op de UPDATE.
-- search_path bevat extensions vanwege de govevent-hashtrigger (digest()).

begin;

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
