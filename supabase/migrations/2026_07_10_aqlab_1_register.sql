-- ============================================================================
-- Migratie 2026-07-10 (AQLab-1 / register) — AI Output Quality & Governance Lab
-- ----------------------------------------------------------------------------
-- WAAROM:
--   Werkticket AQL-1 "Fundament & seed" legt het datamodel voor het AQLab neer:
--   de kwaliteits-/verantwoordingslaag over de AI-output van het portaal
--   (Optie A: operationele module in de platform-backoffice). Deze eerste van
--   drie fundament-migraties levert de REGISTER-tabellen: te toetsen features,
--   golden testsets/-cases, prompt- en modelversies, en het synthetische
--   fixture-register. Runs/outputs/scores komen in aqlab_2; release/audit/log in
--   aqlab_3. Zonder dit fundament kan geen run (AQL-2), consistentiemeting
--   (AQL-3) of assurance/release (AQL-4) bestaan.
--
-- SCOPE-KEUZE (technisch §1.4): in de MVP zijn ALLE aqlab_-tabellen
--   provider-owned globaal met UITSLUITEND synthetische golden data — geen
--   fonds_id, geen echte fondsdata. Fonds-scoped assurance (fonds_id + RLS +
--   WITH CHECK) is een bewuste latere uitbreiding (architectuur §12).
--
-- AUTORISATIEMODEL (decision 0058): conform het platformfundament
--   (2026_06_23) zijn deze tabellen SERVICE-ROLE-BEHEERD met deny-by-default
--   RLS. De capability-gate (aqlab:*) wordt server-side in de platform-wrapper
--   afgedwongen (lib/platform-wrapper.ts), NIET in RLS-predicaten — er bestaat
--   geen SQL-capabilityhelper. Voor de tenant-anon-key geldt deny-by-default:
--   bewust GEEN permissive policies. Zo blijft tenant-RLS volledig ongemoeid en
--   is er geen ongedekte tenant-write (WITH CHECK n.v.t. want geen fonds_id).
--
-- Idempotent (create table if not exists / drop policy if exists + create).
-- Transactioneel. Eerst in Supabase draaien, DAN code-deploy (migratie-eerst).
-- ROLLBACK: 2026_07_10_aqlab_1_register_ROLLBACK.sql
-- TENANT-IMPACT: geen. Nieuwe provider-globale tabellen zonder fonds_id; geen
--   wijziging aan bestaande data of policies. Horizon-tenantgedrag ongewijzigd.
-- ============================================================================

begin;

-- ── 1. aqlab_ai_features — register van te toetsen AI-features (§2.1) ────────
create table if not exists public.aqlab_ai_features (
  id                          uuid primary key default uuid_generate_v4(),
  code                        text unique not null,
  naam                        text not null,
  doel                        text,
  geraakt_proces              text,
  risicocategorie             text not null default 'nader_beoordelen'
                                check (risicocategorie in ('minimaal','beperkt','hoog','nader_beoordelen')),
  human_in_the_loop_maatregel text,
  status                      text not null default 'ontwerp'
                                check (status in ('ontwerp','pilot','productie','retired')),
  eigenaar                    text,
  aangemaakt_op               timestamptz not null default now(),
  aangemaakt_door             uuid references auth.users(id)
);
comment on table public.aqlab_ai_features is
  'AQLab GLOBAAL (provider-owned, synthetisch). Register van te toetsen AI-features. Deny-by-default RLS; toegang via platform-wrapper (decision 0058).';

-- ── 2. aqlab_test_sets — benoemde golden set per feature (§2.2) ──────────────
create table if not exists public.aqlab_test_sets (
  id              uuid primary key default uuid_generate_v4(),
  feature_id      uuid references public.aqlab_ai_features(id) on delete cascade,
  code            text unique not null,
  naam            text not null,
  omschrijving    text,
  versie          integer not null default 1,
  status          text not null default 'actief'
                    check (status in ('actief','verouderd','gearchiveerd')),
  aangemaakt_op   timestamptz not null default now(),
  aangemaakt_door uuid references auth.users(id)
);
comment on table public.aqlab_test_sets is
  'AQLab GLOBAAL. Golden set (verzameling testcases) per feature. Provider-globaal/synthetisch, geen fonds_id/scope in MVP.';

-- ── 3. aqlab_fixture_documents — synthetisch bronregister (§2.14, §2A) ───────
-- synthetic = true HARD afgedwongen: geen echte fondsdata in de golden set.
create table if not exists public.aqlab_fixture_documents (
  id              uuid primary key default uuid_generate_v4(),
  code            text unique not null,          -- fixture_id (bv. HORIZON-CIJFERS-001)
  titel           text not null,
  documenttype    text,
  feature_id      uuid references public.aqlab_ai_features(id) on delete set null,
  versie          integer not null default 1,
  opslag_ref      text,                          -- Supabase Storage-pad (demo-namespace)
  repo_path       text,                          -- repo-fixture-pad
  content_hash    text,                          -- sha256 over canonieke inhoud
  synthetic       boolean not null default true check (synthetic = true),
  aangemaakt_op   timestamptz not null default now(),
  aangemaakt_door uuid references auth.users(id),
  unique (code, versie)                          -- idempotentie-sleutel loader
);
comment on table public.aqlab_fixture_documents is
  'AQLab GLOBAAL. Register synthetische demodocumenten (demofonds Horizon). synthetic=true CHECK afgedwongen; reproduceerbare bronref = code + versie + content_hash.';

-- ── 4. aqlab_test_cases — één reproduceerbaar testgeval (§2.3) ──────────────
create table if not exists public.aqlab_test_cases (
  id                     uuid primary key default uuid_generate_v4(),
  test_set_id            uuid not null references public.aqlab_test_sets(id) on delete cascade,
  feature_id             uuid references public.aqlab_ai_features(id) on delete set null,
  code                   text not null,          -- bv. BS-01, SEC-03 (uniek per testset)
  titel                  text not null,
  gebruikersvraag        text,
  gebruikersrol          text,
  broncontext_ref        jsonb not null default '[]'::jsonb,  -- verwijzing(en) naar fixtures
  verwachte_outputvorm   text,
  verplichte_onderdelen  jsonb not null default '[]'::jsonb,  -- toetsbare eisen
  blokkadecriteria       jsonb not null default '[]'::jsonb,  -- harde criteria
  minimale_acceptatiescore integer check (minimale_acceptatiescore between 0 and 100),
  soort                  text not null default 'functioneel'
                           check (soort in ('functioneel','security_blocking')),
  kritikaliteit          text not null default 'middel'
                           check (kritikaliteit in ('kritiek','hoog','middel','laag')),
  tags                   text[] not null default '{}',        -- vrije labels, subset-selectie
  review_verplicht       boolean not null default false,
  herhalingen            integer not null default 3,
  -- Consistentie (technisch §2.3 / §7A): stuurt de consistentiemeting in AQL-3.
  consistency_required   boolean not null default false,
  consistency_iterations integer not null default 3 check (consistency_iterations in (3,5)),
  spec                   jsonb not null default '{}'::jsonb,  -- expected_facts/outline/checks (seedbron)
  actief                 boolean not null default true,
  aangemaakt_op          timestamptz not null default now(),
  aangemaakt_door        uuid references auth.users(id),
  unique (test_set_id, code)
);
comment on table public.aqlab_test_cases is
  'AQLab GLOBAAL. Reproduceerbaar testgeval; broncontext = uitsluitend synthetische fixtures. consistency_* stuurt de consistentiemeting (AQL-3, ADR 0056).';

-- ── 5. aqlab_test_case_fixtures — n-n koppeling testcase ↔ fixture ──────────
-- Expliciete koppeltabel zodat post-seed-verificatie bidirectioneel sluit
-- (required/excluded bronnen). broncontext_ref op de testcase blijft de
-- gedenormaliseerde snapshot; deze tabel is de genormaliseerde waarheid.
create table if not exists public.aqlab_test_case_fixtures (
  test_case_id        uuid not null references public.aqlab_test_cases(id) on delete cascade,
  fixture_document_id uuid not null references public.aqlab_fixture_documents(id) on delete cascade,
  rol                 text not null default 'required' check (rol in ('required','excluded')),
  primary key (test_case_id, fixture_document_id, rol)
);
comment on table public.aqlab_test_case_fixtures is
  'AQLab GLOBAAL. n-n koppeling testcase ↔ synthetische fixture (rol: required/excluded).';

-- ── 6. aqlab_prompt_versions — versiebeheer prompts (§2.4) ──────────────────
create table if not exists public.aqlab_prompt_versions (
  id                   uuid primary key default uuid_generate_v4(),
  feature_id           uuid not null references public.aqlab_ai_features(id) on delete cascade,
  soort                text not null
                         check (soort in ('user_prompt','system_prompt','answer_template','guardrail')),
  versie               integer not null,
  inhoud               text not null,
  checksum             text,
  actief_in_productie  boolean not null default false,
  notitie              text,
  aangemaakt_op        timestamptz not null default now(),
  aangemaakt_door      uuid references auth.users(id),
  unique (feature_id, soort, versie)
);
comment on table public.aqlab_prompt_versions is
  'AQLab GLOBAAL. Versiebeheer prompts/system-prompts per feature; append-only aanbevolen (nieuwe versie i.p.v. edit).';

-- ── 7. aqlab_model_configurations — benoemde modelinstelling (§2.5) ─────────
-- Gevraagd (_requested) gescheiden van effectief (per output bevroren, aqlab_2).
create table if not exists public.aqlab_model_configurations (
  id                    uuid primary key default uuid_generate_v4(),
  naam                  text not null,
  model_provider        text not null default 'anthropic',
  model_name            text not null,
  model_version         text,
  temperature_requested numeric,
  max_tokens_requested  integer,
  top_p_requested       numeric,
  retrieval_settings    jsonb not null default '{}'::jsonb,
  guardrails            jsonb not null default '{}'::jsonb,
  is_baseline           boolean not null default false,
  aangemaakt_op         timestamptz not null default now(),
  aangemaakt_door       uuid references auth.users(id)
);
comment on table public.aqlab_model_configurations is
  'AQLab GLOBAAL. Benoemde modelinstelling (variant-as); reproduceerbaarheid via gevraagd vs effectief (effectief bevroren op run_outputs).';

-- ── 8. RLS: aan op alle tabellen, deny-by-default (decision 0058) ───────────
-- Bewust GEEN permissive policies: de platform-wrapper (service-role, server-
-- side) leest/schrijft ná de capability+audit-check. Voor de tenant-anon-key
-- zijn deze tabellen dus niet zichtbaar/schrijfbaar. Geen write-policy zonder
-- WITH CHECK → de T3-dekkingsgate (supabase/checks/..._t3_cross_tenant.sql)
-- blijft groen zonder uitzondering.
alter table public.aqlab_ai_features         enable row level security;
alter table public.aqlab_test_sets           enable row level security;
alter table public.aqlab_fixture_documents   enable row level security;
alter table public.aqlab_test_cases          enable row level security;
alter table public.aqlab_test_case_fixtures  enable row level security;
alter table public.aqlab_prompt_versions     enable row level security;
alter table public.aqlab_model_configurations enable row level security;

-- ── 9. Indexen voor de gangbare lookups ─────────────────────────────────────
create index if not exists idx_aqlab_test_sets_feature   on public.aqlab_test_sets(feature_id);
create index if not exists idx_aqlab_test_cases_set       on public.aqlab_test_cases(test_set_id);
create index if not exists idx_aqlab_test_cases_feature   on public.aqlab_test_cases(feature_id);
create index if not exists idx_aqlab_test_cases_soort     on public.aqlab_test_cases(soort);
create index if not exists idx_aqlab_tcf_fixture          on public.aqlab_test_case_fixtures(fixture_document_id);
create index if not exists idx_aqlab_prompt_versions_feat on public.aqlab_prompt_versions(feature_id);
create index if not exists idx_aqlab_fixtures_code_versie on public.aqlab_fixture_documents(code, versie desc);

commit;

-- ── Verificatie (handmatig ná de migratie) ─────────────────────────────────
-- 1. Zeven register-tabellen bestaan met RLS aan:
--      select relname, relrowsecurity from pg_class
--       where relname like 'aqlab_%' and relkind='r' order by relname;
-- 2. Geen permissive policies (deny-by-default):
--      select tablename, count(*) from pg_policies
--       where tablename like 'aqlab_%' group by tablename;   -- verwacht: leeg
-- 3. synthetic-CHECK afgedwongen (moet FALEN):
--      insert into public.aqlab_fixture_documents (code,titel,synthetic)
--        values ('X','x',false);   -- verwacht: check-constraint-fout
