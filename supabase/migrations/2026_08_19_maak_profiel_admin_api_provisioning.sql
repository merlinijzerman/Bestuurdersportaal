-- ============================================================================
--  2026-08-19 — Auth Admin API provisioning
--
--  Supabase GoTrue does not reliably expose `app_metadata` to an
--  auth.users AFTER INSERT trigger invoked by auth.admin.createUser(). The
--  result is a 500 from /admin/users before the service-role caller can finish
--  provisioning, even though app_metadata is the correct non-client-writable
--  source for fonds_id and platform.
--
--  Keep the security boundary from 2026-08-17, but defer the profile
--  provisioning decision until the service-role app_metadata UPDATE. A public
--  signup may therefore create an Auth user without a tenant profile, but it
--  can never choose a fonds through user metadata and receives no tenant data
--  through RLS. The supported back-office path calls createUser() followed by
--  updateUserById({ app_metadata }), which fires `bij_app_metadata`.
--
--  Direct SQL inserts that already carry app_metadata remain supported through
--  `bij_registratie`; repeated updates are idempotent, but a profile can never
--  silently move to another fonds.
-- ============================================================================

begin;

create or replace function public.maak_profiel() returns trigger
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  v_fonds_tekst text;
  v_fonds_id    uuid;
  v_bestaand    uuid;
begin
  -- Platform-back-officeaccounts krijgen bewust geen tenant-profiel.
  if coalesce(new.raw_app_meta_data->>'platform', '') = 'true' then
    return new;
  end if;

  -- Een privilege-bit in user-metadata blijft expliciet verboden. Dit pad is
  -- client-schrijfbaar via signUp() en mag nooit platformtoegang bepalen.
  if coalesce(new.raw_user_meta_data->>'platform', '') = 'true' then
    raise exception
      'maak_profiel: platform-vlag in user-metadata wordt niet geaccepteerd. Een platformaccount wordt uitsluitend via de back-office aangemaakt (raw_app_meta_data.platform).'
      using errcode = 'check_violation';
  end if;

  -- createUser() kan het app-metadata-veld pas in de daaropvolgende
  -- service-role update beschikbaar maken. Zonder app_metadata blijft het
  -- account bewust profiel-loos en dus tenant-loos.
  v_fonds_tekst := new.raw_app_meta_data->>'fonds_id';
  if v_fonds_tekst is null or btrim(v_fonds_tekst) = '' then
    return new;
  end if;

  begin
    v_fonds_id := v_fonds_tekst::uuid;
  exception
    when others then
      raise exception
        'maak_profiel: fonds_id in app-metadata (%) is geen geldige UUID.', v_fonds_tekst
        using errcode = 'check_violation';
  end;

  if not exists (select 1 from public.fondsen f where f.id = v_fonds_id) then
    raise exception
      'maak_profiel: fonds_id % bestaat niet in public.fondsen.', v_fonds_id
      using errcode = 'foreign_key_violation';
  end if;

  if exists (select 1 from public.profielen p where p.id = new.id) then
    select p.fonds_id into v_bestaand
    from public.profielen p
    where p.id = new.id;
    if v_bestaand is distinct from v_fonds_id then
      raise exception
        'maak_profiel: bestaand profiel kan niet naar een ander fonds worden verplaatst.'
        using errcode = 'check_violation';
    end if;
    return new;
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

drop trigger if exists bij_registratie on auth.users;
create trigger bij_registratie
  after insert on auth.users
  for each row execute function public.maak_profiel();

drop trigger if exists bij_app_metadata on auth.users;
create trigger bij_app_metadata
  after update of raw_app_meta_data on auth.users
  for each row execute function public.maak_profiel();

do $$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth'
      and c.relname = 'users'
      and t.tgname = 'bij_app_metadata'
      and not t.tgisinternal
  ) then
    raise exception 'MIGRATIE 2026_08_19 FAALT: bij_app_metadata ontbreekt.';
  end if;
end $$;

commit;
