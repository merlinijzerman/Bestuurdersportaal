-- #263 — regressiecheck P2-indexpreflight.
--
-- Productie bevatte op stap 2 een gebonden document met min_aantal=1 en op
-- dezelfde stap een andere assumption-requirement met min_aantal=3. De oude
-- preflight koppelde alleen op template + stap en gaf daardoor een vals-positief.
-- Deze pure fixture bewijst beide kanten van de gecorrigeerde correlatie:
--   1. een hoge drempel op een ANDERE sleutel telt niet;
--   2. een hoge drempel op DEZELFDE, versievaste sleutel telt wel.
-- ROL: postgres; dit is een isolatievrije, volledig synthetische CTE-fixture
-- zonder tabeltoegang. Zij toetst uitsluitend de eigenaarspreflight en rolt af.

begin;

do $$
declare
  v_aantal int;
begin
  with
  procedures(id, template_code, template_versie) as (
    values ('00000000-0000-0000-0000-000000000001'::uuid, 'beleid', '1.0.0')
  ),
  stappen(id, procedure_id, volgorde) as (
    values (
      '00000000-0000-0000-0000-000000000002'::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid,
      2
    )
  ),
  bewijs(stap_id, requirement_sleutel) as (
    values (
      '00000000-0000-0000-0000-000000000002'::uuid,
      '2|document|ALM_analyse'
    )
  ),
  requirements(template_code, template_versie, stap_volgorde, requirement_type, documenttype, label, min_aantal) as (
    values
      ('beleid', '1.0.0', 2, 'document', 'ALM_analyse', 'ALM-analyse', 1),
      ('beleid', '1.0.0', 2, 'assumption', null, 'Drie kernaannames', 3),
      ('beleid', '2.0.0', 2, 'document', 'ALM_analyse', 'ALM-analyse', 4)
  )
  select count(*) into v_aantal
    from bewijs pb
    join stappen ps on ps.id = pb.stap_id
    join procedures p on p.id = ps.procedure_id
    join requirements r
      on r.template_code = p.template_code
     and r.template_versie = p.template_versie
     and r.stap_volgorde = ps.volgorde
     and pb.requirement_sleutel =
           r.stap_volgorde::text || '|' || r.requirement_type || '|' ||
           coalesce(r.documenttype, r.label)
   where pb.requirement_sleutel is not null
     and coalesce(r.min_aantal, 1) > 1;

  if v_aantal <> 0 then
    raise exception 'FAALT #263-A: andere sleutel/versie veroorzaakt vals-positief: %', v_aantal;
  end if;

  with
  procedures(id, template_code, template_versie) as (
    values ('00000000-0000-0000-0000-000000000001'::uuid, 'beleid', '1.0.0')
  ),
  stappen(id, procedure_id, volgorde) as (
    values (
      '00000000-0000-0000-0000-000000000002'::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid,
      2
    )
  ),
  bewijs(stap_id, requirement_sleutel) as (
    values (
      '00000000-0000-0000-0000-000000000002'::uuid,
      '2|document|ALM_analyse'
    )
  ),
  requirements(template_code, template_versie, stap_volgorde, requirement_type, documenttype, label, min_aantal) as (
    values
      ('beleid', '1.0.0', 2, 'document', 'ALM_analyse', 'ALM-analyse', 2),
      ('beleid', '1.0.0', 2, 'assumption', null, 'Drie kernaannames', 3),
      ('beleid', '2.0.0', 2, 'document', 'ALM_analyse', 'ALM-analyse', 4)
  )
  select count(*) into v_aantal
    from bewijs pb
    join stappen ps on ps.id = pb.stap_id
    join procedures p on p.id = ps.procedure_id
    join requirements r
      on r.template_code = p.template_code
     and r.template_versie = p.template_versie
     and r.stap_volgorde = ps.volgorde
     and pb.requirement_sleutel =
           r.stap_volgorde::text || '|' || r.requirement_type || '|' ||
           coalesce(r.documenttype, r.label)
   where pb.requirement_sleutel is not null
     and coalesce(r.min_aantal, 1) > 1;

  if v_aantal <> 1 then
    raise exception 'FAALT #263-B: echte hoge-drempelbinding niet gevonden: %', v_aantal;
  end if;

  raise notice 'OK #263: preflight correleert exact op sleutel en templateversie.';
end $$;

rollback;
