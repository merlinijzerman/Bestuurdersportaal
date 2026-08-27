-- P3 / PR-C (#168) — atomaire afronding-met-afwijking. Besluit 0192.
-- ---------------------------------------------------------------------------
-- Ontwerp: PROCEDURE-ENGINE-V2-ONTWERP.md §5.1. HAND-APPLIED. Rollback:
--   supabase/rollbacks/2026_08_27_p3c_02_fn_afronden_afwijking_ROLLBACK.sql
--
-- Twee functies:
--   1. fn_stap_open_per_zwaarte(stap) — READ-ONLY. Wat ontbreekt op deze stap,
--      per zwaarte. Spiegelt EXACT het D10-vervullingsmodel van core/lib/decision.ts
--      (besluit 0189): vervuld = aantal GEBONDEN feiten (gelijkheid op
--      requirement_sleutel) >= min_aantal — NIET de per-type matchlogica van
--      fn_decision_readiness_check (dat is het oude, met D10 vervangen model dat
--      PR-D verwijdert). `field` is de gemotiveerde uitzondering. Een
--      gedragstest (snapshot-pin) bindt deze SQL aan decision.ts zodat de twee
--      niet uit elkaar lopen — de fout die readiness fataal werd.
--   2. fn_stap_afronden_met_afwijking(...) — de atomaire KERN (§5.1): statuswijziging
--      + de vier afwijkingskolommen + snapshot + procedure_log + governance-event,
--      alles in één transactie. De activatie-cascade is AFGELEIDE toestand en
--      volgt buiten deze transactie in de route (herstelbaar; besluit 0192).
--
-- EIGEN SLOT. fn_stap_afronden_met_afwijking is een AANROEPBARE SECURITY DEFINER-
-- RPC — een tweede voordeur naast de route (anders dan P2's trigger-only
-- fn_assert_gebonden_feit). Ze toetst daarom ZELF dat auth.uid() een profiel heeft
-- met rol ∈ {voorzitter, bestuurder} binnen het fonds van deze procedure, en leidt
-- de actor af uit auth.uid() (nooit een meegegeven argument — de handtekening op
-- een onherstelbaar feit mag de aanroeper niet kiezen).

begin;

-- ── 1. fn_stap_open_per_zwaarte: wat ontbreekt op de stap, per zwaarte (D10). ──
create or replace function public.fn_stap_open_per_zwaarte(p_stap_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_proc      record;
  v_stap      record;
  v_dec       record;
  rij         record;
  v_kritiek   jsonb := '[]'::jsonb;
  v_vereist   jsonb := '[]'::jsonb;
  v_optioneel jsonb := '[]'::jsonb;
begin
  select ps.id, ps.procedure_id, ps.volgorde
    into v_stap
    from public.procedure_stappen ps
   where ps.id = p_stap_id;
  if not found then
    return jsonb_build_object('error', 'stap_not_found');
  end if;

  select p.id, p.template_code, p.template_versie, p.fonds_id
    into v_proc
    from public.procedures p
   where p.id = v_stap.procedure_id;

  -- Primair Decision Object van de procedure (voor de instantie-arm, de
  -- decision-scoped feiten en de field-uitzondering). Kan ontbreken; dan blijven
  -- die armen leeg (document-type vereisten worden nog steeds correct geteld).
  select d.* into v_dec
    from public.decision_objects d
   where d.procedure_id = v_proc.id and d.is_primary_decision = true
   limit 1;

  for rij in
    -- Template-arm: versie-gefilterd (P1b), activatie-conditioneel (spiegelt
    -- decision.ts + readiness), en MET aftrek van per-proces-uitsluitingen.
    select r.requirement_type, r.stap_volgorde, r.label, r.documenttype, r.veld_pad,
           r.zwaarte, r.min_aantal
      from public.procedure_requirements r
     where r.template_code   = v_proc.template_code
       and r.template_versie = v_proc.template_versie
       and r.stap_volgorde   = v_stap.volgorde
       and (v_dec.id is null or not exists (
             select 1 from public.procedure_requirement_uitsluiting u
              where u.decision_id = v_dec.id
                and u.actief = true
                and u.stap_volgorde   = r.stap_volgorde
                and u.requirement_type = r.requirement_type
                and u.match_sleutel   = coalesce(r.documenttype, r.label)))
       and (v_dec.id is null or (
             (r.triggert_bij_complexiteit     is null or v_dec.complexiteit     = any (r.triggert_bij_complexiteit))
         and (r.triggert_bij_risiconiveau     is null or v_dec.risiconiveau     = any (r.triggert_bij_risiconiveau))
         and (r.triggert_bij_mandaatgevoelig  is null or v_dec.mandaatgevoelig  = r.triggert_bij_mandaatgevoelig)
         and (r.triggert_bij_toezichtgevoelig is null or v_dec.toezichtgevoelig = r.triggert_bij_toezichtgevoelig)))
    union all
    -- Instantie-arm: decision-scoped, altijd actief (geen triggers).
    select i.requirement_type, i.stap_volgorde, i.label, i.documenttype, i.veld_pad,
           i.zwaarte, i.min_aantal
      from public.procedure_requirement_instance i
     where v_dec.id is not null
       and i.decision_id = v_dec.id
       and i.actief = true
       and i.stap_volgorde = v_stap.volgorde
  loop
    declare
      v_sleutel   text := rij.stap_volgorde::text || '|' || rij.requirement_type
                          || '|' || coalesce(rij.documenttype, rij.label);
      v_vervuld   boolean := false;
      v_aantal    int := 0;
      v_dubbel    int;
    begin
      -- Ambiguïteit: dezelfde sleutel meer dan één keer gedefinieerd op deze stap →
      -- fail-closed (niet vervuld), gelijk aan decision.ts (r817). BELANGRIJK: de
      -- dubbeltelling gebruikt DEZELFDE gefilterde set als de hoofdlus en als
      -- decision.ts (dat telt over `alleRequirements`, ná uitsluiting én activatie).
      -- De template-arm r2 draagt daarom exact het uitsluitings- én het
      -- triggert_bij_*-filter; anders zou een uitgesloten of inactieve template-
      -- vereiste een botsende ACTIEVE instantie-vereiste stil fail-closed maken.
      select count(*) into v_dubbel from (
        select 1 from public.procedure_requirements r2
          where r2.template_code = v_proc.template_code
            and r2.template_versie = v_proc.template_versie
            and r2.stap_volgorde = rij.stap_volgorde
            and (r2.stap_volgorde::text || '|' || r2.requirement_type || '|'
                 || coalesce(r2.documenttype, r2.label)) = v_sleutel
            and (v_dec.id is null or not exists (
                  select 1 from public.procedure_requirement_uitsluiting u
                   where u.decision_id = v_dec.id
                     and u.actief = true
                     and u.stap_volgorde    = r2.stap_volgorde
                     and u.requirement_type = r2.requirement_type
                     and u.match_sleutel    = coalesce(r2.documenttype, r2.label)))
            and (v_dec.id is null or (
                  (r2.triggert_bij_complexiteit     is null or v_dec.complexiteit     = any (r2.triggert_bij_complexiteit))
              and (r2.triggert_bij_risiconiveau     is null or v_dec.risiconiveau     = any (r2.triggert_bij_risiconiveau))
              and (r2.triggert_bij_mandaatgevoelig  is null or v_dec.mandaatgevoelig  = r2.triggert_bij_mandaatgevoelig)
              and (r2.triggert_bij_toezichtgevoelig is null or v_dec.toezichtgevoelig = r2.triggert_bij_toezichtgevoelig)))
        union all
        select 1 from public.procedure_requirement_instance i2
          where v_dec.id is not null and i2.decision_id = v_dec.id and i2.actief = true
            and (i2.stap_volgorde::text || '|' || i2.requirement_type || '|'
                 || coalesce(i2.documenttype, i2.label)) = v_sleutel
      ) d;

      if rij.requirement_type = 'field' then
        -- Gemotiveerde uitzondering (0189): veld op het besluit / het
        -- classificatie-event. Identiek aan decision.ts r780-807.
        if v_dec.id is null then
          v_vervuld := false;
        elsif rij.veld_pad = 'decision.besluitvraag' then
          -- Spiegelt decision.ts r783-787: `!!besluitvraag` — een lege string telt
          -- als NIET ingevuld (length>0), niet alleen `is not null`.
          v_vervuld := v_dec.besluitvraag is not null
                   and length(v_dec.besluitvraag) > 0
                   and v_dec.besluitvraag !~ '^Aanvullen na auto-upgrade';
        elsif rij.veld_pad = 'decision.scope' then
          v_vervuld := v_dec.scope is not null and length(trim(v_dec.scope)) > 0;
        else
          v_vervuld :=
            exists (select 1 from public.governance_events
                     where decision_id = v_dec.id and event_type = 'classificatie_bevestigd')
            or v_dec.complexiteit <> 'complicated'
            or v_dec.risiconiveau <> 'middel';
        end if;
      elsif v_dubbel > 1 then
        v_vervuld := false; -- ambigu → fail-closed
      else
        -- D10: tel de gebonden feiten (requirement_sleutel) over de acht bronnen die
        -- core/lib/decision.ts telt; vervuld = aantal >= min_aantal.
        v_aantal :=
            (select count(*) from public.procedure_bewijs pb
               join public.procedure_stappen ps on ps.id = pb.stap_id
              where ps.procedure_id = v_proc.id and pb.requirement_sleutel = v_sleutel)
          + (select count(*) from public.decision_risks
              where v_dec.id is not null and decision_id = v_dec.id and requirement_sleutel = v_sleutel)
          + (select count(*) from public.decision_assumptions
              where v_dec.id is not null and decision_id = v_dec.id and requirement_sleutel = v_sleutel)
          + (select count(*) from public.decision_conditions
              where v_dec.id is not null and decision_id = v_dec.id and requirement_sleutel = v_sleutel)
          + (select count(*) from public.decision_evaluations
              where v_dec.id is not null and decision_id = v_dec.id and requirement_sleutel = v_sleutel)
          + (select count(*) from public.decision_ai_interactions
              where v_dec.id is not null and decision_id = v_dec.id and requirement_sleutel = v_sleutel)
          + (select count(*) from public.procedure_besluiten
              where procedure_id = v_proc.id and requirement_sleutel = v_sleutel)
          + (select count(*) from public.procedure_vaststelling
              where procedure_id = v_proc.id and requirement_sleutel = v_sleutel);
        v_vervuld := v_aantal >= greatest(1, coalesce(rij.min_aantal, 1));
      end if;

      if not v_vervuld then
        declare v_item jsonb := jsonb_build_object('label', rij.label, 'requirement_sleutel', v_sleutel);
        begin
          if rij.zwaarte = 'kritiek' then
            v_kritiek := v_kritiek || v_item;
          elsif rij.zwaarte = 'vereist' then
            v_vereist := v_vereist || v_item;
          else
            v_optioneel := v_optioneel || v_item;
          end if;
        end;
      end if;
    end;
  end loop;

  return jsonb_build_object('kritiek', v_kritiek, 'vereist', v_vereist, 'optioneel', v_optioneel);
end $$;
-- GEEN grant aan authenticated/service_role. Deze read-only snapshotfunctie is
-- SECURITY DEFINER (bypast RLS) en draagt geen eigen fondsslot; zou authenticated
-- haar direct kunnen aanroepen, dan kon een gebruiker de open vereisten (labels +
-- sleutels) van een stap in een VREEMD fonds uitlezen. Niets buiten de afrondfunctie
-- roept haar aan, en die is SECURITY DEFINER (draait als eigenaar), dus de eigenaar
-- behoudt execute voor de interne aanroep — verder niemand.
revoke all on function public.fn_stap_open_per_zwaarte(uuid) from public, anon, authenticated, service_role;

-- ── 2. fn_stap_afronden_met_afwijking: de atomaire kern (§5.1). ──
create or replace function public.fn_stap_afronden_met_afwijking(
  p_stap_id      uuid,
  p_procedure_id uuid,
  p_motivering   text,
  p_bevestigd    boolean
) returns jsonb
language plpgsql
security definer
-- `extensions` staat in het pad omdat de INSERT in governance_events de
-- hash-trigger fn_govevent_hash vuurt, die `digest()` (pgcrypto, schema
-- extensions) ongekwalificeerd aanroept en het pad van de aanroepende functie
-- erft. Zonder extensions faalt de hash — óók op productie (P2 schreef nooit
-- governance_events vanuit een SECURITY DEFINER-functie met beperkt pad).
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
  v_snapshot   jsonb;
  v_kritiek_open boolean;
  v_open_boven_optioneel boolean;
begin
  -- ── Eigen slot: aanroepbare SECURITY DEFINER-RPC draagt zijn eigen slot. ──
  if v_actor is null then
    raise exception 'Niet ingelogd.' using errcode = '42501';
  end if;
  select pr.rol, pr.naam, pr.fonds_id into v_rol, v_naam, v_actorfonds
    from public.profielen pr where pr.id = v_actor;

  select p.id, p.fonds_id into v_proc
    from public.procedures p where p.id = p_procedure_id;
  if not found then
    raise exception 'Procedure niet gevonden (fail-closed).' using errcode = '23514';
  end if;
  if v_rol is distinct from 'voorzitter' and v_rol is distinct from 'bestuurder' then
    raise exception 'Alleen voorzitter of bestuurder kan een afwijking vastleggen.' using errcode = '42501';
  end if;
  if v_actorfonds is distinct from v_proc.fonds_id then
    raise exception 'Fondsgrens: afwijking niet in het eigen fonds.' using errcode = '42501';
  end if;

  -- ── Poort: stap hoort bij de procedure en staat op actief/heropend. ──
  -- FOR UPDATE serialiseert gelijktijdige afrondingen op dezelfde stap: een tweede
  -- concurrente call blokkeert hier tot de eerste commit, leest dán status='afgerond'
  -- en valt op de statuspoort — zo ontstaan er geen twee audit-/governance-regels
  -- voor één afronding (lost update tussen transacties).
  select ps.id, ps.naam, ps.status, ps.volgorde into v_stap
    from public.procedure_stappen ps
   where ps.id = p_stap_id and ps.procedure_id = p_procedure_id
   for update;
  if not found then
    raise exception 'Stap niet gevonden bij deze procedure.' using errcode = 'PC002';
  end if;
  if v_stap.status is distinct from 'actief' and v_stap.status is distinct from 'heropend' then
    raise exception 'Alleen een actieve of heropende stap kan worden afgerond.' using errcode = 'PC002';
  end if;

  -- ── Snapshot (D10, dezelfde functie die de pin bindt aan decision.ts). ──
  v_snapshot := public.fn_stap_open_per_zwaarte(p_stap_id);
  v_kritiek_open := jsonb_array_length(v_snapshot->'kritiek') > 0;
  v_open_boven_optioneel := v_kritiek_open or jsonb_array_length(v_snapshot->'vereist') > 0;

  -- ── Regels (§5.1). Eigen SQLSTATE PC002 = door de gebruiker te verhelpen
  --    validatie; de route mag de melding tonen. Een KALE 23514 (een echte
  --    CHECK-constraint) mag NOOIT doorgegeven worden — die zou schema-namen lekken.
  if not v_open_boven_optioneel then
    raise exception 'Geen afwijking nodig: er staat niets open boven optioneel. Gebruik de normale afronding.'
      using errcode = 'PC002';
  end if;
  -- I2: minimumlengte afgedwongen (niet leeg-met-spaties). 10 = core/lib/afwijking.ts
  -- MIN_MOTIVERING_LENGTE; de route en een CHECK-constraint dragen dezelfde grens.
  if p_motivering is null or length(btrim(p_motivering)) < 10 then
    raise exception 'Een afwijking vereist een motivering van minimaal 10 tekens.' using errcode = 'PC002';
  end if;
  if v_kritiek_open and coalesce(p_bevestigd, false) = false then
    -- Eigen SQLSTATE zodat de route 409 "bevestiging vereist" kan onderscheiden.
    raise exception 'Er staat een kritieke vereiste open; expliciete bevestiging vereist.'
      using errcode = 'PC001';
  end if;

  -- ── Kern: statuswijziging + de vier afwijkingskolommen. ──
  update public.procedure_stappen
     set status = 'afgerond',
         voltooid_op = now(),
         voltooid_door = v_actor,
         afgerond_met_afwijking = true,
         afwijking_motivering = p_motivering,
         afwijking_snapshot = v_snapshot,
         afwijking_door = v_actor
   where id = p_stap_id;

  -- ── procedure_log: canoniek voor de historie (append-only). ──
  insert into public.procedure_log (procedure_id, event_type, actor_id, actor_naam, payload)
  values (p_procedure_id, 'stap_afgerond_met_afwijking', v_actor, v_naam,
          jsonb_build_object('stap', v_stap.naam, 'stap_id', p_stap_id,
                             'motivering', p_motivering, 'snapshot', v_snapshot));

  -- ── governance-event op het primaire Decision Object. ──
  select d.id into v_dec_id
    from public.decision_objects d
   where d.procedure_id = p_procedure_id and d.is_primary_decision = true
   limit 1;
  if v_dec_id is null then
    raise exception 'Geen primair Decision Object voor de procedure (fail-closed).' using errcode = '23514';
  end if;
  insert into public.governance_events
    (decision_id, event_type, actor_id, actor_naam, object_type, object_id, nieuwe_waarde, reden)
  values (v_dec_id, 'stap_afgerond_met_afwijking', v_actor, v_naam,
          'procedure_stap', p_stap_id, v_snapshot, p_motivering);

  return jsonb_build_object('ok', true, 'snapshot', v_snapshot);
end $$;
revoke all on function public.fn_stap_afronden_met_afwijking(uuid, uuid, text, boolean) from public, anon, service_role;
grant execute on function public.fn_stap_afronden_met_afwijking(uuid, uuid, text, boolean) to authenticated;

commit;
