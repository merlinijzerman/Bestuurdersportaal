-- Besluit 0195 / #228 — reparatie van reeds toegepaste legacy-seed.
--
-- De seed van 2026-05-08 is al op Preview toegepast. Deze voorwaartse
-- datamigratie verwijdert daarom de evaluation-requirement waarvoor de huidige
-- runtime geen aanmaakpad heeft. Zij wijzigt uitsluitend
-- beleidswijziging-beleggingsbeleid@1.0.0 en raakt geen nieuwe definitie.
--
-- P1b bevriest gepubliceerde requirementversies. Dit is uitsluitend verdedigbaar
-- als er nul dossiers op @1.0.0 pinnen; de assertie hieronder maakt die gemeten
-- uitzondering afdwingbaar. De trigger gaat alleen binnen deze transactie uit,
-- nooit via session_replication_role, en staat vóór commit aantoonbaar weer aan.
-- Een fout rolt zowel de DELETE als de triggerstand terug.
-- Rollback: supabase/rollbacks/2026_08_29_zz_0195_verwijder_onvervulbare_templatevereisten_ROLLBACK.sql

begin;

do $$
declare
  v_aantal integer;
  v_gepinde_dossiers integer;
begin
  select count(*) into v_gepinde_dossiers
    from public.procedures p
   where p.template_code = 'beleidswijziging_beleggingsbeleid'
     and p.template_versie = '1.0.0';

  if v_gepinde_dossiers <> 0 then
    raise exception
      '0195/#228 breekt af: % dossier(s) pinnen op beleidswijziging-beleggingsbeleid@1.0.0; maak een nieuwe templateversie in plaats van I7 te doorbreken.',
      v_gepinde_dossiers;
  end if;

  select count(*) into v_aantal
    from public.procedure_requirements
   where template_code = 'beleidswijziging_beleggingsbeleid'
     and template_versie = '1.0.0'
     and stap_volgorde = 6
     and requirement_type = 'evaluation'
     and label = 'Evaluatiemoment gepland';

  if v_aantal <> 1 then
    raise exception
      '0195/#228 verwacht precies 1 legacy evaluation-requirement, vond %.',
      v_aantal;
  end if;
end $$;

alter table public.procedure_requirements disable trigger trg_req_versievast;

delete from public.procedure_requirements
 where template_code = 'beleidswijziging_beleggingsbeleid'
   and template_versie = '1.0.0'
   and stap_volgorde = 6
   and requirement_type = 'evaluation'
   and label = 'Evaluatiemoment gepland';

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
    raise exception '0195/#228: I7-trigger trg_req_versievast staat na de correctie niet actief.';
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
    raise exception '0195/#228: onvervulbare legacy requirement bleef aanwezig.';
  end if;
end $$;

commit;
