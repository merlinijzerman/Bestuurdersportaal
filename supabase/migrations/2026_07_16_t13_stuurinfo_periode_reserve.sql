-- ============================================================================
-- Migratie 2026-07-16 — T13: periodemodel + reserves voor stuurinformatie
-- ----------------------------------------------------------------------------
-- WAAROM: T13 bouwt de eerste tab (Balans) van het bestuurdersdashboard volgens
-- de AZL-lijn (Plan uitbreiding stuurinformatie + werkopdracht Balans-tab).
-- Daarvoor is een PERIODEMODEL nodig (huidig vs. voorgaand kwartaal, met een
-- paginabrede periodefilter) en een volwaardig OVERZICHT RESERVES (grenzen +
-- afgeleide stoplichtstatus). Zie decisions/0074.
--
-- DRIE WIJZIGINGEN (alle tenant-aware, deny-by-default RLS per fonds_id):
--   1. fonds_stuurinfo_periode  — NIEUW: periode-registry (bron van waarheid
--      voor welke rapportageperiodes bestaan; de latere beheer-/invoerlaag
--      bouwt hierop voort: periode + peildatum + bron per periode).
--   2. periode-kolom op fonds_stuurinfo_kpi en fonds_stuurinfo_reeks —
--      bestaande rijen worden gebackfilled naar '2026Q1' (de as-built seed had
--      peildatum 31 maart 2026); PK's worden uitgebreid met periode; een
--      samengestelde FK naar de registry maakt die afdwingbaar leidend.
--   3. fonds_stuurinfo_reserve — NIEUW: reservestanden per periode met
--      optionele onder-/bovengrens (ABTN-band). BEWUST GEEN status-kolom:
--      de stoplichtstatus wordt in de leeslaag AFGELEID uit stand t.o.v. band
--      (geen band → "monitoring"); één definitie, geen dubbele waarheid.
--
-- HARDE SCOPEGRENS (ongewijzigd t.o.v. T11): GEEN deelnemer-persoonsgegevens.
-- Balans/reserves zijn fonds-aggregaat; populatie_n blijft NULL op deze rijen
-- (geen telbare populatie) → de kleine-populatie-suppressie (n<10, leeslaag)
-- blijft ongewijzigd van kracht voor rijen die er wél een dragen.
--
-- RLS-VORM (identiek T11/T8-patroon):
--   LEZEN     = elk lid van het eigen fonds  → for select using (eigen fonds).
--   SCHRIJVEN = alleen rol voorzitter/beheerder van het eigen fonds, met een
--               WITH CHECK die fonds_id ÉN rol toetst. Geen DELETE-policy →
--               deny-by-default. fonds_id komt server-side (profiel.fonds_id).
--
-- Idempotent (if not exists / do-blokken met guards / drop policy if exists).
-- Transactioneel. Eerst in Supabase draaien, DAN code-deploy (migratie-eerst).
-- ROLLBACK: 2026_07_16_t13_stuurinfo_periode_reserve_ROLLBACK.sql
--           (draai eerst de seed-rollback 2026_07_16_t13b_stuurinfo_balans_seed_ROLLBACK.sql)
-- SEED:     2026_07_16_t13b_stuurinfo_balans_seed.sql (Q1+Q2 2026, beide fondsen;
--           b-suffix zodat de seed ná deze tabelmigratie sorteert in de test-DB-apply)
-- TENANT-IMPACT: additief + PK-verbreding op twee bestaande tabellen. Bestaande
-- rijen krijgen periode '2026Q1'; geen dataverlies. De oude app-leeslaag (zonder
-- periode-filter) blijft tot de code-deploy gewoon werken (leest alle rijen van
-- het eigen fonds; er bestaat op dat moment maar één periode).
-- ============================================================================

begin;

-- ── 1. fonds_stuurinfo_periode — periode-registry per fonds ─────────────────
-- Eén rij per rapportageperiode ('2026Q2'). peildatum = de balansdatum;
-- bron documenteert de herkomst (seed_synthetisch / later uitvoerder_kwartaal,
-- uitvoerder_maand, handmatig); volgorde stuurt de sortering (hoog = recentst).
create table if not exists public.fonds_stuurinfo_periode (
  fonds_id    uuid not null references public.fondsen(id) on delete cascade,
  periode     text not null,
  peildatum   date not null,
  bron        text not null default 'seed_synthetisch',
  volgorde    integer not null default 0,
  bijgewerkt  timestamptz not null default now(),
  primary key (fonds_id, periode)
);

-- Format-guard op de registry (de FK's op kpi/reeks/reserve erven dit
-- transitief): voorkomt rommel-invoer ('2026-Q2', vrije tekst) door de latere
-- beheer-/invoerlaag. Kwartaalvorm 'JJJJQx'.
alter table public.fonds_stuurinfo_periode
  drop constraint if exists fonds_stuurinfo_periode_periode_format;
alter table public.fonds_stuurinfo_periode
  add constraint fonds_stuurinfo_periode_periode_format
  check (periode ~ '^\d{4}Q[1-4]$');

alter table public.fonds_stuurinfo_periode enable row level security;

drop policy if exists "stuurinfo periode lezen eigen fonds" on public.fonds_stuurinfo_periode;
create policy "stuurinfo periode lezen eigen fonds" on public.fonds_stuurinfo_periode
  for select
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "stuurinfo periode schrijven priv" on public.fonds_stuurinfo_periode;
create policy "stuurinfo periode schrijven priv" on public.fonds_stuurinfo_periode
  for insert
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

drop policy if exists "stuurinfo periode bijwerken priv" on public.fonds_stuurinfo_periode;
create policy "stuurinfo periode bijwerken priv" on public.fonds_stuurinfo_periode
  for update
  using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  )
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

comment on table public.fonds_stuurinfo_periode is
  'TENANT (T13). Periode-registry voor stuurinformatie: welke rapportageperiodes '
  'bestaan per fonds (periode, peildatum, bron, volgorde). Bron van waarheid voor '
  'de paginabrede periodefilter; de invoerlaag (vervolgticket) bouwt hierop voort. '
  'Lezen = eigen fonds; schrijven = eigen fonds + voorzitter/beheerder (WITH CHECK).';

-- ── 2a. Registry-backfill voor bestaande data ───────────────────────────────
-- Elk fonds dat al T11-stuurinfo-rijen heeft, krijgt de bestaande snapshot als
-- periode '2026Q1' (as-built seed: peildatum "31 maart 2026"). Moet vóór de FK's.
insert into public.fonds_stuurinfo_periode (fonds_id, periode, peildatum, bron, volgorde)
select x.fonds_id, '2026Q1', date '2026-03-31', 'seed_synthetisch', 1
from (
  select fonds_id from public.fonds_stuurinfo_kpi
  union
  select fonds_id from public.fonds_stuurinfo_reeks
) x
on conflict (fonds_id, periode) do nothing;

-- ── 2b. Periode-kolom + PK-verbreding op fonds_stuurinfo_kpi ────────────────
alter table public.fonds_stuurinfo_kpi
  add column if not exists periode text not null default '2026Q1';

do $$
begin
  if not exists (
    select 1 from information_schema.key_column_usage
    where table_schema = 'public' and table_name = 'fonds_stuurinfo_kpi'
      and constraint_name = 'fonds_stuurinfo_kpi_pkey' and column_name = 'periode'
  ) then
    alter table public.fonds_stuurinfo_kpi drop constraint fonds_stuurinfo_kpi_pkey;
    alter table public.fonds_stuurinfo_kpi add primary key (fonds_id, periode, kpi_key);
  end if;
end $$;

alter table public.fonds_stuurinfo_kpi alter column periode drop default;

alter table public.fonds_stuurinfo_kpi
  drop constraint if exists fonds_stuurinfo_kpi_periode_fk;
alter table public.fonds_stuurinfo_kpi
  add constraint fonds_stuurinfo_kpi_periode_fk
  foreign key (fonds_id, periode)
  references public.fonds_stuurinfo_periode(fonds_id, periode)
  on delete cascade;

-- ── 2c. Periode-kolom + PK-verbreding op fonds_stuurinfo_reeks ──────────────
alter table public.fonds_stuurinfo_reeks
  add column if not exists periode text not null default '2026Q1';

do $$
begin
  if not exists (
    select 1 from information_schema.key_column_usage
    where table_schema = 'public' and table_name = 'fonds_stuurinfo_reeks'
      and constraint_name = 'fonds_stuurinfo_reeks_pkey' and column_name = 'periode'
  ) then
    alter table public.fonds_stuurinfo_reeks drop constraint fonds_stuurinfo_reeks_pkey;
    alter table public.fonds_stuurinfo_reeks add primary key (fonds_id, periode, reeks_key, punt_key);
  end if;
end $$;

alter table public.fonds_stuurinfo_reeks alter column periode drop default;

alter table public.fonds_stuurinfo_reeks
  drop constraint if exists fonds_stuurinfo_reeks_periode_fk;
alter table public.fonds_stuurinfo_reeks
  add constraint fonds_stuurinfo_reeks_periode_fk
  foreign key (fonds_id, periode)
  references public.fonds_stuurinfo_periode(fonds_id, periode)
  on delete cascade;

-- Index vervangen: de leeslaag filtert voortaan op (fonds, periode, reeks).
drop index if exists public.idx_stuurinfo_reeks_fonds_reeks;
create index if not exists idx_stuurinfo_reeks_fonds_periode_reeks
  on public.fonds_stuurinfo_reeks(fonds_id, periode, reeks_key, volgorde);

-- ── 3. fonds_stuurinfo_reserve — reservestanden per periode ─────────────────
-- Eén rij per (fonds, periode, reserve). ondergrens/bovengrens zijn de ABTN-band
-- in dezelfde eenheid als pct_waarde (%); NULL = geen formele band → status
-- "monitoring" in de leeslaag. pct_basis documenteert de noemer van pct_waarde
-- (bv. 'technische_voorziening'). GEEN status-kolom: status wordt afgeleid.
create table if not exists public.fonds_stuurinfo_reserve (
  fonds_id    uuid not null references public.fondsen(id) on delete cascade,
  periode     text not null,
  reserve_key text not null,
  label       text not null,
  stand       numeric not null,
  pct_basis   text,
  pct_waarde  numeric,
  ondergrens  numeric,
  bovengrens  numeric,
  volgorde    integer not null default 0,
  bijgewerkt  timestamptz not null default now(),
  primary key (fonds_id, periode, reserve_key),
  foreign key (fonds_id, periode)
    references public.fonds_stuurinfo_periode(fonds_id, periode)
    on delete cascade
);

alter table public.fonds_stuurinfo_reserve enable row level security;

drop policy if exists "stuurinfo reserve lezen eigen fonds" on public.fonds_stuurinfo_reserve;
create policy "stuurinfo reserve lezen eigen fonds" on public.fonds_stuurinfo_reserve
  for select
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "stuurinfo reserve schrijven priv" on public.fonds_stuurinfo_reserve;
create policy "stuurinfo reserve schrijven priv" on public.fonds_stuurinfo_reserve
  for insert
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

drop policy if exists "stuurinfo reserve bijwerken priv" on public.fonds_stuurinfo_reserve;
create policy "stuurinfo reserve bijwerken priv" on public.fonds_stuurinfo_reserve
  for update
  using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  )
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

comment on table public.fonds_stuurinfo_reserve is
  'TENANT (T13). Reservestanden per fonds/periode met optionele ABTN-band '
  '(ondergrens/bovengrens in dezelfde eenheid als pct_waarde). Stoplichtstatus '
  'wordt in de leeslaag AFGELEID (geen band = monitoring) — bewust geen '
  'status-kolom. Fonds-aggregaat, GEEN deelnemer-PII. Lezen = eigen fonds; '
  'schrijven = eigen fonds + voorzitter/beheerder (WITH CHECK).';

commit;

-- ── Verificatie (handmatig ná de migratie) ─────────────────────────────────
-- 1. Nieuwe tabellen + RLS aan:
--      select tablename, rowsecurity from pg_tables
--       where tablename in ('fonds_stuurinfo_periode','fonds_stuurinfo_reserve');
-- 2. PK's bevatten periode:
--      select conrelid::regclass, pg_get_constraintdef(oid) from pg_constraint
--       where contype = 'p' and conrelid::regclass::text
--         in ('fonds_stuurinfo_kpi','fonds_stuurinfo_reeks');
-- 3. Backfill compleet: geen rijen zonder registry-rij (moet 0 zijn):
--      select count(*) from public.fonds_stuurinfo_kpi k
--       left join public.fonds_stuurinfo_periode p
--         on p.fonds_id = k.fonds_id and p.periode = k.periode
--       where p.fonds_id is null;
-- 4. Alle schrijf-policies hebben WITH CHECK (T3-structuurcheck pikt dit anders op).
