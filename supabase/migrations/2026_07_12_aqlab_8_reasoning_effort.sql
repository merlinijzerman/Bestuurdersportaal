-- ============================================================================
-- Migratie 2026-07-12 (AQLab-6 / reasoning-modellen) — reasoning_effort-kolommen
-- ----------------------------------------------------------------------------
-- WAAROM:
--   AQL-6 voegt OpenAI reasoning-modellen toe (o-serie/GPT-5). Die vergrendelen
--   temperature/top_p en bieden in plaats daarvan een reasoning_effort-knop
--   (minimal/low/medium/high). Dat is een reproduceerbare variant-as (§2B) en moet
--   dus — net als temperature/top_p — GEVRAAGD op de modelconfig én EFFECTIEF per
--   iteratie bevroren worden.
--
--   De config-hash blijft back-compat: reasoning_effort wordt alleen in de
--   canonieke variant-string opgenomen als het gezet is → bestaande (chat-)configs
--   houden dezelfde hash (geen re-seed, decision 0064).
--
-- AUTORISATIE/RLS: ongewijzigd. Beide tabellen blijven deny-by-default; alleen de
--   service-role (server-side, achter de platform-wrapper) schrijft.
--
-- Idempotent (add column if not exists). Transactioneel. Migratie EERST in
-- Supabase draaien, daarna pas de code-deploy (CLAUDE.md: migratie-eerst).
-- ============================================================================

begin;

-- Gevraagd (op de benoemde modelconfig).
alter table public.aqlab_model_configurations
  add column if not exists reasoning_effort_requested text;

comment on column public.aqlab_model_configurations.reasoning_effort_requested is
  'AQL-6: gevraagde reasoning-effort voor reasoning-modellen (minimal/low/medium/high). NULL = provider-default of niet-reasoning-model.';

-- Effectief (per iteratie bevroren).
alter table public.aqlab_run_outputs
  add column if not exists reasoning_effort_effective text;

comment on column public.aqlab_run_outputs.reasoning_effort_effective is
  'AQL-6: effectieve reasoning-effort bevroren per iteratie. NULL = provider-default of niet-reasoning-model (klassiek chat-model, sampling via temperature).';

commit;

-- Verificatie (handmatig):
--   select column_name from information_schema.columns
--    where (table_name = 'aqlab_model_configurations' and column_name = 'reasoning_effort_requested')
--       or (table_name = 'aqlab_run_outputs' and column_name = 'reasoning_effort_effective');
