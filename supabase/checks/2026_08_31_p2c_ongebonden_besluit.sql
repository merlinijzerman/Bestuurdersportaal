-- #228-familie / Bevinding 2b — gedragsbewijs voor D10 op approval-besluiten.
--
-- Een besluit is een feit en mag daarom ongebonden bestaan. Alleen de binding
-- aan een approval-vereiste telt als vervulling; de P4-status-feitenmatrix
-- weigert de statusclaim zolang dat gebonden feit ontbreekt. Twee paden,
-- zelf-seedend en volledig terugrolbaar.
-- ROL: postgres seedt de isolatievrije fixture; de statusomslag zet auth.uid()
-- expliciet op een voorzitter, omdat juist het bevoegde browserpad moet tonen
-- dat een ongebonden feit bestaat maar de P4-poort niet passeert.

begin;

insert into public.fondsen (id, naam, slug)
values ('2c2c0000-0000-0000-0000-000000000001', 'P2c besluitfonds', 'p2c-besluitfonds');
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('2c2c0000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
        'p2c-voorzitter@test.local', '{"naam":"P2c Voorzitter"}', now(), now());
insert into public.profielen (id, fonds_id, naam, rol)
values ('2c2c0000-0000-0000-0000-000000000002', '2c2c0000-0000-0000-0000-000000000001',
        'P2c Voorzitter', 'voorzitter');

-- Pad A: de definitie heeft geen approval. Het besluit landt ongebonden en de
-- status-feitenmatrix weigert terecht `besloten`: bestaan ≠ vervullen.
insert into public.procedures (id, fonds_id, template_code, template_versie, titel)
values ('2c2c0000-0000-0000-0000-000000000003', '2c2c0000-0000-0000-0000-000000000001',
        'p2c_zonder_approval', '1.0.0', 'Ongebonden besluit');
insert into public.procedure_stappen (id, procedure_id, volgorde, naam, vereist_besluit)
values ('2c2c0000-0000-0000-0000-000000000004', '2c2c0000-0000-0000-0000-000000000003',
        1, 'Besluitmoment zonder requirement', true);
insert into public.decision_objects
  (id, procedure_id, fonds_id, besluit_code, titel, besluitvraag, is_primary_decision, status)
values ('2c2c0000-0000-0000-0000-000000000005', '2c2c0000-0000-0000-0000-000000000003',
        '2c2c0000-0000-0000-0000-000000000001', 'P2C-1', 'Ongebonden', 'Vraag?', true, 'in_bespreking');
insert into public.procedure_besluiten
  (procedure_id, stap_id, decision_id, formulering, datum, requirement_sleutel, uitkomst)
values ('2c2c0000-0000-0000-0000-000000000003', '2c2c0000-0000-0000-0000-000000000004',
        '2c2c0000-0000-0000-0000-000000000005', 'Besluit zonder templatebinding', current_date, null, 'instemmend');

do $$
declare v_aantal integer; v_status text;
begin
  select count(*) into v_aantal from public.procedure_besluiten
   where procedure_id = '2c2c0000-0000-0000-0000-000000000003'
     and requirement_sleutel is null;
  if v_aantal <> 1 then
    raise exception 'P2c/A faalt: ongebonden besluit is niet als feit vastgelegd (%).', v_aantal;
  end if;
  perform set_config('request.jwt.claim.sub', '2c2c0000-0000-0000-0000-000000000002', true);
  begin
    perform public.fn_besluit_status_omslag(
      '2c2c0000-0000-0000-0000-000000000005', 'besloten', 'vastleggen',
      'Een ongebonden besluit mag de vereiste statusclaim niet dragen.');
    set constraints trg_besluitstatus_feit immediate;
    raise exception 'P2c/A faalt: ongebonden besluit voldeed toch aan de approval-statuspoort.';
  exception when sqlstate 'PC004' then null;
  end;
  select status into v_status from public.decision_objects
   where id = '2c2c0000-0000-0000-0000-000000000005';
  if v_status <> 'in_bespreking' then
    raise exception 'P2c/A faalt: status wijzigde ondanks ontbrekende gebonden approval (%).', v_status;
  end if;
  raise notice 'OK P2c/A: besluit bestaat ongebonden en vervult niets.';
end $$;

-- Pad B: exact één approval. Het gebonden besluit voldoet aan dezelfde matrix.
insert into public.procedures (id, fonds_id, template_code, template_versie, titel)
values ('2c2c0000-0000-0000-0000-000000000006', '2c2c0000-0000-0000-0000-000000000001',
        'p2c_met_approval', '1.0.0', 'Gebonden besluit');
insert into public.procedure_stappen (id, procedure_id, volgorde, naam, vereist_besluit)
values ('2c2c0000-0000-0000-0000-000000000007', '2c2c0000-0000-0000-0000-000000000006',
        1, 'Besluitmoment met requirement', true);
insert into public.decision_objects
  (id, procedure_id, fonds_id, besluit_code, titel, besluitvraag, is_primary_decision, status)
values ('2c2c0000-0000-0000-0000-000000000008', '2c2c0000-0000-0000-0000-000000000006',
        '2c2c0000-0000-0000-0000-000000000001', 'P2C-2', 'Gebonden', 'Vraag?', true, 'in_bespreking');
insert into public.procedure_requirements
  (template_code, template_versie, stap_volgorde, requirement_type, label, min_aantal, zwaarte)
values ('p2c_met_approval', '1.0.0', 1, 'approval', 'P2c approval', 1, 'vereist');
insert into public.procedure_besluiten
  (procedure_id, stap_id, decision_id, formulering, datum, requirement_sleutel, uitkomst)
values ('2c2c0000-0000-0000-0000-000000000006', '2c2c0000-0000-0000-0000-000000000007',
        '2c2c0000-0000-0000-0000-000000000008', 'Besluit met templatebinding', current_date,
        '1|approval|P2c approval', 'instemmend');

do $$
declare v_status text;
begin
  perform set_config('request.jwt.claim.sub', '2c2c0000-0000-0000-0000-000000000002', true);
  perform public.fn_besluit_status_omslag(
    '2c2c0000-0000-0000-0000-000000000008', 'besloten', 'vastleggen',
    'Gebonden approval-feit is voor deze statusclaim aanwezig.');
  set constraints trg_besluitstatus_feit immediate;
  select status into v_status from public.decision_objects
   where id = '2c2c0000-0000-0000-0000-000000000008';
  if v_status <> 'besloten' then
    raise exception 'P2c/B faalt: gebonden approval-besluit bereikte besloten niet (%).', v_status;
  end if;
  raise notice 'OK P2c/B: gebonden approval-besluit vervult en draagt de statusclaim.';
end $$;

rollback;
