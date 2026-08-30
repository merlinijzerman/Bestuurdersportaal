-- P5 / #170 — aantekeningen per processtap (§9.3, besluit 0191).
-- Werkverkeer per stap, bewust niet append-only: alleen de auteur kan later
-- bewerken of verwijderen. De notitie blijft buiten het afschrift en activeert
-- nooit een processtap.

begin;

create table if not exists public.procedure_stap_notitie (
  id            uuid primary key default uuid_generate_v4(),
  fonds_id      uuid not null references public.fondsen(id),
  procedure_id  uuid not null references public.procedures(id) on delete cascade,
  stap_id       uuid not null references public.procedure_stappen(id) on delete cascade,
  tekst         text not null check (length(trim(tekst)) > 0),
  auteur        uuid not null references auth.users(id),
  auteur_naam   text not null,
  aangemaakt_op timestamptz not null default now(),
  bewerkt_op    timestamptz
);

create index if not exists idx_stap_notitie_stap
  on public.procedure_stap_notitie(stap_id, aangemaakt_op desc);

-- I5: fonds en stap moeten precies bij de opgegeven procedure horen. De
-- trigger schrijft niets aan procedure_stappen en kan de stap dus niet activeren.
create or replace function public.fn_validate_stap_notitie()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_proc_fonds uuid;
  v_stap_proc uuid;
begin
  select fonds_id into v_proc_fonds from public.procedures where id = new.procedure_id;
  if not found then
    raise exception 'Aantekening: procedure % niet gevonden.', new.procedure_id using errcode = '23514';
  end if;
  if new.fonds_id is distinct from v_proc_fonds then
    raise exception 'Fondsgrens (I5): aantekening-fonds wijkt af van procedure-fonds.' using errcode = '23514';
  end if;
  select procedure_id into v_stap_proc from public.procedure_stappen where id = new.stap_id;
  if not found or v_stap_proc is distinct from new.procedure_id then
    raise exception 'Aantekening: stap hoort niet bij de procedure.' using errcode = '23514';
  end if;
  return new;
end $$;

revoke all on function public.fn_validate_stap_notitie() from public, anon, authenticated;
grant execute on function public.fn_validate_stap_notitie() to service_role;

drop trigger if exists trg_stap_notitie_validate on public.procedure_stap_notitie;
create trigger trg_stap_notitie_validate
  before insert or update of fonds_id, procedure_id, stap_id on public.procedure_stap_notitie
  for each row execute function public.fn_validate_stap_notitie();

alter table public.procedure_stap_notitie enable row level security;

drop policy if exists "notitie lezen fonds" on public.procedure_stap_notitie;
create policy "notitie lezen fonds" on public.procedure_stap_notitie
  for select using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "notitie schrijven auteur" on public.procedure_stap_notitie;
create policy "notitie schrijven auteur" on public.procedure_stap_notitie
  for insert with check (
    auteur = auth.uid()
    and fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

drop policy if exists "notitie wijzigen auteur" on public.procedure_stap_notitie;
create policy "notitie wijzigen auteur" on public.procedure_stap_notitie
  for update using (auteur = auth.uid()) with check (auteur = auth.uid());

drop policy if exists "notitie verwijderen auteur" on public.procedure_stap_notitie;
create policy "notitie verwijderen auteur" on public.procedure_stap_notitie
  for delete using (auteur = auth.uid());

revoke all on public.procedure_stap_notitie from public, anon;
grant select, insert, update, delete on public.procedure_stap_notitie to authenticated;
grant select, insert, update, delete on public.procedure_stap_notitie to service_role;

comment on table public.procedure_stap_notitie is
  'P5/#170 (§9.3): werkverkeer per processtap; geen afschrift, geen statusactivatie. Auteur mag bewerken of verwijderen.';

commit;
