-- ============================================================================
-- Migratie 2026-06-22 — Increment F: persoonlijk bestuurdersprofiel (FO v1.3 §14)
-- ----------------------------------------------------------------------------
-- Bestuurders krijgen een persoonlijk profiel (functionele bestuurlijke rol,
-- expertise, gremia, kritische focusgebieden, antwoordvoorkeuren) dat de
-- AI-voorbereiding PRIORITEERT — het filtert of verbergt de collectieve
-- feitenbasis niet. Het profiel is STRIKT ZELFBEHEERD: alleen de persoon zelf
-- wijzigt het eigen profiel (besluit 0017). Geen beheerder-/voorzitter-override.
--
-- Fondsconsistentie op de join-tabellen = composite-FK (besluit 0007):
--   * profielen krijgt unique (fonds_id, id) als composite-FK-doel;
--   * de catalogus-parents (expertises/gremia/kritische_focusgebieden) dragen
--     die unieke sleutel al (migratie 2026_06_18_catalogus_organen.sql);
--   * join-tabellen dragen fonds_id NOT NULL + twee composite-FK's, zodat een
--     koppeling alleen binnen één fonds kan en globale templates (fonds_id NULL)
--     declaratief onkoppelbaar blijven.
--
-- AANTAL-grenzen (max 3 secundaire expertises, 3-5 focusgebieden) en de
-- toegestane tekstwaarden zijn APP-VALIDATIE (route /api/profiel), geen DB-check.
--
-- B9 (eigenaars vrije tekst -> FK) is BEWUST UITGESTELD uit Increment F
-- (besluit 0017): de bestaande FK-kolommen (risicos.eigenaar_id,
-- decision_dissent.bestuurder_id, procedure_eigenaars.gebruiker_id) blijven
-- ongemoeid; geen mappingtabel/backfill in deze migratie.
--
-- B10-LIVEGANG-GATE: profielvelden zijn persoonsgegevens die AI-output sturen.
-- Deploy/livegang van F mag NIET vóór een geactualiseerd, geldig DPIA +
-- AI-governance-checkpoint voor profilering. Bouwen/mergen mag vooruit.
--
-- Idempotent. Eerst in Supabase draaien, dán code-deploy. ROLLBACK: zie
-- 2026_06_22_profiel_ROLLBACK.sql.
-- ============================================================================

-- ── 1. Profielen uitbreiden ────────────────────────────────────────────────
-- LET OP: 'rol' (autorisatierol) blijft ongemoeid. 'bestuurlijke_rol' is een
-- FUNCTIONELE rol en speelt geen enkele rol in autorisatie.
alter table public.profielen
  add column if not exists bestuurlijke_rol     text,
  add column if not exists primaire_expertise_id uuid,
  add column if not exists antwoordvoorkeur     text,
  add column if not exists standaard_ai_modus   text,
  add column if not exists detailniveau         text;

-- Composite-FK-doel voor de join-tabellen (besluit 0007). id is al PK (globaal
-- uniek); deze unieke sleutel dient enkel als referentiedoel.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'uq_profielen_fonds_id') then
    alter table public.profielen add constraint uq_profielen_fonds_id unique (fonds_id, id);
  end if;
end $$;

-- Primaire expertise fondsconsistent via composite-FK naar expertises(fonds_id,id).
-- MATCH SIMPLE: bij NULL primaire_expertise_id niet gecontroleerd (optioneel veld);
-- gezet kan het alleen naar een expertise van het EIGEN fonds wijzen, en alleen
-- als profielen.fonds_id gevuld is.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fk_profielen_primaire_expertise') then
    alter table public.profielen
      add constraint fk_profielen_primaire_expertise
      foreign key (fonds_id, primaire_expertise_id)
      references public.expertises (fonds_id, id) on delete set null;
  end if;
end $$;

-- ── 2. Join-tabellen (composite-FK, besluit 0007) ──────────────────────────
-- fonds_id NOT NULL is een correctheidseis (MATCH-SIMPLE-valkuil), geen smaak:
-- het sluit verwijzing naar globale templates declaratief uit en borgt dat
-- profiel én gekoppeld record bij hetzelfde fonds horen.
create table if not exists public.profiel_expertises (
  id           uuid primary key default uuid_generate_v4(),
  fonds_id     uuid not null,
  profiel_id   uuid not null,
  expertise_id uuid not null,
  aangemaakt   timestamptz default now(),
  unique (profiel_id, expertise_id),
  foreign key (fonds_id, profiel_id)
    references public.profielen (fonds_id, id) on delete cascade,
  foreign key (fonds_id, expertise_id)
    references public.expertises (fonds_id, id) on delete cascade
);

create table if not exists public.profiel_gremia (
  id         uuid primary key default uuid_generate_v4(),
  fonds_id   uuid not null,
  profiel_id uuid not null,
  gremium_id uuid not null,
  aangemaakt timestamptz default now(),
  unique (profiel_id, gremium_id),
  foreign key (fonds_id, profiel_id)
    references public.profielen (fonds_id, id) on delete cascade,
  foreign key (fonds_id, gremium_id)
    references public.gremia (fonds_id, id) on delete cascade
);

create table if not exists public.profiel_focusgebieden (
  id            uuid primary key default uuid_generate_v4(),
  fonds_id      uuid not null,
  profiel_id    uuid not null,
  focusgebied_id uuid not null,
  aangemaakt    timestamptz default now(),
  unique (profiel_id, focusgebied_id),
  foreign key (fonds_id, profiel_id)
    references public.profielen (fonds_id, id) on delete cascade,
  foreign key (fonds_id, focusgebied_id)
    references public.kritische_focusgebieden (fonds_id, id) on delete cascade
);

create index if not exists idx_profiel_exp_profiel   on public.profiel_expertises(profiel_id);
create index if not exists idx_profiel_grem_profiel  on public.profiel_gremia(profiel_id);
create index if not exists idx_profiel_focus_profiel on public.profiel_focusgebieden(profiel_id);

-- ── 3. Profiel-audit (append-only, persoonsgegevens) ───────────────────────
-- Append-only: geen update/delete-policy. Fonds-breed leesbaar voor governance
-- (alleen metadata in payload, geen profielinhoud-as-waarheid).
create table if not exists public.profiel_log (
  id         uuid primary key default uuid_generate_v4(),
  fonds_id   uuid not null references public.fondsen(id) on delete cascade,
  profiel_id uuid references auth.users(id) on delete set null,
  event_type text not null,   -- 'profiel_gewijzigd'|'expertise_gekoppeld'|'expertise_ontkoppeld'|'gremium_gekoppeld'|'gremium_ontkoppeld'|'focusgebied_gekoppeld'|'focusgebied_ontkoppeld'
  actor_id   uuid references auth.users(id) on delete set null,
  payload    jsonb default '{}',
  tijdstip   timestamptz default now()
);
create index if not exists idx_profiel_log_fonds on public.profiel_log(fonds_id, tijdstip desc);

-- ── 4. Row Level Security ──────────────────────────────────────────────────
alter table public.profiel_expertises    enable row level security;
alter table public.profiel_gremia         enable row level security;
alter table public.profiel_focusgebieden  enable row level security;
alter table public.profiel_log            enable row level security;

-- Join-tabellen: STRIKT eigen profiel (besluit 0017, Model A). De composite-FK
-- borgt al dat fonds_id = het fonds van het eigen profiel; profiel_id = auth.uid()
-- is daarmee voldoende voor zowel isolatie als zelfbeheer.
drop policy if exists "eigen profiel_expertises" on public.profiel_expertises;
create policy "eigen profiel_expertises" on public.profiel_expertises
  for all
  using (profiel_id = auth.uid())
  with check (profiel_id = auth.uid());

drop policy if exists "eigen profiel_gremia" on public.profiel_gremia;
create policy "eigen profiel_gremia" on public.profiel_gremia
  for all
  using (profiel_id = auth.uid())
  with check (profiel_id = auth.uid());

drop policy if exists "eigen profiel_focusgebieden" on public.profiel_focusgebieden;
create policy "eigen profiel_focusgebieden" on public.profiel_focusgebieden
  for all
  using (profiel_id = auth.uid())
  with check (profiel_id = auth.uid());

-- profiel_log: lezen fonds-breed (governance); append-only (insert-only, geen
-- update/delete-policy). Actor schrijft alleen binnen het eigen fonds.
drop policy if exists "lees profiel_log" on public.profiel_log;
create policy "lees profiel_log" on public.profiel_log
  for select using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));
drop policy if exists "schrijf profiel_log" on public.profiel_log;
create policy "schrijf profiel_log" on public.profiel_log
  for insert with check (
    actor_id = auth.uid()
    and fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- ── 5. Verificatiequery's (handmatig draaien ná de migratie) ───────────────
-- Draai deze read-only checks in de Supabase SQL-editor; ze wijzigen niets.
--
-- (a) Kolommen aanwezig op profielen:
--     select column_name from information_schema.columns
--      where table_name='profielen'
--        and column_name in ('bestuurlijke_rol','primaire_expertise_id',
--                            'antwoordvoorkeur','standaard_ai_modus','detailniveau');
--     -- verwacht: 5 rijen.
--
-- (b) Composite-FK's aanwezig:
--     select conname from pg_constraint
--      where conname in ('uq_profielen_fonds_id','fk_profielen_primaire_expertise')
--         or conrelid in ('public.profiel_expertises'::regclass,
--                         'public.profiel_gremia'::regclass,
--                         'public.profiel_focusgebieden'::regclass);
--
-- (c) NEGATIEF — koppeling met inconsistent fonds_id faalt op de FK:
--     insert into public.profiel_expertises (fonds_id, profiel_id, expertise_id)
--     values ('<ander-fonds>', '<eigen-profiel>', '<eigen-expertise>');
--     -- verwacht: foreign key violation.
--
-- (d) NEGATIEF — koppeling aan globale template (expertise.fonds_id NULL) faalt:
--     insert into public.profiel_expertises (fonds_id, profiel_id, expertise_id)
--     values ('<eigen-fonds>', '<eigen-profiel>', '<template-expertise-id>');
--     -- verwacht: foreign key violation (template heeft fonds_id NULL).
--
-- (e) profiel_log append-only:
--     update public.profiel_log set event_type='x' where id='<willekeurig>';
--     -- verwacht: geen rijen geraakt onder RLS / geweigerd; delete idem.
