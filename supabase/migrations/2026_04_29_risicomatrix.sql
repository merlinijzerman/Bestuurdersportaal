-- ============================================================
--  Migratie 2026-04-29 — Module Risicomatrix
--  Drie tabellen: risicos, risico_maatregelen, risico_log.
--  Plus RLS policies (fondsbreed, alleen eigen fonds).
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--  Idempotent: opnieuw draaien is veilig.
-- ============================================================

-- ── 1. Risicos ─────────────────────────────────────────────
create table if not exists public.risicos (
  id                  uuid primary key default uuid_generate_v4(),
  fonds_id            uuid not null references public.fondsen(id) on delete cascade,
  categorie           text not null check (categorie in (
                        'financieel_actuarieel',
                        'governance_organisatie',
                        'operationeel_datakwaliteit',
                        'informatie_communicatie'
                      )),
  titel               text not null,
  toelichting         text,
  kans                int not null check (kans between 1 and 5),
  impact              int not null check (impact between 1 and 5),
  niveau              text not null check (niveau in ('laag','middel','hoog')) default 'middel',
  niveau_handmatig    boolean default false,
  type_risico         text not null check (type_risico in ('structureel','tijdelijk')) default 'structureel',
  status              text not null check (status in ('actief','gesloten')) default 'actief',
  eigenaar_id         uuid references auth.users(id) on delete set null,
  eigenaar_naam       text,
  volgende_beoordeling date,
  aangemaakt          timestamptz default now(),
  aangemaakt_door     uuid references auth.users(id) on delete set null,
  gesloten_op         timestamptz,
  gesloten_door       uuid references auth.users(id) on delete set null,
  sluit_motivering    text
);

create index if not exists idx_risicos_fonds on public.risicos(fonds_id, status, aangemaakt desc);
create index if not exists idx_risicos_categorie on public.risicos(fonds_id, categorie);

-- ── 2. Maatregelen ─────────────────────────────────────────
create table if not exists public.risico_maatregelen (
  id              uuid primary key default uuid_generate_v4(),
  risico_id       uuid not null references public.risicos(id) on delete cascade,
  beschrijving    text not null,
  status          text not null check (status in ('open','in_voorbereiding','genomen')) default 'open',
  verantwoordelijke text,
  procedure_id    uuid,  -- placeholder voor toekomstige Procedures-koppeling
  volgorde        int default 0,
  aangemaakt      timestamptz default now(),
  aangemaakt_door uuid references auth.users(id) on delete set null,
  bijgewerkt_op   timestamptz default now()
);

create index if not exists idx_maatregelen_risico on public.risico_maatregelen(risico_id, volgorde);

-- ── 3. Logboek (append-only) ───────────────────────────────
create table if not exists public.risico_log (
  id            uuid primary key default uuid_generate_v4(),
  risico_id     uuid not null references public.risicos(id) on delete cascade,
  event_type    text not null,
  actor_id      uuid references auth.users(id) on delete set null,
  actor_naam    text,
  payload       jsonb default '{}',
  tijdstip      timestamptz default now()
);

create index if not exists idx_risico_log_risico on public.risico_log(risico_id, tijdstip desc);

-- ── 4. Row Level Security ─────────────────────────────────
alter table public.risicos enable row level security;
alter table public.risico_maatregelen enable row level security;
alter table public.risico_log enable row level security;

-- Risicos: alleen eigen fonds
drop policy if exists "fonds risicos" on public.risicos;
create policy "fonds risicos" on public.risicos
  for all using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- Maatregelen: volgt risico
drop policy if exists "fonds maatregelen" on public.risico_maatregelen;
create policy "fonds maatregelen" on public.risico_maatregelen
  for all using (
    risico_id in (
      select id from public.risicos where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- Logboek: volgt risico
drop policy if exists "fonds risico log" on public.risico_log;
create policy "fonds risico log" on public.risico_log
  for all using (
    risico_id in (
      select id from public.risicos where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- ── 5. Demo-seed (optioneel) ──────────────────────────────
-- Vier voorbeeld-risico's voor het Horizon-fonds, waarvan
-- één gesloten zodat het archief direct gevuld is.
do $$
declare
  v_fonds uuid;
  v_renterisico uuid;
  v_cyber uuid;
begin
  select id into v_fonds from public.fondsen where slug = 'horizon';
  if v_fonds is null then return; end if;

  -- Skip seeden als er al risico's zijn
  if exists (select 1 from public.risicos where fonds_id = v_fonds) then
    return;
  end if;

  insert into public.risicos
    (fonds_id, categorie, titel, toelichting, kans, impact, niveau, type_risico, eigenaar_naam)
  values
    (v_fonds, 'financieel_actuarieel', 'Renterisico',
     'Verlaging financieringsgraad bij dalende rente, ondanks hedge van 60%.',
     4, 5, 'hoog', 'structureel', 'Anna de Vries')
  returning id into v_renterisico;

  insert into public.risicos
    (fonds_id, categorie, titel, toelichting, kans, impact, niveau, type_risico, eigenaar_naam)
  values
    (v_fonds, 'operationeel_datakwaliteit', 'Cyber-incident',
     'Datalek of ransomware bij uitvoerder of vermogensbeheerder met deelnemersgevolgen.',
     3, 5, 'hoog', 'structureel', 'Pieter Verhoeven')
  returning id into v_cyber;

  insert into public.risicos
    (fonds_id, categorie, titel, toelichting, kans, impact, niveau, type_risico, eigenaar_naam)
  values
    (v_fonds, 'governance_organisatie', 'Wtp-implementatie complex',
     'Complexiteit invaren naar persoonlijk pensioenvermogen, deadline 2027.',
     4, 4, 'hoog', 'tijdelijk', 'Merlin Ijzerman'),
    (v_fonds, 'informatie_communicatie', 'Onduidelijke deelnemerscommunicatie',
     'Pensioenoverzicht en webcommunicatie scoren wisselend in begrijpelijkheid.',
     3, 3, 'middel', 'structureel', 'Anna de Vries'),
    (v_fonds, 'financieel_actuarieel', 'Inflatierisico',
     'Koopkrachtverlies pensioenuitkeringen door aanhoudende inflatie.',
     4, 3, 'middel', 'structureel', 'Anna de Vries');

  -- Eén gesloten risico voor het archief
  insert into public.risicos
    (fonds_id, categorie, titel, toelichting, kans, impact, niveau, type_risico, eigenaar_naam,
     status, gesloten_op, sluit_motivering)
  values
    (v_fonds, 'governance_organisatie', 'Voorzitter-vacature 2025',
     'Periode tussen aftreden vorige voorzitter en aantreden nieuwe (4 maanden).',
     3, 3, 'middel', 'tijdelijk', 'Merlin Ijzerman',
     'gesloten', '2026-02-05 10:00:00+01',
     'Nieuwe voorzitter aangetreden 1 feb 2026, transitie soepel verlopen.');

  -- Een paar maatregelen + logboek-events voor het renterisico
  insert into public.risico_maatregelen (risico_id, beschrijving, status, verantwoordelijke, volgorde)
  values
    (v_renterisico, 'Rentehedge 60% via swaps en lange-looptijd staatsobligaties',
     'genomen', 'Beleggingsadviescommissie', 1),
    (v_renterisico, 'Maandelijkse stresstest dekkingsgraad bij −100bp en −200bp',
     'genomen', 'Uitvoerder', 2),
    (v_renterisico, 'Heroverweging hedge-ratio naar 70%',
     'in_voorbereiding', 'Anna de Vries', 3);

  insert into public.risico_log (risico_id, event_type, actor_naam, payload)
  values
    (v_renterisico, 'risico_aangemaakt', 'Pieter Verhoeven',
     '{"toelichting": "Bij start risicoraamwerk"}'::jsonb),
    (v_renterisico, 'niveau_gewijzigd', 'Anna de Vries',
     '{"van": "middel", "naar": "hoog", "motivering": "Stresstest -100bp toont krappe financieringsgraad"}'::jsonb);

  insert into public.risico_log (risico_id, event_type, actor_naam, payload)
  values
    (v_cyber, 'risico_aangemaakt', 'Pieter Verhoeven', '{}'::jsonb);
end$$;
