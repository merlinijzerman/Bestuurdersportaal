-- #214-a1 (besluit 0194) — procedure_stappen: kolomniveau-revoke (PRODUCTIEFIX).
-- ---------------------------------------------------------------------------
-- Mechanisme = PR-D `2026_08_28_p3d_03` op decision_objects.status. Trek de
-- tabel-brede UPDATE van `authenticated` in en her-verleen UPDATE op álle kolommen
-- BEHALVE de drie bewaakte die op `main`/productie bestaan: `status`, `voltooid_op`,
-- `voltooid_door`. Een directe PATCH op een bewaakte kolom faalt daarna met 42501.
-- De SECURITY DEFINER-RPC's uit migratie 01 draaien als owner en houden het recht.
--
-- De vier afwijkingskolommen (afgerond_met_afwijking, afwijking_*) bestaan hier NIET
-- (epic-only). Zodra dit pakket in de epic landt, vallen die vier al fail-closed uit
-- deze her-grant; #214-a2 maakt het daar expliciet en breidt de gate uit.
--
-- LET OP — grant-drift: een later toegevoegde kolom valt fail-closed uit deze
-- her-grant. Bewaakt door de statische gate `2026_08_28_p214a1_schrijfpoort.sql`.
--
-- HAND-APPLIED. Rollback: supabase/rollbacks/2026_08_28_p214a1_02_kolomrevoke_stappen_ROLLBACK.sql

begin;

revoke update on public.procedure_stappen from authenticated;

grant update (
  id, procedure_id, volgorde, naam, beschrijving, vereist_besluit, geschatte_dagen,
  eigenaar_naam, deadline, blokkerende_afhankelijkheden, herbevestiging_nodig,
  heropend_op, fase_code
) on public.procedure_stappen to authenticated;

-- DELETE ingetrokken (reviewbevinding, symmetrisch met procedure_besluiten): een
-- afgeronde stap hard verwijderen wist het verantwoordingsfeit. Geen app-pad
-- verwijdert stappen als authenticated; de procedure→stappen ON DELETE CASCADE valt
-- buiten de child-DELETE-grant en blijft werken.
revoke delete on public.procedure_stappen from authenticated;

commit;
