-- ============================================================================
-- ROLLBACK voor 2026_06_19e_indexering_classificatie.sql
--
-- Draait Increment E (denorm op document_chunks + classificatie_voorstellen +
-- refresh-triggers) volledig terug. Raakt GEEN broninhoud: chunks, embeddings,
-- documenten en procesinstanties blijven ongemoeid; alleen de in E toegevoegde
-- kolommen/tabel/triggers/functies verdwijnen.
-- Volgorde respecteert trigger-/FK-afhankelijkheden.
-- ============================================================================

-- 1. Voorstellen-tabel (RLS-policy valt mee weg met de tabel).
drop table if exists public.classificatie_voorstellen cascade;

-- 2. Triggers + functies voor de denorm-refresh.
drop trigger if exists trg_chunk_denorm_before_insert on public.document_chunks;
drop trigger if exists trg_chunk_denorm_refresh       on public.documenten;
drop function if exists public.fn_chunk_denorm_before_insert();
drop function if exists public.fn_chunk_denorm_refresh();
drop function if exists public.fn_chunk_denorm(uuid);

-- 3. Index + denorm-kolommen op document_chunks.
drop index if exists public.idx_chunks_denorm;

alter table public.document_chunks
  drop column if exists procesmodel_id,
  drop column if exists procesinstantie_id,
  drop column if exists vergadering_id,
  drop column if exists agendapunt_id,
  drop column if exists documenttype,
  drop column if exists documentstatus,
  drop column if exists documentdatum,
  drop column if exists periode,
  drop column if exists bronstatus,
  drop column if exists geldig_vanaf,
  drop column if exists geldig_tot;
