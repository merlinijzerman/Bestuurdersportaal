-- ============================================================================
--  ROLLBACK van 2026_09_07_microsoft_login_beleidsmodus.sql (#344 PR-A).
-- ----------------------------------------------------------------------------
--  Zet de fondsconfiguratie en de Auth-hook terug op de F1B-vorm (#335):
--  binaire `actief` + `pilotstatus`, en een hook die niet-oauth-uitgiftes
--  onvoorwaardelijk doorlaat.
--
--  VOLGORDE (blokkerend)
--    1. Rol EERST de PR-A-code terug (of zet elk fonds op `optioneel`/`uit`).
--       Draai je deze rollback terwijl een fonds nog `verplicht` is, dan valt de
--       afdwinging weg en kunnen die gebruikers weer met wachtwoord inloggen.
--    2. Draai dit script.
--
--  DATAVERLIES  De modus zelf, de break-glassuitzonderingen en de openstaande
--    koppel-/herstelsessies verdwijnen. `pilotstatus` wordt deterministisch
--    afgeleid uit `actief` ('actief' of 'uit'); de oorspronkelijke waarde 'pilot'
--    is niet reconstrueerbaar en was nergens in de code geconsumeerd.
--    login_private.audit_log blijft ongemoeid (append-only): de vastgelegde
--    beleidswijzigingen, break-glassgebruik en herkoppelingen blijven bewaard.
-- ============================================================================

begin;

-- ── 1. Hook terug naar de F1B-vorm ──────────────────────────────────────────
create or replace function public.fn_access_token_hook(event jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_user uuid;
  v_oauth boolean;
  v_aantal integer;
  v_provider text; v_sub text; v_tid text; v_oid text;
  v_weiger jsonb := pg_catalog.jsonb_build_object('error', pg_catalog.jsonb_build_object(
    'http_code', 403, 'message', 'Microsoft-login is niet gekoppeld aan dit account.'));
begin
  v_oauth := (event->>'authentication_method') = 'oauth'
          or exists (
               select 1 from pg_catalog.jsonb_array_elements(coalesce(event->'claims'->'amr', '[]'::jsonb)) e
                where coalesce(e->>'method', e #>> '{}') = 'oauth');
  if not v_oauth then
    return event;
  end if;
  v_user := (event->>'user_id')::uuid;
  if v_user is null then return v_weiger; end if;

  select count(*), min(i.provider), min(i.provider_id),
         min(i.identity_data->'custom_claims'->>'tid'), min(i.identity_data->'custom_claims'->>'oid')
    into v_aantal, v_provider, v_sub, v_tid, v_oid
    from auth.identities i
   where i.user_id = v_user and i.provider not in ('email','phone');
  if v_aantal <> 1 or v_provider <> 'azure' or v_sub is null or v_tid is null or v_oid is null then
    return v_weiger;
  end if;
  if login_private.identiteit_toegestaan(v_user, v_sub, v_tid, v_oid) then
    return event;
  end if;
  return v_weiger;
exception when others then
  return pg_catalog.jsonb_build_object('error', pg_catalog.jsonb_build_object(
    'http_code', 403, 'message', 'Microsoft-login kan nu niet worden gecontroleerd.'));
end $$;
revoke all on function public.fn_access_token_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.fn_access_token_hook(jsonb) to supabase_auth_admin;

-- ── 2. Hookhelper voor het wachtwoordpad weg ────────────────────────────────
-- De helper is eigendom van login_hook_owner; alleen die rol mag hem verwijderen.
grant login_hook_owner to postgres;
set local role login_hook_owner;
drop function if exists login_private.wachtwoordlogin_niveau(uuid, boolean, boolean, timestamptz);
drop function if exists login_private.wachtwoordlogin_toegestaan(uuid, boolean);
reset role;
revoke login_hook_owner from postgres;

-- ── 2b. De beperkte portaalrol ontmantelen ──────────────────────────────────
-- De ROL zelf blijft staan (provisioning, net als login_gateway); alleen haar
-- rechten en policy verdwijnen. Zonder de hook wordt de claim toch nooit meer
-- gezet, en een rechtenloze rol is onschadelijk.
drop policy if exists "beperkte sessie leest eigen profiel" on public.profielen;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'portaal_beperkt') then
    execute 'revoke all on public.profielen from portaal_beperkt';
    execute 'revoke usage on schema public from portaal_beperkt';
  end if;
end $$;

-- ── 3. Gatewayfuncties van PR-A weg ─────────────────────────────────────────
drop function if exists login_private.sessiebeleid(uuid);
drop function if exists login_private.breakglass_overzicht(uuid);
drop function if exists login_private.open_breakglass_venster(uuid, integer, text);
drop function if exists login_private.trek_uitnodiging_in(uuid, uuid, uuid, text);
drop function if exists login_private.activeer_uitnodiging(text, uuid, integer, text);
drop function if exists login_private.maak_uitnodiging(uuid, uuid, text, integer, uuid, text);
drop function if exists login_private.trek_break_glass_in(uuid, uuid, uuid, text);
drop function if exists login_private.verleen_break_glass(uuid, uuid, text, uuid, integer, text);
drop function if exists login_private.beheer_intrekking(uuid, uuid, uuid, boolean, text);
drop trigger if exists trg_profiel_fondslock on public.profielen;
drop function if exists public.fn_profiel_fondslock();
drop function if exists login_private.fondslock(uuid);
drop function if exists login_private.dekkingsrapport(uuid);
drop function if exists login_private.zet_modus(uuid, text, uuid, text);
drop function if exists login_private.activering_preflight(uuid);

-- ── 4. Activeringspaden terug naar de F1B-vorm (zonder venstersluiting) ─────
create or replace function login_private.activeer_identiteit(p_id uuid, p_user uuid, p_sub text)
returns boolean
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare r microsoft_identiteiten%rowtype;
begin
  select * into r from microsoft_identiteiten where id = p_id and user_id = p_user and sub = p_sub for update;
  if not found then raise exception 'onbekende_binding' using errcode = 'no_data_found'; end if;
  if r.status = 'active' then return true; end if;
  if r.status <> 'pending' or r.pending_verloopt_op <= now() then
    raise exception 'ongeldige_overgang' using errcode = 'check_violation';
  end if;
  update microsoft_identiteiten set status = 'active', geactiveerd_op = now(), pending_verloopt_op = null where id = p_id;
  insert into audit_log (fonds_id, user_id, gebeurtenis, identiteit_hash, correlatie_id)
  values (r.fonds_id, r.user_id, 'koppelen.geactiveerd', encode(extensions.digest(r.tid || ':' || r.oid, 'sha256'), 'hex'), r.correlatie_id);
  return true;
end $$;

create or replace function login_private.herstel_koppeling(p_id uuid, p_user uuid, p_sub text)
returns boolean
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare r microsoft_identiteiten%rowtype;
begin
  select * into r from microsoft_identiteiten where id = p_id and user_id = p_user and sub = p_sub for update;
  if not found then raise exception 'onbekende_binding' using errcode = 'no_data_found'; end if;
  if r.status = 'active' then return true; end if;
  if r.status <> 'pending' then raise exception 'ongeldige_overgang' using errcode = 'check_violation'; end if;
  update microsoft_identiteiten set status = 'active', geactiveerd_op = now(), pending_verloopt_op = null where id = p_id;
  insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, identiteit_hash, correlatie_id)
  values (r.fonds_id, r.user_id, 'koppelen.hersteld', null, encode(extensions.digest(r.tid || ':' || r.oid, 'sha256'), 'hex'), r.correlatie_id);
  return true;
end $$;

-- ── 4b. start_intrekking terug naar de F1B-vorm (uuid, raise bij fout) ──────
drop function if exists login_private.start_intrekking(uuid, uuid, uuid, text);
create or replace function login_private.start_intrekking(p_fonds uuid, p_user uuid, p_door uuid, p_correlatie text)
returns uuid
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare r microsoft_identiteiten%rowtype;
begin
  select * into r from microsoft_identiteiten
   where user_id = p_user and fonds_id = p_fonds and status in ('active','revoking') for update;
  if not found then raise exception 'onbekende_binding' using errcode = 'no_data_found'; end if;
  if r.status = 'revoking' then return r.id; end if;
  update microsoft_identiteiten
     set status = 'revoking', intrekking_gestart_op = now(), ingetrokken_door = p_door
   where id = r.id;
  insert into audit_log (fonds_id, user_id, gebeurtenis, identiteit_hash, correlatie_id)
  values (r.fonds_id, r.user_id, 'ontkoppelen.gestart', encode(extensions.digest(r.tid || ':' || r.oid, 'sha256'), 'hex'), p_correlatie);
  return r.id;
end $$;
revoke all on function login_private.start_intrekking(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function login_private.start_intrekking(uuid, uuid, uuid, text) to login_gateway;

-- ── 5. Private tabellen van PR-A weg ────────────────────────────────────────
drop table if exists login_private.herkoppel_uitnodigingen;
drop table if exists login_private.break_glass_activeringen;
drop table if exists login_private.break_glass;

-- ── 6. Configuratietabel terug: pilotstatus erbij, modus eraf ───────────────
alter table public.fonds_microsoft_login
  add column if not exists pilotstatus text not null default 'uit';
update public.fonds_microsoft_login set pilotstatus = case when actief then 'actief' else 'uit' end;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fonds_microsoft_login_pilotstatus_check') then
    alter table public.fonds_microsoft_login
      add constraint fonds_microsoft_login_pilotstatus_check
      check (pilotstatus in ('uit','pilot','actief'));
  end if;
end $$;

alter table public.fonds_microsoft_login drop constraint if exists fonds_microsoft_login_modus_spiegelt_actief;
alter table public.fonds_microsoft_login drop constraint if exists fonds_microsoft_login_modus_geldig;
revoke select (modus) on public.fonds_microsoft_login from login_hook_owner;
alter table public.fonds_microsoft_login drop column if exists modus;

drop function if exists login_private.lees_config(uuid);
create or replace function login_private.lees_config(p_fonds uuid)
returns table(actief boolean, entra_tenant_id text, pilotstatus text)
language sql security definer set search_path = login_private, public, pg_temp stable as $$
  select c.actief, c.entra_tenant_id, c.pilotstatus
    from public.fonds_microsoft_login c
   where c.fonds_id = p_fonds
$$;
revoke all on function login_private.lees_config(uuid) from public, anon, authenticated, service_role;
grant execute on function login_private.lees_config(uuid) to login_gateway;

create or replace function public.fn_fonds_microsoft_login_standaard() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  insert into public.fonds_microsoft_login (fonds_id, actief, pilotstatus)
  values (new.id, false, 'uit')
  on conflict (fonds_id) do nothing;
  return new;
end $$;
revoke all on function public.fn_fonds_microsoft_login_standaard() from public, anon, authenticated;

create or replace function public.fn_fonds_microsoft_login_audit() returns trigger
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
begin
  insert into login_private.audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, identiteit_hash, correlatie_id)
  values (
    coalesce(new.fonds_id, old.fonds_id),
    null,
    case tg_op when 'INSERT' then 'config.aangemaakt' when 'UPDATE' then 'config.gewijzigd' else 'config.verwijderd' end,
    case when tg_op = 'DELETE' then null
         else format('actief=%s;pilotstatus=%s;tenant_gezet=%s', new.actief::text, new.pilotstatus, (new.entra_tenant_id is not null)::text) end,
    null,
    'txid:' || txid_current()::text
  );
  return coalesce(new, old);
end $$;
revoke all on function public.fn_fonds_microsoft_login_audit() from public, anon, authenticated, service_role;

commit;
