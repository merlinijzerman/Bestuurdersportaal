-- #228-familie / Bevinding 2a — publiceer pf_wtp_invaarbesluit@2.0.1.
--
-- Stap 1 van @2.0.0 vroeg wel een besluit maar droeg geen approval-vereiste.
-- I7 verbiedt het wijzigen van die gepubliceerde versie. Deze voorwaartse
-- migratie kopieert daarom de bevroren set naar 2.0.1, voegt daar precies één
-- approval aan toe en publiceert de nieuwe versie pas als laatste stap.
--
-- Rollback: geen database-rollback na commit. procedure_definitie_publicatie is
-- bewust append-only (I7); bij een afgebroken code-deploy blijft @2.0.1 een
-- ongebruikte, correct gepubliceerde definitie en kan de code veilig op @2.0.0
-- terug. Een fout vóór commit rolt de volledige transactie terug.

begin;

do $$
declare
  v_oud integer;
  v_nieuw integer;
begin
  select count(*) into v_oud
    from public.procedure_requirements
   where template_code = 'pf_wtp_invaarbesluit'
     and template_versie = '2.0.0';
  -- De schema-only testbaseline bevat bewust geen definitiedata. Daar is niets
  -- te klonen en publiceert deze migratie dus ook niets; op een werkelijke
  -- omgeving is exact de bevroren 63-rijenversie vereist.
  if v_oud not in (0, 63) then
    raise exception
      '2a/#228 breekt af: verwacht 63 requirements in pf_wtp_invaarbesluit@2.0.0 (of 0 in de schema-only testbaseline), vond %.',
      v_oud;
  end if;

  select count(*) into v_nieuw
    from public.procedure_requirements
   where template_code = 'pf_wtp_invaarbesluit'
     and template_versie = '2.0.1';
  if v_nieuw <> 0 then
    raise exception
      '2a/#228 breekt af: pf_wtp_invaarbesluit@2.0.1 bestaat al (% requirements); wijzig een gepubliceerde versie niet.',
      v_nieuw;
  end if;
  if exists (
    select 1 from public.procedure_definitie_publicatie
     where template_code = 'pf_wtp_invaarbesluit' and template_versie = '2.0.1'
  ) then
    raise exception '2a/#228 breekt af: pf_wtp_invaarbesluit@2.0.1 is al gepubliceerd.';
  end if;
end $$;

insert into public.procedure_requirements
  (template_code, template_versie, stap_volgorde, requirement_type, label,
   documenttype, veld_pad, min_aantal,
   vereist_validatie_domein, toelichting, zwaarte, besluitmoment_stap,
   triggert_bij_ai_risicoklasse)
select template_code, '2.0.1', stap_volgorde, requirement_type, label,
       documenttype, veld_pad, min_aantal,
       vereist_validatie_domein, toelichting, zwaarte, besluitmoment_stap,
       triggert_bij_ai_risicoklasse
  from public.procedure_requirements
 where template_code = 'pf_wtp_invaarbesluit'
   and template_versie = '2.0.0';

insert into public.procedure_requirements
  (template_code, template_versie, stap_volgorde, requirement_type, label,
   min_aantal, toelichting, zwaarte)
select
  'pf_wtp_invaarbesluit', '2.0.1', 1, 'approval',
  'Vaststellingsbesluit opdrachtontvangst en duiding',
  1,
  'Leg het bestuurlijke besluit vast waarmee de ontvangen invaaropdracht is geduid en als uitgangspunt voor het vervolg is vastgesteld.',
  'vereist'
where exists (
  select 1 from public.procedure_requirements
   where template_code = 'pf_wtp_invaarbesluit' and template_versie = '2.0.0'
);

do $$
declare v_nieuw integer;
begin
  select count(*) into v_nieuw
    from public.procedure_requirements
   where template_code = 'pf_wtp_invaarbesluit'
     and template_versie = '2.0.1';
  if exists (
    select 1 from public.procedure_requirements
     where template_code = 'pf_wtp_invaarbesluit' and template_versie = '2.0.0'
  ) and v_nieuw <> 64 then
    raise exception '2a/#228: @2.0.1 moet 64 requirements dragen, vond %.', v_nieuw;
  end if;
  if exists (
    select 1 from public.procedure_requirements
     where template_code = 'pf_wtp_invaarbesluit' and template_versie = '2.0.0'
  ) and not exists (
    select 1 from public.procedure_requirements
     where template_code = 'pf_wtp_invaarbesluit'
       and template_versie = '2.0.1'
       and stap_volgorde = 1
       and requirement_type = 'approval'
       and label = 'Vaststellingsbesluit opdrachtontvangst en duiding'
  ) then
    raise exception '2a/#228: approval-vereiste op stap 1 ontbreekt.';
  end if;
end $$;

-- Pas na de volledige, getoetste inhoud publiceren: vanaf hier bevriest I7 @2.0.1.
insert into public.procedure_definitie_publicatie (template_code, template_versie)
select 'pf_wtp_invaarbesluit', '2.0.1'
where exists (
  select 1 from public.procedure_requirements
   where template_code = 'pf_wtp_invaarbesluit' and template_versie = '2.0.0'
);

commit;
