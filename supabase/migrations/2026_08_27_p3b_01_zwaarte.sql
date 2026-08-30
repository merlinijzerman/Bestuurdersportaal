-- P3 / PR-B (#168) — zwaarte + besluitmoment_stap (§5.1, §7). ADDITIEF.
-- ---------------------------------------------------------------------------
-- `verplicht` + `blokkerend` worden één veld `zwaarte` (optioneel/vereist/kritiek).
-- Puur additief: de booleans blijven reële kolommen, de leescode blijft ze lezen —
-- nul gedragswijziging. De omzetting naar afgeleide (generated) leeskolommen zit
-- in p3b_02. `besluitmoment_stap` (§7) komt hier mee: leeg = huidig gedrag.
-- Besluit 0192. HAND-APPLIED. Rollback bijgevoegd.
--
-- LET OP — I7 (P1b/#166): procedure_requirements draagt de onveranderlijkheids-
-- trigger `trg_req_versievast`, die ELKE row-DML (insert/update/delete) op een rij
-- van een GEPUBLICEERDE (template_code, template_versie) weigert. Een gewone
-- `update … set zwaarte = …`-backfill zou daarom op de gepubliceerde invaar- en
-- beleidswijzigingsdefinities afbreken (bevinding audit-/code-review). Daarom
-- vullen we zwaarte NIET met row-DML, maar via een tijdelijk-GENERATED kolom: de
-- waarden worden per rij door DDL berekend (óók voor de bevroren rijen, want DDL
-- vuurt de row-trigger niet) en daarna maakt `drop expression` er een gewone,
-- schrijfbare kolom van mét die waarden. Zo blijft I7 volledig aan; geen window.

begin;

-- Pre-flight (READ-ONLY, geen row-DML → geen I7): de onzin-combo verplicht=false/
-- blokkerend=true (§5.1 noemt 'm zinloos) is niet lossless naar zwaarte. Bestaat
-- die, dan moet een mens kijken vóór we hem stil naar 'optioneel' normaliseren.
do $$
declare n int;
begin
  select count(*) into n from (
    select 1 from public.procedure_requirements
      where coalesce(verplicht, true) = false and coalesce(blokkerend, false) = true
    union all
    select 1 from public.procedure_requirement_instance
      where coalesce(verplicht, true) = false and coalesce(blokkerend, false) = true
  ) x;
  if n > 0 then
    raise exception
      'P3-preflight: % rij(en) met de onzin-combo verplicht=false/blokkerend=true — niet lossless naar zwaarte; handmatig beoordelen (§5.1).', n;
  end if;
end $$;

-- ── procedure_requirements: zwaarte via tijdelijk-generated (DDL, geen I7).
alter table public.procedure_requirements
  add column zwaarte text generated always as (
    case
      when coalesce(verplicht, true)  = false then 'optioneel'
      when coalesce(blokkerend, false) = false then 'vereist'
      else 'kritiek'
    end) stored;
alter table public.procedure_requirements alter column zwaarte drop expression;  -- → gewone kolom, waarden blijven
alter table public.procedure_requirements
  add constraint procedure_requirements_zwaarte_check check (zwaarte in ('optioneel','vereist','kritiek'));
alter table public.procedure_requirements alter column zwaarte set not null;
alter table public.procedure_requirements add column if not exists besluitmoment_stap int;

-- ── procedure_requirement_instance (geen I7-trigger; zelfde nette DDL-vorm).
alter table public.procedure_requirement_instance
  add column zwaarte text generated always as (
    case
      when coalesce(verplicht, true)  = false then 'optioneel'
      when coalesce(blokkerend, false) = false then 'vereist'
      else 'kritiek'
    end) stored;
alter table public.procedure_requirement_instance alter column zwaarte drop expression;
alter table public.procedure_requirement_instance
  add constraint procedure_requirement_instance_zwaarte_check check (zwaarte in ('optioneel','vereist','kritiek'));
alter table public.procedure_requirement_instance alter column zwaarte set not null;
alter table public.procedure_requirement_instance add column if not exists besluitmoment_stap int;

comment on column public.procedure_requirements.zwaarte is
  'P3 (#168, §5.1): optioneel/vereist/kritiek — vervangt verplicht+blokkerend. Zie besluit 0192.';
comment on column public.procedure_requirements.besluitmoment_stap is
  'P3 (#168, §7): stap-volgorde van het besluitmoment waarvoor deze vereiste óók telt (naast haar eigen stap); leeg = alleen de eigen stap.';
comment on column public.procedure_requirement_instance.zwaarte is
  'P3 (#168, §5.1): optioneel/vereist/kritiek — vervangt verplicht+blokkerend.';
comment on column public.procedure_requirement_instance.besluitmoment_stap is
  'P3 (#168, §7): besluitmoment-binding; leeg = alleen de eigen stap.';

commit;
