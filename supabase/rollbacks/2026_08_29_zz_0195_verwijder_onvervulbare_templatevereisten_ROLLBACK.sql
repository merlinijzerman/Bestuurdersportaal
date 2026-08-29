-- Rollback van besluit 0195 / #228.
-- Alleen toepassen als de voorwaartse 0195-migratie al is toegepast en P1b nog
-- aanwezig is. De hoofdrollback draait dit bestand dus vóór P4, P3, P2 en P1b.

begin;

do $$
begin
  if exists (
    select 1
      from public.procedure_requirements
     where template_code = 'beleidswijziging_beleggingsbeleid'
       and template_versie = '1.0.0'
       and stap_volgorde = 6
       and requirement_type = 'evaluation'
       and label = 'Evaluatiemoment gepland'
  ) then
    raise exception '0195/#228 rollback: legacy requirements bestaan al; afbreken om duplicatie te voorkomen.';
  end if;
end $$;

alter table public.procedure_requirements disable trigger trg_req_versievast;

insert into public.procedure_requirements
  (template_code, template_versie, stap_volgorde, requirement_type, label,
   validatieregel, zwaarte)
values
  ('beleidswijziging_beleggingsbeleid', '1.0.0', 6, 'evaluation',
   'Evaluatiemoment gepland',
   'minstens één decision_evaluations met geplande_datum', 'kritiek');

alter table public.procedure_requirements enable trigger trg_req_versievast;

commit;
