-- ============================================================================
-- Migratie 2026-08-05 — C1: indexen op de denorm-filtervelden (retrieval).
-- ----------------------------------------------------------------------------
-- Doel (PvA vectorless/hybride, backlog B-03): de gedenormaliseerde filtervelden
-- op document_chunks (increment E/G) maken filteren-vóór-ranking mogelijk, maar
-- zijn — op idx_chunks_bronsoort (bibliotheek) en idx_chunks_document na — niet
-- afzonderlijk geïndexeerd. Bij groei (meer fondsen / duizenden documenten per
-- fonds) wordt de gefilterde/vectorless retrieval traag omdat status-, geldigheids-
-- en dossierfilters op een sequential scan binnen de RLS-scope leunen.
--
-- Deze migratie voegt B-tree/composite-indexen toe die de bestaande retrieval-
-- predicaten (zie zoek_chunks / zoek_chunks_hybride, 2026_07_10_t10) ondersteunen.
--
-- Kenmerken:
--   • Puur additief: GEEN kolom-, RLS-, grant- of functiewijziging. Retrieval-
--     gedrag en zichtbaarheid veranderen NIET; alleen het queryplan.
--   • Idempotent (create index if not exists) — veilig herhaalbaar.
--   • GEEN reindex / GEEN re-embed nodig.
--   • RLS/tenant-isolatie ONGEWIJZIGD (indexen raken geen policies).
--
-- Productie-aandachtspunt: `create index` neemt een SHARE-lock (blokkeert writes
-- op de tabel tijdens de bouw). Bij een grote document_chunks-tabel kun je per
-- statement `create index concurrently if not exists ...` gebruiken (mag NIET in
-- een transactieblok en niet gecombineerd met andere DDL in één run). Voor het
-- huidige MVP-volume is de niet-concurrente vorm hieronder afdoende; draai bij
-- productievolume elk statement los en overweeg CONCURRENTLY.
--
-- Volgorde: migratie EERST in Supabase draaien, dan hoeft er niets aan de code te
-- veranderen (de planner benut de indexen automatisch). ROLLBACK:
-- 2026_08_05_c1_retrieval_denorm_indexen_ROLLBACK.sql.
-- Verificatie: EXPLAIN (ANALYZE) op een gefilterde zoek_chunks-aanroep vóór/na;
-- structurele gates (2026_07_31_r1_structurele_gates.sql) blijven schoon (geen
-- policy/grant/functiewijziging).
-- ============================================================================

-- Actualiteits-/statusfilter (modus='actueel' en expliciete status-/bronstatus-
-- filters): documentstatus + bronstatus + geldigheidsvenster.
create index if not exists idx_chunks_status_geldig
  on public.document_chunks (documentstatus, bronstatus, geldig_vanaf, geldig_tot);

-- Dossier-/procesinstantie-scoping (p_procesinstantie_ids).
create index if not exists idx_chunks_procesinstantie
  on public.document_chunks (procesinstantie_id);

-- Datum-/historische vragen en ordening op documentdatum.
create index if not exists idx_chunks_documentdatum
  on public.document_chunks (documentdatum);

-- Documentkop-filtering (fondsgrens + actief + status) op de documenten-join.
create index if not exists idx_documenten_fonds_status
  on public.documenten (fonds_id, status, actief);

-- ============================================================================
-- NB (documentatie): werk supabase/schema.sql bij met bovenstaande indexen als
-- documentatie (schema.sql mag achterlopen; de migratie is authoritatief).
-- ============================================================================
