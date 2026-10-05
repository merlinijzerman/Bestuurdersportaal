-- #548 — terugdraaien van 2026_10_05_548_chunks_atomisch_vervangen.sql.
-- Verwijdert de RPC fn_document_chunks_vervangen.
--
-- LET OP — VOLGORDE: draai deze rollback pas NADAT de applicatiecode is
-- teruggezet naar vóór #548. De #548-code (ingestworker en herindexering)
-- roept de RPC aan; zonder RPC faalt elke chunkvervanging met PGRST202. De
-- oude chunkset blijft dan staan (geen gedeeltelijke index), maar nieuwe
-- uploads worden niet meer geïndexeerd.
-- Data: geen. Chunks die via de RPC zijn ingevoegd blijven gewone rijen.
-- Idempotent.
begin;

drop function if exists public.fn_document_chunks_vervangen(uuid, jsonb);

commit;

notify pgrst, 'reload schema';
