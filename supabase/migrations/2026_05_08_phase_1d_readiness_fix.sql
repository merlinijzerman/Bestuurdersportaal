-- ============================================================
--  Migratie 2026-05-08 — Decision Object MVP-1D bug-fix
--  Synchroniseert `fn_decision_readiness_check` met de in 1C/1D
--  toegevoegde kolommen die de DB-functie nog niet kende:
--
--    • procedure_requirements.vereist_validatie_domein  (1C)
--      → ai_validation matcht alleen wanneer een AI-output is
--        gevalideerd ÉN op het juiste domein (algemeen/risk/...).
--    • procedure_requirements.min_aantal                 (1C)
--      → assumption-drempel uit de seed (default 1, voor sommige
--        rijen 3). Voorheen was 1 aanname al "voldoende".
--    • procedure_bewijs.documenttype                     (1D-4)
--      → document-match primair op kolom, fallback op
--        titel-LIKE voor backward compat.
--
--  Daarmee komt de DB-readiness in lijn met de TypeScript
--  buildEvidenceLijst in lib/decision.ts (single source of truth
--  voor wat een vereiste vervuld maakt).
--
--  Idempotent: `create or replace function`.
-- ============================================================

create or replace function public.fn_decision_readiness_check(
  p_decision_id uuid,
  p_target      text
) returns jsonb language plpgsql stable as $$
declare
  v_dec       record;
  v_proc      record;
  ontbrekend  jsonb := '[]'::jsonb;
  blokkerend  boolean := false;
  rij         record;
  relevante_types text[];
begin
  select * into v_dec from public.decision_objects where id = p_decision_id;
  if not found then
    return jsonb_build_object('error', 'decision_not_found');
  end if;
  select * into v_proc from public.procedures where id = v_dec.procedure_id;

  relevante_types := case p_target
    when 'onderbouwing_compleet' then array['document','field']
    when 'reviewrijp'            then array['document','field','ai_validation','risk']
    when 'bespreekrijp'          then array['document','field','ai_validation','risk','assumption']
    when 'besluitrijp'           then array['document','field','ai_validation','risk','assumption','mandate_check','approval']
    when 'verantwoordingsrijp'   then array['document','field','ai_validation','risk','assumption','mandate_check','approval','dissent_review']
    when 'evaluatierijp'         then array['kpi','evaluation']
    else array['document']
  end;

  for rij in
    select *
      from public.procedure_requirements
     where template_code = v_proc.template_code
       and verplicht = true
       and requirement_type = any (relevante_types)
       and (triggert_bij_complexiteit       is null or v_dec.complexiteit       = any (triggert_bij_complexiteit))
       and (triggert_bij_risiconiveau       is null or v_dec.risiconiveau       = any (triggert_bij_risiconiveau))
       and (triggert_bij_mandaatgevoelig    is null or v_dec.mandaatgevoelig    = triggert_bij_mandaatgevoelig)
       and (triggert_bij_toezichtgevoelig   is null or v_dec.toezichtgevoelig   = triggert_bij_toezichtgevoelig)
  loop
    declare
      vervuld    boolean := false;
      v_count    int;
      v_drempel  int;
    begin
      case rij.requirement_type
        when 'document' then
          -- 1D-4: primair op documenttype-kolom, fallback op titel-LIKE.
          vervuld := exists (
            select 1
              from public.procedure_stappen ps
              join public.procedure_bewijs pb on pb.stap_id = ps.id
             where ps.procedure_id = v_proc.id
               and ps.volgorde = rij.stap_volgorde
               and (
                    rij.documenttype is null
                 or pb.documenttype = rij.documenttype
                 or lower(coalesce(pb.titel,'')) like '%' || lower(rij.documenttype) || '%'
               )
          );

        when 'ai_validation' then
          -- 1C: match op validatie_domein indien gevuld.
          vervuld := exists (
            select 1 from public.decision_ai_interactions ai
             where ai.decision_id = p_decision_id
               and ai.validatiestatus in ('gevalideerd','aangepast')
               and (
                    rij.vereist_validatie_domein is null
                 or ai.validatie_domein = rij.vereist_validatie_domein
               )
          );

        when 'assumption' then
          -- 1C: gebruik min_aantal als drempel (default 1 in schema).
          v_drempel := coalesce(rij.min_aantal, 1);
          select count(*) into v_count
            from public.decision_assumptions
           where decision_id = p_decision_id
             and status in ('gevalideerd','gewijzigd');
          vervuld := v_count >= v_drempel;

        when 'risk' then
          vervuld := exists (
            select 1 from public.decision_risks where decision_id = p_decision_id
          );

        when 'mandate_check' then
          vervuld := exists (
            select 1 from public.governance_events
             where decision_id = p_decision_id and event_type = 'mandate_check_passed'
          );

        when 'approval' then
          vervuld := v_dec.status in ('besloten','voorwaardelijk_besloten','in_uitvoering','in_evaluatie','afgesloten');

        when 'kpi' then
          vervuld := exists (
            select 1 from public.decision_conditions where decision_id = p_decision_id and kpi is not null
          );

        when 'evaluation' then
          vervuld := exists (
            select 1 from public.decision_evaluations where decision_id = p_decision_id
          );

        when 'dissent_review' then
          vervuld := not exists (
            select 1 from public.decision_dissent
             where decision_id = p_decision_id
               and zichtbaarheid in ('formele_dissent','minderheidsnotitie')
               and not formeel_vastgesteld
          );

        when 'field' then
          -- field-level checks: alleen "classificatie ingevuld" telt voor
          -- onderbouwing_compleet. We honoreren een 'classificatie_bevestigd'
          -- governance-event of een non-default classificatie. (Spiegelt
          -- buildEvidenceLijst.)
          if rij.veld_pad = 'decision.besluitvraag' then
            vervuld := v_dec.besluitvraag is not null
                   and v_dec.besluitvraag !~ '^Aanvullen na auto-upgrade';
          elsif rij.veld_pad = 'decision.scope' then
            vervuld := v_dec.scope is not null and length(trim(v_dec.scope)) > 0;
          else
            vervuld :=
              exists (select 1 from public.governance_events
                       where decision_id = p_decision_id
                         and event_type = 'classificatie_bevestigd')
              or v_dec.complexiteit <> 'complicated'
              or v_dec.risiconiveau <> 'middel';
          end if;

        else
          vervuld := false;
      end case;

      if not vervuld then
        ontbrekend := ontbrekend || jsonb_build_object(
          'requirement_type', rij.requirement_type,
          'stap_volgorde',    rij.stap_volgorde,
          'label',            rij.label,
          'documenttype',     rij.documenttype,
          'blokkerend',       rij.blokkerend
        );
        if rij.blokkerend then blokkerend := true; end if;
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'decision_id',    p_decision_id,
    'target',         p_target,
    'voldoet',        not blokkerend,
    'blokkerend',     blokkerend,
    'kan_overrulen',  array['voorzitter','beheerder'],
    'ontbrekend',     ontbrekend
  );
end;
$$;

-- ============================================================
--  Verificatie:
--    select public.fn_decision_readiness_overview('<decision-id>');
--  → moet voor besluiten waar AI-validatie gevalideerd is op het
--    juiste domein, of waar 3 aannames gevalideerd zijn (bij
--    complex/hoog), of waar bewijs een matchend documenttype
--    heeft, het juiste readiness-niveau tonen.
-- ============================================================
