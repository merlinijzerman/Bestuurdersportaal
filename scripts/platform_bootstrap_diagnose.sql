-- ============================================================================
--  DIAGNOSE — "Inloggen mislukt. Controleer e-mailadres en wachtwoord."
--  op beheer.bestuurdersportaal.com.
-- ----------------------------------------------------------------------------
--  De platform-login toont ÉÉN generieke melding voor elke fout van
--  signInWithPassword (app/(platform)/platform/login/page.tsx). Achter die ene
--  tekst zitten minstens vijf verschillende oorzaken. Dit script scheidt ze.
--
--  ⚠️ Draai dit in het Supabase-project dat de GEDEPLOYDE app gebruikt
--     (NEXT_PUBLIC_SUPABASE_URL in Vercel), niet per se het project uit je
--     lokale .env.local. Query 0 hieronder helpt dat vaststellen.
-- ============================================================================


-- ── 0. DRAAI IK IN HET JUISTE PROJECT? ──────────────────────────────────────
-- auth.audit_log_entries legt élke inlogpoging vast. Zie je hier GEEN recente
-- regel terwijl je net hebt geprobeerd in te loggen, dan praat de gedeployde
-- app met een ÁNDER Supabase-project dan waar je nu zit. Dat is dan meteen de
-- oorzaak — en geen enkele query hieronder is dan nog zinvol.
select
  created_at,
  payload->>'action'      as actie,
  payload->>'actor_username' as actor,
  payload->>'error_code'  as foutcode
from auth.audit_log_entries
order by created_at desc
limit 15;


-- ── 1. HOOFDDIAGNOSE per account ────────────────────────────────────────────
-- Loop de kolommen van links naar rechts; de eerste die niet klopt is je oorzaak.
--
--  bestaat_niet            → Deel 1 van de bootstrap is (in dit project) nooit
--                            gedraaid. Deel 2 t/m 4 doen dan stilzwijgend niets:
--                            de INSERT ... SELECT vindt geen auth-user en voegt
--                            0 rijen toe. Geen foutmelding, geen effect.
--  wachtwoord_klopt=false  → account bestaat, maar niet met 'Welkom01'.
--  email_bevestigd=false   → GoTrue weigert de login (email_not_confirmed).
--                            Ontstaat als 'Auto Confirm User' niet is aangevinkt.
--  identity_email=0        → auth.users-rij zonder auth.identities-rij. Typisch
--                            gevolg van route B (rauwe SQL) waarbij stap B2 is
--                            overgeslagen of op een schema-verschil stukliep.
--                            GoTrue kan de gebruiker dan niet resolven.
--  geblokkeerd / verwijderd → banned_until in de toekomst of deleted_at gezet.
--
--  Let op: heeft_profiel en platform_identiteit spelen HIER nog geen rol. Die
--  gaan pas na een geslaagde login meedoen (dan krijg je ?fout=geen_toegang,
--  een andere melding). Ze staan erbij zodat je de vervolgstap meteen ziet.
select
  d.email,
  u.id                                                    as auth_user_id,
  (u.id is null)                                          as bestaat_niet,
  u.encrypted_password is not null                        as heeft_wachtwoord,
  (u.encrypted_password = crypt('Welkom01', u.encrypted_password))
                                                          as wachtwoord_klopt,
  (u.email_confirmed_at is not null)                      as email_bevestigd,
  (select count(*) from auth.identities i
     where i.user_id = u.id and i.provider = 'email')     as identity_email,
  (u.banned_until is not null and u.banned_until > now()) as geblokkeerd,
  (u.deleted_at is not null)                              as verwijderd,
  u.raw_user_meta_data->>'platform'                       as meta_platform,
  (select count(*) from public.profielen p
     where p.id = u.id)                                   as heeft_profiel,
  (select count(*) from public.platform_identities pi
     where pi.id = u.id)                                  as platform_identiteit,
  (select count(*) from public.platform_identity_capabilities c
     where c.identity_id = u.id and c.ingetrokken_op is null) as actieve_caps
from (values
  ('merlin.ijzerman@the-paradox.com'),
  ('robert.timmer@the-paradox.com')
) as d(email)
left join auth.users u on lower(u.email) = lower(d.email);

-- Werkt crypt() hier niet ("function crypt(...) does not exist"), gebruik dan:
--   (u.encrypted_password = extensions.crypt('Welkom01', u.encrypted_password))


-- ── 2. Staat het account misschien onder een ander adres? ───────────────────
-- Vangt typefouten en het +platform-alias uit de eerdere bootstrap.
select id, email, created_at,
       email_confirmed_at is not null as bevestigd,
       raw_user_meta_data->>'platform' as meta_platform
from auth.users
where email ilike '%ijzerman%' or email ilike '%timmer%' or email ilike '%paradox%'
order by created_at desc;


-- ============================================================================
--  HERSTELACTIES — kies op basis van query 1
-- ============================================================================

-- A. bestaat_niet = true
--    → Maak de accounts alsnog aan: Supabase → Authentication → Add user,
--      mét Auto Confirm ✅ en User Metadata {"platform": true, "naam": "..."}.
--      Of: node scripts/platform_bootstrap_beheerders.mjs --uitvoeren
--      Draai dáárna Deel 2 t/m 6 van platform_bootstrap_beheerders.sql opnieuw.

-- B. wachtwoord_klopt = false
--    → Supabase → Authentication → Users → account → Reset/Update password.
--      Of via SQL (pgcrypto):
-- update auth.users
--    set encrypted_password = crypt('Welkom01', gen_salt('bf')),
--        updated_at = now()
--  where lower(email) in ('merlin.ijzerman@the-paradox.com',
--                         'robert.timmer@the-paradox.com');

-- C. email_bevestigd = false
-- update auth.users
--    set email_confirmed_at = coalesce(email_confirmed_at, now()),
--        updated_at = now()
--  where lower(email) in ('merlin.ijzerman@the-paradox.com',
--                         'robert.timmer@the-paradox.com');

-- D. identity_email = 0  (auth.users bestaat, auth.identities ontbreekt)
-- insert into auth.identities (
--   id, provider_id, user_id, identity_data, provider,
--   last_sign_in_at, created_at, updated_at
-- )
-- select gen_random_uuid(), u.id::text, u.id,
--        jsonb_build_object('sub', u.id::text, 'email', u.email,
--                           'email_verified', true, 'phone_verified', false),
--        'email', now(), now(), now()
-- from auth.users u
-- where lower(u.email) in ('merlin.ijzerman@the-paradox.com',
--                          'robert.timmer@the-paradox.com')
--   and not exists (select 1 from auth.identities i
--                   where i.user_id = u.id and i.provider = 'email');

-- E. geblokkeerd = true
-- update auth.users set banned_until = null, updated_at = now()
--  where lower(email) in ('merlin.ijzerman@the-paradox.com',
--                         'robert.timmer@the-paradox.com');


-- ── 3. Nacontrole: draai query 1 opnieuw ────────────────────────────────────
-- Verwacht vóór een geslaagde login: bestaat_niet=false, wachtwoord_klopt=true,
-- email_bevestigd=true, identity_email=1, geblokkeerd=false, verwijderd=false.
-- En voor de gate daarna: heeft_profiel=0, platform_identiteit=1, actieve_caps=15.
