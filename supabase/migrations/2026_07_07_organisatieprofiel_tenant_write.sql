-- ============================================================================
-- Migratie 2026-07-07 — Organisatieprofiel: tenant-zelfservice schrijf-policies.
-- ----------------------------------------------------------------------------
-- HERZIENING van de oorspronkelijke keuze in 2026_07_06_organisatie_profielen.sql
-- (en besluit 0038): daarin was schrijven bewust ALLEEN via de service-role
-- (platform-back-office). De platform-autorisatie bleek te zwaar voor de MVP;
-- het fonds beheert nu z'n eigen organisatieprofiel via een tab in het portaal.
--
-- Autorisatiemodel (huispatroon, zie lib/capabilities.ts):
--   - RLS = FONDS-ISOLATIE: INSERT/UPDATE mag alleen voor de rij van het eigen
--     fonds (zelfde subquery als de SELECT-policy).
--   - CODE = ROLGATE: de beheerder-eis (capability organisation.profile.manage,
--     alleen rol 'beheerder') wordt server-side in /api/organisatieprofiel
--     afgedwongen via requireCapability(). RLS kent bewust GEEN rolcheck, gelijk
--     aan de profielen-tabel (RLS op eigen rij, capability in de route).
--
-- De service-role-schrijfweg (platform-back-office, OP-5) blijft ongewijzigd
-- werken: die omzeilt RLS en staat los van deze policies.
--
-- Conventies: idempotent; migratie-eerst-dan-deploy; ROLLBACK-bestand apart.
-- ============================================================================

-- INSERT: alleen een rij voor het eigen fonds aanmaken.
drop policy if exists "organisatieprofiel insert eigen fonds"
  on public.organisatie_profielen;
create policy "organisatieprofiel insert eigen fonds"
  on public.organisatie_profielen
  for insert with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- UPDATE: alleen de rij van het eigen fonds; WITH CHECK verhindert dat de rij
-- naar een ander fonds wordt omgehangen.
drop policy if exists "organisatieprofiel update eigen fonds"
  on public.organisatie_profielen;
create policy "organisatieprofiel update eigen fonds"
  on public.organisatie_profielen
  for update using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  ) with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- Geen DELETE-policy: verwijderen blijft uitgesloten voor tenants.
