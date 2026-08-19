-- ============================================================================
-- ROLLBACK van 2026_08_12_r_grant_hygiene_gate_h.sql
-- ----------------------------------------------------------------------------
-- ⚠ Deze rollback HEROPENT het beveiligingsgat dat de migratie dichtte: hij geeft
-- `anon` weer EXECUTE op de drie functies (de Supabase-default-toestand van vóór
-- de fix). GATE H zal daarna opnieuw falen. Draai dit alléén als je bewust naar
-- de pre-fix toestand wilt; normaal gesproken laat je grant-hygiëne staan.
-- ============================================================================

begin;

grant execute on function public.fn_document_status_transitie(text, text) to anon;
grant execute on function public.fn_chunk_denorm(uuid) to anon;
grant execute on function public.fn_afschrift_bevries_kolommen() to anon;

commit;
