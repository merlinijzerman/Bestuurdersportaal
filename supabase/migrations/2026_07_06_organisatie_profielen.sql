-- ============================================================================
-- Migratie 2026-07-06 — Organisatieprofiel: tabel organisatie_profielen + RLS.
-- ----------------------------------------------------------------------------
-- Generiek, bestuurlijk-licht contextprofiel per organisatie (1-op-1 met
-- fondsen). Grondt AI-duiding met organisatiespecifieke feiten + strategie en
-- voorkomt sectoraannames (FO Organisatieprofiel v0.4 §4, FR-1).
--
-- BEWUST GEEN autorisatie-/vaststellings-/status-laag (FO §2, §5, §13):
--   - geen profiel_status/gating: elk profiel is direct actief;
--   - geen schrijfrol/goedkeuring: bewerken loopt server-side via de
--     platform-back-office (service-role, omzeilt RLS — zelfde patroon als
--     generiek-curatie bij documenten);
--   - van beheer resteert alleen wie/wanneer-audit (bijgewerkt_door/-op).
--
-- RLS-strategie:
--   - RLS AAN. SELECT: eigen fonds (zodat AI-routes onder de user-sessie het
--     profiel lezen). GEEN INSERT/UPDATE/DELETE-policy voor authenticated →
--     schrijven kan alleen server-side via de service-role (back-office).
--
-- Conventies: idempotent; migratie-eerst-dan-deploy; ROLLBACK-bestand apart.
-- uuid_generate_v4() (uuid-ossp) conform de huisstijl in schema.sql.
-- ============================================================================
create extension if not exists "uuid-ossp";   -- uuid_generate_v4()

create table if not exists public.organisatie_profielen (
  id                       uuid primary key default uuid_generate_v4(),
  fonds_id                 uuid not null unique
                             references public.fondsen(id) on delete cascade,
  -- Harde feitvelden (generiek, foutpreventie — §4).
  organisatietype          text,
  uitvoerende_partijen     text,
  omvang                   text,
  kernfeiten               text,
  -- Strategische velden (duiding/toetsvragen; tekenlimiet ~600 — §4).
  missie                   text check (missie is null
                             or char_length(missie) <= 600),
  visie                    text check (visie is null
                             or char_length(visie) <= 600),
  strategische_speerpunten text check (strategische_speerpunten is null
                             or char_length(strategische_speerpunten) <= 600),
  risicohouding            text check (risicohouding is null
                             or char_length(risicohouding) <= 600),
  -- Optionele peildatum (promptblok + conflictregel — §4, §7).
  peildatum                date,
  -- Audit — enige beheer-metadata (§5, FR-8).
  bijgewerkt_door          text,          -- naam/e-mail van de bewerker (back-office)
  bijgewerkt_op            timestamptz not null default now(),
  aangemaakt_op            timestamptz not null default now()
);

comment on table public.organisatie_profielen is
  'Generiek contextprofiel per organisatie (1-op-1 met fondsen). Grondt AI-duiding; geen autorisatie/vaststelling/gating. FO Organisatieprofiel v0.4.';

-- Auto-touch bijgewerkt_op bij elke UPDATE (audit "wanneer").
create or replace function public.fn_organisatie_profielen_touch()
returns trigger language plpgsql as $f$
begin
  new.bijgewerkt_op := now();
  return new;
end;
$f$;

drop trigger if exists trg_organisatie_profielen_touch
  on public.organisatie_profielen;
create trigger trg_organisatie_profielen_touch
  before update on public.organisatie_profielen
  for each row execute procedure public.fn_organisatie_profielen_touch();

-- ── RLS: aan; SELECT eigen fonds; schrijven alleen via service-role ─────────
alter table public.organisatie_profielen enable row level security;

drop policy if exists "organisatieprofiel select eigen fonds"
  on public.organisatie_profielen;
create policy "organisatieprofiel select eigen fonds"
  on public.organisatie_profielen
  for select using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- Geen INSERT/UPDATE/DELETE-policy → schrijven kan alleen server-side via de
-- service-role (platform-back-office). Zo is er geen aparte schrijfrol nodig.
