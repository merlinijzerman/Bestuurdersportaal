-- Preview-controle voor besluit 0195 / #228.
-- Draai na de voorwaartse 0195-migratie. Dit is de DB-laag van de contracttest:
-- de legacy-evaluation requirement uit besluit 0195 mag niet blijven bestaan.

do $$
declare
  v_restant text;
begin
  select string_agg(
           format('%s@%s stap %s (%s)', template_code, template_versie,
                  stap_volgorde, requirement_type),
           ', ' order by template_code, template_versie, stap_volgorde, requirement_type
         )
    into v_restant
    from public.procedure_requirements
   where template_code = 'beleidswijziging_beleggingsbeleid'
     and template_versie = '1.0.0'
     and stap_volgorde = 6
     and requirement_type = 'evaluation'
     and label = 'Evaluatiemoment gepland';

  if v_restant is not null then
    raise exception
      '0195/#228 FAALT: legacy evaluation-requirement zonder runtime-vervullingspad aanwezig: %',
      v_restant;
  end if;
end $$;

select '0195/#228 OK: legacy evaluation-requirement verwijderd.' as resultaat;
