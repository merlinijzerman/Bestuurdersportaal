-- ============================================================
--  Migratie 2026-05-20 — Stemmingen (Tranche 2 van Vergaderingen V2)
--
--  Voegt formele stemfunctionaliteit toe binnen agendapunten met
--  categorie 'besluitvorming'. Zie VERGADERINGEN-V2-ONTWERP.md §7 (v1.2).
--
--  Twee nieuwe tabellen:
--    • stemmingen           — stemronde op een agendapunt
--    • stem_uitbrengingen   — individuele stem met volmacht-splitsing
--
--  Twee nieuwe FK-kolommen op bestaande tabellen:
--    • procedure_bewijs.stemming_id   — expliciete koppeling stemverslag↔bewijs
--    • decision_dissent.stemming_id   — dissent kan ontstaan uit een tegen-stem
--
--  Vier nieuwe notificatie-types in notificaties_type_check.
--
--  Plak in Supabase Dashboard → SQL Editor → Run. Idempotent.
--  Rollback: 2026_05_20_stemmingen_ROLLBACK.sql.
-- ============================================================

-- ── 1. Stemmingen ───────────────────────────────────────────
create table if not exists public.stemmingen (
  id                    uuid primary key default uuid_generate_v4(),
  fonds_id              uuid not null references public.fondsen(id) on delete cascade,
  agendapunt_id         uuid not null references public.agendapunten(id) on delete cascade,
  decision_id           uuid references public.decision_objects(id) on delete set null,
  vraag                 text not null,
  -- Default voor/tegen/onthouden; custom alternatieven toegestaan.
  alternatieven         jsonb not null default
                          '[{"code":"voor","label":"Voor"},{"code":"tegen","label":"Tegen"},{"code":"onthouden","label":"Onthouden"}]'::jsonb,
  vereist_quorum        int,
  vereiste_meerderheid  text check (vereiste_meerderheid in (
                          'gewone','gekwalificeerd_twee_derde','unaniem'
                        )),
  status                text not null default 'open'
                          check (status in ('open','gesloten','ingetrokken')),
  geopend_op            timestamptz not null default now(),
  geopend_door          uuid not null references auth.users(id) on delete set null,
  gesloten_op           timestamptz,
  gesloten_door         uuid references auth.users(id) on delete set null,
  ingetrokken_reden     text,
  uitslag               jsonb,
  constraint chk_alternatieven_array check (jsonb_typeof(alternatieven) = 'array')
);

-- Precies één open stemming per agendapunt.
create unique index if not exists idx_stemming_een_open
  on public.stemmingen(agendapunt_id)
  where status = 'open';

create index if not exists idx_stemming_agendapunt on public.stemmingen(agendapunt_id);
create index if not exists idx_stemming_decision on public.stemmingen(decision_id)
  where decision_id is not null;

comment on table public.stemmingen is
  'Stemronde op een agendapunt met categorie besluitvorming. decision_id afgeleid via agendapunt→procedure-stap→procedure bij starten.';
comment on column public.stemmingen.uitslag is
  'jsonb met totalen, quorum_status, meerderheid_status, besluitregistratie_advies, winnend_alternatief en per_stemgerechtigde. Gevuld bij sluiten.';

-- ── 2. Stem-uitbrengingen (met volmacht-splitsing) ──────────
create table if not exists public.stem_uitbrengingen (
  id                    uuid primary key default uuid_generate_v4(),
  stemming_id           uuid not null references public.stemmingen(id) on delete cascade,
  -- Wie klikt en de stem registreert (kan een gemachtigde zijn).
  uitgebracht_door      uuid not null references auth.users(id) on delete cascade,
  -- Van wie de stem formeel is (bij eigen stem == uitgebracht_door).
  stemgerechtigde_id    uuid not null references auth.users(id) on delete cascade,
  keuze                 text not null,  -- moet matchen met een code in stemmingen.alternatieven
  motivering            text,
  -- Afgeleid: true zodra uitbrenger ≠ stemgerechtigde.
  is_volmacht           boolean generated always as (uitgebracht_door <> stemgerechtigde_id) stored,
  volmacht_toelichting  text,
  volmacht_bevestigd    boolean not null default false,
  uitgebracht_op        timestamptz not null default now(),
  -- Eén stem per stemgerechtigde per stemming.
  unique (stemming_id, stemgerechtigde_id),
  -- Symmetrische check: eigen stem → bevestigd=false; volmacht → bevestigd=true.
  constraint chk_volmacht_bevestigd check (
    (uitgebracht_door =  stemgerechtigde_id and volmacht_bevestigd = false)
    or
    (uitgebracht_door <> stemgerechtigde_id and volmacht_bevestigd = true)
  )
);

create index if not exists idx_stem_stemming on public.stem_uitbrengingen(stemming_id);
create index if not exists idx_stem_stemgerechtigde on public.stem_uitbrengingen(stemming_id, stemgerechtigde_id);

comment on table public.stem_uitbrengingen is
  'Individuele stem. uitgebracht_door = wie klikt; stemgerechtigde_id = van wie de stem is. Bij volmacht wijken die af en is volmacht_bevestigd verplicht true.';

-- ── 3. FK-kolommen op bestaande tabellen ────────────────────
alter table public.procedure_bewijs
  add column if not exists stemming_id uuid references public.stemmingen(id) on delete set null;

create index if not exists idx_procbewijs_stemming on public.procedure_bewijs(stemming_id)
  where stemming_id is not null;

alter table public.decision_dissent
  add column if not exists stemming_id uuid references public.stemmingen(id) on delete set null;

create index if not exists idx_dissent_stemming on public.decision_dissent(stemming_id)
  where stemming_id is not null;

comment on column public.procedure_bewijs.stemming_id is
  'Expliciete koppeling naar de stemming waaruit dit stemverslag-bewijs is ontstaan (documenttype stemverslag).';
comment on column public.decision_dissent.stemming_id is
  'Optionele koppeling naar de stem waaruit deze dissent is ontstaan (tegen-stem met motivering).';

-- ── 4. Row Level Security ───────────────────────────────────
alter table public.stemmingen enable row level security;
alter table public.stem_uitbrengingen enable row level security;

-- stemmingen: lezen binnen eigen fonds.
drop policy if exists "fonds stemmingen select" on public.stemmingen;
create policy "fonds stemmingen select" on public.stemmingen
  for select using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- stemmingen: insert binnen eigen fonds (rol-/aanmaker-check gebeurt server-side).
drop policy if exists "fonds stemmingen insert" on public.stemmingen;
create policy "fonds stemmingen insert" on public.stemmingen
  for insert with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and geopend_door = auth.uid()
  );

-- stemmingen: update binnen eigen fonds (starter/voorzitter/beheerder check server-side).
drop policy if exists "fonds stemmingen update" on public.stemmingen;
create policy "fonds stemmingen update" on public.stemmingen
  for update using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- stem_uitbrengingen: lezen binnen eigen fonds (open stemming = iedereen ziet elkaars stem).
drop policy if exists "fonds stem select" on public.stem_uitbrengingen;
create policy "fonds stem select" on public.stem_uitbrengingen
  for select using (
    stemming_id in (
      select id from public.stemmingen
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- stem_uitbrengingen: insert alleen door de uitbrenger zelf, binnen eigen fonds.
drop policy if exists "fonds stem insert" on public.stem_uitbrengingen;
create policy "fonds stem insert" on public.stem_uitbrengingen
  for insert with check (
    uitgebracht_door = auth.uid()
    and stemming_id in (
      select id from public.stemmingen
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- stem_uitbrengingen: update/delete alleen eigen rij (vóór sluiting; server-side getoetst).
drop policy if exists "fonds stem update" on public.stem_uitbrengingen;
create policy "fonds stem update" on public.stem_uitbrengingen
  for update using (uitgebracht_door = auth.uid());

drop policy if exists "fonds stem delete" on public.stem_uitbrengingen;
create policy "fonds stem delete" on public.stem_uitbrengingen
  for delete using (uitgebracht_door = auth.uid());

-- ── 5. Notificatie-types uitbreiden ─────────────────────────
alter table public.notificaties
  drop constraint if exists notificaties_type_check;

alter table public.notificaties
  add constraint notificaties_type_check check (type in (
    -- Iteratie 3-A
    'inbreng_geplaatst',
    'ai_validatie_wacht',
    'procedure_afgerond',
    'besluit_geregistreerd',
    'dissent_formeel_vastgelegd',
    -- Vergader-basics tranche 1
    'agendapunt_gewijzigd',
    'agendapunt_verplaatst',
    'agendapunt_verwijderd',
    -- Stemmingen tranche 2
    'stemronde_geopend',
    'volmachtstem_uitgebracht',
    'stemronde_gesloten',
    'stemronde_ingetrokken'
  ));

-- ============================================================
--  Verificatie:
--   select tablename from pg_tables where tablename in ('stemmingen','stem_uitbrengingen');
--   select column_name from information_schema.columns
--     where table_name='procedure_bewijs' and column_name='stemming_id';
--   select column_name from information_schema.columns
--     where table_name='decision_dissent' and column_name='stemming_id';
--   select pg_get_constraintdef(oid) from pg_constraint where conname='notificaties_type_check';
-- ============================================================
