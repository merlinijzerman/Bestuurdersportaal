-- ============================================================================
-- ROLLBACK 2026-06-20d — Increment D: Notulen op agendapuntniveau.
-- ----------------------------------------------------------------------------
-- Draait 2026_06_20d_notulen_segmenten.sql terug. Idempotent.
--
-- LET OP — onomkeerbaar dataverlies: de eerste bevestiging van een segment heeft
-- de whole-document-chunks van dat notulendocument VERWIJDERD (keuze 2). Deze
-- rollback verwijdert de segmentchunks maar HERSTELT de whole-document-chunks
-- NIET. Getroffen notulendocumenten zijn daarna niet meer geïndexeerd; her-indexeer
-- ze via de bestaande her-extract-route (POST /api/documents/[id]/her-extract).
-- ============================================================================

-- 1. D-segmentchunks opruimen (vóór de markerkolom wegvalt).
delete from public.document_chunks where notulen_segment_id is not null;

-- 2. RPC's verwijderen.
drop function if exists public.fn_notulen_segment_bevestig(uuid, jsonb, text);
drop function if exists public.fn_notulen_segment_ontbevestig(uuid, text);
drop function if exists public.fn_notulen_segment_verwijder(uuid, text);
drop function if exists public.fn_notulen_segment_audit(uuid, text, text, text, text, boolean);

-- 3. Markerkolom + index van document_chunks verwijderen.
drop index if exists public.idx_chunks_notulen_segment;
alter table public.document_chunks drop column if exists notulen_segment_id;

-- 4. COALESCE-fix terugdraaien: fn_chunk_denorm_before_insert() terug naar de
--    E-versie (agendapunt_id/vergadering_id worden weer HARD uit het document gezet).
create or replace function public.fn_chunk_denorm_before_insert()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v record;
begin
  select * into v from public.fn_chunk_denorm(new.document_id);
  if found then
    new.procesmodel_id     := v.procesmodel_id;
    new.procesinstantie_id := v.procesinstantie_id;
    new.vergadering_id     := v.vergadering_id;
    new.agendapunt_id      := v.agendapunt_id;
    new.documenttype       := v.documenttype;
    new.documentstatus     := v.documentstatus;
    new.documentdatum      := v.documentdatum;
    new.periode            := v.periode;
    new.bronstatus         := v.bronstatus;
    new.geldig_vanaf       := v.geldig_vanaf;
    new.geldig_tot         := v.geldig_tot;
  end if;
  return new;
end;
$$;

-- 5. notulen_segmenten droppen (cascade ruimt trigger, indexen en policy op).
drop trigger if exists trg_notulen_segment_check on public.notulen_segmenten;
drop table if exists public.notulen_segmenten cascade;

-- 6. Integriteitsfunctie verwijderen.
drop function if exists public.fn_notulen_segment_check();
