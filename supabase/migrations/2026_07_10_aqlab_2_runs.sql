-- ============================================================================
-- Migratie 2026-07-10 (AQLab-2 / runs) — run-, output-, score- en findingtabellen
-- ----------------------------------------------------------------------------
-- WAAROM:
--   Tweede fundament-migratie van werkticket AQL-1. Legt de uitvoerings- en
--   scoringstabellen vast waarop de run-engine (AQL-2), de consistentiemeting
--   (AQL-3) en de scorekaart bouwen. In AQL-1 worden deze tabellen alleen
--   AANGEMAAKT (schema); ze worden pas gevuld door de run-orchestrator in AQL-2.
--
--   RESERVERING ADR 0056 (consistentie = stabiliteit én correctheid): het
--   consistentie-aggregaat leeft als JSON in aqlab_runs.aggregatie
--   (aggregatie.consistency[test_case_id]) — GEEN aparte kolommen, want
--   aqlab_run_outputs legt al één rij per iteratie vast. AQL-1 reserveert de
--   velden (documenteert de vorm); de BEREKENING is AQL-3. Zie
--   lib/aqlab/consistency.ts voor de gereserveerde veldenset.
--
--   refs_only (technisch §1.3): snapshot van gebruikte context/bronnen wordt als
--   JSON-refs + hash op aqlab_run_outputs bewaard, niet gematerialiseerd.
--
-- AUTORISATIE/RLS: identiek aan aqlab_1 — deny-by-default, service-role via de
--   platform-wrapper (decision 0058). Provider-globaal, geen fonds_id in MVP.
--
-- Idempotent (create table if not exists / drop policy if exists + create).
-- Transactioneel. Eerst in Supabase draaien, DAN code-deploy.
-- ROLLBACK: 2026_07_10_aqlab_2_runs_ROLLBACK.sql
-- VOLGORDE: draait NA aqlab_1 (verwijst naar test_sets/test_cases/prompt/model).
-- TENANT-IMPACT: geen (provider-globaal, geen fonds_id).
-- ============================================================================

begin;

-- ── 1. aqlab_runs — één uitvoering (testset × prompt × modelconfig) (§2.6) ──
create table if not exists public.aqlab_runs (
  id                     uuid primary key default uuid_generate_v4(),
  run_type               text not null default 'full_regression'
                           check (run_type in ('full_regression','subset','ad_hoc')),
  test_set_id            uuid references public.aqlab_test_sets(id) on delete set null,
  prompt_version_id      uuid references public.aqlab_prompt_versions(id) on delete set null,
  model_configuration_id uuid references public.aqlab_model_configurations(id) on delete set null,
  baseline_run_id        uuid references public.aqlab_runs(id) on delete set null,
  rol                    text check (rol in ('baseline','challenger')),
  soort                  text not null default 'functioneel'
                           check (soort in ('functioneel','security_blocking')),
  subset_filter          jsonb,
  selected_test_case_ids uuid[],
  ad_hoc_question        text,
  promoted_to_testcase   boolean not null default false,
  promoted_testcase_id   uuid references public.aqlab_test_cases(id) on delete set null,
  gewijzigde_as          text check (gewijzigde_as in
                           ('prompt','model','temperature','max_tokens','retrieval','geen','meerdere')),
  atomair                boolean,
  status                 text not null default 'queued'
                           check (status in ('queued','running','done','failed','cancelled')),
  persist_mode           text not null default 'full_synthetic'
                           check (persist_mode in ('full_synthetic','none','metadata_only')),
  aggregatie             jsonb not null default '{}'::jsonb,   -- incl. gereserveerd consistency-aggregaat (ADR 0056, AQL-3)
  kostenplafond          numeric,
  totale_kosten          numeric,
  notitie                text,
  gestart_door           uuid references auth.users(id),
  gestart_op             timestamptz not null default now(),
  voltooid_op            timestamptz
);
comment on table public.aqlab_runs is
  'AQLab GLOBAAL. Uitvoering + aggregatie (regressie/performance/consistency-JSON). Consistentie-aggregaat gereserveerd (ADR 0056), berekend in AQL-3.';

-- ── 2. aqlab_run_outputs — resultaat per (run × testcase × iteratie) (§2.7) ─
create table if not exists public.aqlab_run_outputs (
  id                          uuid primary key default uuid_generate_v4(),
  run_id                      uuid not null references public.aqlab_runs(id) on delete cascade,
  test_case_id                uuid references public.aqlab_test_cases(id) on delete set null,
  iteratie                    integer not null default 1,
  inputvraag                  text,
  gebruikte_context           jsonb,                 -- synthetisch
  gegenereerd_antwoord        text,
  gebruikte_bronnen           jsonb,                 -- [Bron N]-refs
  herkomstlabels              jsonb,
  snapshot_refs               jsonb,                 -- document-/chunk-ID's (refs_only)
  snapshot_hash               text,                  -- sha256 over gebruikte chunks
  retrieval_filter            jsonb,
  -- Effectieve modelinstellingen (per output bevroren, §2B):
  model_name                  text,
  model_version               text,
  temperature_effective       numeric,
  max_tokens_effective        integer,
  top_p_effective             numeric,
  provider_default_used       boolean,
  retrieval_settings_effective jsonb,
  prompt_version_id           uuid references public.aqlab_prompt_versions(id) on delete set null,
  tokengebruik                jsonb,                 -- {in,out}
  latency_ms                  integer,
  kosten_indicatie            numeric,
  foutmelding                 text,
  tijdstip                    timestamptz not null default now(),
  gestart_door                uuid references auth.users(id)
);
comment on table public.aqlab_run_outputs is
  'AQLab GLOBAAL. AI-resultaat per iteratie + snapshot-refs (refs_only) + effectieve modelinstellingen bevroren. Synthetische content in MVP.';

-- ── 3. aqlab_scores — score per (output × criterium) (§2.8) ─────────────────
-- criterium_code verwijst naar het seedcriterium in lib/aqlab/criteria.ts
-- (geen beheerbare tabel in de MVP).
create table if not exists public.aqlab_scores (
  id             uuid primary key default uuid_generate_v4(),
  run_output_id  uuid not null references public.aqlab_run_outputs(id) on delete cascade,
  criterium_code text not null,
  methode        text not null
                   check (methode in ('deterministisch','heuristisch','llm_judge','human')),
  score          numeric,
  pass           boolean,
  motivatie      text,
  bewijs         jsonb,
  judge_model    text,
  beoordeeld_op  timestamptz not null default now(),
  beoordeeld_door uuid references auth.users(id)
);
comment on table public.aqlab_scores is
  'AQLab GLOBAAL. Score per output×criterium; criterium_code → lib/aqlab/criteria.ts (code-seed, geen tabel in MVP).';

-- ── 4. aqlab_findings — concrete bevindingen per score (§2.9) ───────────────
create table if not exists public.aqlab_findings (
  id            uuid primary key default uuid_generate_v4(),
  score_id      uuid references public.aqlab_scores(id) on delete cascade,
  run_output_id uuid references public.aqlab_run_outputs(id) on delete cascade,
  type          text check (type in
                  ('hallucinatie','bron_ontbreekt','format','autorisatie','herkomstlabel','overig')),
  ernst         text not null default 'middel'
                  check (ernst in ('kritiek','hoog','middel','laag')),
  omschrijving  text,
  fragment      text,
  status        text not null default 'open'
                  check (status in ('open','geaccepteerd','opgelost')),
  aangemaakt_op timestamptz not null default now()
);
comment on table public.aqlab_findings is
  'AQLab GLOBAAL. Bevinding/afwijking per score (audit-detail).';

-- ── 5. aqlab_human_reviews — menselijke aftekening (MVP light, §2.12) ───────
create table if not exists public.aqlab_human_reviews (
  id             uuid primary key default uuid_generate_v4(),
  run_output_id  uuid not null references public.aqlab_run_outputs(id) on delete cascade,
  reviewer_id    uuid references auth.users(id),
  oordeel        text not null check (oordeel in ('bevestigd','overruled','geblokkeerd')),
  score_override numeric,
  motivatie      text,                              -- verplicht bij overrule/blokkade (service-laag)
  beoordeeld_op  timestamptz not null default now()
);
comment on table public.aqlab_human_reviews is
  'AQLab GLOBAAL. Menselijke aftekening/overrule (light: geen toewijzing/SLA/queue).';

-- ── 6. RLS: aan op alle tabellen, deny-by-default (decision 0058) ───────────
alter table public.aqlab_runs         enable row level security;
alter table public.aqlab_run_outputs  enable row level security;
alter table public.aqlab_scores       enable row level security;
alter table public.aqlab_findings     enable row level security;
alter table public.aqlab_human_reviews enable row level security;

-- ── 7. Indexen ──────────────────────────────────────────────────────────────
create index if not exists idx_aqlab_runs_test_set    on public.aqlab_runs(test_set_id);
create index if not exists idx_aqlab_runs_baseline     on public.aqlab_runs(baseline_run_id);
create index if not exists idx_aqlab_run_outputs_run   on public.aqlab_run_outputs(run_id);
create index if not exists idx_aqlab_run_outputs_tc    on public.aqlab_run_outputs(test_case_id);
create index if not exists idx_aqlab_scores_output     on public.aqlab_scores(run_output_id);
create index if not exists idx_aqlab_findings_score    on public.aqlab_findings(score_id);
create index if not exists idx_aqlab_findings_output   on public.aqlab_findings(run_output_id);
create index if not exists idx_aqlab_reviews_output    on public.aqlab_human_reviews(run_output_id);

commit;

-- ── Verificatie (handmatig ná de migratie) ─────────────────────────────────
-- 1. Vijf run-tabellen bestaan met RLS aan:
--      select relname, relrowsecurity from pg_class
--       where relname in ('aqlab_runs','aqlab_run_outputs','aqlab_scores',
--                         'aqlab_findings','aqlab_human_reviews');
-- 2. Geen permissive policies (deny-by-default): pg_policies leeg voor deze tabellen.
