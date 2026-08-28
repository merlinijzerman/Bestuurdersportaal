-- ROLLBACK van 2026_08_27_govevent_document_status.sql (#183b spoor T, handler #2).
-- LET OP: draai alleen terug samen met het herstel van documents/[id]/route.ts naar
-- de directe update + inzage-insert; anders roept de route een verdwenen functie aan.
begin;

drop function if exists public.fn_document_status_zetten(uuid, text, text);

commit;
