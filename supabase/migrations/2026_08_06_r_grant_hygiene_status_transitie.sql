-- ============================================================================
-- Migratie: grant-hygiëne — fn_document_status_transitie uit anon-bereik halen
--           (gate H / bevinding H-18; hoort bij besluit 0136)
-- ----------------------------------------------------------------------------
-- WAAROM. De 0136-migratie (2026_08_06_status_bij_ingest.sql) hercreëerde
--   public.fn_document_status_transitie(text, text) met `create function` maar
--   ZONDER het r7-revoke. Daardoor erfde de functie de Supabase-default-ACL die
--   EXECUTE expliciet aan `anon` (en `authenticated`) toekent. Gate H
--   (supabase/checks/2026_07_31_r1_structurele_gates.sql) faalt hierop:
--     "de publieke anon-rol kan functies in public uitvoeren die niet op de
--      allowlist staan: - fn_document_status_transitie(p_van text, p_naar text)".
--
-- RISICO. Laag qua data: de functie is `language sql immutable`, SECURITY INVOKER,
--   en leest geen enkele tabel — het is een pure lookup over een VALUES-lijst
--   (transitieregels). anon leert er niets uit. Maar gate H dwingt terecht af dat
--   elke publieke functie expliciet getrieerd is; dit sluit de gap volgens het
--   r7-patroon (revoke van public+anon, grant execute aan de rol die 'm echt
--   gebruikt). De trigger die deze helper aanroept draait op authenticated
--   document-updates, dus authenticated + service_role houden EXECUTE.
--
-- IDEMPOTENT. Handmatig in de SQL-editor. Draai daarna gate H opnieuw.
-- ============================================================================

begin;

revoke all on function public.fn_document_status_transitie(text, text) from public, anon;
grant execute on function public.fn_document_status_transitie(text, text) to authenticated, service_role;

commit;

-- ============================================================================
-- VERIFICATIE (ná de COMMIT)
--   select has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'fn_document_status_transitie';
--   → anon = false, authenticated = true.
-- Draai daarna supabase/checks/2026_07_31_r1_structurele_gates.sql → gate H OK.
-- ============================================================================
