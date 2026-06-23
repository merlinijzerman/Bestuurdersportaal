-- ============================================================================
--  Bootstrap eerste platform-identiteit (Increment P0).
-- ----------------------------------------------------------------------------
--  Maakt voor een bestaand auth-account een rij in platform_identities, zodat
--  dat account voorbij de back-office-gate komt (app/(platform)/platform/
--  (beveiligd)/layout.tsx → huidigePlatformIdentiteit). Draai dit in de Supabase
--  SQL-editor (platte SQL — geen psql-variabelen, die werken daar niet).
--
--  VOORWAARDEN:
--   1. Het account moet al bestaan in auth.users — registreer eerst via
--      /platform/login. Dit script maakt GEEN auth-user aan.
--   2. Het account mag GEEN profielen-rij hebben (3b-blokkade: een account met
--      profiel is een tenant-account en wordt door platform-auth geweigerd).
--      De WHERE-NOT-EXISTS hieronder dwingt dat af: bij een tenant-account
--      worden 0 rijen ingevoegd.
--   3. Capabilities zitten hier bewust NIET in: alleen de identiteit-rij geeft
--      toegang tot de home. Capabilities lopen via het vier-ogen-grant-pad
--      (P1+), niet via een self-grant (DB-CHECK chk_pic_geen_self_grant).
--
--  Sleutel = e-mailadres (hieronder direct ingevuld). Wijzig de naam zo nodig.
-- ============================================================================

-- ── 0. Pre-check: bestaat het auth-account en is het geen tenant-account? ────
-- (Informatief — leest alleen. 'auth_user' hoort 1 te zijn, 'heeft_profiel' 0.)
select
  (select count(*) from auth.users u
     where u.email = 'merlinijzerman@gmail.com') as auth_user,
  (select count(*) from public.profielen p
     where p.id = (select id from auth.users
                   where email = 'merlinijzerman@gmail.com')) as heeft_profiel;

-- ── 1. Identiteit aanmaken (idempotent + 3b-guard) ──────────────────────────
-- Voegt alleen in als het auth-account bestaat EN geen profielen-rij heeft.
-- on conflict (id) maakt herhaald draaien veilig.
insert into public.platform_identities (id, email, naam, actief)
select u.id, u.email, 'Merlin IJzerman', true
from auth.users u
where u.email = 'merlinijzerman@gmail.com'
  and not exists (
    select 1 from public.profielen p where p.id = u.id
  )
on conflict (id) do nothing;

-- ── 2. Verificatie: de identiteit hoort er nu te staan, actief ──────────────
select id, email, naam, actief, mfa_enrolled, aangemaakt_op
from public.platform_identities
where email = 'merlinijzerman@gmail.com';
