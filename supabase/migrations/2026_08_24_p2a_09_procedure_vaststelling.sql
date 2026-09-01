-- P2 / PR-A (#167) — procedure_vaststelling: brontabel voor de objectloze typen
-- (`dissent_review`, `mandate_check`). Besluit 0189. HAND-APPLIED. Rollback bijgevoegd.
-- ---------------------------------------------------------------------------
-- Dit is de ENIGE brontabel waar het feit ONTSTAAT bij het binden — de andere zes
-- hebben het artefact al. Daarom draagt de rij `requirement_sleutel NOT NULL`: de
-- knop-route (PR-B) doet één atomaire INSERT mét sleutel, nooit insert-dan-update,
-- zodat er nooit kort een vaststelling zonder binding bestaat.
--
-- Een nieuwe tabel erft GEEN policies. RLS wordt hier EXPLICIET gezet (fonds-scoped
-- via de eigen fonds_id, gespiegeld op procedure_requirement_instance), en de tabel
-- gaat met naam de cross-tenant-suite in.

begin;

create table if not exists public.procedure_vaststelling (
  id                  uuid primary key default uuid_generate_v4(),
  fonds_id            uuid not null references public.fondsen(id),
  procedure_id        uuid not null references public.procedures(id) on delete cascade,
  stap_id             uuid references public.procedure_stappen(id) on delete set null,
  requirement_sleutel text not null,                          -- zelfde formaat, zelfde resolver
  soort               text not null check (soort in ('dissentronde','mandaatcheck')),
  uitkomst            text not null,                          -- bv. 'geen dissent' | 'dissent vastgelegd'
  toelichting         text not null,
  actor               uuid not null references auth.users(id),
  vastgelegd_op       timestamptz not null default now()
);
comment on table public.procedure_vaststelling is
  'P2 (#167): bestuurlijke vaststelling als gebonden feit voor dissent_review/mandate_check (de typen zonder artefact). Fonds-scoped (eigen fonds_id). Zie besluit 0189.';

create index if not exists idx_vaststelling_req_sleutel
  on public.procedure_vaststelling(procedure_id, requirement_sleutel);
create index if not exists idx_vaststelling_procedure
  on public.procedure_vaststelling(procedure_id);

-- ── RLS: EXPLICIET, fonds-scoped via de eigen fonds_id (Gate B: WITH CHECK).
alter table public.procedure_vaststelling enable row level security;
drop policy if exists "fonds proc vaststelling" on public.procedure_vaststelling;
create policy "fonds proc vaststelling" on public.procedure_vaststelling
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

revoke all on public.procedure_vaststelling from public, anon;
grant select, insert, update, delete on public.procedure_vaststelling to authenticated;
grant select, insert, update, delete on public.procedure_vaststelling to service_role;

-- ── Validate-wrapper. Het verwachte type volgt uit de eigen `soort` van de rij
--   (het artefact declareert wat het is) — letterlijk gemapt, niet uit de sleutel
--   afgeleid. Zo bindt een dissentronde-vaststelling geen mandate_check-vereiste.
create or replace function public.fn_validate_vaststelling_binding()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_fonds uuid; v_type text;
begin
  v_type := case new.soort
              when 'dissentronde' then 'dissent_review'
              when 'mandaatcheck' then 'mandate_check'
              else null end;
  if v_type is null then
    raise exception 'Onbekende vaststellings-soort "%".', new.soort using errcode = '23514';
  end if;
  select p.fonds_id into v_fonds from public.procedures p where p.id = new.procedure_id;
  if not found then
    raise exception 'Vaststelling: procedure % niet gevonden (fail-closed).', new.procedure_id using errcode = '23514';
  end if;
  -- I5 dubbel: de eigen fonds_id moet ook bij de procedure horen.
  if new.fonds_id is distinct from v_fonds then
    raise exception 'Fondsgrens (I5): vaststelling-fonds % wijkt af van procedure-fonds %.', new.fonds_id, v_fonds using errcode = '23514';
  end if;
  perform public.fn_assert_gebonden_feit(new.fonds_id, new.procedure_id, new.requirement_sleutel, v_type);
  return new;
end $$;
revoke all on function public.fn_validate_vaststelling_binding() from public, anon, authenticated;
grant execute on function public.fn_validate_vaststelling_binding() to service_role;
drop trigger if exists trg_vaststelling_validate_binding on public.procedure_vaststelling;
create trigger trg_vaststelling_validate_binding
  before insert or update of requirement_sleutel, soort, fonds_id, procedure_id on public.procedure_vaststelling
  for each row execute function public.fn_validate_vaststelling_binding();

create or replace function public.fn_audit_vaststelling_binding()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_oud text; v_nieuw text; v_bron uuid; v_proc uuid;
begin
  if tg_op = 'DELETE' then
    v_oud := old.requirement_sleutel; v_nieuw := null; v_bron := old.id; v_proc := old.procedure_id;
  elsif tg_op = 'INSERT' then
    v_oud := null; v_nieuw := new.requirement_sleutel; v_bron := new.id; v_proc := new.procedure_id;
  else
    if old.requirement_sleutel is not distinct from new.requirement_sleutel then return new; end if;
    v_oud := old.requirement_sleutel; v_nieuw := new.requirement_sleutel; v_bron := new.id; v_proc := new.procedure_id;
  end if;
  perform public.fn_log_gebonden_feit_mutatie(v_proc, 'procedure_vaststelling', v_bron, v_oud, v_nieuw);
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.fn_audit_vaststelling_binding() from public, anon, authenticated;
grant execute on function public.fn_audit_vaststelling_binding() to service_role;
drop trigger if exists trg_vaststelling_audit_binding on public.procedure_vaststelling;
create trigger trg_vaststelling_audit_binding
  after insert or update or delete on public.procedure_vaststelling
  for each row execute function public.fn_audit_vaststelling_binding();

commit;
