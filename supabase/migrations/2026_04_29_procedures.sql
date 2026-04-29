-- ============================================================
--  Migratie 2026-04-29 — Module Procedures (workflow & case management)
--  Zeven tabellen + RLS policies. Idempotent.
-- ============================================================

-- ── 1. Procedures (lopende instances) ──────────────────────
create table if not exists public.procedures (
  id              uuid primary key default uuid_generate_v4(),
  fonds_id        uuid not null references public.fondsen(id) on delete cascade,
  template_code   text not null,
  titel           text not null,
  beschrijving    text,
  status          text not null check (status in (
                    'in_uitvoering','wacht_op_besluit','afgerond'
                  )) default 'in_uitvoering',
  gestart_op      timestamptz default now(),
  gestart_door    uuid references auth.users(id) on delete set null,
  deadline        date,
  afgerond_op     timestamptz
);

create index if not exists idx_procedures_fonds on public.procedures(fonds_id, gestart_op desc);
create index if not exists idx_procedures_status on public.procedures(fonds_id, status);

-- ── 2. Co-eigenaren ────────────────────────────────────────
create table if not exists public.procedure_eigenaars (
  procedure_id    uuid not null references public.procedures(id) on delete cascade,
  gebruiker_id    uuid references auth.users(id) on delete cascade,
  gebruiker_naam  text not null,
  toegevoegd_op   timestamptz default now(),
  primary key (procedure_id, gebruiker_naam)
);

create index if not exists idx_eigenaars_proc on public.procedure_eigenaars(procedure_id);

-- ── 3. Stappen (snapshot van template) ─────────────────────
create table if not exists public.procedure_stappen (
  id                uuid primary key default uuid_generate_v4(),
  procedure_id      uuid not null references public.procedures(id) on delete cascade,
  volgorde          int not null,
  naam              text not null,
  beschrijving      text,
  vereist_besluit   boolean default false,
  geschatte_dagen   int,
  status            text not null check (status in ('open','actief','afgerond')) default 'open',
  eigenaar_naam     text,
  deadline          date,
  voltooid_op       timestamptz,
  voltooid_door     uuid references auth.users(id) on delete set null
);

create index if not exists idx_stappen_proc on public.procedure_stappen(procedure_id, volgorde);

-- ── 4. Checklist (snapshot van template-checklist) ─────────
create table if not exists public.procedure_checklist (
  id              uuid primary key default uuid_generate_v4(),
  stap_id         uuid not null references public.procedure_stappen(id) on delete cascade,
  volgorde        int not null,
  label           text not null,
  bewijs_vereist  boolean default false,
  voldaan         boolean default false,
  voldaan_op      timestamptz,
  voldaan_door    uuid references auth.users(id) on delete set null,
  voldaan_door_naam text,
  opmerking       text
);

create index if not exists idx_checklist_stap on public.procedure_checklist(stap_id, volgorde);

-- ── 5. Bewijsstukken ───────────────────────────────────────
create table if not exists public.procedure_bewijs (
  id              uuid primary key default uuid_generate_v4(),
  stap_id         uuid not null references public.procedure_stappen(id) on delete cascade,
  document_id     uuid references public.documenten(id) on delete set null,
  titel           text not null,
  beschrijving    text,
  toegevoegd_op   timestamptz default now(),
  toegevoegd_door uuid references auth.users(id) on delete set null,
  toegevoegd_door_naam text
);

create index if not exists idx_bewijs_stap on public.procedure_bewijs(stap_id, toegevoegd_op desc);

-- ── 6. Besluiten ───────────────────────────────────────────
create table if not exists public.procedure_besluiten (
  id              uuid primary key default uuid_generate_v4(),
  procedure_id    uuid not null references public.procedures(id) on delete cascade,
  stap_id         uuid references public.procedure_stappen(id) on delete set null,
  vergadering_id  uuid references public.vergaderingen(id) on delete set null,
  agendapunt_id   uuid references public.agendapunten(id) on delete set null,
  formulering     text not null,
  motivering      text,
  datum           date not null,
  vastgelegd_door uuid references auth.users(id) on delete set null,
  vastgelegd_door_naam text,
  vastgelegd_op   timestamptz default now()
);

create index if not exists idx_besluiten_proc on public.procedure_besluiten(procedure_id, datum desc);

-- ── 7. Audit-log (append-only) ─────────────────────────────
create table if not exists public.procedure_log (
  id              uuid primary key default uuid_generate_v4(),
  procedure_id    uuid not null references public.procedures(id) on delete cascade,
  event_type      text not null,
  actor_id        uuid references auth.users(id) on delete set null,
  actor_naam      text,
  payload         jsonb default '{}',
  tijdstip        timestamptz default now()
);

create index if not exists idx_proc_log_proc on public.procedure_log(procedure_id, tijdstip desc);

-- ── 8. Row Level Security ─────────────────────────────────
alter table public.procedures enable row level security;
alter table public.procedure_eigenaars enable row level security;
alter table public.procedure_stappen enable row level security;
alter table public.procedure_checklist enable row level security;
alter table public.procedure_bewijs enable row level security;
alter table public.procedure_besluiten enable row level security;
alter table public.procedure_log enable row level security;

-- Procedures: alleen eigen fonds
drop policy if exists "fonds procedures" on public.procedures;
create policy "fonds procedures" on public.procedures
  for all using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- Eigenaars: volgt procedure
drop policy if exists "fonds proc eigenaars" on public.procedure_eigenaars;
create policy "fonds proc eigenaars" on public.procedure_eigenaars
  for all using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- Stappen: volgt procedure
drop policy if exists "fonds proc stappen" on public.procedure_stappen;
create policy "fonds proc stappen" on public.procedure_stappen
  for all using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- Checklist: volgt stap → procedure
drop policy if exists "fonds proc checklist" on public.procedure_checklist;
create policy "fonds proc checklist" on public.procedure_checklist
  for all using (
    stap_id in (
      select s.id from public.procedure_stappen s
      join public.procedures p on p.id = s.procedure_id
      where p.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- Bewijs: volgt stap → procedure
drop policy if exists "fonds proc bewijs" on public.procedure_bewijs;
create policy "fonds proc bewijs" on public.procedure_bewijs
  for all using (
    stap_id in (
      select s.id from public.procedure_stappen s
      join public.procedures p on p.id = s.procedure_id
      where p.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- Besluiten: volgt procedure
drop policy if exists "fonds proc besluiten" on public.procedure_besluiten;
create policy "fonds proc besluiten" on public.procedure_besluiten
  for all using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- Logboek: volgt procedure
drop policy if exists "fonds proc log" on public.procedure_log;
create policy "fonds proc log" on public.procedure_log
  for all using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- ── 9. Demo-seed (optioneel) ──────────────────────────────
do $$
declare
  v_fonds uuid;
  v_proc uuid;
  v_stap1 uuid;
  v_stap2 uuid;
  v_stap3 uuid;
  v_stap4 uuid;
  v_stap5 uuid;
  v_stap6 uuid;
begin
  select id into v_fonds from public.fondsen where slug = 'horizon';
  if v_fonds is null then return; end if;

  -- Skip seeden als er al procedures zijn
  if exists (select 1 from public.procedures where fonds_id = v_fonds) then
    return;
  end if;

  -- Procedure aanmaken
  insert into public.procedures (fonds_id, template_code, titel, beschrijving, status, deadline)
  values (v_fonds, 'beleidswijziging',
    'Aanpassing strategisch beleggingsplan 2026',
    'Voorgestelde verhoging van het aandelenpercentage in de overrendementsportefeuille van 55% naar 62%, in lijn met de geactualiseerde risicobereidheid en lange-termijn rendementsverwachtingen.',
    'in_uitvoering',
    '2026-06-30')
  returning id into v_proc;

  -- Co-eigenaren
  insert into public.procedure_eigenaars (procedure_id, gebruiker_naam)
  values
    (v_proc, 'Merlin Ijzerman'),
    (v_proc, 'Anna de Vries');

  -- Stappen (snapshot van Beleidswijziging-template)
  insert into public.procedure_stappen
    (procedure_id, volgorde, naam, beschrijving, vereist_besluit, geschatte_dagen, status, eigenaar_naam, voltooid_op)
  values
    (v_proc, 1, 'Voorstel opstellen',
     'Stel een conceptvoorstel op met aanleiding, alternatieven, gevraagd besluit en verwachte impact.',
     false, 5, 'afgerond', 'Anna de Vries', '2026-03-14 10:00:00+01')
  returning id into v_stap1;

  insert into public.procedure_stappen
    (procedure_id, volgorde, naam, beschrijving, vereist_besluit, geschatte_dagen, status, eigenaar_naam, voltooid_op)
  values
    (v_proc, 2, 'Impactanalyse',
     'Financiele, juridische en communicatie-impact in kaart, inclusief risicobeoordeling.',
     false, 10, 'afgerond', 'Merlin Ijzerman', '2026-04-05 17:09:00+02')
  returning id into v_stap2;

  insert into public.procedure_stappen
    (procedure_id, volgorde, naam, beschrijving, vereist_besluit, geschatte_dagen, status, eigenaar_naam, deadline)
  values
    (v_proc, 3, 'Bestuursoverleg',
     'Bespreek het beleidsvoorstel in een bestuursvergadering, verzamel inbreng van commissies en leg overwegingen schriftelijk vast.',
     false, 14, 'actief', 'Anna de Vries', '2026-04-26')
  returning id into v_stap3;

  insert into public.procedure_stappen
    (procedure_id, volgorde, naam, beschrijving, vereist_besluit, geschatte_dagen, status)
  values
    (v_proc, 4, 'Bestuursbesluit',
     'Formele besluitvastlegging met motivering en stemverhouding.',
     true, 7, 'open')
  returning id into v_stap4;

  insert into public.procedure_stappen
    (procedure_id, volgorde, naam, beschrijving, vereist_besluit, geschatte_dagen, status)
  values
    (v_proc, 5, 'Implementatie',
     'Operationele uitvoering van het besluit door uitvoerder en/of vermogensbeheerder.',
     false, 28, 'open')
  returning id into v_stap5;

  insert into public.procedure_stappen
    (procedure_id, volgorde, naam, beschrijving, vereist_besluit, geschatte_dagen, status)
  values
    (v_proc, 6, 'Evaluatie',
     'Korte terugblik na zes maanden: heeft de wijziging het beoogde effect gehad?',
     false, 30, 'open')
  returning id into v_stap6;

  -- Checklist voor stap 1 (afgerond)
  insert into public.procedure_checklist (stap_id, volgorde, label, bewijs_vereist, voldaan, voldaan_op, voldaan_door_naam)
  values
    (v_stap1, 1, 'Aanleiding en context beschreven', true, true, '2026-03-12 14:00:00+01', 'Anna de Vries'),
    (v_stap1, 2, 'Alternatieven gewogen', false, true, '2026-03-13 11:00:00+01', 'Anna de Vries'),
    (v_stap1, 3, 'Gevraagd besluit expliciet geformuleerd', true, true, '2026-03-14 09:30:00+01', 'Anna de Vries');

  -- Checklist voor stap 2 (afgerond)
  insert into public.procedure_checklist (stap_id, volgorde, label, bewijs_vereist, voldaan, voldaan_op, voldaan_door_naam)
  values
    (v_stap2, 1, 'Financiele impact gekwantificeerd', true, true, '2026-04-01 15:00:00+02', 'Merlin Ijzerman'),
    (v_stap2, 2, 'Juridische impact gecheckt', false, true, '2026-04-02 10:00:00+02', 'Merlin Ijzerman'),
    (v_stap2, 3, 'Communicatieplan opgesteld', true, true, '2026-04-04 16:00:00+02', 'Anna de Vries'),
    (v_stap2, 4, 'Risicobeoordeling vastgelegd', true, true, '2026-04-05 17:00:00+02', 'Merlin Ijzerman');

  -- Checklist voor stap 3 (actief — deels voldaan)
  insert into public.procedure_checklist (stap_id, volgorde, label, bewijs_vereist, voldaan, voldaan_op, voldaan_door_naam)
  values
    (v_stap3, 1, 'Vergadering ingepland waarin voorstel wordt besproken', false, true, '2026-04-14 14:21:00+02', 'Merlin Ijzerman'),
    (v_stap3, 2, 'Voorstel als agendapunt toegevoegd', false, true, '2026-04-14 16:33:00+02', 'Anna de Vries'),
    (v_stap3, 3, 'Inbreng commissies ontvangen', true, false, null, null),
    (v_stap3, 4, 'Overwegingen schriftelijk vastgelegd', true, false, null, null);

  -- Checklist voor stap 4
  insert into public.procedure_checklist (stap_id, volgorde, label, bewijs_vereist)
  values
    (v_stap4, 1, 'Besluit geformuleerd in concrete termen', true),
    (v_stap4, 2, 'Stemverhouding genoteerd', false),
    (v_stap4, 3, 'Motivering opgeslagen voor audittrail', true);

  -- Checklist voor stap 5
  insert into public.procedure_checklist (stap_id, volgorde, label, bewijs_vereist)
  values
    (v_stap5, 1, 'Opdracht aan uitvoerder/vermogensbeheerder verstuurd', true),
    (v_stap5, 2, 'Bevestiging implementatie ontvangen', true);

  -- Checklist voor stap 6
  insert into public.procedure_checklist (stap_id, volgorde, label, bewijs_vereist)
  values
    (v_stap6, 1, 'Effect-meting uitgevoerd', true),
    (v_stap6, 2, 'Conclusies vastgelegd', true);

  -- Wat bewijsstukken voor stap 3
  insert into public.procedure_bewijs (stap_id, titel, beschrijving, toegevoegd_door_naam, toegevoegd_op)
  values
    (v_stap3, 'Beleidsvoorstel beleggingsplan v3.pdf',
     'Conceptvoorstel inclusief alternatieven en impactanalyse.',
     'Anna de Vries', '2026-04-12 09:00:00+02'),
    (v_stap3, 'Inbreng beleggingsadviescommissie.pdf',
     'Schriftelijke inbreng van de BAC.',
     'Merlin Ijzerman', '2026-04-16 09:08:00+02'),
    (v_stap3, 'Inbreng risk-commissie.pdf',
     'Risicobeoordeling vanuit risk-commissie.',
     'Merlin Ijzerman', '2026-04-17 11:42:00+02');

  -- Logboek-events
  insert into public.procedure_log (procedure_id, event_type, actor_naam, payload, tijdstip)
  values
    (v_proc, 'procedure_aangemaakt', 'Merlin Ijzerman',
     '{"template": "Beleidswijziging"}'::jsonb, '2026-03-12 09:21:00+01'),
    (v_proc, 'eigenaar_toegevoegd', 'Merlin Ijzerman',
     '{"naam": "Anna de Vries"}'::jsonb, '2026-03-12 09:22:00+01'),
    (v_proc, 'stap_voltooid', 'Anna de Vries',
     '{"stap": "Voorstel opstellen"}'::jsonb, '2026-03-14 10:00:00+01'),
    (v_proc, 'stap_gestart', 'Merlin Ijzerman',
     '{"stap": "Impactanalyse"}'::jsonb, '2026-03-14 10:00:00+01'),
    (v_proc, 'stap_voltooid', 'Merlin Ijzerman',
     '{"stap": "Impactanalyse"}'::jsonb, '2026-04-05 17:09:00+02'),
    (v_proc, 'stap_gestart', 'Anna de Vries',
     '{"stap": "Bestuursoverleg"}'::jsonb, '2026-04-14 14:20:00+02'),
    (v_proc, 'checklistitem_voldaan', 'Merlin Ijzerman',
     '{"stap": "Bestuursoverleg", "item": "Vergadering ingepland"}'::jsonb, '2026-04-14 14:21:00+02'),
    (v_proc, 'checklistitem_voldaan', 'Anna de Vries',
     '{"stap": "Bestuursoverleg", "item": "Voorstel als agendapunt toegevoegd"}'::jsonb, '2026-04-14 16:33:00+02'),
    (v_proc, 'bewijs_toegevoegd', 'Merlin Ijzerman',
     '{"stap": "Bestuursoverleg", "titel": "Inbreng risk-commissie.pdf"}'::jsonb, '2026-04-17 11:42:00+02');
end$$;
