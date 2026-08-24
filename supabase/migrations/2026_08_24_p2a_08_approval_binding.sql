-- P2 / PR-A (#167) — gebonden bewijs voor `approval` op procedure_besluiten.
-- Patroon = p2a_03_risk_binding, maar PROCEDURE-scoped: procedure_besluiten heeft
-- procedure_id (stap_id is nullable — de binding zit in de sleutel, niet in de stap).
-- Dunne wrappers → gedeelde fn_assert_gebonden_feit / fn_log_gebonden_feit_mutatie.
-- Besluit 0189. HAND-APPLIED. Rollback bijgevoegd.

begin;

alter table public.procedure_besluiten
  add column if not exists requirement_sleutel text;
comment on column public.procedure_besluiten.requirement_sleutel is
  'P2 (#167): binding aan een approval-vereiste; formaat stap_volgorde|requirement_type|coalesce(documenttype,label); null = ongebonden. Vervangt de oude "besluitstatus vult vijf vereisten af"-afleiding.';

create index if not exists idx_approval_req_sleutel
  on public.procedure_besluiten(procedure_id, requirement_sleutel)
  where requirement_sleutel is not null;

create or replace function public.fn_validate_approval_binding()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_fonds uuid;
begin
  if new.requirement_sleutel is null then return new; end if;
  select p.fonds_id into v_fonds from public.procedures p where p.id = new.procedure_id;
  if not found then
    raise exception 'Gebonden feit: procedure % niet gevonden (fail-closed).', new.procedure_id using errcode = '23514';
  end if;
  perform public.fn_assert_gebonden_feit(v_fonds, new.procedure_id, new.requirement_sleutel, 'approval');
  return new;
end $$;
revoke all on function public.fn_validate_approval_binding() from public, anon, authenticated;
grant execute on function public.fn_validate_approval_binding() to service_role;
drop trigger if exists trg_approval_validate_binding on public.procedure_besluiten;
create trigger trg_approval_validate_binding
  before insert or update of requirement_sleutel, procedure_id on public.procedure_besluiten
  for each row execute function public.fn_validate_approval_binding();

create or replace function public.fn_audit_approval_binding()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_oud text; v_nieuw text; v_bron uuid; v_proc uuid;
begin
  if tg_op = 'DELETE' then
    if old.requirement_sleutel is null then return old; end if;
    v_oud := old.requirement_sleutel; v_nieuw := null; v_bron := old.id; v_proc := old.procedure_id;
  elsif tg_op = 'INSERT' then
    if new.requirement_sleutel is null then return new; end if;
    v_oud := null; v_nieuw := new.requirement_sleutel; v_bron := new.id; v_proc := new.procedure_id;
  else
    if old.requirement_sleutel is not distinct from new.requirement_sleutel then return new; end if;
    v_oud := old.requirement_sleutel; v_nieuw := new.requirement_sleutel; v_bron := new.id; v_proc := new.procedure_id;
  end if;
  perform public.fn_log_gebonden_feit_mutatie(v_proc, 'procedure_besluiten', v_bron, v_oud, v_nieuw);
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.fn_audit_approval_binding() from public, anon, authenticated;
grant execute on function public.fn_audit_approval_binding() to service_role;
drop trigger if exists trg_approval_audit_binding on public.procedure_besluiten;
create trigger trg_approval_audit_binding
  after insert or update or delete on public.procedure_besluiten
  for each row execute function public.fn_audit_approval_binding();

commit;
