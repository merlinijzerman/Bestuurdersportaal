-- P4 tranche 5 (#169, besluit 0193 §7-aansluitpunt) — besluitmoment_stap-arm in
-- de gezaghebbende SQL-open-berekening.
-- ---------------------------------------------------------------------------
-- §7 definieert de vereisten voor een besluitmoment op stap N als de UNIE
-- {stap_volgorde = N} ∪ {besluitmoment_stap = N}. De TS-route telde beide armen;
-- de SQL-helft (fn_stap_open_per_zwaarte) telde tot nu toe alleen stap_volgorde=N.
-- Zolang besluitmoment_stap leeg was, identiek. Zodra hij gevuld wordt (fase C/P4)
-- telde de RPC MINDER open dan §7 voorschrijft — de DB-eis was zwakker dan de route.
-- Deze migratie voegt de besluitmoment-arm toe aan beide armen (template + instantie).
-- 0193: "besluitmoment_stap mag niet gevuld worden zonder deze aanvulling."
--
-- De dubbel-check (ambiguïteit) blijft op de EIGEN stap_volgorde van de vereiste:
-- de sleutel codeert stap_volgorde, dus dubbeldetectie is per-sleutel en onveranderd.
-- Signatuur ongewijzigd → geen allowlist-wijziging. HAND-APPLIED. Rollback:
--   supabase/rollbacks/2026_08_29_p4_05_besluitmoment_arm_ROLLBACK.sql

begin;

create or replace function public.fn_stap_open_per_zwaarte(p_stap_id uuid, p_decision_id uuid default null)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Het te beoordelen Decision Object (voor de instantie-arm, de decision-scoped
  -- feiten en de field-uitzondering). PR-D (#168, reviewbevinding HOOG): gebruik het
  -- EXPLICIETE p_decision_id, NIET de afgeleide primary — is_primary_decision is door
  -- authenticated updatebaar, dus de afgeleide primary kon een verwisselbare lokvogel
  -- zijn en de open-check op de verkeerde decision richten. Het besluit moet bij deze
  -- procedure horen (anders leeg → fail-closed op de eis). Zonder p_decision_id (het
  -- PR-C afronden-pad) valt de functie terug op de primary — gedragsbehoudend.
  if p_decision_id is not null then
    select d.* into v_dec
      from public.decision_objects d
     where d.id = p_decision_id and d.procedure_id = v_proc.id;
  else
    select d.* into v_dec
      from public.decision_objects d
     where d.procedure_id = v_proc.id and d.is_primary_decision = true
     limit 1;
  end if;

  for rij in
    -- Template-arm: versie-gefilterd (P1b), activatie-conditioneel (spiegelt
    -- decision.ts + readiness), en MET aftrek van per-proces-uitsluitingen.
    select r.requirement_type, r.stap_volgorde, r.label, r.documenttype, r.veld_pad,
           r.zwaarte, r.min_aantal
      from public.procedure_requirements r
     where r.template_code   = v_proc.template_code
       and r.template_versie = v_proc.template_versie
       and (r.stap_volgorde = v_stap.volgorde or r.besluitmoment_stap = v_stap.volgorde)  -- P4 §7: {stap N} ∪ {besluitmoment_stap = N}
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
       and (i.stap_volgorde = v_stap.volgorde or i.besluitmoment_stap = v_stap.volgorde)  -- P4 §7: besluitmoment-arm
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
end $function$;

-- Zelfde slot als PR-C: read-only SECURITY DEFINER-helper, geen externe grant. De
-- twee SECURITY DEFINER-aanroepers (afronden, besluit-omslag) draaien als eigenaar.
revoke all on function public.fn_stap_open_per_zwaarte(uuid, uuid) from public, anon, authenticated, service_role;

commit;
