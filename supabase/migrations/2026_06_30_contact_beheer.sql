-- ============================================================================
-- Migratie 2026-06-30 — Platform-capability voor de contact-inbox back-office.
-- ----------------------------------------------------------------------------
-- Voegt ÉÉN nieuwe platform-capability toe: platform.contact.manage. Hiermee
-- kan een bevoegde platform-identiteit de publieke contactinzendingen
-- (public.contact_aanvragen) inzien en de status opvolgen.
--
-- Context / leidend:
--   - De inbox is NIET tenant-gebonden (geen fonds_id) en hoort daarom op de
--     platform-back-office, niet in een fonds-tenant. Zie migratie
--     2026_06_29_contact_aanvragen.sql (open besluit TO §14 nr. 3: "back-office
--     of expliciete beheerderspolicy" voor lezen/opvolgen).
--   - Posture blijft deny-by-default: er komt GEEN anon/authenticated RLS-
--     leespolicy op contact_aanvragen. Lezen én status-updates lopen server-side
--     via de service-role-client, uitsluitend achter withPlatform (capability-
--     check + twee-fasen-audit). De browser raakt de tabel nooit direct.
--   - De append-only-lijn blijft intact: status-opvolging via UPDATE
--     (nieuw -> in_behandeling -> afgehandeld); de no-delete-trigger blijft gelden.
--
-- Code<->seed-pariteit (TO §12 test 17): de PlatformCapability-union in
-- lib/platform-capabilities.ts en de SEED in lib/platform-capabilities.sanity.ts
-- zijn in dezelfde wijziging meegenomen. Aantal caps: 11 -> 12.
--
-- Idempotent en non-destructief (on conflict do nothing). Standalone veilig:
-- bestaande rijen worden niet aangeraakt; alleen de nieuwe capability erbij.
-- ============================================================================

insert into public.platform_capabilities (capability, omschrijving) values
  ('platform.contact.manage', 'Publieke contact-inbox inzien en opvolgen (niet-tenant)')
on conflict (capability) do nothing;
