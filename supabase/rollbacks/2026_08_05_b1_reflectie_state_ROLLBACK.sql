-- ============================================================================
-- ROLLBACK van 2026_08_05_b1_reflectie_state.sql (plateau B, B-1/B-4)
-- ----------------------------------------------------------------------------
-- Draait de migratie volledig terug: de statustabel, de toestandsmachine en de
-- bronsethashfunctie verdwijnen.
--
-- WAT ER VERLOREN GAAT. `gesprek_reflectie_state` bevat lopende reflectieflows.
-- Die zijn NIET te reconstrueren: de dialoog zelf staat wél in
-- `gesprekken.berichten` en blijft bestaan, maar de status, de gekozen ingang,
-- de beurtteller en de bevroren bronset verdwijnen. Praktisch gevolg: wie
-- midden in een reflectie zat, ziet na de rollback een gewone chat met daarin de
-- reflectievragen en -antwoorden als normale berichten. Dat is verlies van
-- comfort, geen verlies van inhoud, en er verdwijnt geen auditspoor —
-- `governance_log` wordt door deze migratie niet aangeraakt.
--
-- Dit is dus een ECHTE rollback, anders dan A2 uit plateau A (dat de kolommen
-- leeg herstelt, niet de inhoud).
--
-- VOORWAARDE. Draai deze rollback pas ná het terugzetten van de code naar de
-- versie vóór plateau B. De chatroute roept `reflectie_transitie()` aan; is de
-- functie weg en de code niet, dan faalt elke chatbeurt die de status opvraagt.
--
-- Idempotent (drop ... if exists). Transactioneel.
-- Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
-- ============================================================================

begin;

-- 1. Eerst de functies: de tabel is hun returntype, dus de volgorde is dwingend.
drop function if exists public.reflectie_transitie(uuid, text, text, uuid);
drop function if exists public.reflectie_bronset_hash(jsonb);

-- 2. De policy hoeft niet apart te worden gedropt (gaat mee met de tabel), maar
--    expliciet is duidelijker bij een gedeeltelijke rollback.
drop policy if exists "eigen reflectiestatus lezen" on public.gesprek_reflectie_state;

drop table if exists public.gesprek_reflectie_state;

commit;

-- ── Verificatie (handmatig ná de rollback) ──────────────────────────────────
-- 1. Tabel weg — moet 0 teruggeven:
--      select count(*) from information_schema.tables
--       where table_schema='public' and table_name='gesprek_reflectie_state';
-- 2. Functies weg — moet 0 teruggeven:
--      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public'
--         and p.proname in ('reflectie_transitie','reflectie_bronset_hash');
-- 3. Het auditspoor is ongemoeid — moet nog steeds 2 teruggeven:
--      select count(*) from pg_trigger
--       where tgrelid = 'public.governance_log'::regclass and not tgisinternal;
--
-- NB: `pgcrypto` wordt bewust NIET gedropt — die extensie is al sinds
-- 2026_05_07_decision_object.sql in gebruik voor de hash-keten van
-- governance_events.
