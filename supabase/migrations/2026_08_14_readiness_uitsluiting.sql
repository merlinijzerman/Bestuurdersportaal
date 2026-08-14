-- ============================================================
--  Migratie 2026-08-14 — Readiness honoreert per-proces uitsluitingen
--
--  Vult fn_decision_readiness_check aan: de TEMPLATE-arm slaat vereisten over
--  die voor DIT Decision Object zijn uitgesloten (procedure_requirement_
--  uitsluiting, actief=true), match op (stap_volgorde, requirement_type,
--  match_sleutel = coalesce(documenttype, label)) — dezelfde identiteit als de
--  unieke index van procedure_requirements. De generieke set blijft onaangeroerd;
--  de instantie-arm is ongewijzigd. Verder identiek aan de ambiguïteit-fix
--  (incl. #variable_conflict use_column).
--
--  Vereist: 2026_08_14_procedure_requirement_uitsluiting.sql.
--  Idempotent (create or replace); grant-hygiëne (Gate H) opnieuw toegepast.
-- ============================================================

create or replace function public.fn_decision_readiness_check(
  p_decision_id uuid,
  p_target      text
) returns jsonb language plpgsql stable as $$
#variable_conflict use_column
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
    when 'besluitrijp'           then array['document','field','ai_validation','risk','assumption','mandate_check','approval','consultation']
    when 'verantwoordingsrijp'   then array['document','field','ai_validation','risk','assumption','mandate_check','approval','dissent_review','consultation','external_submission']
    when 'evaluatierijp'         then array['kpi','evaluation']
    else array['document']
  end;

  -- UNIE van template-requirements en actieve instantie-requirements.
  -- Beide armen leveren dezelfde kolomvorm; de classificatie-conditionals
  -- gelden alleen op de template-arm (instantie-items hebben geen triggers).
  for rij in
    select requirement_type, stap_volgorde, label, documenttype, veld_pad,
           blokkerend, min_aantal, vereist_validatie_domein
      from public.procedure_requirements
     where template_code = v_proc.template_code
       and verplicht = true
       and requirement_type = any (relevante_types)
       and (triggert_bij_complexiteit       is null or v_dec.complexiteit       = any (triggert_bij_complexiteit))
       and (triggert_bij_risiconiveau       is null or v_dec.risiconiveau       = any (triggert_bij_risiconiveau))
       and (triggert_bij_mandaatgevoelig    is null or v_dec.mandaatgevoelig    = triggert_bij_mandaatgevoelig)
       and (triggert_bij_toezichtgevoelig   is null or v_dec.toezichtgevoelig   = triggert_bij_toezichtgevoelig)
       and not exists (
         select 1 from public.procedure_requirement_uitsluiting u
          where u.decision_id      = p_decision_id
            and u.stap_volgorde    = procedure_requirements.stap_volgorde
            and u.requirement_type = procedure_requirements.requirement_type
            and u.match_sleutel    = coalesce(procedure_requirements.documenttype, procedure_requirements.label)
            and u.actief
       )
    union all
    select requirement_type, stap_volgorde, label, documenttype, veld_pad,
           blokkerend, min_aantal, vereist_validatie_domein
      from public.procedure_requirement_instance
     where decision_id = p_decision_id
       and actief = true
       and verplicht = true
       and requirement_type = any (relevante_types)
  loop
    declare
      vervuld    boolean := false;
      v_count    int;
      v_drempel  int;
      -- external_submission/consultation delen de document-afhandeling.
      v_type     text := case
                           when rij.requirement_type in ('external_submission','consultation')
                             then 'document'
                           else rij.requirement_type
                         end;
    begin
      case v_type
        when 'document' then
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

-- Grant-hygiëne: create-or-replace reset de ACL. Herstel Gate-H-conform.
revoke all on function public.fn_decision_readiness_check(uuid, text) from public, anon;
grant execute on function public.fn_decision_readiness_check(uuid, text) to authenticated, service_role;
