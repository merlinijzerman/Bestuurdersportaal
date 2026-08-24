-- ROLLBACK van P1b (#166) — versievastheid & onveranderlijkheid.
-- ---------------------------------------------------------------------------
-- HAND-RUN, niet automatisch (de runner raakt supabase/rollbacks/ niet).
-- Herstelt de pre-P1b toestand. Getest via forward → rollback → forward.

begin;

-- 1. Triggers + functies weg — eerst, zodat requirement-mutaties weer mogen en de
--    append-only-grendel de drop van de publicatietabel niet in de weg zit.
drop trigger if exists trg_req_versievast on public.procedure_requirements;
drop function if exists public.fn_procedure_requirements_versievast();
drop trigger if exists trg_publicatie_geen_truncate on public.procedure_definitie_publicatie;
drop trigger if exists trg_publicatie_append_only on public.procedure_definitie_publicatie;
drop function if exists public.fn_publicatie_append_only();

-- 2. Publicatieregister weg.
drop table if exists public.procedure_definitie_publicatie;

-- 3. decision_objects.template_versie terug naar de CODE (de pre-P1b staat, waarin
--    decision.ts de code in het versie-veld schreef).
update public.decision_objects d
   set template_versie = p.template_code
  from public.procedures p
 where d.procedure_id = p.id;

-- 4. idx_req_uniek terug naar de originele 4-koloms-vorm (zonder template_versie).
drop index if exists public.idx_req_uniek;
create unique index if not exists idx_req_uniek
  on public.procedure_requirements(
    template_code, stap_volgorde, requirement_type,
    coalesce(documenttype, label));

-- 5. procedures.template_versie weg.
alter table public.procedures drop column if exists template_versie;

-- 6. procedure_requirements-kolommen weg (index in stap 4 al herbouwd zonder deze).
alter table public.procedure_requirements drop column if exists triggert_bij_ai_risicoklasse;
alter table public.procedure_requirements drop column if exists template_versie;

commit;
