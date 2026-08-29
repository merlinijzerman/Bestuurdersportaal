-- Rollback van besluit 0195 / #228.
-- Alleen toepassen als de voorwaartse 0195-migratie al is toegepast en P1b nog
-- aanwezig is. De hoofdrollback draait dit bestand dus vóór P4, P3, P2 en P1b.
-- Ook rollback verandert de inhoud van @1.0.0 en staat daarom uitsluitend de
-- gemeten uitzondering 0 (Preview) of 3 (productie, niet in gebruik) toe. Geen
-- session_replication_role: de I7-trigger wordt uitsluitend transactioneel
-- tijdelijk uitgezet en aantoonbaar hersteld.

begin;

do $$
declare
  v_gepinde_dossiers integer;
begin
  select count(*) into v_gepinde_dossiers
    from public.procedures p
   where p.template_code = 'beleidswijziging_beleggingsbeleid'
     and p.template_versie = '1.0.0';

  if v_gepinde_dossiers not in (0, 3) then
    raise exception
      '0195/#228 rollback breekt af: % dossier(s) pinnen op beleidswijziging-beleggingsbeleid@1.0.0; alleen de gemeten uitzondering 0 (Preview) of 3 (productie, niet in gebruik) is toegestaan.',
      v_gepinde_dossiers;
  end if;

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

do $$
begin
  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.procedure_requirements'::regclass
       and tgname = 'trg_req_versievast'
       and tgenabled = 'O'
  ) then
    raise exception '0195/#228 rollback: I7-trigger trg_req_versievast staat niet actief.';
  end if;
end $$;

commit;
