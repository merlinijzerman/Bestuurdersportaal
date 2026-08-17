-- ============================================================================
--  2026-08-17 — WP1: het fonds komt uit app-metadata, niet uit user-metadata
--
--  BEVINDING (PT-1, Critical zodra zelfregistratie aan staat).
--  `maak_profiel()` haalt het fonds uit `new.raw_user_meta_data->>'fonds_id'`.
--  Dat is exact het veld dat een client zelf vult:
--
--      supabase.auth.signUp({ email, password, options: { data: { fonds_id } } })
--
--  met de PUBLIEKE anon-key. De trigger valideert fail-closed op drie punten —
--  veld aanwezig, geldige UUID, fonds bestaat — maar op geen enkel punt of de
--  aanvrager récht heeft op dat fonds. Hij kán dat ook niet zien: het legitieme
--  back-officepad (auth.admin.createUser) gebruikt hetzelfde veld, dus voor de
--  trigger zijn beide aanvragen identiek.
--
--  De ontbrekende schakel is dicht: `resolve_tenant_host(text)` heeft EXECUTE
--  aan `anon` en geeft op een publieke hostnaam de `fonds_id` terug. En
--  `profielen.fonds_id` is de sleutel waar vrijwel elke RLS-policy op rust.
--
--  Bovendien is `platform: true` — de vlag die bepaalt of een account GEEN
--  tenant-profiel krijgt — nu een privilege-bit in datzelfde client-schrijfbare
--  veld.
--
--  DE GRENS. `raw_app_meta_data` is niet client-schrijfbaar: signUp() vult
--  uitsluitend `raw_user_meta_data`. Alleen de service-role kan app-metadata
--  zetten, en dat pad loopt in deze applicatie achter capability
--  `platform.tenants.manage`, live AAL2 en een twee-fasen-audit. Door het fonds
--  en de platformvlag daarheen te verplaatsen, wordt het onderscheid dat de
--  trigger niet kón maken een eigenschap van het veld zelf.
--
--  BEWUST GEEN TERUGVAL op raw_user_meta_data. Een `coalesce(app, user)` zou de
--  migratie soepel maken en het lek intact laten: een zelfregistratie zonder
--  app-metadata zou dan gewoon door de user-metadata worden bediend. Fail-closed
--  boven beschikbaarheid — een gebruiker die geen profiel krijgt is beter dan een
--  gebruiker in het verkeerde fonds.
--
--  GEVOLGEN, expliciet:
--   • Bestaande accounts worden NIET geraakt: de trigger vuurt alleen bij INSERT
--     op auth.users. Bestaande profielen blijven ongewijzigd. Zie de aparte
--     reconciliatie (scripts/platform_metadata_reconciliatie.sql) voor de
--     vraag wat er met de oude conventie op bestaande accounts moet gebeuren —
--     die inventariseert en promoveert niets.
--   • Elk schrijvend pad moet mee. Zie de migratie-eindnoot.
--   • De volledige §15-checksuite seedt auth.users met raw_user_meta_data en
--     breekt zonder fixture-sweep. Dat is bedoeld gedrag van die tests.
--
--  `naam` blijft uit raw_user_meta_data: dat is presentatie, geen privilege.
--  Wie zijn eigen weergavenaam kiest, kiest daarmee niets over toegang.
--
--  IDEMPOTENT: create or replace.
--  ROLLBACK: 2026_08_17_maak_profiel_app_metadata_ROLLBACK.sql (heropent PT-1).
-- ============================================================================

begin;

create or replace function public.maak_profiel() returns trigger
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  v_fonds_tekst text;
  v_fonds_id    uuid;
begin
  -- 3b-guard (2026-06-23b). Platform-back-officeaccounts krijgen bewust GEEN
  -- tenant-profiel. De vlag staat sinds 17-08-2026 in app-metadata, omdat een
  -- privilege-bit niet in een client-schrijfbaar veld hoort.
  if coalesce(new.raw_app_meta_data->>'platform', '') = 'true' then
    return new;
  end if;

  -- Een platformvlag in USER-metadata is vanaf nu een expliciete weigering, geen
  -- stille no-op. Zou hij worden genegeerd, dan kreeg de aanvrager alsnog een
  -- tenant-profiel op een fonds naar keuze — precies wat hier wordt gesloten.
  if coalesce(new.raw_user_meta_data->>'platform', '') = 'true' then
    raise exception
      'maak_profiel: platform-vlag in user-metadata wordt niet geaccepteerd. Een platformaccount wordt uitsluitend via de back-office aangemaakt (raw_app_meta_data.platform).'
      using errcode = 'check_violation';
  end if;

  -- Het fonds komt UITSLUITEND uit app-metadata. Geen terugval, geen default,
  -- geen limit 1.
  v_fonds_tekst := new.raw_app_meta_data->>'fonds_id';

  -- Fail-closed #1 — geen fonds meegegeven. Dit is óók het pad waarlangs een
  -- zelfregistratie strandt: signUp() kan app-metadata niet zetten.
  if v_fonds_tekst is null or btrim(v_fonds_tekst) = '' then
    raise exception
      'maak_profiel: geen fonds_id in app-metadata. Een tenant-account wordt uitsluitend via de back-office aangemaakt (raw_app_meta_data.fonds_id); zelfregistratie is geen ondersteund pad. Zie decisions/0044.'
      using errcode = 'check_violation';
  end if;

  -- Fail-closed #2 — geen geldige UUID (duidelijke boodschap i.p.v. de kale
  -- cast-fout "invalid input syntax for type uuid").
  begin
    v_fonds_id := v_fonds_tekst::uuid;
  exception
    when others then
      raise exception
        'maak_profiel: fonds_id in app-metadata (%) is geen geldige UUID.', v_fonds_tekst
        using errcode = 'check_violation';
  end;

  -- Fail-closed #3 — geldige UUID, maar het fonds bestaat niet.
  if not exists (select 1 from public.fondsen f where f.id = v_fonds_id) then
    raise exception
      'maak_profiel: fonds_id % bestaat niet in public.fondsen.', v_fonds_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Deterministisch profiel op het expliciet meegegeven fonds.
  -- `naam` blijft uit user-metadata: presentatie, geen privilege.
  insert into public.profielen (id, naam, fonds_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'naam', new.email),
    v_fonds_id
  );
  return new;
end;
$$;

alter function public.maak_profiel() owner to postgres;

-- Grants ongewijzigd t.o.v. 2026_07_31_r7: een triggerfunctie wordt door de
-- trigger aangeroepen, niet door een rol. Hier herhaald zodat een handmatige
-- replay de hygiëne niet stilzwijgend terugdraait.
revoke all on function public.maak_profiel() from public, anon, authenticated;
grant all on function public.maak_profiel() to service_role;

-- ── Fail-closed naverificatie binnen dezelfde transactie ────────────────────
do $$
declare
  v_body text;
begin
  select prosrc into v_body from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'maak_profiel';

  if v_body is null then
    raise exception 'MIGRATIE 2026_08_17 FAALT: maak_profiel bestaat niet na replace.';
  end if;
  if position('raw_app_meta_data->>''fonds_id''' in v_body) = 0 then
    raise exception 'MIGRATIE 2026_08_17 FAALT: fonds_id wordt niet uit raw_app_meta_data gelezen.';
  end if;
  if position('raw_user_meta_data->>''fonds_id''' in v_body) > 0 then
    raise exception 'MIGRATIE 2026_08_17 FAALT: er staat nog een fonds_id-lezing op raw_user_meta_data in de functie.';
  end if;
  raise notice '2026_08_17 OK: maak_profiel leest fonds_id en platform uitsluitend uit app-metadata.';
end $$;

commit;

-- ============================================================================
--  EINDNOOT — schrijvende paden die met deze migratie MEE moeten (WP1-B2).
--  Zonder deze aanpassingen maakt de back-office geen werkende accounts meer:
--
--    app/(platform)/platform/(beveiligd)/gebruikers/acties.ts
--      auth.admin.createUser({ …, app_metadata: { fonds_id } })
--    scripts/platform_bootstrap_beheerders.mjs
--      app_metadata: { platform: true }
--    scripts/platform_beheerders_compleet.sql
--    scripts/platform_bootstrap_beheerders.sql
--    scripts/platform_bootstrap_diagnose.sql
--
--  En de fixture-sweep (WP1-B4) over de 23 checkbestanden die auth.users direct
--  seeden: positieve seeds naar raw_app_meta_data, negatieve cases bewust op
--  raw_user_meta_data laten staan — die bewijzen nu juist de grens.
-- ============================================================================
