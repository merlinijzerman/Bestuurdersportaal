-- ============================================================
--  Migratie 2026-05-18 — Vergader-basics (Tranche 1 van V2-doorontwikkeling)
--
--  Voegt aan de vergaderfunctionaliteit toe:
--    • voorbereidingen.vrije_notities      — vrij notitieveld los van AI-lenzen
--    • agendapunten.aangemaakt_door         — eigenaar-FK voor wijzig-/verwijderrechten
--    • agendapunten soft-delete + metadata  — wijzigen, verplaatsen, verwijderen
--    • agendapunt_log                       — append-only mutatie-log
--    • notificaties.type drie nieuwe waarden — agendapunt_gewijzigd/_verplaatst/_verwijderd
--
--  Geen wijzigingen aan procedure-/decision-logica. Sluit aan op het
--  ontwerpdocument VERGADERINGEN-V2-ONTWERP.md §6 (v1.2).
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--  Idempotent: opnieuw draaien is veilig.
-- ============================================================

-- ── 1. Voorbereidingen: vrij notitieveld ────────────────────
alter table public.voorbereidingen
  add column if not exists vrije_notities text;

comment on column public.voorbereidingen.vrije_notities is
  'Vrij persoonlijk notitieveld los van AI-lenzen. Privé per gebruiker (RLS via eigen voorbereiding).';

-- ── 2. Agendapunten: eigenaar + soft-delete + wijzig-audit ─
alter table public.agendapunten
  add column if not exists aangemaakt_door uuid references auth.users(id) on delete set null,
  add column if not exists verwijderd_op   timestamptz,
  add column if not exists verwijderd_door uuid references auth.users(id) on delete set null,
  add column if not exists verwijder_reden text,
  add column if not exists gewijzigd_op    timestamptz,
  add column if not exists gewijzigd_door  uuid references auth.users(id) on delete set null;

comment on column public.agendapunten.aangemaakt_door is
  'Eigenaar (= aanmaker). Voor bestaande rijen null; daar gelden alleen voorzitter/beheerder als wijzig-/verwijderrechten.';
comment on column public.agendapunten.verwijderd_op is
  'Soft-delete tijdstempel. Rij blijft staan met alle gekoppelde inbreng en voorbereiding intact.';

-- Partial index voor "alleen actieve agendapunten in volgorde":
-- de bestaande idx_agenda_verg blijft staan voor algemene queries; deze
-- partial-versie is sneller voor de dominante UI-query (lijst per vergadering).
create index if not exists idx_agendapunten_actief
  on public.agendapunten (vergadering_id, volgorde)
  where verwijderd_op is null;

-- ── 3. Agendapunt-log (append-only) ─────────────────────────
-- Apart gehouden van governance_events conform ontwerp §11.2:
-- agendapunten leven niet altijd binnen een Decision Object
-- (informatieve agendapunten, beeldvorming zonder gekoppelde
-- procedure). Centralisatie zou een nullable decision_id én
-- aparte RLS-architectuur vergen — geen bijvangst van deze feature.
create table if not exists public.agendapunt_log (
  id              uuid primary key default uuid_generate_v4(),
  agendapunt_id   uuid not null references public.agendapunten(id) on delete cascade,
  event_type      text not null check (event_type in (
                    'agendapunt_gewijzigd',
                    'agendapunt_verplaatst',
                    'agendapunt_verwijderd',
                    'agendapunt_hersteld'
                  )),
  actor_id        uuid not null references auth.users(id) on delete set null,
  payload         jsonb not null default '{}',
  aangemaakt      timestamptz not null default now()
);

create index if not exists idx_agendapunt_log_punt
  on public.agendapunt_log(agendapunt_id, aangemaakt desc);

comment on table public.agendapunt_log is
  'Append-only mutatie-log voor agendapunten. Apart van governance_events (besluit-gericht).';

-- ── 4. RLS op agendapunt_log ────────────────────────────────
alter table public.agendapunt_log enable row level security;

drop policy if exists "fonds agendapunt_log select" on public.agendapunt_log;
create policy "fonds agendapunt_log select" on public.agendapunt_log
  for select using (
    agendapunt_id in (
      select ap.id from public.agendapunten ap
      join public.vergaderingen v on v.id = ap.vergadering_id
      where v.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- INSERT alleen vanuit API-routes met geauthenticeerde user; geen UPDATE/DELETE
-- (append-only via afwezigheid van policy + later eventueel trigger).
drop policy if exists "fonds agendapunt_log insert" on public.agendapunt_log;
create policy "fonds agendapunt_log insert" on public.agendapunt_log
  for insert with check (
    agendapunt_id in (
      select ap.id from public.agendapunten ap
      join public.vergaderingen v on v.id = ap.vergadering_id
      where v.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
    and actor_id = auth.uid()
  );

-- ── 5. Notificatie-types uitbreiden ─────────────────────────
-- Bestaande check-constraint vervangen door uitgebreide versie.
-- Idempotent: drop if exists + recreate.
alter table public.notificaties
  drop constraint if exists notificaties_type_check;

alter table public.notificaties
  add constraint notificaties_type_check check (type in (
    -- Bestaand sinds iteratie 3-A (18 mei 2026)
    'inbreng_geplaatst',
    'ai_validatie_wacht',
    'procedure_afgerond',
    'besluit_geregistreerd',
    'dissent_formeel_vastgelegd',
    -- Nieuw in deze migratie (Vergader-basics tranche 1)
    'agendapunt_gewijzigd',
    'agendapunt_verplaatst',
    'agendapunt_verwijderd'
  ));

-- ── 6. Bevestiging ──────────────────────────────────────────
-- Geen seed-data; bestaande agendapunten houden aangemaakt_door = null,
-- waardoor voor die rijen alleen voorzitter/beheerder mag wijzigen of
-- verwijderen (server-side check). Nieuwe agendapunten vullen het veld
-- vanaf deze release in via de POST /api/agendapunten route.

-- ============================================================
--  Einde migratie. Verifieer in Supabase Dashboard:
--   • select column_name from information_schema.columns
--     where table_name = 'voorbereidingen' and column_name = 'vrije_notities';
--   • select column_name from information_schema.columns
--     where table_name = 'agendapunten'
--     and column_name in ('aangemaakt_door','verwijderd_op','verwijderd_door',
--                         'verwijder_reden','gewijzigd_op','gewijzigd_door');
--   • select tablename from pg_tables where tablename = 'agendapunt_log';
--   • select pg_get_constraintdef(oid) from pg_constraint
--     where conname = 'notificaties_type_check';
-- ============================================================
