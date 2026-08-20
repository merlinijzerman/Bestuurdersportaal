-- ============================================================
--  Migratie 2026-08-18 — Expliciete bewijs↔vereiste-binding
--
--  PROBLEEM. De document-tak van fn_decision_readiness_check (en zijn
--  TS-spiegel buildEvidenceLijst) vervulde een vereiste zodra er *enig*
--  bewijsstuk op dezelfde stap stond:
--      rij.documenttype is null  or  pb.documenttype = rij.documenttype
--                                or  lower(pb.titel) like '%…%'
--  Omdat de invaar-seed v2 alle 63 rijen op documenttype = null zet, was de
--  eerste tak structureel waar: één upload vinkte álle document-vereisten van
--  die stap af, óók de blokkerende. Bovendien "verbruikt" een EXISTS niets,
--  dus hetzelfde stuk kon meerdere vereisten tegelijk vervullen.
--
--  OPLOSSING. procedure_bewijs krijgt een expliciete binding naar precies één
--  vereiste: `requirement_sleutel` =
--      stap_volgorde || '|' || requirement_type || '|' ||
--      coalesce(documenttype, label)
--  Dezelfde identiteit als de unieke index idx_req_uniek op
--  procedure_requirements en als procedure_requirement_uitsluiting.match_sleutel.
--  Geen FK: vereisten leven in twee tabellen (procedure_requirements,
--  procedure_requirement_instance) én de template-set wordt bij elke
--  seed-regeneratie ge-delete en opnieuw ingevoegd, dus ids zijn instabiel.
--  Zie decisions/0183 en BEWIJSMATCH-BINDING-ONTWERP.md.
--
--  Verbruik volgt nu uit het datamodel: een bewijsstuk draagt precies één
--  sleutel en kan dus hoogstens één vereiste vervullen.
--
--  ONDERDELEN
--    1. kolom + partiële index op procedure_bewijs
--    2. deterministische backfill van bestaande rijen, mét auditspoor in
--       procedure_log (append-only)
--    3. fn_decision_readiness_check: document-tak matcht nog uitsluitend op
--       de binding. Verder integraal gelijk aan 2026_08_14_readiness_uitsluiting.sql.
--
--  IMPACT. Datamodel + SECURITY-relevante functie → draai na afloop
--  supabase/checks/2026_07_31_r1_structurele_gates.sql én
--  supabase/checks/2026_08_18_bewijsbinding.sql tegen de doeldatabase.
--  RLS ongewijzigd: de policy "fonds proc bewijs" is rij-gebaseerd en dekt een
--  nieuwe kolom automatisch; tabelgrants gelden per definitie voor nieuwe kolommen.
--
--  LET OP — eerst deze migratie, dán code-deploy. Andersom selecteert
--  decision.ts een kolom die nog niet bestaat en bouwt het dossier niet op.
--
--  Vereist: 2026_08_14_readiness_uitsluiting.sql (de versie die deze vervangt).
--  Idempotent: add column if not exists, create index if not exists,
--  create or replace function, backfill raakt alleen ongebonden rijen en
--  logt hoogstens één keer per procedure.
--  ROLLBACK: 2026_08_18_bewijs_requirement_binding_ROLLBACK.sql
-- ============================================================

begin;

-- ── 1. Kolom + index ──────────────────────────────────────────

alter table public.procedure_bewijs
  add column if not exists requirement_sleutel text;

comment on column public.procedure_bewijs.requirement_sleutel is
  'Bewijsbinding: de vereiste die dit stuk vervult, als '
  'stap_volgorde|requirement_type|coalesce(documenttype, label). '
  'Null = ongebonden; zo''n stuk vervult geen enkele vereiste.';

create index if not exists idx_procbewijs_req_sleutel
  on public.procedure_bewijs(stap_id, requirement_sleutel)
  where requirement_sleutel is not null;

-- ── 2. Backfill ───────────────────────────────────────────────
--
--  Deterministisch en conservatief. Twee regels, in volgorde:
--    R1  pb.documenttype gelijk aan het documenttype van een vereiste
--    R2  pb.titel gelijk aan het label van een vereiste (case/spatie-ongevoelig)
--  Een koppeling wordt alleen gelegd als zij WEDERZIJDS eenduidig is: het
--  bewijsstuk matcht precies één vereiste én die vereiste wordt door precies
--  één ongebonden bewijsstuk geclaimd én zij heeft nog geen gebonden stuk.
--  Alles wat overblijft blijft bewust ongebonden en verschijnt in de UI als
--  "op te voeren" — dat is de correctie, geen regressie.
--
--  De titel-substring-match uit de oude logica wordt NIET als backfillregel
--  gebruikt: die is fuzzy en zou juist de vals-positieven bestendigen.

-- Momentopname vóór de backfill: welke stukken waren ongebonden?
create temporary table _bind_voor on commit drop as
  select pb.id, pb.stap_id, ps.procedure_id
    from public.procedure_bewijs pb
    join public.procedure_stappen ps on ps.id = pb.stap_id
   where pb.requirement_sleutel is null;

-- Kandidaat-vereisten per stap: template-arm (minus uitsluitingen) ∪ instantie-arm.
-- Spiegelt de UNION in fn_decision_readiness_check.
create temporary table _bind_kandidaten on commit drop as
  select ps.id as stap_id,
         r.documenttype,
         r.label,
         r.stap_volgorde::text || '|' || r.requirement_type || '|' ||
           coalesce(r.documenttype, r.label) as sleutel
    from public.procedure_stappen ps
    join public.procedures p on p.id = ps.procedure_id
    join public.procedure_requirements r
      on r.template_code = p.template_code
     and r.stap_volgorde = ps.volgorde
   where r.requirement_type in ('document','external_submission','consultation')
     and not exists (
       select 1
         from public.procedure_requirement_uitsluiting u
         join public.decision_objects d on d.id = u.decision_id
        where d.procedure_id       = p.id
          -- Fonds-hard: `decision_objects` kent geen composite-FK of trigger die
          -- fonds_id aan procedures.fonds_id gelijkstelt, en deze backfill draait
          -- als eigenaar (dus buiten RLS). Zonder deze conditie zou een decision
          -- object dat naar een procedure van een ánder fonds wijst kandidaten
          -- kunnen wegfilteren.
          and d.fonds_id           = p.fonds_id
          and u.stap_volgorde      = r.stap_volgorde
          and u.requirement_type   = r.requirement_type
          and u.match_sleutel      = coalesce(r.documenttype, r.label)
          and u.actief
     )
  union
  select ps.id as stap_id,
         i.documenttype,
         i.label,
         i.stap_volgorde::text || '|' || i.requirement_type || '|' ||
           coalesce(i.documenttype, i.label) as sleutel
    from public.procedure_stappen ps
    join public.procedures p on p.id = ps.procedure_id
    join public.decision_objects d
      on d.procedure_id = ps.procedure_id
      -- Zie hierboven: fonds-gelijkheid expliciet, niet aangenomen.
     and d.fonds_id = p.fonds_id
    join public.procedure_requirement_instance i
      on i.decision_id = d.id
     and i.stap_volgorde = ps.volgorde
     and i.fonds_id = p.fonds_id
   where i.actief = true
     and i.requirement_type in ('document','external_submission','consultation');

-- Elke gelegde binding wordt hier per rij vastgelegd, inclusief de regel die
-- hem legde. Zonder dit zou het auditspoor alleen de negatieve helft bevatten
-- (welke stukken ongebonden bleven) — precies de mutaties die een blokkerende
-- vereiste als vervuld laten gelden zouden dan niet herleidbaar zijn. Ze zijn
-- ook niet achteraf te herrekenen: de kandidatenset leunt op
-- procedure_requirements, dat bij elke seed-regeneratie wordt ge-delete en
-- opnieuw ingevoegd.
create temporary table _bind_gelegd (
  bewijs_id uuid,
  sleutel   text,
  regel     text
) on commit drop;

-- R1 — exacte documenttype-match, wederzijds eenduidig.
with paren as (
  select distinct pb.id as bewijs_id, pb.stap_id, k.sleutel
    from public.procedure_bewijs pb
    join _bind_kandidaten k on k.stap_id = pb.stap_id
   where pb.requirement_sleutel is null
     and pb.documenttype is not null
     and k.documenttype is not null
     and k.documenttype = pb.documenttype
     and not exists (
       select 1 from public.procedure_bewijs g
        where g.stap_id = pb.stap_id
          and g.requirement_sleutel = k.sleutel
     )
),
eenduidig as (
  select bewijs_id, sleutel from paren
   where bewijs_id in (select bewijs_id from paren group by bewijs_id having count(*) = 1)
     and (stap_id, sleutel) in (
       select stap_id, sleutel from paren group by stap_id, sleutel having count(*) = 1
     )
),
gemuteerd as (
  update public.procedure_bewijs pb
     set requirement_sleutel = e.sleutel
    from eenduidig e
   where e.bewijs_id = pb.id
  returning pb.id, pb.requirement_sleutel
)
insert into _bind_gelegd (bewijs_id, sleutel, regel)
select id, requirement_sleutel, 'R1 documenttype-match' from gemuteerd;

-- R2 — titel gelijk aan label, wederzijds eenduidig. Dit is het productieve
-- pad voor pf_wtp_invaarbesluit: "opvoeren vanuit vereiste" prefillt de titel
-- met het label van de vereiste.
with paren as (
  select distinct pb.id as bewijs_id, pb.stap_id, k.sleutel
    from public.procedure_bewijs pb
    join _bind_kandidaten k on k.stap_id = pb.stap_id
   where pb.requirement_sleutel is null
     and lower(btrim(coalesce(pb.titel,''))) <> ''
     and lower(btrim(coalesce(pb.titel,''))) = lower(btrim(k.label))
     and not exists (
       select 1 from public.procedure_bewijs g
        where g.stap_id = pb.stap_id
          and g.requirement_sleutel = k.sleutel
     )
),
eenduidig as (
  select bewijs_id, sleutel from paren
   where bewijs_id in (select bewijs_id from paren group by bewijs_id having count(*) = 1)
     and (stap_id, sleutel) in (
       select stap_id, sleutel from paren group by stap_id, sleutel having count(*) = 1
     )
),
gemuteerd as (
  update public.procedure_bewijs pb
     set requirement_sleutel = e.sleutel
    from eenduidig e
   where e.bewijs_id = pb.id
  returning pb.id, pb.requirement_sleutel
)
insert into _bind_gelegd (bewijs_id, sleutel, regel)
select id, requirement_sleutel, 'R2 titel=label' from gemuteerd;

-- Auditspoor: één append-only regel per geraakte procedure. Geen actor — dit is
-- een systeemmutatie, expliciet als zodanig gemarkeerd. De payload draagt zowel
-- de gelegde bindingen (bewijs_id + sleutel + regel) als de ids die ongebonden
-- bleven, zodat beide helften herleidbaar zijn.
--
-- Idempotentie: er wordt gelogd zodra deze run daadwerkelijk iets heeft
-- gebonden, én bij de allereerste run ook als er niets te binden viel (dat legt
-- de uitgangstoestand vast). Een herhaalde plak-run die niets muteert voegt dus
-- geen ruis toe; een herhaalde run die wél nieuwe stukken bindt, logt dat wel —
-- de guard onderdrukt logging nooit boven een stille mutatie uit.
insert into public.procedure_log (procedure_id, event_type, actor_id, actor_naam, payload)
select v.procedure_id,
       'bewijs_binding_backfill',
       null,
       'systeem (migratie 2026_08_18_bewijs_requirement_binding)',
       jsonb_build_object(
         'regels', 'R1 documenttype-match, dan R2 titel=label; alleen bij wederzijds eenduidige koppeling',
         'beoordeeld',  count(*),
         'gebonden_deze_run', count(*) filter (where g.bewijs_id is not null),
         'ongebonden',  count(*) filter (where pb.requirement_sleutel is null),
         'gebonden', coalesce(
           jsonb_agg(
             jsonb_build_object('bewijs_id', g.bewijs_id, 'sleutel', g.sleutel, 'regel', g.regel)
             order by g.bewijs_id
           ) filter (where g.bewijs_id is not null), '[]'::jsonb),
         'ongebonden_bewijs_ids',
           coalesce(jsonb_agg(pb.id order by pb.id) filter (where pb.requirement_sleutel is null), '[]'::jsonb)
       )
  from _bind_voor v
  join public.procedure_bewijs pb on pb.id = v.id
  left join _bind_gelegd g on g.bewijs_id = v.id
 group by v.procedure_id
having count(*) filter (where g.bewijs_id is not null) > 0
    or not exists (
         select 1 from public.procedure_log l
          where l.procedure_id = v.procedure_id
            and l.event_type   = 'bewijs_binding_backfill'
       );

do $$
declare g int; o int;
begin
  select (select count(*) from _bind_gelegd),
         (select count(*) from _bind_voor v
            join public.procedure_bewijs pb on pb.id = v.id
           where pb.requirement_sleutel is null)
    into g, o;
  raise notice 'Backfill bewijsbinding: % gebonden in deze run, % ongebonden gelaten.',
    coalesce(g,0), coalesce(o,0);
end $$;

-- ── 3. fn_decision_readiness_check ────────────────────────────
--
--  Integraal gelijk aan 2026_08_14_readiness_uitsluiting.sql, met één
--  wijziging: de document-tak matcht op de expliciete binding in plaats van
--  op documenttype-is-null / documenttype-gelijk / titel-like.

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
          -- Uitsluitend de expliciete binding. Geen wildcard op een vereiste
          -- zonder documenttype, geen titel-substring-match: één bewijsstuk
          -- draagt één sleutel en vervult dus hoogstens één vereiste.
          vervuld := exists (
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
$$;

-- Grant-hygiëne (Gate H). Let op: `create or replace` BEHOUDT de ACL —
-- alleen `drop function` + `create` reset hem, waarna anon via de Supabase
-- default-ACL opnieuw EXECUTE krijgt (bevinding H-18 / OP-C5). Empirisch
-- geverifieerd op Postgres 16 bij deze wijziging; het commentaar "create-or-
-- replace reset de ACL" in eerdere migraties klopt dus niet. Deze regels zijn
-- daarom defensief en idempotent, niet herstellend — ze blijven staan zodat de
-- eindtoestand ook na een toekomstige drop+create expliciet in de migratie staat.
revoke all on function public.fn_decision_readiness_check(uuid, text) from public, anon;
grant execute on function public.fn_decision_readiness_check(uuid, text) to authenticated, service_role;

commit;
