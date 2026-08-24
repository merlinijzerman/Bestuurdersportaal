-- P2 / PR-A (#167) — gebonden bewijs voor `evaluation` op decision_evaluations.
-- Patroon = p2a_03_risk_binding (bewezen). Scope-kolom: decision_id (besluitgebonden).
-- Dunne wrappers → gedeelde fn_assert_gebonden_feit / fn_log_gebonden_feit_mutatie.
-- Besluit 0189. HAND-APPLIED. Rollback bijgevoegd.

begin;

alter table public.decision_evaluations
  add column if not exists requirement_sleutel text;
comment on column public.decision_evaluations.requirement_sleutel is
  'P2 (#167): binding aan een evaluation-vereiste; formaat stap_volgorde|requirement_type|coalesce(documenttype,label); null = ongebonden.';

create index if not exists idx_evaluation_req_sleutel
  on public.decision_evaluations(decision_id, requirement_sleutel)
  where requirement_sleutel is not null;

create or replace function public.fn_validate_evaluation_binding()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_fonds uuid; v_proc uuid;
begin
  if new.requirement_sleutel is null then return new; end if;
  select d.fonds_id, d.procedure_id into v_fonds, v_proc
    from public.decision_objects d where d.id = new.decision_id;
  if not found then
    raise exception 'Gebonden feit: decision % niet gevonden (fail-closed).', new.decision_id using errcode = '23514';
  end if;
  perform public.fn_assert_gebonden_feit(v_fonds, v_proc, new.requirement_sleutel, 'evaluation');
  return new;
end $$;
revoke all on function public.fn_validate_evaluation_binding() from public, anon, authenticated;
grant execute on function public.fn_validate_evaluation_binding() to service_role;
drop trigger if exists trg_evaluation_validate_binding on public.decision_evaluations;
create trigger trg_evaluation_validate_binding
  before insert or update of requirement_sleutel, decision_id on public.decision_evaluations
  for each row execute function public.fn_validate_evaluation_binding();

create or replace function public.fn_audit_evaluation_binding()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_proc uuid; v_oud text; v_nieuw text; v_bron uuid; v_decision uuid;
begin
  if tg_op = 'DELETE' then
    if old.requirement_sleutel is null then return old; end if;
    v_oud := old.requirement_sleutel; v_nieuw := null; v_bron := old.id; v_decision := old.decision_id;
  elsif tg_op = 'INSERT' then
    if new.requirement_sleutel is null then return new; end if;
    v_oud := null; v_nieuw := new.requirement_sleutel; v_bron := new.id; v_decision := new.decision_id;
  else
    if old.requirement_sleutel is not distinct from new.requirement_sleutel then return new; end if;
    v_oud := old.requirement_sleutel; v_nieuw := new.requirement_sleutel; v_bron := new.id; v_decision := new.decision_id;
  end if;
  select d.procedure_id into v_proc from public.decision_objects d where d.id = v_decision;
  perform public.fn_log_gebonden_feit_mutatie(v_proc, 'decision_evaluations', v_bron, v_oud, v_nieuw);
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.fn_audit_evaluation_binding() from public, anon, authenticated;
grant execute on function public.fn_audit_evaluation_binding() to service_role;
drop trigger if exists trg_evaluation_audit_binding on public.decision_evaluations;
create trigger trg_evaluation_audit_binding
  after insert or update or delete on public.decision_evaluations
  for each row execute function public.fn_audit_evaluation_binding();

commit;
