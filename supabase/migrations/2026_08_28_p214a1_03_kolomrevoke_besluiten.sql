-- #214-a1 (besluit 0194) — procedure_besluiten: UPDATE + DELETE ingetrokken.
-- ---------------------------------------------------------------------------
-- Meting: procedure_besluiten is `for all` fonds-only met tabel-brede UPDATE én
-- DELETE voor authenticated en geen trigger — een besluit is door elk fondslid te
-- wijzigen én hard te DELETEN. Een besluit dat hard verwijderbaar is, is geen besluit.
--
-- GEEN kolom her-verleend: de write-pad-inventaris (0194 §A) vond GEEN enkel
-- authenticated-pad dat een besluit ná insert update of verwijdert (de POST
-- /besluiten-route INSERT't en leest terug). UPDATE + DELETE dus geheel ingetrokken;
-- INSERT blijft. Wat weg moet, gaat via een owner-pad met spoor.
--
-- N.B. FK `procedure_id → procedures(id) ON DELETE CASCADE`: een cascade-DELETE bij
-- het verwijderen van een procedure valt buiten de child-DELETE-grant en blijft werken.
--
-- HAND-APPLIED. Rollback: supabase/rollbacks/2026_08_28_p214a1_03_kolomrevoke_besluiten_ROLLBACK.sql

begin;

revoke update, delete on public.procedure_besluiten from authenticated;

commit;
