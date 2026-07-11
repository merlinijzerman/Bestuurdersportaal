-- ============================================================================
-- Migratie 2026-07-11 (AQLab-6 / console-UX) — run-naam + modelconfig-dedup-hash
-- ----------------------------------------------------------------------------
-- WAAROM (werkticket AQL-5, console-UX & variantbeheer-light):
--   1. aqlab_runs krijgt een benoembare `naam` (los van `notitie`, die vrije
--      toelichting blijft). De naam is zichtbaar in de runs-lijst en de
--      run-header, zodat een run makkelijk terugvindbaar is.
--   2. aqlab_model_configurations krijgt een `config_hash` + UNIEKE index, zodat
--      challenger-instellingen die tijdens "run samenstellen" worden gepind
--      APPEND-ONLY en met DEDUP-OP-HASH worden vastgelegd: een identieke
--      (model + temperature + max_tokens + top_p + retrieval)-combinatie
--      hergebruikt de bestaande rij i.p.v. wildgroei aan varianten (§2B,
--      besloten optie A). De hash wordt in TS berekend (lib/aqlab/modellen.ts,
--      één implementatie = single source of truth).
--
-- AUTORISATIE/RLS: ongewijzigd. aqlab_* blijft deny-by-default + service-role
--   via de platform-wrapper (decision 0058). Nieuwe kolommen erven dat; geen
--   fonds_id, geen tenant-impact, geen nieuwe policy (T3-dekkingsgate blijft
--   groen). Niets hiervan raakt de fonds-assurance-view.
--
-- NB UNIEKE index op config_hash is NIET partieel: bestaande rijen houden
--   config_hash = NULL en Postgres behandelt NULLs als distinct, dus meerdere
--   NULL-rijen blijven toegestaan én ON CONFLICT (config_hash) werkt voor de
--   upsert/dedup vanuit de service-laag.
--
-- Idempotent (add column if not exists / create index if not exists).
-- Transactioneel. Eerst in Supabase draaien, DAN code-deploy (migratie-eerst).
-- Na deploy: `npm run aqlab:seed:modellen` seedt de starter-set modelconfigs.
-- ROLLBACK: 2026_07_11_aqlab_6_console_ux_ROLLBACK.sql
-- VOLGORDE: draait NA aqlab_1..3 (kolommen op bestaande tabellen).
-- TENANT-IMPACT: geen (provider-globaal, geen fonds_id).
-- ============================================================================

begin;

-- ── 1. aqlab_runs.naam — benoembare run (naast notitie voor vrije toelichting) ─
alter table public.aqlab_runs
  add column if not exists naam text;
comment on column public.aqlab_runs.naam is
  'AQL-5: door de gebruiker gekozen run-naam/label (terugvindbaarheid). Los van notitie (vrije toelichting).';

-- ── 2. aqlab_model_configurations.config_hash — dedup-sleutel gepinde varianten ─
alter table public.aqlab_model_configurations
  add column if not exists config_hash text;
comment on column public.aqlab_model_configurations.config_hash is
  'AQL-5: sha256 over (model + temperature + max_tokens + top_p + retrieval), berekend in lib/aqlab/modellen.ts. Uniek → dedup-op-hash bij append-only pinnen van challenger-instellingen (§2B).';

-- Unieke index (niet-partieel; NULLs distinct) → ondersteunt ON CONFLICT-dedup.
create unique index if not exists uq_aqlab_model_configurations_config_hash
  on public.aqlab_model_configurations(config_hash);

commit;

-- ── Verificatie (handmatig ná de migratie) ─────────────────────────────────
-- 1. Kolommen bestaan:
--      select column_name from information_schema.columns
--       where table_name='aqlab_runs' and column_name='naam';
--      select column_name from information_schema.columns
--       where table_name='aqlab_model_configurations' and column_name='config_hash';
-- 2. Unieke index bestaat:
--      select indexname from pg_indexes
--       where tablename='aqlab_model_configurations'
--         and indexname='uq_aqlab_model_configurations_config_hash';
-- 3. Meerdere NULL-config_hash-rijen blijven toegestaan (bestaande rijen ok):
--      -- geen fout bij >1 rij met config_hash IS NULL.
