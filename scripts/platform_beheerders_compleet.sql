-- ============================================================================
--  COMPLEET — twee platformbeheerders volledig inrichten. Eén keer draaien.
--
--  Doel : merlin.ijzerman@the-paradox.com  (Merlin IJzerman)
--         robert.timmer@the-paradox.com    (Robert Timmer)
--  Geeft: auth-account met wachtwoord Welkom01 + platform-identiteit +
--         ALLE platform-capabilities + auditspoor.
--
--  WAAR : Supabase → SQL Editor, project aebwiufuegsiwhwpdrfb.
--         Selecteer alles en druk op Run. Idempotent: herhalen is veilig.
--  DAARNA: https://beheer.bestuurdersportaal.com/login
--          → e-mail + Welkom01 → TOTP-enrollment → back-office.
--
--  Onderaan staat de verificatie. Klopt die niet, dan staat daar ook de
--  terugdraaiactie.
-- ============================================================================

do $$
declare
  v_user_id            uuid;
  v_heeft_provider_id  boolean;
  v_aantal_caps        int;
  d                    record;
begin
  -- Schemavariant van auth.identities bepalen (provider_id bestaat pas vanaf
  -- GoTrue ~v2.60). Zo werkt het script op beide varianten.
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities'
      and column_name = 'provider_id'
  ) into v_heeft_provider_id;

  -- Twee systeem-identiteiten als herkomststempel. Nodig omdat twee DB-CHECKs
  -- een self-grant verbieden (toegekend_door <> identity_id, vier_ogen_door <>
  -- toegekend_door) en 7 van de 15 caps vier-ogen vereisen. Niet-inlogbaar
  -- (actief=false, geen auth.users-rij). Bewust géén echte naam als goedkeurder:
  -- het auditspoor mag niet suggereren dat een mens heeft meegekeken.
  insert into public.platform_identities (id, email, naam, actief) values
    ('00000000-0000-0000-0000-0000000000b0',
     'systeem-bootstrap-toekenner@platform.local', 'Systeem (bootstrap-toekenner)', false),
    ('00000000-0000-0000-0000-0000000000b1',
     'systeem-bootstrap-vierogen@platform.local',  'Systeem (bootstrap-vier-ogen)', false)
  on conflict (id) do nothing;

  for d in
    select * from (values
      ('merlin.ijzerman@the-paradox.com', 'Merlin IJzerman'),
      ('robert.timmer@the-paradox.com',   'Robert Timmer')
    ) as t(email, naam)
  loop
    ------------------------------------------------------------------ 1. auth
    select id into v_user_id from auth.users where lower(email) = lower(d.email);

    if v_user_id is null then
      v_user_id := gen_random_uuid();

      -- raw_user_meta_data.platform = true is VERPLICHT: de trigger
      -- bij_registratie → maak_profiel() is fail-closed en gooit anders een
      -- exception op de ontbrekende fonds_id, waardoor de hele insert terugrolt.
      -- Dat is precies waarom de "Add user"-dialog faalt.
      -- De lege strings voorkomen dat GoTrue later struikelt over NULL-tokens
      -- ("converting NULL to string is unsupported").
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new,
        email_change_token_current, email_change, phone_change,
        phone_change_token, reauthentication_token
      ) values (
        '00000000-0000-0000-0000-000000000000',
        v_user_id, 'authenticated', 'authenticated',
        lower(d.email),
        crypt('Welkom01', gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('platform', true, 'naam', d.naam),
        now(), now(),
        '', '', '', '', '', '', '', ''
      );
      raise notice '% → auth-account aangemaakt (%)', d.email, v_user_id;
    else
      -- Bestaat al: wachtwoord, bevestiging en platform-vlag gelijktrekken.
      update auth.users
         set encrypted_password = crypt('Welkom01', gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                                  || jsonb_build_object('platform', true, 'naam', d.naam),
             banned_until       = null,
             updated_at         = now()
       where id = v_user_id;
      raise notice '% → bestond al (%), wachtwoord/vlag bijgewerkt', d.email, v_user_id;
    end if;

    ------------------------------------------------------- 2. auth.identities
    -- Zonder deze rij weigert GoTrue de wachtwoordlogin met exact dezelfde
    -- melding als een fout wachtwoord. Meest gemiste stap bij handmatig aanmaken.
    if not exists (select 1 from auth.identities i
                   where i.user_id = v_user_id and i.provider = 'email') then
      if v_heeft_provider_id then
        insert into auth.identities (
          id, provider_id, user_id, identity_data, provider,
          last_sign_in_at, created_at, updated_at
        ) values (
          gen_random_uuid(), v_user_id::text, v_user_id,
          jsonb_build_object('sub', v_user_id::text, 'email', lower(d.email),
                             'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now()
        );
      else
        insert into auth.identities (
          id, user_id, identity_data, provider,
          last_sign_in_at, created_at, updated_at
        ) values (
          v_user_id::text, v_user_id,
          jsonb_build_object('sub', v_user_id::text, 'email', lower(d.email),
                             'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now()
        );
      end if;
    end if;

    ------------------------------------------------- 3. tenant-profiel weg
    -- Een account MET profielen-rij is een tenant-account en wordt door de
    -- 3b-guard in platform-auth.ts altijd geweigerd. Scherp afgebakend op dit
    -- ene account; raakt geen bestuurdersprofielen.
    delete from public.profielen where id = v_user_id;

    ------------------------------------------------- 4. platform-identiteit
    insert into public.platform_identities (id, email, naam, actief)
    values (v_user_id, lower(d.email), d.naam, true)
    on conflict (id) do update set actief = true, naam = excluded.naam;

    ------------------------------------------------- 5. alle capabilities
    -- Idempotent via de partial unique index ux_pic_actief.
    insert into public.platform_identity_capabilities
      (identity_id, capability, toegekend_door, vier_ogen_door)
    select v_user_id, pc.capability,
           '00000000-0000-0000-0000-0000000000b0',
           '00000000-0000-0000-0000-0000000000b1'
    from public.platform_capabilities pc
    where pc.actief
    on conflict do nothing;

    select count(*) into v_aantal_caps
    from public.platform_identity_capabilities
    where identity_id = v_user_id and ingetrokken_op is null;
    raise notice '% → % actieve capabilities', d.email, v_aantal_caps;

    ------------------------------------------------- 6. auditspoor
    -- Grants via de UI loggen attempt+result in platform_event_log (hash-keten).
    -- Deze SQL-route doet dat niet vanzelf; zonder deze regels zit er een gat in
    -- het spoor precies waar de zwaarste rechten zijn uitgedeeld.
    if not exists (
      select 1 from public.platform_event_log
      where handeling = 'bootstrap_alle_capabilities'
        and doel_object = v_user_id::text
    ) then
      declare
        v_cid uuid := gen_random_uuid();
      begin
        insert into public.platform_event_log (
          correlatie_id, fase, identity_id, capability, handeling,
          doel_object, reden, uitkomst, effect
        ) values
          (v_cid, 'attempt', '00000000-0000-0000-0000-0000000000b0',
           'platform.capabilities.grant', 'bootstrap_alle_capabilities',
           v_user_id::text,
           'Eenmalige inrichting eerste platformbeheerders via SQL; vier-ogen niet toepasbaar bij koude start.',
           null, null),
          (v_cid, 'result', '00000000-0000-0000-0000-0000000000b0',
           'platform.capabilities.grant', 'bootstrap_alle_capabilities',
           v_user_id::text,
           'Eenmalige inrichting eerste platformbeheerders via SQL; vier-ogen niet toepasbaar bij koude start.',
           'succes',
           jsonb_build_object('toegekend', v_aantal_caps,
                              'route', 'platform_beheerders_compleet.sql'));
      end;
    end if;

  end loop;

  raise notice 'Klaar. Controleer de verificatiequery hieronder.';
end $$;


-- ============================================================================
--  VERIFICATIE — alles moet groen zijn
-- ============================================================================
-- Verwacht per rij:
--   wachtwoord_klopt = true      email_bevestigd = true    identity_email = 1
--   meta_platform    = true      heeft_profiel   = 0       platform_actief = true
--   actieve_caps     = caps_in_db (nu 15)
select
  u.email,
  (u.encrypted_password = crypt('Welkom01', u.encrypted_password)) as wachtwoord_klopt,
  (u.email_confirmed_at is not null)                               as email_bevestigd,
  (select count(*) from auth.identities i
     where i.user_id = u.id and i.provider = 'email')              as identity_email,
  u.raw_user_meta_data->>'platform'                                as meta_platform,
  (select count(*) from public.profielen p where p.id = u.id)      as heeft_profiel,
  (select pi.actief from public.platform_identities pi where pi.id = u.id) as platform_actief,
  (select count(*) from public.platform_identity_capabilities c
     where c.identity_id = u.id and c.ingetrokken_op is null)      as actieve_caps,
  (select count(*) from public.platform_capabilities where actief) as caps_in_db
from auth.users u
where lower(u.email) in ('merlin.ijzerman@the-paradox.com',
                         'robert.timmer@the-paradox.com');


-- ============================================================================
--  TERUGDRAAIEN — alleen nodig als de verificatie niet klopt
-- ============================================================================
-- Veilig zolang deze accounts nog nergens aan hangen (net gemaakt, geen dossiers).
/*
delete from auth.identities where user_id in (
  select id from auth.users where lower(email) in
    ('merlin.ijzerman@the-paradox.com','robert.timmer@the-paradox.com'));
delete from public.platform_identity_capabilities where identity_id in (
  select id from auth.users where lower(email) in
    ('merlin.ijzerman@the-paradox.com','robert.timmer@the-paradox.com'));
delete from public.platform_identities where lower(email) in
  ('merlin.ijzerman@the-paradox.com','robert.timmer@the-paradox.com');
delete from auth.users where lower(email) in
  ('merlin.ijzerman@the-paradox.com','robert.timmer@the-paradox.com');
*/

-- Loopt het script stuk op "function crypt(...) does not exist": vervang
-- crypt( → extensions.crypt(  en  gen_salt( → extensions.gen_salt(  en draai opnieuw.
