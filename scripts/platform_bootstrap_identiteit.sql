-- ============================================================================
--  Bootstrap eerste platform-identiteit (Increment P0).
-- ----------------------------------------------------------------------------
--  Maakt voor een bestaand auth-account een rij in platform_identities, zodat
--  dat account voorbij de back-office-gate komt (app/(platform)/platform/
--  (beveiligd)/layout.tsx → huidigePlatformIdentiteit). Draai dit in de Supabase
--  SQL-editor (platte SQL — geen psql-variabelen, die werken daar niet).
--
--  VOORWAARDEN:
--   1. Het account moet al bestaan in auth.users. De back-office heeft GEEN
--      zelfregistratie; maak het account aan via Supabase → Authentication →
--      Add user (Auto Confirm aanvinken). Dit script maakt GEEN auth-user aan.
--   2. Het account mag GEEN profielen-rij hebben (3b-blokkade: een account met
--      profiel is een tenant-account en wordt door platform-auth geweigerd).
--      De WHERE-NOT-EXISTS hieronder dwingt dat af: bij een tenant-account
--      worden 0 rijen ingevoegd.
--   3. Capabilities zitten hier bewust NIET in: alleen de identiteit-rij geeft
--      toegang tot de home. Capabilities lopen via het vier-ogen-grant-pad
--      (P1+), niet via een self-grant (DB-CHECK chk_pic_geen_self_grant).
--
--  ⚠️ LET OP — AUTO-PROFIEL (waargenomen 2026-06-23, root cause nog te bevestigen):
--  in de LIVE database krijgt ELK nieuw auth-account automatisch een profielen-
--  rij (rol=bestuurder, gekoppeld aan het demofonds). Dit mechanisme staat NIET
--  in de migraties of in de app-code — vermoedelijk een trigger op auth.users die
--  los in de DB is aangemaakt. Gevolg: een vers platform-account is meteen een
--  tenant-account en wordt door de 3b-gate geweigerd. Tot dat mechanisme netjes
--  is gefixt (platform-accounts overslaan) moet je dit auto-profiel HANDMATIG
--  verwijderen vóór stap 1 — zie stap 0b. Dit is een eenmalige bootstrap-ingreep
--  per platform-account, GEEN onderdeel van de tenant-onboarding.
--
--  Sleutel = e-mailadres (hieronder direct ingevuld). Wijzig de naam zo nodig.
-- ============================================================================

-- ── 0a. Pre-check: bestaat het auth-account, en heeft het (nog) een profiel? ─
-- (Informatief — leest alleen. 'auth_user' hoort 1 te zijn; 'heeft_profiel' is
--  door het auto-profiel waarschijnlijk 1 — dat ruimt stap 0b op.)
select
  (select count(*) from auth.users u
     where u.email = 'merlinijzerman+platform@gmail.com') as auth_user,
  (select count(*) from public.profielen p
     where p.id = (select id from auth.users
                   where email = 'merlinijzerman+platform@gmail.com')) as heeft_profiel;

-- ── 0b. Auto-profiel weghalen (DESTRUCTIEF — alleen voor het PLATFORM-account) ─
-- Verwijdert het per ongeluk auto-aangemaakte tenant-profiel zodat de 3b-guard
-- de platform-identiteit toelaat. Scope = exact dit e-mailadres; cascadet naar
-- de (lege) profiel_* subtabellen. Raakt echte bestuurder-accounts NIET.
-- Voer dit alleen uit als stap 0a 'heeft_profiel = 1' toont voor dit alias-adres.
delete from public.profielen p
using auth.users u
where p.id = u.id
  and u.email = 'merlinijzerman+platform@gmail.com';

-- ── 1. Identiteit aanmaken (idempotent + 3b-guard) ──────────────────────────
-- Voegt alleen in als het auth-account bestaat EN geen profielen-rij heeft.
-- on conflict (id) maakt herhaald draaien veilig.
insert into public.platform_identities (id, email, naam, actief)
select u.id, u.email, 'Merlin IJzerman', true
from auth.users u
where u.email = 'merlinijzerman+platform@gmail.com'
  and not exists (
    select 1 from public.profielen p where p.id = u.id
  )
on conflict (id) do nothing;

-- ── 2. Verificatie: heeft_profiel=0, heeft_platform_identiteit=1, actief=true ─
select
  (select count(*) from public.profielen p where p.id = u.id)             as heeft_profiel,
  (select count(*) from public.platform_identities pi where pi.id = u.id) as heeft_platform_identiteit,
  (select pi.actief from public.platform_identities pi where pi.id = u.id) as platform_actief
from auth.users u
where u.email = 'merlinijzerman+platform@gmail.com';
