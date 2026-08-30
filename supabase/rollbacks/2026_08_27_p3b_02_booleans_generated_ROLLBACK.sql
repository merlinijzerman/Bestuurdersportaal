-- ROLLBACK van 2026_08_27_p3b_02_booleans_generated.sql (P3/PR-B, #168, 0192).
-- Zet verplicht/blokkerend terug als GEWONE booleans, mét exact dezelfde waarden
-- en de OORSPRONKELIJKE default/nullability. Net als p3b_01: geen row-DML op
-- procedure_requirements (I7-bevroren rijen), maar via tijdelijk-generated + drop
-- expression, zodat de rollback óók op productie doorloopt zonder I7-window.
--   procedure_requirements = nullable, default true (beide).
--   procedure_requirement_instance = NOT NULL (verplicht default true, blokkerend default false).
begin;

-- ── procedure_requirements ────────────────────────────────────────────────
alter table public.procedure_requirements drop column verplicht;
alter table public.procedure_requirements drop column blokkerend;
alter table public.procedure_requirements
  add column verplicht  boolean generated always as (zwaarte <> 'optioneel') stored,
  add column blokkerend boolean generated always as (zwaarte  = 'kritiek')  stored;
alter table public.procedure_requirements alter column verplicht  drop expression;
alter table public.procedure_requirements alter column blokkerend drop expression;
alter table public.procedure_requirements alter column verplicht  set default true;
alter table public.procedure_requirements alter column blokkerend set default true;

-- ── procedure_requirement_instance (geen I7; NOT NULL herstellen) ──────────
alter table public.procedure_requirement_instance drop column verplicht;
alter table public.procedure_requirement_instance drop column blokkerend;
alter table public.procedure_requirement_instance
  add column verplicht  boolean generated always as (zwaarte <> 'optioneel') stored,
  add column blokkerend boolean generated always as (zwaarte  = 'kritiek')  stored;
alter table public.procedure_requirement_instance alter column verplicht  drop expression;
alter table public.procedure_requirement_instance alter column blokkerend drop expression;
alter table public.procedure_requirement_instance alter column verplicht  set default true;
alter table public.procedure_requirement_instance alter column blokkerend set default false;
alter table public.procedure_requirement_instance alter column verplicht  set not null;
alter table public.procedure_requirement_instance alter column blokkerend set not null;

commit;
