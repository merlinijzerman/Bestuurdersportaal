-- ============================================================================
-- ROLLBACK voor 2026_06_18_dossier_procesinstantie.sql
--
-- Draait Increment B (procesinstantie/dossier + dossierstatus-mapping)
-- volledig terug: view + mapping-functie weg, documentkoppeling weg,
-- periode-velden weg, en de statusset terug naar de oude 3 waarden.
--
-- LET OP — volgorde en datamapping:
--   1. De oude 3-waarden-check accepteert alleen in_uitvoering/
--      wacht_op_besluit/afgerond. Daarom mappen we de nieuwe
--      8-waardenstatussen TERUG vóór we de oude check zetten, anders
--      faalt de constraint. Statussen zonder oude tegenhanger
--      (gepland/in_implementatie/heropend/gearchiveerd) worden
--      conservatief naar in_uitvoering resp. afgerond gemapt.
--   2. ALLEEN gebruiken om B volledig terug te draaien.
-- ============================================================================

-- 1. View + mapping-functie
drop view if exists public.vw_dossier_status;
drop function if exists public.fn_dossierstatus_van_decision(text);

-- 2. Documentkoppeling (trigger → functie → index → kolom)
drop trigger if exists trg_document_procesinstantie_fonds on public.documenten;
drop function if exists public.fn_document_procesinstantie_fonds_check();
drop index if exists public.idx_documenten_procesinstantie;
alter table public.documenten drop column if exists procesinstantie_id;

-- 3. Statusset terug naar oud (eerst data terugmappen, dan check).
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.procedures'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.procedures drop constraint %I', c);
  end loop;
end $$;

update public.procedures set status = 'in_uitvoering'    where status = 'lopend';
update public.procedures set status = 'wacht_op_besluit' where status = 'ter_besluitvorming';
update public.procedures set status = 'in_uitvoering'    where status in ('gepland','besloten','in_implementatie','heropend');
update public.procedures set status = 'afgerond'         where status = 'gearchiveerd';
-- 'afgerond' blijft afgerond.

alter table public.procedures
  add constraint procedures_status_check check (status in (
    'in_uitvoering','wacht_op_besluit','afgerond'
  ));
alter table public.procedures alter column status set default 'in_uitvoering';

-- 4. Periode-velden
alter table public.procedures
  drop column if exists periode_type,
  drop column if exists periode_start,
  drop column if exists periode_eind,
  drop column if exists periode_jaar;
