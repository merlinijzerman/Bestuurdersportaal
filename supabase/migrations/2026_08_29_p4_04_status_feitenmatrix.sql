-- P4 tranche 4 (#169, besluit 0193) — volledige status-feitenmatrix (I1).
-- ---------------------------------------------------------------------------
-- De matrix is data; de toets zit als INITIALLY DEFERRED constraint-trigger
-- onder decision_objects.status. Daardoor vallen óók SECURITY DEFINER-paden
-- (procedure beëindigen/heropenen en heropenen-ter-correctie) onder I1, terwijl
-- een feit/event dat later in dezelfde transactie wordt geschreven wel meetelt.
--
-- HAND-APPLIED. Rollback:
-- supabase/rollbacks/2026_08_29_p4_04_status_feitenmatrix_ROLLBACK.sql

begin;

create table if not exists public.besluitstatus_vereist_feit (
  doelstatus   text primary key,
  vereist_feit text not null,
  toelichting  text not null
);

comment on table public.besluitstatus_vereist_feit is
  'P4/I1: auditor-leesbare matrix van besluitstatus naar het feit dat vóór de statusomslag moet bestaan.';

alter table public.besluitstatus_vereist_feit enable row level security;
drop policy if exists "statusfeiten read all" on public.besluitstatus_vereist_feit;
create policy "statusfeiten read all" on public.besluitstatus_vereist_feit
  for select using (auth.uid() is not null);
revoke all on public.besluitstatus_vereist_feit from public, anon, authenticated;
grant select on public.besluitstatus_vereist_feit to authenticated;

insert into public.besluitstatus_vereist_feit (doelstatus, vereist_feit, toelichting)
values
  ('concept',                 'geen',                         'Werktoestand; stelt geen extern feit.'),
  ('in_onderbouwing',         'geen',                         'Werktoestand; stelt geen extern feit.'),
  ('in_validatie',            'geen',                         'Werktoestand; stelt geen extern feit.'),
  ('in_review',               'geen',                         'Werktoestand; stelt geen extern feit.'),
  ('geagendeerd',             'agendapunt_gepland',           'Gekoppeld agendapunt op een nog niet afgeronde vergadering.'),
  ('in_bespreking',           'agendapunt_bespreekbaar',      'Gekoppeld agendapunt op een vergadering van vandaag of eerder.'),
  ('besloten',                'besluit_gebonden_approval',    'Minimaal één vastgelegd besluit is gebonden aan een approval-vereiste.'),
  ('voorwaardelijk_besloten', 'besluit_en_voorwaarde',        'Gebonden besluit én minimaal één vastgelegde voorwaarde.'),
  ('afgewezen',               'afwijzend_besluit',             'Een gebonden besluit met uitkomst afwijzend.'),
  ('aangehouden',             'aanhoudingsreden',              'Append-only statusfeit met een niet-lege reden.'),
  ('geescaleerd',             'escalatie_geadresseerd',        'Append-only statusfeit met een geadresseerde.'),
  ('teruggezet',              'terugzetdoel_en_motivering',    'Append-only statusfeit met doelstatus en motivering.'),
  ('in_uitvoering',           'besluit_in_historie',           'Eerdere status vastgesteld als besloten of voorwaardelijk besloten.'),
  ('in_evaluatie',            'besluit_en_evaluatie',          'Besluit in historie én een geplande evaluatie.'),
  ('afgesloten',              'alle_besluitmomenten_gebonden', 'Elk besluitmoment heeft een gebonden besluit.'),
  ('heropend',                'heropening_met_bron_en_reden',   'Terminaal vertrekpunt en verplichte motivering zijn vastgelegd.'),
  ('beeindigd',               'beeindiging_event',             'Beëindigingsevent met actor en reden.'),
  ('geannuleerd',             'legacy_niet_kiesbaar',          'Verborgen legacy-opslagwaarde; geen nieuwe overgang toegestaan.')
on conflict (doelstatus) do update
set vereist_feit = excluded.vereist_feit,
    toelichting = excluded.toelichting;

-- Het vastgelegde besluit draagt voortaan zijn uitkomst als zelfstandig feit.
-- Bestaande rijen blijven NULL: de matrix laat ze niet stil als afwijzend gelden.
alter table public.procedure_besluiten
  add column if not exists uitkomst text;
alter table public.procedure_besluiten
  drop constraint if exists procedure_besluiten_uitkomst_check;
alter table public.procedure_besluiten
  add constraint procedure_besluiten_uitkomst_check
  check (uitkomst is null or uitkomst in ('instemmend','voorwaardelijk','afwijzend'));
comment on column public.procedure_besluiten.uitkomst is
  'P4/I1: feitelijke uitkomst van de vastlegging; vereist voor nieuwe besluiten en voor status afgewezen.';

create or replace function public.fn_toets_besluitstatus_feit(
  p_decision_id uuid,
  p_doelstatus  text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_feit text;
  v_proc uuid;
  v_ok   boolean := false;
begin
  select d.procedure_id into v_proc
    from public.decision_objects d
   where d.id = p_decision_id;
  if not found then
    raise exception 'Decision Object niet gevonden voor de feitenmatrix.' using errcode = '23514';
  end if;

  select m.vereist_feit into v_feit
    from public.besluitstatus_vereist_feit m
   where m.doelstatus = p_doelstatus;
  if not found then
    raise exception 'Status % ontbreekt in besluitstatus_vereist_feit (fail-closed).', p_doelstatus
      using errcode = 'PC004';
  end if;

  if v_feit = 'geen' then
    return;
  elsif v_feit = 'agendapunt_gepland' then
    select exists (
      select 1
        from public.agendapunten a
        join public.procedure_stappen ps on ps.id = a.procedure_stap_id
        join public.vergaderingen v on v.id = a.vergadering_id
       where ps.procedure_id = v_proc
         and v.status is distinct from 'afgerond'
         and v.gearchiveerd_op is null
    ) into v_ok;
  elsif v_feit = 'agendapunt_bespreekbaar' then
    select exists (
      select 1
        from public.agendapunten a
        join public.procedure_stappen ps on ps.id = a.procedure_stap_id
        join public.vergaderingen v on v.id = a.vergadering_id
       where ps.procedure_id = v_proc
         and v.datum::date <= current_date
         and v.gearchiveerd_op is null
    ) into v_ok;
  elsif v_feit = 'besluit_gebonden_approval' then
    select exists (
      select 1 from public.procedure_besluiten b
       where b.decision_id = p_decision_id
         and b.requirement_sleutel is not null
    ) into v_ok;
  elsif v_feit = 'besluit_en_voorwaarde' then
    select exists (
      select 1 from public.procedure_besluiten b
       where b.decision_id = p_decision_id
         and b.requirement_sleutel is not null
    ) and exists (
      select 1 from public.decision_conditions c
       where c.decision_id = p_decision_id
    ) into v_ok;
  elsif v_feit = 'afwijzend_besluit' then
    select exists (
      select 1 from public.procedure_besluiten b
       where b.decision_id = p_decision_id
         and b.requirement_sleutel is not null
         and b.uitkomst = 'afwijzend'
    ) into v_ok;
  elsif v_feit = 'aanhoudingsreden' then
    select exists (
      select 1 from public.governance_events g
       where g.decision_id = p_decision_id
         and g.event_type = 'status_gewijzigd'
         and g.nieuwe_waarde->>'status' = 'aangehouden'
         and length(btrim(coalesce(g.reden, ''))) >= 3
    ) into v_ok;
  elsif v_feit = 'escalatie_geadresseerd' then
    select exists (
      select 1 from public.governance_events g
       where g.decision_id = p_decision_id
         and g.event_type = 'status_gewijzigd'
         and g.nieuwe_waarde->>'status' = 'geescaleerd'
         and length(btrim(coalesce(g.nieuwe_waarde->>'geadresseerde', ''))) >= 2
    ) into v_ok;
  elsif v_feit = 'terugzetdoel_en_motivering' then
    select exists (
      select 1 from public.governance_events g
       where g.decision_id = p_decision_id
         and g.event_type = 'status_gewijzigd'
         and g.nieuwe_waarde->>'status' = 'teruggezet'
         and g.nieuwe_waarde->>'doelstatus' in ('in_onderbouwing','in_validatie')
         and length(btrim(coalesce(g.reden, ''))) >= 10
    ) into v_ok;
  elsif v_feit = 'besluit_in_historie' then
    select exists (
      select 1 from public.governance_events g
       where g.decision_id = p_decision_id
         and g.event_type = 'status_gewijzigd'
         and g.nieuwe_waarde->>'status' in ('besloten','voorwaardelijk_besloten')
    ) into v_ok;
  elsif v_feit = 'besluit_en_evaluatie' then
    select exists (
      select 1 from public.governance_events g
       where g.decision_id = p_decision_id
         and g.event_type = 'status_gewijzigd'
         and g.nieuwe_waarde->>'status' in ('besloten','voorwaardelijk_besloten')
    ) and exists (
      select 1 from public.decision_evaluations e
       where e.decision_id = p_decision_id
         and e.geplande_datum is not null
    ) into v_ok;
  elsif v_feit = 'alle_besluitmomenten_gebonden' then
    select exists (
      select 1 from public.procedure_stappen ps
       where ps.procedure_id = v_proc and ps.vereist_besluit = true
    ) and not exists (
      select 1 from public.procedure_stappen ps
       where ps.procedure_id = v_proc
         and ps.vereist_besluit = true
         and not exists (
           select 1 from public.procedure_besluiten b
            where b.decision_id = p_decision_id
              and b.stap_id = ps.id
              and b.requirement_sleutel is not null
         )
    ) into v_ok;
  elsif v_feit = 'heropening_met_bron_en_reden' then
    select exists (
      select 1 from public.governance_events g
       where g.decision_id = p_decision_id
         and (
           (g.event_type = 'status_gewijzigd'
            and g.nieuwe_waarde->>'status' = 'heropend'
            and g.oude_waarde->>'status' in ('besloten','voorwaardelijk_besloten','in_evaluatie','afgesloten','beeindigd'))
           or g.event_type in ('besluit_heropend_ter_correctie','procedure_heropend')
         )
         and length(btrim(coalesce(g.reden, ''))) >= 10
    ) into v_ok;
  elsif v_feit = 'beeindiging_event' then
    select exists (
      select 1 from public.governance_events g
       where g.decision_id = p_decision_id
         and g.event_type = 'procedure_beeindigd'
         and g.actor_id is not null
         and length(btrim(coalesce(g.reden, ''))) >= 10
    ) into v_ok;
  elsif v_feit = 'legacy_niet_kiesbaar' then
    v_ok := false;
  end if;

  if not coalesce(v_ok, false) then
    raise exception 'Status % vereist feit %; dat feit ontbreekt.', p_doelstatus, v_feit
      using errcode = 'PC004';
  end if;
end $$;

revoke all on function public.fn_toets_besluitstatus_feit(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.fn_guard_besluitstatus_feit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    perform public.fn_toets_besluitstatus_feit(new.id, new.status);
  end if;
  return new;
end $$;

revoke all on function public.fn_guard_besluitstatus_feit()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_besluitstatus_feit on public.decision_objects;
create constraint trigger trg_besluitstatus_feit
  after update of status on public.decision_objects
  deferrable initially deferred
  for each row execute function public.fn_guard_besluitstatus_feit();

commit;
