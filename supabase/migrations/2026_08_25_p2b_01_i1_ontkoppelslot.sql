-- P2 / PR-B (#167) — I1: een gebonden vervulling mag niet onder een besluit
-- vandaan zodra dat besluit "op slot" staat. Besluit 0189 §I1. HAND-APPLIED.
-- Rollback: supabase/rollbacks/2026_08_25_p2b_01_i1_ontkoppelslot_ROLLBACK.sql
-- ---------------------------------------------------------------------------
-- Drie deuren (0189 §I1): (a) ontkoppelen, (b) de bronrij verwijderen,
-- (c) herbinden. 0189 stelde: route voor (a)/(c), trigger voor (b). PR-B verstevigt
-- dat naar één fail-closed DB-backstop die ALLE DRIE de deuren dichtzet — de route
-- levert nog steeds de nette 409 en de dissent-check, maar de invariant leunt niet
-- op het schrijfpad. Zo blijft I1 gedekt ook als een domeinflow (die niet via de
-- koppelroute loopt) een gebonden bronrij verwijdert of de sleutel muteert.
--
-- Deuren als triggerconditie:
--   (b) DELETE van een GEBONDEN rij (old.requirement_sleutel is not null);
--   (a)/(c) UPDATE waarbij een BESTAANDE binding verdwijnt of verandert
--           (old.requirement_sleutel is not null and old is distinct from new).
--   Een EERSTE koppeling (null → sleutel) voegt een vervulling TOE en is geen deur.
--
-- Tijdelijke, striktere variant: P4 vervangt hem door de status-feitenmatrix.
-- Zelfde dunne-wrapper-vorm als PR-A: één gedeelde assert, per tabel een dunne
-- wrapper die het relevante besluit resolvet.

begin;

-- ── Gedeelde poort: raise als het besluit op slot staat. Null besluit (nog geen
--   Decision Object) → geen slot. De statusset spiegelt de approval-tak in
--   buildEvidenceLijst en 0189 §I1.
create or replace function public.fn_assert_feit_ontgrendeld(p_decision_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if p_decision_id is null then
    return;
  end if;
  select status into v_status from public.decision_objects where id = p_decision_id;
  if not found or v_status is null then
    return;
  end if;
  if v_status in ('besloten', 'voorwaardelijk_besloten', 'in_uitvoering', 'in_evaluatie', 'afgesloten') then
    raise exception
      'I1: een gebonden vervulling van een besluit met status "%" mag niet vervallen (verwijderen/ontkoppelen/herbinden geweigerd). Heropen het besluit eerst.',
      v_status using errcode = '23514';
  end if;
end $$;
revoke all on function public.fn_assert_feit_ontgrendeld(uuid) from public, anon, authenticated;
grant execute on function public.fn_assert_feit_ontgrendeld(uuid) to service_role;

-- Deur-conditie: verdwijnt/verandert er een BESTAANDE binding? DELETE van een
-- gebonden rij (b), of UPDATE waarbij old-sleutel niet-null is en wijzigt (a/c).
-- Een eerste koppeling (null → sleutel) is geen deur.
--   → gebruikt in elke wrapper via de lokale expressie hieronder.

-- ── Besluitgebonden tabellen: het besluit is old.decision_id.
create or replace function public.fn_guard_decision_scoped_i1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.requirement_sleutel is not null
     and (tg_op = 'DELETE' or old.requirement_sleutel is distinct from new.requirement_sleutel) then
    perform public.fn_assert_feit_ontgrendeld(old.decision_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.fn_guard_decision_scoped_i1() from public, anon, authenticated;
grant execute on function public.fn_guard_decision_scoped_i1() to service_role;

drop trigger if exists trg_risk_i1 on public.decision_risks;
create trigger trg_risk_i1 before delete or update of requirement_sleutel on public.decision_risks
  for each row execute function public.fn_guard_decision_scoped_i1();
drop trigger if exists trg_assumption_i1 on public.decision_assumptions;
create trigger trg_assumption_i1 before delete or update of requirement_sleutel on public.decision_assumptions
  for each row execute function public.fn_guard_decision_scoped_i1();
drop trigger if exists trg_kpi_i1 on public.decision_conditions;
create trigger trg_kpi_i1 before delete or update of requirement_sleutel on public.decision_conditions
  for each row execute function public.fn_guard_decision_scoped_i1();
drop trigger if exists trg_evaluation_i1 on public.decision_evaluations;
create trigger trg_evaluation_i1 before delete or update of requirement_sleutel on public.decision_evaluations
  for each row execute function public.fn_guard_decision_scoped_i1();
drop trigger if exists trg_aivalidation_i1 on public.decision_ai_interactions;
create trigger trg_aivalidation_i1 before delete or update of requirement_sleutel on public.decision_ai_interactions
  for each row execute function public.fn_guard_decision_scoped_i1();

-- ── Proceduregebonden tabellen (approval, vaststelling): het relevante besluit is
--   het primaire Decision Object van de procedure. Null (nog geen besluit) → geen slot.
create or replace function public.fn_guard_procedure_scoped_i1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dec uuid;
begin
  if old.requirement_sleutel is not null
     and (tg_op = 'DELETE' or old.requirement_sleutel is distinct from new.requirement_sleutel) then
    select id into v_dec from public.decision_objects
      where procedure_id = old.procedure_id and is_primary_decision = true
      limit 1;
    perform public.fn_assert_feit_ontgrendeld(v_dec);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.fn_guard_procedure_scoped_i1() from public, anon, authenticated;
grant execute on function public.fn_guard_procedure_scoped_i1() to service_role;

drop trigger if exists trg_approval_i1 on public.procedure_besluiten;
create trigger trg_approval_i1 before delete or update of requirement_sleutel on public.procedure_besluiten
  for each row execute function public.fn_guard_procedure_scoped_i1();
drop trigger if exists trg_vaststelling_i1 on public.procedure_vaststelling;
create trigger trg_vaststelling_i1 before delete or update of requirement_sleutel on public.procedure_vaststelling
  for each row execute function public.fn_guard_procedure_scoped_i1();

-- ── procedure_bewijs (document/external_submission/consultation): stap-scoped;
--   het besluit is het primaire Decision Object van de procedure áchter de stap.
create or replace function public.fn_guard_bewijs_i1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dec uuid;
begin
  if old.requirement_sleutel is not null
     and (tg_op = 'DELETE' or old.requirement_sleutel is distinct from new.requirement_sleutel) then
    select d.id into v_dec
      from public.procedure_stappen s
      join public.decision_objects d
        on d.procedure_id = s.procedure_id and d.is_primary_decision = true
     where s.id = old.stap_id
     limit 1;
    perform public.fn_assert_feit_ontgrendeld(v_dec);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.fn_guard_bewijs_i1() from public, anon, authenticated;
grant execute on function public.fn_guard_bewijs_i1() to service_role;

drop trigger if exists trg_bewijs_i1 on public.procedure_bewijs;
create trigger trg_bewijs_i1 before delete or update of requirement_sleutel on public.procedure_bewijs
  for each row execute function public.fn_guard_bewijs_i1();

commit;
