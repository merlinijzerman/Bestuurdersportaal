-- ============================================================================
--  Bootstrap-grant — platform.contact.manage voor de platform-identiteit.
--  Draai in de Supabase SQL-editor. Platte SQL (geen psql-variabelen).
-- ----------------------------------------------------------------------------
--  Doel: de platform-identiteit (merlinijzerman+platform@gmail.com) mag de
--  publieke CONTACT-INBOX inzien en opvolgen in de back-office
--  (/platform/contact, capability platform.contact.manage).
--
--  VOORWAARDEN (in deze volgorde):
--   1. Migratie 2026_06_30_contact_beheer.sql is gedraaid → de capability
--      platform.contact.manage bestaat in public.platform_capabilities.
--      (Zonder die rij faalt de grant op de FK naar platform_capabilities.)
--   2. De platform-identiteit bestaat al (zie scripts/platform_bootstrap_identiteit.sql).
--
--  Waarom een systeem-toekenner? De DB-CHECK chk_pic_geen_self_grant verbiedt
--  dat een identiteit zichzelf een capability toekent (toegekend_door <>
--  identity_id). Met één platformbeheerder is er nog geen tweede toekenner, dus
--  gebruiken we dezelfde niet-inlogbare systeem-identiteit als in INTENT A van
--  platform_rechten_toekennen.sql, puur als herkomst-stempel voor deze eenmalige
--  bootstrap-grant. ⚠️ Dit omzeilt bewust de vier-ogen-conventie en is alleen
--  voor de allereerste setup. Doe vervolg-grants via de rechten-UI zodra er een
--  tweede bevoegde toekenner is.
-- ============================================================================

-- 0. Pre-check: bestaat de identiteit, bestaat de capability, en is hij er al?
select
  (select count(*) from public.platform_identities pi
     join auth.users u on u.id = pi.id
    where u.email = 'merlinijzerman+platform@gmail.com')              as is_platform_identiteit,
  (select count(*) from public.platform_capabilities
    where capability = 'platform.contact.manage')                     as cap_bestaat,
  (select count(*) from public.platform_identity_capabilities c
     join auth.users u on u.id = c.identity_id
    where u.email = 'merlinijzerman+platform@gmail.com'
      and c.capability = 'platform.contact.manage'
      and c.ingetrokken_op is null)                                   as heeft_cap_al;

-- 1. Systeem-bootstrap-identiteit (idempotent; bestaat al na INTENT A).
insert into public.platform_identities (id, email, naam, actief)
values ('00000000-0000-0000-0000-0000000000b0',
        'systeem-bootstrap@platform.local', 'Systeem (bootstrap)', false)
on conflict (id) do nothing;

-- 2. Grant platform.contact.manage (niet-zwaar → vier_ogen_door mag NULL).
--    Idempotent via ux_pic_actief (1 actieve grant per identity+capability).
insert into public.platform_identity_capabilities
  (identity_id, capability, toegekend_door, vier_ogen_door)
select u.id,
       'platform.contact.manage',
       '00000000-0000-0000-0000-0000000000b0',
       null
from auth.users u
where u.email = 'merlinijzerman+platform@gmail.com'
  and exists (select 1 from public.platform_identities pi where pi.id = u.id)
on conflict do nothing;

-- 3. Verificatie: 1 actieve grant van platform.contact.manage verwacht.
select c.capability, c.toegekend_op, c.ingetrokken_op
from public.platform_identity_capabilities c
join auth.users u on u.id = c.identity_id
where u.email = 'merlinijzerman+platform@gmail.com'
  and c.capability = 'platform.contact.manage'
  and c.ingetrokken_op is null;
