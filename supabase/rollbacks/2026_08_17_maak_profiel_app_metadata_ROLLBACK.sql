-- ============================================================================
--  ROLLBACK 2026-08-17 — WP1: fonds uit app-metadata
--
--  ⚠️ LET OP — DIT HEROPENT EEN CRITICAL.
--
--  Deze rollback zet `maak_profiel()` terug op `raw_user_meta_data`. Daarmee
--  bepaalt de aanvrager zelf weer op welk fonds zijn profiel landt, want dat is
--  precies het veld dat `supabase.auth.signUp({ options: { data } })` vult met
--  de publieke anon-key. In combinatie met `resolve_tenant_host` (EXECUTE aan
--  anon, geeft een geldig fonds_id terug op een publieke hostnaam) is dat een
--  ongeauthenticeerde tenant-takeover zodra zelfregistratie in het Supabase-
--  dashboard aan staat.
--
--  Draai dit ALLEEN als:
--    (a) is vastgesteld dat "Allow new users to sign up" uit staat in ELKE
--        omgeving waar deze rollback landt, én
--    (b) er een einddatum op staat waarop de forward-migratie terugkomt.
--
--  Ook dan blijft de grens hangen aan één dashboardinstelling die nergens
--  geautomatiseerd wordt getoetst — de reden dat WP1 bestond.
--
--  De check supabase/checks/2026_07_08_maak_profiel_deterministisch.sql wordt
--  hierna rood op de app-metadata-cases. Dat is correct gedrag van de check.
--
--  NB Dit herstelt ook de platformvlag naar user-metadata. Draai je de rollback,
--  draai dan ook de bijbehorende codewijzigingen terug (gebruikers/acties.ts en
--  de vier bootstrapscripts), anders maakt de back-office accounts die geen
--  profiel meer krijgen.
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
  if coalesce(new.raw_user_meta_data->>'platform', '') = 'true' then
    return new;
  end if;

  v_fonds_tekst := new.raw_user_meta_data->>'fonds_id';

  if v_fonds_tekst is null or btrim(v_fonds_tekst) = '' then
    raise exception
      'maak_profiel: geen fonds_id in user-metadata. Een tenant-account vereist een expliciet fonds (raw_user_meta_data.fonds_id); er is bewust geen default/eerste-fonds. Zie decisions/0044.'
      using errcode = 'check_violation';
  end if;

  begin
    v_fonds_id := v_fonds_tekst::uuid;
  exception
    when others then
      raise exception
        'maak_profiel: fonds_id in user-metadata (%) is geen geldige UUID.', v_fonds_tekst
        using errcode = 'check_violation';
  end;

  if not exists (select 1 from public.fondsen f where f.id = v_fonds_id) then
    raise exception
      'maak_profiel: fonds_id % bestaat niet in public.fondsen.', v_fonds_id
      using errcode = 'foreign_key_violation';
  end if;

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
revoke all on function public.maak_profiel() from public, anon, authenticated;
grant all on function public.maak_profiel() to service_role;

commit;
