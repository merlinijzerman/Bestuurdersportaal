-- ============================================================================
-- Migratie 2026-08-06 — Bootstrap drie demo-fondsen (PGB, PH&C, Huisartsen)
-- ----------------------------------------------------------------------------
-- WAAROM: voor de demo-omgeving worden drie fondsen ingericht waarmee gesprekken
-- lopen. Er is geen fondscreatie-UI (P3 slice A niet gebouwd), dus dit loopt via
-- een migratie. Elk fonds krijgt tegelijk zijn configuratielaag (T8): theming,
-- module-manifest en feature flags, zodat het fonds vanaf de eerste login het
-- zijne is zonder één regel codewijziging.
--
-- ECHTE NAMEN EN HOSTS — BEWUSTE AFWIJKING VAN DE T8-SEED-GUARDRAIL (0135).
--   `2026_07_09_t8_demo_fonds_seed.sql` legt vast: "Bewust FICTIEF: geen echte
--   fondsnaam/host/fonds-id gehardcode". Die guardrail hoort bij een
--   DEMONSTRATIEVE seed (Meridiaan), waar een fictieve naam het punt scherper
--   maakt. Dit is ONBOARDING van echte tenants; dan is een naam functioneel
--   noodzakelijk. Besluit 0135 herziet de reikwijdte expliciet. Fonds-id's
--   blijven wél buiten de repo: verwijzing loopt via `fondsen.slug`.
--
-- STATUTAIRE NAMEN conform het DNB openbaar register (besluit 0135): een
-- bestuurdersportaal spreekt de taal van statuten en jaarverslagen.
--
-- GEEN EIGEN KLEURSTELLING (besluit 0135, aanvulling 06-08-2026).
--   De drie fondsen draaien op het BASISPALET. Herkenning loopt via het logo en
--   de fondsnaam, niet via merkkleuren. Twee redenen:
--     1. Merkkleuren van een fonds overnemen vraagt toestemming en is voor een
--        demo een onnodig risico;
--     2. de bruikbare kleurruimte is smal — `scripts/toets-fondsthema.mjs` eist
--        naast WCAG-contrast een perceptuele afstand ΔE >= 25 tot --ok, --err,
--        --warn en --phase, óók onder gesimuleerde kleurenblindheid. Vrijwel elk
--        warm accent valt daardoor af (bordeaux haalde ΔE 9,3 tegen --ok onder
--        protanopie).
--   In besluit 0135 staan drie getoetste paletten (0 overtredingen, 0
--   waarschuwingen) klaar voor als je later alsnog wilt differentiëren. Wijzig
--   een palet NOOIT zonder de toets opnieuw te draaien:
--       node scripts/toets-fondsthema.mjs themas.json
--
-- LOGO: deze migratie zet `logo-letter` als werkende beginwaarde. Het echte
-- logo komt via `logo-url` zodra de bestanden er zijn — zie het blok onderaan.
-- Twee randvoorwaarden uit de renderlaag (core/components/Sidebar.tsx):
--     • het logo staat in een tegel van 40x40 px met achtergrond --nav-accent
--       (in het basispalet donkerblauw) → gebruik een WIT/monochroom BEELDMERK,
--       geen woordmerk en geen donker logo;
--     • de CSP staat `img-src 'self' data: blob:` toe — een logo van een externe
--       site wordt geblokkeerd. Bestanden horen dus in `public/logos/`.
--
-- MODULES: `stuurinformatie` en `klantbeeld` staan UIT voor alle drie. Beide
-- zijn datagedreven dashboards en er is voor deze fondsen geen stuurinformatie
-- geladen. Een leeg dashboard demonstreert niets en gefingeerde cijfers onder
-- een echte fondsnaam is een reputatierisico. Zet ze aan zodra er data is.
--
-- Idempotent (on conflict do nothing). Transactioneel.
-- ROLLBACK: 2026_08_06_demo_fondsen_bootstrap_ROLLBACK.sql
-- TENANT-IMPACT: additief. Voegt drie geïsoleerde fondsen toe; raakt Horizon en
-- Meridiaan niet. Er worden GEEN auth-gebruikers geseed (auth-schema) —
-- demo-logins provisioneer je via /platform/gebruikers.
-- VOLGORDE: deze migratie eerst, DAARNA 2026_08_06_tenant_domains_demo_fondsen
-- (die heeft een foreign key naar fondsen en inserteert anders stil niets).
-- ============================================================================

begin;

-- ── 1. De drie fondsen ──────────────────────────────────────────────────────
-- Slug = het subdomein, zodat host en fonds herleidbaar bij elkaar horen.
insert into public.fondsen (naam, slug) values
  ('Stichting Pensioenfonds PGB',                'pgb'),
  ('Stichting Pensioenfonds Horeca & Catering',  'phenc'),
  ('Stichting Pensioenfonds voor Huisartsen',    'huisartsenpensioen')
on conflict (slug) do nothing;

-- ── 2. Theming: alléén de logoletter, basispalet blijft staan ───────────────
-- Bewust geen kleuroverrides (zie kop). `logo-letter` accepteert 1–2
-- alfanumerieke tekens (LETTER_PATROON in lib/fonds-config-core.ts).
insert into public.fonds_theming (fonds_id, tokens, versie)
select f.id, jsonb_build_object('logo-letter', l.letter), 1
  from public.fondsen f
  join (values
          ('pgb',                'P'),
          ('phenc',              'HC'),
          ('huisartsenpensioen', 'HA')
       ) as l(slug, letter) on l.slug = f.slug
 on conflict (fonds_id) do nothing;

-- ── 3. Module-manifest: datagedreven dashboards uit ─────────────────────────
-- module_key moet bestaan in de code-registry (lib/module-registry.ts);
-- onbekende keys zijn niet beschikbaar en worden genegeerd.
insert into public.fonds_module_manifest (fonds_id, module_key, actief, versie)
select f.id, m.module_key, false, 1
  from public.fondsen f
  cross join (values ('stuurinformatie'), ('klantbeeld')) as m(module_key)
 where f.slug in ('pgb', 'phenc', 'huisartsenpensioen')
 on conflict (fonds_id, module_key) do nothing;

-- ── 4. Feature flags ────────────────────────────────────────────────────────
-- Hybride zoeken aan: de demo draait op publieke fondsdocumenten met veel
-- jargon, waar de combinatie van tekst- en vectorzoeken het meeste verschil maakt.
insert into public.fonds_feature_flags (fonds_id, flag_key, waarde, versie)
select f.id, 'hybride_zoeken', to_jsonb(true), 1
  from public.fondsen f
 where f.slug in ('pgb', 'phenc', 'huisartsenpensioen')
 on conflict (fonds_id, flag_key) do nothing;

commit;

-- ============================================================================
-- CONTROLE — draai dit na afloop.
-- Verwacht: drie rijen, elk met heeft_thema = true, modules_uit = 2, flags = 1.
-- ============================================================================
-- select f.slug, f.naam,
--        (t.fonds_id is not null)                       as heeft_thema,
--        t.tokens ->> 'logo-letter'                     as logoletter,
--        t.tokens ->> 'logo-url'                        as logourl,
--        (select count(*) from public.fonds_module_manifest m
--          where m.fonds_id = f.id and m.actief = false) as modules_uit,
--        (select count(*) from public.fonds_feature_flags v
--          where v.fonds_id = f.id)                      as flags
--   from public.fondsen f
--   left join public.fonds_theming t on t.fonds_id = f.id
--  where f.slug in ('pgb','phenc','huisartsenpensioen')
--  order by f.slug;

-- ============================================================================
-- VERVOLGSTAP — logo aanzetten zodra de bestanden in de repo staan.
-- ----------------------------------------------------------------------------
-- Voorwaarde: `public/logos/<slug>.svg` (of .png) bestaat en is gedeployed.
-- Gebruik een WIT/monochroom BEELDMERK — de tegel is 40x40 px met een donkere
-- achtergrond, dus een donker of breed woordmerk wordt onleesbaar.
--
-- Dit is een UPDATE, geen insert: de theming-rij bestaat al. De jsonb-merge (||)
-- laat `logo-letter` staan, zodat je met één statement terug kunt.
-- De AFTER-trigger fn_fonds_config_capture legt de wijziging vast in
-- fonds_config_log (append-only) — verhoog daarom ook `versie`.
--
-- update public.fonds_theming t
--    set tokens = t.tokens || jsonb_build_object('logo-url', l.url),
--        versie = t.versie + 1
--   from public.fondsen f
--   join (values
--           ('pgb',                '/logos/pgb.svg'),
--           ('phenc',              '/logos/phenc.svg'),
--           ('huisartsenpensioen', '/logos/huisartsenpensioen.svg')
--        ) as l(slug, url) on l.slug = f.slug
--  where t.fonds_id = f.id;
--
-- TERUGDRAAIEN (logo weer weg, letter blijft):
-- update public.fonds_theming t
--    set tokens = t.tokens - 'logo-url',
--        versie = t.versie + 1
--   from public.fondsen f
--  where t.fonds_id = f.id
--    and f.slug in ('pgb','phenc','huisartsenpensioen');
-- ============================================================================
