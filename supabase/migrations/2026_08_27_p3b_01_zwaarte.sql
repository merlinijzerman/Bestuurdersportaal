-- P3 / PR-B (#168) — zwaarte + besluitmoment_stap (§5.1, §7). ADDITIEF.
-- ---------------------------------------------------------------------------
-- `verplicht` + `blokkerend` worden één veld `zwaarte` (optioneel/vereist/kritiek).
-- Deze migratie is puur additief: de booleans blijven reële kolommen, de leescode
-- blijft ze lezen — nul gedragswijziging. De omzetting naar afgeleide (generated)
-- leeskolommen zit BEWUST in een aparte, risicovollere migratie (p3b_02).
-- `besluitmoment_stap` (§7) komt hier mee: leeg = huidig gedrag (telt alleen voor
-- de eigen stap). Besluit 0192. HAND-APPLIED. Rollback bijgevoegd.

begin;

-- Pre-flight: de onzin-combo (verplicht=false, blokkerend=true) — §5.1 noemt 'm
-- expliciet zinloos — kan niet lossless naar zwaarte (verplicht=false wint →
-- optioneel, en blokkerend gaat verloren). Bestaat die, dan moet een mens kijken.
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

alter table public.procedure_requirements
  add column if not exists zwaarte text check (zwaarte in ('optioneel','vereist','kritiek')),
  add column if not exists besluitmoment_stap int;
alter table public.procedure_requirement_instance
  add column if not exists zwaarte text check (zwaarte in ('optioneel','vereist','kritiek')),
  add column if not exists besluitmoment_stap int;

-- Backfill: verplicht=false → optioneel; true+false → vereist; true+true → kritiek.
update public.procedure_requirements
   set zwaarte = case
                   when coalesce(verplicht, true) = false then 'optioneel'
                   when coalesce(blokkerend, false) = false then 'vereist'
                   else 'kritiek'
                 end
 where zwaarte is null;
update public.procedure_requirement_instance
   set zwaarte = case
                   when coalesce(verplicht, true) = false then 'optioneel'
                   when coalesce(blokkerend, false) = false then 'vereist'
                   else 'kritiek'
                 end
 where zwaarte is null;

alter table public.procedure_requirements alter column zwaarte set not null;
alter table public.procedure_requirement_instance alter column zwaarte set not null;

comment on column public.procedure_requirements.zwaarte is
  'P3 (#168, §5.1): optioneel/vereist/kritiek — vervangt verplicht+blokkerend. Zie besluit 0192.';
comment on column public.procedure_requirements.besluitmoment_stap is
  'P3 (#168, §7): stap-volgorde van het besluitmoment waarvoor deze vereiste óók telt (naast haar eigen stap); leeg = alleen de eigen stap.';
comment on column public.procedure_requirement_instance.zwaarte is
  'P3 (#168, §5.1): optioneel/vereist/kritiek — vervangt verplicht+blokkerend.';
comment on column public.procedure_requirement_instance.besluitmoment_stap is
  'P3 (#168, §7): besluitmoment-binding; leeg = alleen de eigen stap.';

commit;
