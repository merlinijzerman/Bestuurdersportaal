-- ============================================================================
--  BOOTSTRAP — twee platformbeheerders met ALLE platform-capabilities.
--  Doel: merlin.ijzerman@the-paradox.com en robert.timmer@the-paradox.com
--        volledige toegang geven tot de platform back-office
--        (PLATFORM_HOST = beheer.bestuurdersportaal.com).
-- ----------------------------------------------------------------------------
--  Draaien in: Supabase → SQL Editor van het project dat ACHTER
--  beheer.bestuurdersportaal.com hangt (productie). Platte SQL, geen psql-vars.
--  Idempotent: herhaald draaien is veilig (on conflict do nothing overal).
--
--  ⚠️ VOORAF LEZEN — vier harde randvoorwaarden
--   1. HOST-CONFIG. beheer.bestuurdersportaal.com werkt alleen als PLATFORM_HOST
--      in de Vercel-omgeving op die host staat (middleware.ts → bepaalSurface).
--      In .env.vercel-now staat PLATFORM_HOST nu leeg → dan 'app'-surface en
--      /platform → 404. Deze SQL repareert dat NIET. Eerst env zetten + redeploy,
--      plus DNS/domein toevoegen in Vercel.
--   2. MFA IS HARD. app/(platform)/platform/(beveiligd)/layout.tsx eist live
--      AAL2. Zonder TOTP-factor kom je niet voorbij de gate. De platform-login
--      (/login op de platform-host → rewrite /platform/login) doet zelf de
--      enrollment: wachtwoord → TOTP-secret uitlezen → code → binnen.
--      Het TOTP-secret wordt als tekst getoond (geen QR-library).
--   3. GEEN TENANT-PROFIEL. De trigger bij_registratie → maak_profiel() maakt bij
--      elke nieuwe auth-user een profielen-rij, TENZIJ raw_user_meta_data
--      {"platform": true} bevat. Zonder die vlag faalt de insert bovendien
--      fail-closed (geen fonds_id). Metadata is dus VERPLICHT — zie Deel 1.
--   4. WACHTWOORD. 'Welkom01' is bewust een STARTwachtwoord. Zie de notitie
--      onderaan (Deel 7) — laat beide beheerders dit direct wijzigen.
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DEEL 0 — Pre-check (leest alleen; niets wijzigt)                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Verwacht NA een volledige run: auth_user=1, heeft_profiel=0,
-- platform_identiteit=1, actieve_caps = aantal rijen in platform_capabilities.
select
  d.email,
  (select count(*) from auth.users u where u.email = d.email)                    as auth_user,
  (select count(*) from public.profielen p
     where p.id = (select id from auth.users u2 where u2.email = d.email))       as heeft_profiel,
  (select count(*) from public.platform_identities pi where pi.email = d.email)  as platform_identiteit,
  (select count(*) from public.platform_identity_capabilities c
     where c.identity_id = (select id from auth.users u3 where u3.email = d.email)
       and c.ingetrokken_op is null)                                             as actieve_caps
from (values
  ('merlin.ijzerman@the-paradox.com'),
  ('robert.timmer@the-paradox.com')
) as d(email);

-- Referentie: welke capabilities kent de database (bron-van-waarheid = de
-- code-union in platform/lib/platform-capabilities.ts). Verwacht: 15 rijen.
select count(*) as caps_in_db, count(*) filter (where actief) as caps_actief
from public.platform_capabilities;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DEEL 1 — Auth-accounts aanmaken                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
--  ►► ROUTE A (AANBEVOLEN) — via de Supabase-console, GEEN SQL nodig.
--     Authentication → Users → Add user, twee keer:
--       E-mail            merlin.ijzerman@the-paradox.com  /  robert.timmer@the-paradox.com
--       Password          Welkom01
--       Auto Confirm User ✅ aanvinken (anders geen login zonder mailbevestiging)
--       User Metadata     {"platform": true, "naam": "Merlin IJzerman"}
--                         {"platform": true, "naam": "Robert Timmer"}
--     De metadata-vlag "platform": true is VERPLICHT: zonder die vlag gooit
--     maak_profiel() een exception ("geen fonds_id in user-metadata") en wordt
--     het account NIET aangemaakt. Mét de vlag komt er terecht géén profielen-rij.
--     Alternatief scriptbaar: scripts/platform_bootstrap_beheerders.mjs
--     (Admin API, node scripts/platform_bootstrap_beheerders.mjs).
--
--  ►► ROUTE B (FALLBACK) — accounts rechtstreeks in auth.* schrijven.
--     Alleen gebruiken als A en het .mjs-script niet kunnen. Je schrijft dan in
--     het interne GoTrue-schema; dat schema kan per Supabase-versie afwijken
--     (auth.identities.provider_id bestaat pas vanaf GoTrue v2.60-ish). Controleer
--     na afloop of inloggen daadwerkelijk lukt. Verwijder het commentaarblok
--     hieronder om het te activeren.
/*
-- B1. auth.users. crypt/gen_salt komen uit pgcrypto (al geïnstalleerd door
--     2026_06_23_platform_fundament.sql). Werkt crypt() niet, probeer dan
--     extensions.crypt(...) / extensions.gen_salt(...).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated', 'authenticated',
  d.email,
  crypt('Welkom01', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('platform', true, 'naam', d.naam),
  now(), now()
from (values
  ('merlin.ijzerman@the-paradox.com', 'Merlin IJzerman'),
  ('robert.timmer@the-paradox.com',   'Robert Timmer')
) as d(email, naam)
where not exists (select 1 from auth.users u where u.email = d.email);

-- B2. auth.identities — zonder deze rij weigert GoTrue de wachtwoordlogin.
insert into auth.identities (
  id, provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id::text, u.id,
  jsonb_build_object(
    'sub', u.id::text, 'email', u.email,
    'email_verified', true, 'phone_verified', false
  ),
  'email', now(), now(), now()
from auth.users u
where u.email in ('merlin.ijzerman@the-paradox.com','robert.timmer@the-paradox.com')
  and not exists (
    select 1 from auth.identities i
    where i.user_id = u.id and i.provider = 'email'
  );
*/

-- B3 / vangnet. Mocht er tóch een tenant-profiel zijn aangemaakt (metadata-vlag
-- vergeten), dan blokkeert de 3b-guard in platform-auth.ts de platformtoegang.
-- DESTRUCTIEF maar scherp afgebakend op exact deze twee adressen. Draai dit
-- alleen als Deel 0 'heeft_profiel = 1' toont.
-- delete from public.profielen p
-- using auth.users u
-- where p.id = u.id
--   and u.email in ('merlin.ijzerman@the-paradox.com','robert.timmer@the-paradox.com');


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DEEL 2 — Platform-identiteiten                                           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Geeft toegang tot de back-office-home. Guard: alleen als het auth-account
-- bestaat ÉN geen profielen-rij heeft (3b: een account met profiel is een
-- tenant-account en wordt door platform-auth altijd geweigerd).
insert into public.platform_identities (id, email, naam, actief)
select u.id, u.email, d.naam, true
from (values
  ('merlin.ijzerman@the-paradox.com', 'Merlin IJzerman'),
  ('robert.timmer@the-paradox.com',   'Robert Timmer')
) as d(email, naam)
join auth.users u on u.email = d.email
where not exists (select 1 from public.profielen p where p.id = u.id)
on conflict (id) do nothing;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DEEL 3 — Bootstrap-herkomst (twee systeem-identiteiten)                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Twee DB-CHECKs staan een naïeve self-grant in de weg:
--   chk_pic_geen_self_grant     toegekend_door <> identity_id
--   chk_pic_geen_self_approval  vier_ogen_door <> toegekend_door
-- Bovendien eist de code (ZWARE_CAPABILITIES) vier-ogen voor 7 van de 15 caps.
-- Bij een koude start is er nog geen bevoegde toekenner. We stempelen daarom met
-- twee niet-inlogbare systeem-identiteiten (actief=false, geen auth.users-rij).
-- BEWUST: we vullen vier_ogen_door NIET met de andere echte persoon — dat zou het
-- auditspoor laten zeggen dat een mens meekeek terwijl dat niet zo is.
insert into public.platform_identities (id, email, naam, actief) values
  ('00000000-0000-0000-0000-0000000000b0',
   'systeem-bootstrap-toekenner@platform.local', 'Systeem (bootstrap-toekenner)', false),
  ('00000000-0000-0000-0000-0000000000b1',
   'systeem-bootstrap-vierogen@platform.local',  'Systeem (bootstrap-vier-ogen)', false)
on conflict (id) do nothing;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DEEL 4 — ALLE capabilities toekennen                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Alle actieve capabilities uit het register, aan beide identiteiten.
-- Idempotent via de partial unique index ux_pic_actief (één actieve grant per
-- identity+capability) → on conflict do nothing.
--
-- ⚠️ Dit omzeilt bewust de vier-ogen-/break-glass-conventie uit
--    platform/lib/platform-grant-regels.ts (valideerGrant). Dat kan alleen bij de
--    ALLEREERSTE inrichting. Vanaf nu lopen grants via de rechten-UI
--    (/platform/rechten), waar de guards wél gelden.
insert into public.platform_identity_capabilities
  (identity_id, capability, toegekend_door, vier_ogen_door)
select
  pi.id,
  pc.capability,
  '00000000-0000-0000-0000-0000000000b0',
  '00000000-0000-0000-0000-0000000000b1'
from public.platform_identities pi
cross join public.platform_capabilities pc
where pi.email in ('merlin.ijzerman@the-paradox.com','robert.timmer@the-paradox.com')
  and pc.actief
on conflict do nothing;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DEEL 5 — Auditspoor van deze bootstrap                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Grants via de UI loggen attempt+result in platform_event_log (hash-keten).
-- Deze SQL-route doet dat niet vanzelf; zonder deze inserts staat er een gat in
-- het spoor precies op het moment dat de zwaarste rechten zijn uitgedeeld.
-- De hash/prev_hash worden door trg_platform_event_hash gezet.
-- Niet idempotent (ux_pel_correlatie_fase is per correlatie_id, en die is nieuw
-- per run) → draai dit blok één keer, bij de daadwerkelijke eerste toekenning.
with doelen as materialized (
  select pi.id, pi.email, gen_random_uuid() as cid
  from public.platform_identities pi
  where pi.email in ('merlin.ijzerman@the-paradox.com','robert.timmer@the-paradox.com')
),
fasen as (select 'attempt' as fase union all select 'result')
insert into public.platform_event_log (
  correlatie_id, fase, identity_id, capability, handeling,
  doel_object, reden, uitkomst, effect
)
select
  d.cid,
  f.fase,
  '00000000-0000-0000-0000-0000000000b0',
  'platform.capabilities.grant',
  'bootstrap_alle_capabilities',
  d.id::text,
  'Eenmalige inrichting eerste platformbeheerders via SQL-bootstrap; vier-ogen niet toepasbaar bij koude start.',
  case when f.fase = 'result' then 'succes' end,
  case when f.fase = 'result'
       then jsonb_build_object(
              'toegekend', (select count(*) from public.platform_capabilities where actief),
              'route', 'scripts/platform_bootstrap_beheerders.sql')
  end
from doelen d cross join fasen f;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DEEL 6 — Verificatie                                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- 6a. Eindstand per beheerder. Verwacht: heeft_profiel=0, identiteit=1,
--     actief=true, caps = aantal actieve capabilities (nu 15).
select
  pi.email, pi.naam, pi.actief,
  (select count(*) from public.profielen p where p.id = pi.id)                   as heeft_profiel,
  (select count(*) from public.platform_identity_capabilities c
     where c.identity_id = pi.id and c.ingetrokken_op is null)                   as actieve_caps
from public.platform_identities pi
where pi.email in ('merlin.ijzerman@the-paradox.com','robert.timmer@the-paradox.com');

-- 6b. Ontbreekt er een capability? Verwacht: 0 rijen.
select pi.email, pc.capability as ontbreekt
from public.platform_identities pi
cross join public.platform_capabilities pc
where pi.email in ('merlin.ijzerman@the-paradox.com','robert.timmer@the-paradox.com')
  and pc.actief
  and not exists (
    select 1 from public.platform_identity_capabilities c
    where c.identity_id = pi.id and c.capability = pc.capability
      and c.ingetrokken_op is null
  );

-- 6c. Auditspoor van deze bootstrap terugzien.
select fase, identity_id, doel_object, uitkomst, tijdstip
from public.platform_event_log
where handeling = 'bootstrap_alle_capabilities'
order by tijdstip desc, id desc
limit 10;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DEEL 7 — Na afloop: inloggen + hygiëne                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--  INLOGGEN
--   1. https://beheer.bestuurdersportaal.com/login
--      (de middleware rewrit dit naar de interne route /platform/login)
--   2. e-mail + Welkom01
--   3. TOTP-enrollment: het secret verschijnt als tekst → handmatig invoeren in
--      Google Authenticator / 1Password / Authy → 6-cijferige code → binnen.
--   Lokaal smoken kan zonder host-config via http://localhost:3000/platform
--   (dev-fallback in middleware.ts) of ?surface=platform.
--
--  DIRECT DAARNA (aanbevolen)
--   - Wachtwoord wijzigen. 'Welkom01' geeft, gecombineerd met alle 15 caps,
--     toegang tot cross-tenant data van álle fondsen. MFA vangt veel af, maar het
--     wachtwoord blijft de eerste factor. Zet in Supabase → Authentication →
--     Policies bij voorkeur ook een minimale wachtwoordsterkte.
--   - Vervolg-grants NIET meer via SQL, maar via /platform/rechten, zodat de
--     guards (self-grant, vier-ogen, break-glass) en het auditspoor gelden.
--   - Overweeg de systeem-identiteiten uit Deel 3 te laten staan: ze zijn
--     actief=false en dienen als herkomststempel in het auditspoor. Verwijderen
--     breekt de FK vanuit de grants.
--
--  TERUGDRAAIEN (intrekken, append-only — niet verwijderen)
--   update public.platform_identity_capabilities
--     set ingetrokken_op = now()
--   where identity_id in (select id from public.platform_identities
--                         where email in ('merlin.ijzerman@the-paradox.com',
--                                         'robert.timmer@the-paradox.com'))
--     and ingetrokken_op is null;
--   -- en/of de identiteit blokkeren:
--   update public.platform_identities set actief = false
--   where email in ('merlin.ijzerman@the-paradox.com','robert.timmer@the-paradox.com');
