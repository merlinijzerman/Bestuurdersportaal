-- ============================================================================
-- Migratie 2026-08-12 (R) — grant-hygiëne: drie functies uit het anon-bereik
-- halen (gate H).
-- ----------------------------------------------------------------------------
-- WAAROM. Bij het draaien van de structurele gates (2026_07_31_r1_structurele_
-- gates.sql) vóór de reflectie-deploy faalde GATE H: de publieke `anon`-rol kan
-- drie functies in `public` uitvoeren die niet op de allowlist staan:
--   - public.fn_afschrift_bevries_kolommen()          [SECURITY DEFINER]
--   - public.fn_chunk_denorm(uuid)
--   - public.fn_document_status_transitie(text, text)
--
-- Dit is NIET de reflectiefunctie, maar bestaande grant-schuld uit eerdere
-- releases die pas nu zichtbaar wordt omdat de gates niet eerder tegen deze
-- database zijn gedraaid (OP-B9). Oorzaak per functie:
--   • fn_document_status_transitie — hersteld op 06-08 (r_grant_hygiene_status_
--     transitie), maar 2026_08_10_documentstatus_acht_naar_vijf.sql doet
--     `drop function` + `create function` en RESET daarmee de ACL naar de
--     Supabase-default (anon = EXECUTE) zonder het r7-revoke te herhalen.
--   • fn_chunk_denorm — 2026_08_12_t4_regime_borging.sql doet `drop function`
--     + recreate zonder revoke. Deze functie is `returns table` en dus
--     RECHTSTREEKS door anon aan te roepen → een echt informatielek over
--     gedenormaliseerde documentmetadata. Dit is de zwaarste van de drie.
--   • fn_afschrift_bevries_kolommen — `SECURITY DEFINER` triggerfunctie
--     (2026_08_09_procedure_afschriften_hardening) die nooit het r7-revoke kreeg.
--     Een triggerfunctie is niet rechtstreeks aanroepbaar, maar hoort evengoed
--     niet in het anon-bereik (bevinding H-18 / CLAUDE.md).
--
-- FIX. Het r7-patroon: `revoke all … from public, anon` en gericht teruggeven aan
-- de rol die de functie werkelijk nodig heeft (authenticated + service_role;
-- voor de definer-triggerfunctie alleen service_role — de trigger zelf vuurt
-- ongeacht de EXECUTE-grant).
--
-- ⚠ EIGENAARSCHAP. Deze fix raakt objecten uit besluiten 0136/0149/0162, niet de
-- reflectie-optimalisatie. Bevestig met de eigenaren van die releases dat de
-- gekozen doelrollen kloppen. Toets de UITKOMST in de database (gate H), niet de
-- intentie hier.
--
-- Idempotent (revoke/grant zijn herhaalbaar). Transactioneel.
-- ROLLBACK: 2026_08_12_r_grant_hygiene_gate_h_ROLLBACK.sql
-- Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
-- ============================================================================

begin;

-- fn_document_status_transitie(text, text) — check-helper, app + worker.
revoke all on function public.fn_document_status_transitie(text, text) from public, anon;
grant execute on function public.fn_document_status_transitie(text, text) to authenticated, service_role;

-- fn_chunk_denorm(uuid) — denorm-helper voor de chunk-triggers; `returns table`,
-- dus rechtstreeks aanroepbaar. Uit anon-bereik halen is hier het belangrijkst.
revoke all on function public.fn_chunk_denorm(uuid) from public, anon;
grant execute on function public.fn_chunk_denorm(uuid) to authenticated, service_role;

-- fn_afschrift_bevries_kolommen() — SECURITY DEFINER triggerfunctie. Alleen de
-- service-role-worker beweegt in dit domein; de trigger vuurt sowieso.
revoke all on function public.fn_afschrift_bevries_kolommen() from public, anon;
grant execute on function public.fn_afschrift_bevries_kolommen() to service_role;

commit;

-- ── Verificatie (handmatig ná de migratie) ──────────────────────────────────
-- anon mag geen van de drie meer uitvoeren — alle drie moeten false teruggeven:
--   select has_function_privilege('anon','public.fn_document_status_transitie(text,text)','execute');
--   select has_function_privilege('anon','public.fn_chunk_denorm(uuid)','execute');
--   select has_function_privilege('anon','public.fn_afschrift_bevries_kolommen()','execute');
-- En de volledige gate opnieuw: supabase/checks/2026_07_31_r1_structurele_gates.sql.
