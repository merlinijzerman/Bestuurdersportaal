-- ============================================================================
-- Migratie 2026-06-24 — RAG R1.1 + R1.2: structuur-bewuste chunking +
-- contextual retrieval (gedeelde re-index).
-- ----------------------------------------------------------------------------
-- Leidend: "Bestuurdersportaal - RAG-kwaliteit releaseplan (R1-R2) v0.1" §4
-- (R1.1 + R1.2), de kwaliteitsvoorwaarde uit "Fase C hybride retrieval ontwerp"
-- §5c, en Fase 2 uit "RAG-verbetering ontwerp v1.0". Dit ticket wijzigt chunking
-- en de embedding-/indexeringsinhoud, NIET het retrieval-algoritme (RRF/FTS-
-- cascade blijft), geen model/prompts voor de chat, geen reranking (R1.3).
--
-- Drie wijzigingen:
--   1. Additieve, nullable kolommen op document_chunks voor R1.1 (structuur-
--      metadata) en R1.2 (context-prefix + herkomst/versie). Allemaal nullable;
--      prefix NULL => baseline-gedrag, dus puur additief.
--   2. zoek_vector herdefiniëren zodat FTS de VERRIJKTE tekst indexeert
--      (context_prefix + originele tekst). De originele `tekst` blijft exact
--      ongewijzigd en is en blijft het weergaveveld (prefix-isolatie). Een
--      generated-kolom kan niet ge-ALTER-d worden → drop + recreate (de gin-
--      index idx_chunks_zoek hangt eraan en wordt mee herbouwd).
--   3. reindex_runs — lichte, per-run provenance van de gedeelde re-index
--      (model, prompt-versie, tellingen, trigger-gebruiker). Géén append-only/
--      hash-spoor; het auditspoor (governance_events/*_log) blijft onaangeroerd.
--
-- REVERSIBILITEIT (kernvoorwaarde van dit ticket):
--   • Contextueel terugdraaien zonder dataverlies: zet context_prefix = NULL →
--     zoek_vector herberekent vanzelf naar baseline; re-embed dan vanuit `tekst`.
--     `tekst` is nooit aangeraakt, dus geen verlies.
--   • Volledig terug naar lengte-chunks: her-extract met de oude chunker
--     (chunks zijn altijd her-afleidbaar uit het Storage-origineel + `tekst`).
--   • Schema terug: zie 2026_06_24_rag_structuur_contextueel_ROLLBACK.sql.
--
-- De BEFORE INSERT-trigger fn_chunk_denorm_before_insert (Increment E) raakt deze
-- nieuwe kolommen NIET (hij zet alleen de denorm-spiegelvelden), dus app-geleverde
-- structuur-/prefix-waarden persisteren bij insert.
--
-- Idempotent. EERST in Supabase draaien, DAN code-deploy (migratie-eerst).
-- ============================================================================

-- ── 1. Additieve kolommen op document_chunks (R1.1 + R1.2) ──────────────────
-- R1.1 — structuur-metadata bovenop de bestaande pagina/paragraaf-metadata.
alter table public.document_chunks
  add column if not exists structuur_type  text,   -- artikel|paragraaf|definitie|besluit|tabel|kop|tekst
  add column if not exists structuur_label text;    -- bv. "Artikel 12", "§3.2", "Tabblad: Dekkingsgraad"

-- R1.2 — context-prefix (NOOIT getoond; alleen voor embedding + FTS) + herkomst.
alter table public.document_chunks
  add column if not exists context_prefix    text,
  add column if not exists prefix_model      text,   -- welk model de prefix maakte (NULL = geen prefix)
  add column if not exists indexering_versie text;    -- bv. 'r1-structuur-contextueel' (NULL = baseline)

-- ── 2. zoek_vector → verrijkte FTS (contextual BM25) ────────────────────────
-- Een GENERATED-expressie kan niet ge-ALTER-d worden; drop + recreate. De gin-
-- index hangt aan de kolom en wordt expliciet eerst gedropt en daarna herbouwd.
-- prefix NULL => to_tsvector('dutch', tekst) = exact het baseline-gedrag.
drop index if exists public.idx_chunks_zoek;
alter table public.document_chunks drop column if exists zoek_vector;
alter table public.document_chunks
  add column zoek_vector tsvector
  generated always as (
    to_tsvector('dutch', coalesce(context_prefix || ' ', '') || tekst)
  ) stored;
create index idx_chunks_zoek on public.document_chunks using gin(zoek_vector);

-- ── 3. reindex_runs — lichte per-run provenance van de gedeelde re-index ─────
-- Géén per-chunk en géén append-only/hash-spoor; reproduceerbaarheid van een
-- re-index-actie (welk model/prompt, hoeveel verwerkt, door wie, wanneer).
create table if not exists public.reindex_runs (
  id                uuid primary key default uuid_generate_v4(),
  fonds_id          uuid references public.fondsen(id) on delete cascade,
  bibliotheek       text,                 -- 'fonds' | 'generiek'
  prefix_model      text,
  prompt_versie     text,
  indexering_versie text,
  aantal_documenten int,
  aantal_chunks     int,
  gestart_door      uuid references auth.users(id) on delete set null,
  aangemaakt        timestamptz default now()
);

create index if not exists idx_reindex_runs_fonds
  on public.reindex_runs (fonds_id, aangemaakt desc);

-- RLS: lezen/schrijven uitsluitend binnen het eigen fonds (anon-key + fonds_id).
-- Generieke re-index-runs (fonds_id NULL, bibliotheek='generiek') worden door de
-- platform-/service-role-kant geschreven en zijn niet voor tenants zichtbaar.
alter table public.reindex_runs enable row level security;

drop policy if exists "fonds reindex_runs" on public.reindex_runs;
create policy "fonds reindex_runs" on public.reindex_runs
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- ── 4. Verificatie (informatief; verschijnt in de migratie-output) ──────────
do $$
declare
  v_cols int;
begin
  select count(*) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'document_chunks'
     and column_name in ('structuur_type','structuur_label','context_prefix',
                          'prefix_model','indexering_versie','zoek_vector');
  raise notice 'R1.1/R1.2: % van 6 verwachte kolommen aanwezig op document_chunks (verwacht 6).', v_cols;
end $$;
