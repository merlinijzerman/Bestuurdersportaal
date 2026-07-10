-- ============================================================================
-- Migratie 2026-07-10 — T11: tenant-veilige data-laag stuurinformatie + klantbeeld
-- ----------------------------------------------------------------------------
-- WAAROM: T11 vervangt de STATISCHE demo-constanten van de modules
-- stuurinformatie (app/(dashboard)/dashboard) en klantbeeld
-- (lib/klantbeeld-data.ts) door een CONFIG-GEDREVEN, per-fonds gescheiden
-- data-laag onder fonds-RLS. Zo tonen twee fondsen aantoonbaar verschillende,
-- correct gescheiden inhoud op één codebase. Leidend ontwerp: beslisnotitie
-- multi-tenant v0.4 §13 + de vaststelling van 2026-07-08 (klantbeeld ZONDER
-- deelnemer-persoonsgegevens → geen DPIA/`restricted`). Zie decisions/0054
-- (bronkeuze RLS-aggregaat) en decisions/0055 (suppressiedrempel n<10).
--
-- HARDE SCOPEGRENS (v0.4 §13 / 2026-07-08): GEEN deelnemer-persoonsgegevens.
-- Deze tabellen bevatten UITSLUITEND aggregaat-/cohort-/fonds-niveau-feiten.
-- Er is BEWUST geen individu-herleidbare kolom (geen deelnemer_id, geen naam,
-- geen bsn, geen geboortedatum). Elke rij telt >= 1 persoon of is een
-- fonds-totaal; de populatie-teller (populatie_n / aantal) draagt de celgrootte
-- voor de kleine-populatie-suppressie (n<10, in de app-leeslaag afgedwongen).
-- Komt hier ooit een individu-identificator bij, dan herleeft de go/no-go uit
-- v0.4 §13 en dekt dit ticket niet langer.
--
-- KERNRANDVOORWAARDE (v0.4 §9): beschikbaarheid ≠ autorisatie ≠ datacontext.
--   - Beschikbaarheid: T8-manifest (fonds_module_manifest) — server-side gate.
--   - Autorisatie: requireCapability() (stuurinformatie.view / klantbeeld.view).
--   - Datacontext: de RLS op ONDERSTAANDE tabellen (per fonds_id).
-- Alle drie server-side; UI-zichtbaarheid is geen beveiliging.
--
-- TABELLEN (alle tenant-aware, deny-by-default RLS per fonds_id; mutabel/upsert,
-- géén append-only — dit zijn feiten-per-periode, geen auditspoor):
--   fonds_stuurinfo_kpi     — headline KPI-tegels (financieringsgraad etc.)
--   fonds_stuurinfo_reeks   — trend/balans/deelnemer-status (long format)
--   fonds_klantbeeld_cohort — cohort-aggregaten per leeftijd (aantal = populatie_n)
--
-- RLS-VORM (identiek aan de T8-config-tabellen, 2026_07_09_t8_config_manifestlaag):
--   LEZEN     = elk lid van het eigen fonds  → for select using (eigen fonds).
--   SCHRIJVEN = alleen rol voorzitter/beheerder van het eigen fonds, met een
--               WITH CHECK die fonds_id ÉN rol toetst (defense-in-depth naast de
--               API-capabilitygate). Geen DELETE-policy → deny-by-default.
-- fonds_id wordt in de app ALTIJD server-side afgeleid (profiel.fonds_id), nooit
-- uit de request-body.
--
-- Idempotent (create table if not exists / drop policy if exists + create).
-- Transactioneel. Eerst in Supabase draaien, DAN code-deploy (migratie-eerst).
-- ROLLBACK: 2026_07_10_t11_stuurinfo_klantbeeld_data_ROLLBACK.sql
-- SEED (synthetisch, Horizon + Meridiaan): 2026_07_10_t11_seed_synthetisch.sql
-- TENANT-IMPACT: additief. Nieuwe tabellen; geen wijziging aan bestaande data of
-- policies. Zonder rijen valt de app terug op een lege/placeholder-render (de
-- seed-migratie vult Horizon + het demo-fonds Meridiaan).
-- ============================================================================

begin;

-- ── 1. fonds_stuurinfo_kpi — headline KPI-tegels per fonds ──────────────────
-- Eén rij per KPI-tegel (financieringsgraad, solidariteitsreserve, vermogen,
-- rendement, aantal deelnemers ...). `waarde`/`delta` numeriek + `eenheid` als
-- presentatiehint (pct/mln/aantal). `populatie_n` alleen gevuld waar de KPI over
-- een telbare populatie gaat (bv. aantal deelnemers) → suppressie in de leeslaag.
create table if not exists public.fonds_stuurinfo_kpi (
  fonds_id     uuid not null references public.fondsen(id) on delete cascade,
  kpi_key      text not null,
  label        text not null,
  waarde       numeric,
  delta        numeric,
  eenheid      text not null default 'getal',
  toelichting  text,
  volgorde     integer not null default 0,
  populatie_n  integer,
  bijgewerkt   timestamptz not null default now(),
  primary key (fonds_id, kpi_key)
);

alter table public.fonds_stuurinfo_kpi enable row level security;

drop policy if exists "stuurinfo kpi lezen eigen fonds" on public.fonds_stuurinfo_kpi;
create policy "stuurinfo kpi lezen eigen fonds" on public.fonds_stuurinfo_kpi
  for select
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "stuurinfo kpi schrijven priv" on public.fonds_stuurinfo_kpi;
create policy "stuurinfo kpi schrijven priv" on public.fonds_stuurinfo_kpi
  for insert
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

drop policy if exists "stuurinfo kpi bijwerken priv" on public.fonds_stuurinfo_kpi;
create policy "stuurinfo kpi bijwerken priv" on public.fonds_stuurinfo_kpi
  for update
  using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  )
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

comment on table public.fonds_stuurinfo_kpi is
  'TENANT (T11). Headline stuurinformatie-KPI''s per fonds (aggregaat, GEEN '
  'deelnemer-PII). populatie_n draagt de celgrootte voor kleine-populatie-'
  'suppressie (n<10, app-leeslaag). Lezen = eigen fonds; schrijven = eigen fonds '
  '+ voorzitter/beheerder (WITH CHECK). Beschikbaarheid/autorisatie blijven '
  'manifest + requireCapability().';

-- ── 2. fonds_stuurinfo_reeks — trend/balans/deelnemer-status (long format) ──
-- Generiek long-format: `reeks_key` groepeert (trend_fg, balans_activa_*,
-- balans_passiva_*, deelnemer_status, cohort_verdeling), `punt_key` is het punt
-- binnen de reeks. `kleur` optioneel voor categorische reeksen. `populatie_n`
-- gevuld op de deelnemer-status-/cohort-rijen → suppressie in de leeslaag.
create table if not exists public.fonds_stuurinfo_reeks (
  fonds_id     uuid not null references public.fondsen(id) on delete cascade,
  reeks_key    text not null,
  punt_key     text not null,
  label        text,
  volgorde     integer not null default 0,
  waarde       numeric,
  delta        numeric,
  kleur        text,
  populatie_n  integer,
  bijgewerkt   timestamptz not null default now(),
  primary key (fonds_id, reeks_key, punt_key)
);

create index if not exists idx_stuurinfo_reeks_fonds_reeks
  on public.fonds_stuurinfo_reeks(fonds_id, reeks_key, volgorde);

alter table public.fonds_stuurinfo_reeks enable row level security;

drop policy if exists "stuurinfo reeks lezen eigen fonds" on public.fonds_stuurinfo_reeks;
create policy "stuurinfo reeks lezen eigen fonds" on public.fonds_stuurinfo_reeks
  for select
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "stuurinfo reeks schrijven priv" on public.fonds_stuurinfo_reeks;
create policy "stuurinfo reeks schrijven priv" on public.fonds_stuurinfo_reeks
  for insert
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

drop policy if exists "stuurinfo reeks bijwerken priv" on public.fonds_stuurinfo_reeks;
create policy "stuurinfo reeks bijwerken priv" on public.fonds_stuurinfo_reeks
  for update
  using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  )
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

comment on table public.fonds_stuurinfo_reeks is
  'TENANT (T11). Long-format stuurinformatie-reeksen per fonds (trend/balans/'
  'deelnemer-status; aggregaat, GEEN deelnemer-PII). populatie_n draagt de '
  'celgrootte voor kleine-populatie-suppressie. Lezen = eigen fonds; schrijven = '
  'eigen fonds + voorzitter/beheerder (WITH CHECK).';

-- ── 3. fonds_klantbeeld_cohort — cohort-aggregaten per leeftijd ─────────────
-- Eén rij per (fonds, leeftijd 18..68). Bevat de per-cohort AGGREGAAT-parameters
-- die de klantbeeld-visuals deterministisch reproduceren (aantal, status-split,
-- salaris, premie, kapitaal, gewichten). `aantal` = populatie_n → suppressie.
-- BEWUST GEEN individu-rijen: dit is de cohort-samenvatting, geen deelnemerslijst.
create table if not exists public.fonds_klantbeeld_cohort (
  fonds_id          uuid not null references public.fondsen(id) on delete cascade,
  leeftijd          integer not null check (leeftijd between 0 and 120),
  aantal            integer not null default 0,        -- populatie_n voor suppressie
  actief_p          numeric not null default 0,
  slapend_p         numeric not null default 0,
  uitkerend_p       numeric not null default 0,
  salaris           numeric not null default 0,
  maand_premie      numeric not null default 0,
  maand_uitkering   numeric not null default 0,
  invaar_kapitaal   numeric not null default 0,
  doel_op67         numeric not null default 0,
  over_weight       numeric not null default 0,
  bescherm_weight   numeric not null default 0,
  duration_jr       numeric not null default 0,
  uitvoering_mult   numeric not null default 1,
  bijgewerkt        timestamptz not null default now(),
  primary key (fonds_id, leeftijd)
);

alter table public.fonds_klantbeeld_cohort enable row level security;

drop policy if exists "klantbeeld cohort lezen eigen fonds" on public.fonds_klantbeeld_cohort;
create policy "klantbeeld cohort lezen eigen fonds" on public.fonds_klantbeeld_cohort
  for select
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "klantbeeld cohort schrijven priv" on public.fonds_klantbeeld_cohort;
create policy "klantbeeld cohort schrijven priv" on public.fonds_klantbeeld_cohort
  for insert
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

drop policy if exists "klantbeeld cohort bijwerken priv" on public.fonds_klantbeeld_cohort;
create policy "klantbeeld cohort bijwerken priv" on public.fonds_klantbeeld_cohort
  for update
  using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  )
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

comment on table public.fonds_klantbeeld_cohort is
  'TENANT (T11). Cohort-AGGREGAAT per fonds/leeftijd — GEEN deelnemer-PII, geen '
  'individu-rijen. aantal = populatie_n voor kleine-populatie-suppressie (n<10). '
  'Reproduceert de klantbeeld-visuals deterministisch. Lezen = eigen fonds; '
  'schrijven = eigen fonds + voorzitter/beheerder (WITH CHECK).';

commit;

-- ── Verificatie (handmatig ná de migratie) ─────────────────────────────────
-- 1. Drie tabellen + RLS aan:
--      select tablename, rowsecurity from pg_tables
--       where tablename in ('fonds_stuurinfo_kpi','fonds_stuurinfo_reeks',
--         'fonds_klantbeeld_cohort');
-- 2. Alle schrijf-policies hebben WITH CHECK (T3-check pikt dit anders op).
-- 3. GEEN individu-identificator: de kolomlijst bevat geen deelnemer_id/naam/bsn/
--    geboortedatum (structuurcheck tests/cross-tenant bewaakt dit).
