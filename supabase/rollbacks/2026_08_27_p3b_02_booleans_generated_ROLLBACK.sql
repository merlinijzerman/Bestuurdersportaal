-- ROLLBACK van 2026_08_27_p3b_02_booleans_generated.sql (P3/PR-B, #168, 0192).
-- Zet verplicht/blokkerend terug als GEWONE booleans, mét exact dezelfde waarden
-- (backfill uit zwaarte, de inverse van p3b_01) en de OORSPRONKELIJKE default/
-- nullability: procedure_requirements = nullable default true; instance = NOT NULL
-- (verplicht default true, blokkerend default false).
begin;

-- ── procedure_requirements (booleans waren nullable, default true) ─────────
alter table public.procedure_requirements drop column verplicht;
alter table public.procedure_requirements drop column blokkerend;
alter table public.procedure_requirements
  add column verplicht  boolean default true,
  add column blokkerend boolean default true;
update public.procedure_requirements
   set verplicht  = (zwaarte <> 'optioneel'),
       blokkerend = (zwaarte  = 'kritiek');

-- ── procedure_requirement_instance (verplicht NOT NULL default true,
--    blokkerend NOT NULL default false) ──────────────────────────────────
alter table public.procedure_requirement_instance drop column verplicht;
alter table public.procedure_requirement_instance drop column blokkerend;
alter table public.procedure_requirement_instance
  add column verplicht  boolean default true,
  add column blokkerend boolean default false;
update public.procedure_requirement_instance
   set verplicht  = (zwaarte <> 'optioneel'),
       blokkerend = (zwaarte  = 'kritiek');
alter table public.procedure_requirement_instance alter column verplicht  set not null;
alter table public.procedure_requirement_instance alter column blokkerend set not null;

commit;
