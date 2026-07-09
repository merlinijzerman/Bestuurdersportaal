-- ============================================================================
-- Migratie 2026-07-09 — T8: DEMO-seed tweede fonds (differentiatie-aantoning)
-- ----------------------------------------------------------------------------
-- WAAROM: acceptatiecriterium 1 vraagt aan te tonen dat twee fondsen op DEZELFDE
-- codebase zichtbaar verschillen (ander thema + andere actieve modules) puur via
-- configuratie. Deze migratie seedt een FICTIEF tweede fonds ("Stichting
-- Demofonds Meridiaan") met een afwijkend thema, een afwijkend module-manifest en
-- een afwijkende feature flag. Zo is de config-laag zonder code-wijziging aan te
-- tonen.
--
-- Dit is NIET de echte PGB-onboarding (dat is T12/onboarding + het maak_profiel()-
-- determinisme). Bewust FICTIEF: geen echte fondsnaam/host/fonds-id gehardcode
-- (guardrail). De fonds_id wordt door de DB gegenereerd; config-rijen refereren
-- via de slug. Verwijder deze seed vóór productie/echte-fonds-onboarding met de
-- bijbehorende ROLLBACK.
--
-- Idempotent (on conflict do nothing). Afhankelijk van 2026_07_09_t8_config_manifestlaag.sql.
-- ROLLBACK: 2026_07_09_t8_demo_fonds_seed_ROLLBACK.sql
-- TENANT-IMPACT: voegt een geïsoleerd demo-fonds toe; raakt Horizon niet. Er
-- worden GEEN auth-gebruikers geseed (auth-schema); een demo-login moet apart
-- worden geprovisioneerd.
-- ============================================================================

begin;

-- 1. Fictief tweede fonds (via slug; DB genereert de id).
insert into public.fondsen (naam, slug)
values ('Stichting Demofonds Meridiaan', 'meridiaan')
on conflict (slug) do nothing;

-- 2. Afwijkend thema (warm terracotta-accent + groenere nav i.p.v. Horizon-navy).
--    Alleen allowlist-tokens (RGB-channel-triples / logo-referentie). Zie
--    lib/fonds-config.ts:THEMABARE_TOKENS.
insert into public.fonds_theming (fonds_id, tokens, versie)
select f.id,
       jsonb_build_object(
         'accent-rgb',      '176 84 52',    -- terracotta
         'accent-ink-rgb',  '138 62 36',
         'accent-tint-rgb', '244 232 226',
         'nav-rgb',         '30 58 47',      -- diep groen
         'nav-accent-rgb',  '96 150 118',
         'logo-letter',     'M'
       ),
       1
  from public.fondsen f
 where f.slug = 'meridiaan'
 on conflict (fonds_id) do nothing;

-- 3. Afwijkend module-manifest: Meridiaan heeft (als voorbeeld) géén Klantbeeld
--    en géén Risicomatrix. Overige modules vallen terug op registry.defaultActief.
insert into public.fonds_module_manifest (fonds_id, module_key, actief, versie)
select f.id, m.module_key, false, 1
  from public.fondsen f
  cross join (values ('klantbeeld'), ('risicomatrix')) as m(module_key)
 where f.slug = 'meridiaan'
 on conflict (fonds_id, module_key) do nothing;

-- 4. Afwijkende feature flag: hybride zoeken AAN voor Meridiaan (Horizon =
--    env-default). Toont dat een flag per fonds data-gedreven verschilt.
insert into public.fonds_feature_flags (fonds_id, flag_key, waarde, versie)
select f.id, 'hybride_zoeken', to_jsonb(true), 1
  from public.fondsen f
 where f.slug = 'meridiaan'
 on conflict (fonds_id, flag_key) do nothing;

commit;
