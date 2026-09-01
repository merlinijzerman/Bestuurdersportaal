-- ROLLBACK van 2026_08_28_p3d_01_readiness_drop.sql (P3/PR-D, #168, 0187/0193).
-- Herstelt de twee readiness-functies (exacte laatste definities) én
-- fn_build_decision_dossier mét de readiness-key. Grants Gate-H-conform.
begin;

CREATE OR REPLACE FUNCTION public.fn_decision_readiness_check(p_decision_id uuid, p_target text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
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
  -- Fail-closed. Zonder deze guard (pre-existent, meegenomen bij deze
  -- herschrijving) levert een onvindbare procedure nul requirements op en
  -- retourneert de gate `voldoet = true, ontbrekend = []` — een readiness-gate
  -- die bij ontbrekende context "ja" zegt. Kan alleen optreden als de aanroeper
  -- het decision object wél maar de procedure níet mag zien.
  if not found then
    return jsonb_build_object('error', 'procedure_not_found');
  end if;

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
      v_sleutel_count int;
      -- external_submission/consultation delen de document-afhandeling.
      v_type     text := case
                           when rij.requirement_type in ('external_submission','consultation')
                             then 'document'
                           else rij.requirement_type
                         end;
      -- Bindingssleutel van DEZE vereiste. Let op: het oorspronkelijke
      -- requirement_type, niet v_type — spiegelt requirementSleutel() in TS.
      v_sleutel  text := rij.stap_volgorde::text || '|' || rij.requirement_type ||
                         '|' || coalesce(rij.documenttype, rij.label);
    begin
      case v_type
        when 'document' then
          -- Dezelfde inhoudelijke sleutel kan per ongeluk zowel in de
          -- template- als instantie-arm voorkomen. Dan zou één bewijsstuk twee
          -- vereisten afvinken. Tel daarom eerst de kandidaatdefinities en
          -- accepteer uitsluitend exact één definitie én exact één stap met
          -- deze volgorde. Alles daarbuiten faalt gesloten.
          select count(*) into v_sleutel_count
            from (
              select r.stap_volgorde::text || '|' || r.requirement_type || '|' ||
                     coalesce(r.documenttype, r.label) as sleutel
                from public.procedure_requirements r
               where r.template_code = v_proc.template_code
                 and r.requirement_type in ('document','external_submission','consultation')
              union all
              select i.stap_volgorde::text || '|' || i.requirement_type || '|' ||
                     coalesce(i.documenttype, i.label) as sleutel
                from public.procedure_requirement_instance i
                join public.decision_objects d on d.id = i.decision_id
               where d.procedure_id = v_proc.id
                 and d.fonds_id = v_proc.fonds_id
                 and i.fonds_id = v_proc.fonds_id
                 and i.actief
                 and i.requirement_type in ('document','external_submission','consultation')
            ) kandidaten
           where kandidaten.sleutel = v_sleutel;

          vervuld := v_sleutel_count = 1
            and (select count(*) from public.procedure_stappen ps
                  where ps.procedure_id = v_proc.id
                    and ps.volgorde = rij.stap_volgorde) = 1
            and exists (
              select 1
                from public.procedure_stappen ps
                join public.procedure_bewijs pb on pb.stap_id = ps.id
               where ps.procedure_id = v_proc.id
                 and ps.volgorde = rij.stap_volgorde
                 and pb.requirement_sleutel = v_sleutel
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
$function$

;
revoke all on function public.fn_decision_readiness_check(uuid, text) from public, anon;
grant execute on function public.fn_decision_readiness_check(uuid, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_decision_readiness_overview(p_decision_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select jsonb_build_object(
    'onderbouwing_compleet', public.fn_decision_readiness_check(p_decision_id, 'onderbouwing_compleet'),
    'reviewrijp',            public.fn_decision_readiness_check(p_decision_id, 'reviewrijp'),
    'bespreekrijp',          public.fn_decision_readiness_check(p_decision_id, 'bespreekrijp'),
    'besluitrijp',           public.fn_decision_readiness_check(p_decision_id, 'besluitrijp'),
    'verantwoordingsrijp',   public.fn_decision_readiness_check(p_decision_id, 'verantwoordingsrijp'),
    'evaluatierijp',         public.fn_decision_readiness_check(p_decision_id, 'evaluatierijp')
  );
$function$

;
revoke all on function public.fn_decision_readiness_overview(uuid) from public, anon;
grant execute on function public.fn_decision_readiness_overview(uuid) to authenticated, service_role;

-- fn_build_decision_dossier mét de readiness-key terug.
create or replace function public.fn_build_decision_dossier(p_decision_id uuid)
returns jsonb language sql stable as $BODY$
  select jsonb_build_object(
    'decision', to_jsonb(d.*),
    'procedure', (select to_jsonb(p.*) from public.procedures p where p.id = d.procedure_id),
    'steps', coalesce((select jsonb_agg(to_jsonb(ps.*) order by ps.volgorde, ps.id)
                        from public.procedure_stappen ps where ps.procedure_id = d.procedure_id), '[]'::jsonb),
    'bewijs', coalesce((select jsonb_agg(to_jsonb(pb.*) order by ps.volgorde, pb.toegevoegd_op, pb.id)
                         from public.procedure_stappen ps
                         join public.procedure_bewijs pb on pb.stap_id = ps.id
                        where ps.procedure_id = d.procedure_id), '[]'::jsonb),
    'readiness', public.fn_decision_readiness_overview(d.id),
    'assumptions', coalesce((select jsonb_agg(to_jsonb(a.*) order by a.aangemaakt_op)
                              from public.decision_assumptions a where a.decision_id = d.id), '[]'::jsonb),
    'risks',       coalesce((select jsonb_agg(to_jsonb(r.*) order by r.aangemaakt_op)
                              from public.decision_risks r where r.decision_id = d.id), '[]'::jsonb),
    'dissent',     coalesce((select jsonb_agg(to_jsonb(x.*) order by x.aangemaakt_op)
                              from public.decision_dissent x where x.decision_id = d.id), '[]'::jsonb),
    'conditions',  coalesce((select jsonb_agg(to_jsonb(c.*) order by c.aangemaakt_op)
                              from public.decision_conditions c where c.decision_id = d.id), '[]'::jsonb),
    'actions',     coalesce((select jsonb_agg(to_jsonb(ac.*) order by ac.aangemaakt_op)
                              from public.decision_actions ac where ac.decision_id = d.id), '[]'::jsonb),
    'evaluations', coalesce((select jsonb_agg(to_jsonb(e.*) order by e.geplande_datum)
                              from public.decision_evaluations e where e.decision_id = d.id), '[]'::jsonb),
    'aiOutputs',   coalesce((select jsonb_agg(to_jsonb(ai.*) order by ai.aangemaakt_op)
                              from public.decision_ai_interactions ai where ai.decision_id = d.id), '[]'::jsonb),
    'events',      coalesce((select jsonb_agg(to_jsonb(g.*) order by g.tijdstip)
                              from public.governance_events g where g.decision_id = d.id), '[]'::jsonb),
    'stemverslagen', coalesce((select jsonb_agg(to_jsonb(s.*) order by s.geopend_op desc)
                                from public.stemmingen s
                               where s.decision_id = d.id
                                 and s.status in ('gesloten','ingetrokken')), '[]'::jsonb)
  )
    from public.decision_objects d
   where d.id = p_decision_id;
$BODY$;
revoke all on function public.fn_build_decision_dossier(uuid) from public, anon;
grant execute on function public.fn_build_decision_dossier(uuid) to authenticated, service_role;

commit;
