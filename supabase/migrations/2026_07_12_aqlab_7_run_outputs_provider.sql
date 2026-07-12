-- ============================================================================
-- Migratie 2026-07-12 (AQLab-6 / multi-provider) — model_provider op run_outputs
-- ----------------------------------------------------------------------------
-- WAAROM:
--   AQL-6 opent de generatie-vergelijking naar andere providers (OpenAI/GPT en
--   Mistral) náást Anthropic (baseline/productie). De provider is een effectieve,
--   per-output te BEVRIEZEN as (§2B reproduceerbaarheid): een output moet
--   herleidbaar tonen mét welke provider hij is gegenereerd, niet alleen mét welk
--   model. aqlab_model_configurations had al model_provider; de per-iteratie
--   bevroren instellingen (aqlab_run_outputs) nog niet.
--
--   De config-hash blijft provider-ONAFHANKELIJK: modelnamen zijn provider-uniek
--   (claude-*/gpt-*/mistral-*), dus bestaande hashes/rijen blijven geldig
--   (decision 0064). Deze migratie voegt alleen een bevriezingskolom toe.
--
-- DATA-SCOPE (hard, decision 0064): externe providers draaien uitsluitend op de
--   synthetische golden set — geen echte fondsdata tot de EU-residentie-migratie.
--
-- AUTORISATIE/RLS: ongewijzigd. aqlab_run_outputs blijft deny-by-default; alleen
--   de service-role (server-side, achter de platform-wrapper) schrijft.
--
-- Idempotent (add column if not exists). Transactioneel. Draai deze migratie
-- EERST in Supabase, daarna pas de code-deploy (CLAUDE.md: migratie-eerst).
-- ============================================================================

begin;

alter table public.aqlab_run_outputs
  add column if not exists model_provider text;

comment on column public.aqlab_run_outputs.model_provider is
  'AQL-6: effectieve generatie-provider bevroren per iteratie (anthropic=baseline/productie; openai/mistral=challenger). NULL op oudere rijen van vóór AQL-6.';

commit;

-- Verificatie (handmatig):
--   select column_name from information_schema.columns
--    where table_name = 'aqlab_run_outputs' and column_name = 'model_provider';
