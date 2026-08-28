-- ==========================================================================
-- 2026-08-27 — platform.pipeline.operate: machinegezag (besluit 0193, #183b-machine)
-- --------------------------------------------------------------------------
-- De 5 machine-worker-SPECs schrijven vanaf #183b-machine een platform_event_log-
-- event met capability = 'platform.pipeline.operate'. Die capability benoemt de
-- SOORT bevoegdheid ("dit gebeurde onder machinegezag, niet onder iemands recht"),
-- geen toekenbaar privilege.
--
-- Twee dingen, samen:
--   1. Seed de nieuwe waarde in platform_capabilities (code<->seed-consistentie,
--      TO §12 test 17 / platform-capabilities.sanity.ts). platform_event_log.capability
--      heeft GEEN FK hierheen, dus dit is voor de referentie/consistentie, niet een
--      harde voorwaarde voor de write.
--   2. Maak hem STRUCTUREEL niet-toekenbaar: een CHECK op platform_identity_capabilities
--      weigert elke grant van deze capability. Zo is uitgesloten dat een mens hem ooit
--      houdt en machine-events weer ononderscheidbaar worden van menselijke handelingen
--      (0193 §2a). Symmetrisch met chk_pic_geen_self_grant / chk_pic_geen_self_approval.
--
-- Idempotent: on conflict do nothing + DO-block dat de constraint alleen toevoegt
-- als hij nog niet bestaat. Bestaande rijen: geen enkele verwijst naar de nieuwe
-- capability, dus de CHECK valideert schoon.
-- ==========================================================================

begin;

-- 1. Seed als bekende waarde (NIET als toekenbaar recht).
insert into public.platform_capabilities (capability, omschrijving) values
  ('platform.pipeline.operate', 'Machinegezag: geautomatiseerde cron-/pipelineruns (service-role). Niet-toekenbaar — besluit 0193.')
on conflict (capability) do nothing;

-- 2. Structureel niet-toekenbaar: geen enkele identiteit mag deze capability houden.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_pic_geen_machinegezag'
  ) then
    alter table public.platform_identity_capabilities
      add constraint chk_pic_geen_machinegezag
      check (capability <> 'platform.pipeline.operate');
  end if;
end $$;

commit;
