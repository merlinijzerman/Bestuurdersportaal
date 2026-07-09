-- ============================================================================
-- Migratie 2026-07-09 — T8: configuratie-/manifestlaag (differentiatie-als-data)
-- ----------------------------------------------------------------------------
-- WAAROM: vanaf twee fondsen moet een fonds volledig via CONFIGURATIE te
-- onderscheiden zijn (theming + welke modules actief + feature flags + content-
-- overrides) zonder code-wijziging, versiebeheerd en terugdraaibaar met een
-- append-only audit. Dit generaliseert de smalle per-fonds `fonds_instellingen`
-- (alleen hybride_zoeken) naar een generieke config-laag. Leidend ontwerp:
-- besluit 0040 + beslisnotitie multi-tenant v0.4 §9 (B5). Zie decisions/0050
-- (moduleregistry-vorm) en decisions/0051 (audit-tabelkeuze fonds_config_log).
--
-- KERNRANDVOORWAARDE (v0.4 §9): beschikbaarheid ≠ autorisatie. De module-
-- manifest bepaalt BESCHIKBAARHEID, niet autorisatie. Elke schrijf-/leesgate
-- blijft via requireCapability() + RLS. Een module "uit" in het manifest is
-- nooit de enige bescherming; de server-side capability-/RLS-gate geldt ook dan.
--
-- TABELLEN (alle tenant-aware, deny-by-default RLS per fonds_id):
--   fonds_theming            — design-tokens per fonds (jsonb, logo als ref)
--   fonds_module_manifest    — welke modules actief (module_key uit code-registry)
--   fonds_feature_flags      — sleutel→waarde flags (generalisatie fonds_instellingen)
--   fonds_content_overrides  — minimale copy-overrides (volledige workflow = T10)
--   fonds_config_log         — APPEND-ONLY audit van elke config-wijziging
--
-- RLS-VORM (sterker dan fonds_instellingen; beslispunt ② van de werkopdracht):
--   LEZEN  = elk lid van het eigen fonds (app rendert theming/manifest/flags
--            voor iedere gebruiker) → `for select using (eigen fonds)`.
--   SCHRIJVEN = alleen rol voorzitter/beheerder van het eigen fonds, met een
--            WITH CHECK die zowel de fonds_id ALS de rol toetst → defense-in-
--            depth naast de API-capabilitygate (fonds.config.manage). Er is
--            bewust GEEN delete-policy: config wordt geüpsert/geversied, niet
--            verwijderd → deny-by-default op DELETE.
--   fonds_config_log = for select (eigen fonds) + for insert (eigen fonds);
--            append-only-trigger blokkeert UPDATE/DELETE.
--
-- fonds_id wordt in de app ALTIJD server-side afgeleid (profiel.fonds_id /
-- resolver), nooit uit de request-body (herhaling R2/T2).
--
-- Idempotent (create table if not exists / drop policy if exists + create).
-- Transactioneel. Eerst in Supabase draaien, DAN code-deploy (migratie-eerst).
-- ROLLBACK: 2026_07_09_t8_config_manifestlaag_ROLLBACK.sql
-- TENANT-IMPACT: additief. Nieuwe tabellen, geen wijziging aan bestaande data
-- of policies. Horizon-gedrag ongewijzigd (geen manifest-rijen = code-defaults).
-- ============================================================================

begin;

-- Herbepaling van de gedeelde append-only-immutabiliteitsfunctie (identiek aan
-- 2026_07_08_t3_append_only_logs.sql) zodat deze migratie zelfstandig draaibaar
-- is. create or replace = idempotent en verandert bestaand gedrag niet.
create or replace function public.fn_log_append_only()
returns trigger language plpgsql as $f$
begin
  raise exception '% is append-only (geen UPDATE/DELETE toegestaan)', tg_table_name;
end;
$f$;

-- Gedeelde rol-privilege-predikaat inline in elke policy (geen SECURITY DEFINER,
-- geen aparte functie): (select rol from profielen where id = auth.uid()).

-- ── 1. fonds_theming — design-tokens per fonds ──────────────────────────────
-- tokens jsonb: allowlist-gevalideerde design-tokens (kleur-RGB-triples, logo-
-- referentie). GEEN binaries in de DB (logo via storage-pad/URL in tokens).
-- Fail-safe: geen rij = generiek default-thema uit code (theming is cosmetisch,
-- niet fail-closed).
create table if not exists public.fonds_theming (
  fonds_id        uuid primary key references public.fondsen(id) on delete cascade,
  tokens          jsonb not null default '{}'::jsonb,
  versie          integer not null default 1,
  bijgewerkt      timestamptz not null default now(),
  bijgewerkt_door uuid references auth.users(id)
);

alter table public.fonds_theming enable row level security;

drop policy if exists "theming lezen eigen fonds" on public.fonds_theming;
create policy "theming lezen eigen fonds" on public.fonds_theming
  for select
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "theming schrijven priv" on public.fonds_theming;
create policy "theming schrijven priv" on public.fonds_theming
  for insert
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

drop policy if exists "theming bijwerken priv" on public.fonds_theming;
create policy "theming bijwerken priv" on public.fonds_theming
  for update
  using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  )
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

comment on table public.fonds_theming is
  'TENANT (T8-config). Design-tokens per fonds (jsonb, allowlist-gevalideerd; logo '
  'als storage-referentie, geen binaries). Lezen = eigen fonds (alle leden); '
  'schrijven = eigen fonds + rol voorzitter/beheerder (WITH CHECK). Fail-safe: '
  'geen rij = generiek default-thema uit code. Cosmetisch, geen securitygrens.';

-- ── 2. fonds_module_manifest — welke modules beschikbaar per fonds ──────────
-- module_key is vrije tekst in de DB maar wordt in de app getoetst tegen de
-- centrale code-registry (lib/module-registry.ts). Een onbekende/uitgezette
-- module is deterministisch "niet beschikbaar": effectieve beschikbaarheid =
-- rij.actief als de rij bestaat, anders registry.defaultActief. Beschikbaarheid
-- ≠ autorisatie: de capability-/RLS-gate van de module blijft altijd gelden.
create table if not exists public.fonds_module_manifest (
  fonds_id        uuid not null references public.fondsen(id) on delete cascade,
  module_key      text not null,
  actief          boolean not null default true,
  config          jsonb not null default '{}'::jsonb,
  versie          integer not null default 1,
  bijgewerkt      timestamptz not null default now(),
  bijgewerkt_door uuid references auth.users(id),
  primary key (fonds_id, module_key)
);

alter table public.fonds_module_manifest enable row level security;

drop policy if exists "manifest lezen eigen fonds" on public.fonds_module_manifest;
create policy "manifest lezen eigen fonds" on public.fonds_module_manifest
  for select
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "manifest schrijven priv" on public.fonds_module_manifest;
create policy "manifest schrijven priv" on public.fonds_module_manifest
  for insert
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

drop policy if exists "manifest bijwerken priv" on public.fonds_module_manifest;
create policy "manifest bijwerken priv" on public.fonds_module_manifest
  for update
  using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  )
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

comment on table public.fonds_module_manifest is
  'TENANT (T8-config). Per fonds welke modules beschikbaar zijn. module_key wordt '
  'getoetst tegen de code-registry (lib/module-registry.ts); onbekend = genegeerd '
  '= niet beschikbaar. Lezen = eigen fonds; schrijven = eigen fonds + voorzitter/'
  'beheerder. BESCHIKBAARHEID, GEEN AUTORISATIE: capability-/RLS-gate blijft gelden.';

-- ── 3. fonds_feature_flags — generalisatie van fonds_instellingen ──────────
-- waarde jsonb (beslispunt ①): generiek boolean/string/getal met getypeerde
-- accessors in lib/fonds-config.ts. hybride_zoeken is de eerste gemigreerde flag
-- (backfill in 2026_07_09_t8_flags_backfill.sql). Env-default blijft de fallback.
create table if not exists public.fonds_feature_flags (
  fonds_id        uuid not null references public.fondsen(id) on delete cascade,
  flag_key        text not null,
  waarde          jsonb not null,
  versie          integer not null default 1,
  bijgewerkt      timestamptz not null default now(),
  bijgewerkt_door uuid references auth.users(id),
  primary key (fonds_id, flag_key)
);

alter table public.fonds_feature_flags enable row level security;

drop policy if exists "flags lezen eigen fonds" on public.fonds_feature_flags;
create policy "flags lezen eigen fonds" on public.fonds_feature_flags
  for select
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "flags schrijven priv" on public.fonds_feature_flags;
create policy "flags schrijven priv" on public.fonds_feature_flags
  for insert
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

drop policy if exists "flags bijwerken priv" on public.fonds_feature_flags;
create policy "flags bijwerken priv" on public.fonds_feature_flags
  for update
  using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  )
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

comment on table public.fonds_feature_flags is
  'TENANT (T8-config). Sleutel→waarde feature flags per fonds (waarde jsonb). '
  'Generalisatie van fonds_instellingen; hybride_zoeken is de eerste gemigreerde '
  'flag. Env-default blijft fallback. Lezen = eigen fonds; schrijven = voorzitter/beheerder.';

-- ── 4. fonds_content_overrides — minimale copy-overrides ───────────────────
-- Sleutel→waarde overschrijving van generieke content-/copy-fragmenten per
-- fonds. Bewust minimaal; volledige redactie-/publicatieworkflow is T10.
create table if not exists public.fonds_content_overrides (
  fonds_id        uuid not null references public.fondsen(id) on delete cascade,
  sleutel         text not null,
  waarde          text not null,
  versie          integer not null default 1,
  bijgewerkt      timestamptz not null default now(),
  bijgewerkt_door uuid references auth.users(id),
  primary key (fonds_id, sleutel)
);

alter table public.fonds_content_overrides enable row level security;

drop policy if exists "overrides lezen eigen fonds" on public.fonds_content_overrides;
create policy "overrides lezen eigen fonds" on public.fonds_content_overrides
  for select
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "overrides schrijven priv" on public.fonds_content_overrides;
create policy "overrides schrijven priv" on public.fonds_content_overrides
  for insert
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

drop policy if exists "overrides bijwerken priv" on public.fonds_content_overrides;
create policy "overrides bijwerken priv" on public.fonds_content_overrides
  for update
  using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  )
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) in ('voorzitter','beheerder')
  );

comment on table public.fonds_content_overrides is
  'TENANT (T8-config). Minimale per-fonds copy-overrides (sleutel→waarde). '
  'Volledige redactie-/publicatieworkflow = T10. Lezen = eigen fonds; schrijven '
  '= voorzitter/beheerder.';

-- ── 5. fonds_config_log — APPEND-ONLY audit van elke config-wijziging ──────
-- Hergebruikt het bestaande append-only-patroon (fn_log_append_only), geen
-- tweede logmechanisme (decisions/0051). governance_log (vraag NOT NULL, AI-
-- chatvorm) en governance_events (decision_id-FK) passen semantisch niet op
-- config-wijzigingen. Legt wie/wanneer/welk fonds (server-side afgeleid)/
-- config_type/sleutel/oud→nieuw/versie vast. Terugdraaibaarheid = een eerdere
-- oude_waarde opnieuw wegschrijven als nieuwe versie (append-only blijft intact).
create table if not exists public.fonds_config_log (
  id              uuid primary key default uuid_generate_v4(),
  fonds_id        uuid not null references public.fondsen(id) on delete cascade,
  gebruiker_id    uuid references auth.users(id),
  gebruiker_naam  text,
  config_type     text not null check (config_type in ('theming','manifest','flag','override')),
  config_sleutel  text not null,
  oude_waarde     jsonb,
  nieuwe_waarde   jsonb,
  versie          integer not null,
  aangemaakt      timestamptz not null default now()
);

create index if not exists idx_config_log_fonds on public.fonds_config_log(fonds_id);
create index if not exists idx_config_log_tijd on public.fonds_config_log(aangemaakt desc);
create index if not exists idx_config_log_sleutel
  on public.fonds_config_log(fonds_id, config_type, config_sleutel, versie desc);

alter table public.fonds_config_log enable row level security;

-- Lezen = eigen fonds (fonds-brede leesbare historie voor traceerbaarheid).
drop policy if exists "config log lezen eigen fonds" on public.fonds_config_log;
create policy "config log lezen eigen fonds" on public.fonds_config_log
  for select
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- Schrijven = eigen fonds. De rolgate zit op de config-tabellen zelf + de API;
-- het logspoor mag de begeleidende privileged actie niet blokkeren. fonds_id is
-- server-side afgeleid, dus de WITH CHECK borgt tenant-isolatie op de auditregel.
drop policy if exists "config log insert eigen fonds" on public.fonds_config_log;
create policy "config log insert eigen fonds" on public.fonds_config_log
  for insert
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- Append-only: UPDATE/DELETE geblokkeerd op DB-niveau (niet alleen code-pad).
drop trigger if exists trg_fonds_config_log_no_update on public.fonds_config_log;
create trigger trg_fonds_config_log_no_update
  before update on public.fonds_config_log
  for each row execute procedure public.fn_log_append_only();

drop trigger if exists trg_fonds_config_log_no_delete on public.fonds_config_log;
create trigger trg_fonds_config_log_no_delete
  before delete on public.fonds_config_log
  for each row execute procedure public.fn_log_append_only();

comment on table public.fonds_config_log is
  'TENANT + APPEND-ONLY (T8-config-audit). Onveranderlijk auditspoor van elke '
  'config-wijziging: wie/wanneer/fonds (server-side afgeleid)/config_type/sleutel/'
  'oud→nieuw/versie. Triggers blokkeren UPDATE/DELETE. Lezen = eigen fonds; '
  'insert = eigen fonds. Hergebruikt fn_log_append_only (geen tweede logmechanisme).';

commit;

-- ── Verificatie (handmatig ná de migratie) ─────────────────────────────────
-- 1. Vijf tabellen + RLS aan:
--      select tablename, rowsecurity from pg_tables
--       where tablename in ('fonds_theming','fonds_module_manifest',
--         'fonds_feature_flags','fonds_content_overrides','fonds_config_log');
-- 2. Alle schrijf-policies hebben WITH CHECK (T3-DEEL 1a-check pikt dit op).
-- 3. Append-only-triggers op fonds_config_log:
--      select trigger_name from information_schema.triggers
--       where event_object_table = 'fonds_config_log';
-- 4. Een UPDATE op een auditregel moet falen:
--      update public.fonds_config_log set versie = versie where true; -- → exception
