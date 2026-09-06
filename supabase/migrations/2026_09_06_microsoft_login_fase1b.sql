-- ============================================================================
--  Microsoft-login fase 1B — datamodel, rechtenmodel en Auth-hook (#335, T1/PR-A)
-- ----------------------------------------------------------------------------
--  WAAROM (besluit 0211, ontwerp MICROSOFT-365-LOGIN-F1B-ONTWERP.md)
--    Een Microsoft-identiteit wordt uitsluitend expliciet aan een BESTAAND
--    Supabase-account gekoppeld (zelfde user-UUID). Autorisatie steunt op een
--    private binding fonds_id + user_id + tid + oid, die door een Custom Access
--    Token Hook op de EXACTE identiteit wordt afgedwongen vóór elke tokenuitgifte
--    (ook refresh). Een e-mailadres is nergens sleutel.
--
--  WAT WEL
--    * public.fonds_microsoft_login — fondsconfiguratie, standaard UIT; alleen
--      via migratie/gecontroleerde SQL schrijfbaar (geen schrijfpolicies);
--      wijzigingen worden append-only in login_private.audit_log vastgelegd;
--    * privaat schema login_private met:
--        microsoft_identiteiten — bindingen met toestandsmodel
--                                 pending → active → revoking → revoked | failed;
--        oauth_transacties      — eenmalige, versleutelde flowtransacties (T2);
--        audit_log              — append-only, inhoudsvrij;
--    * SECURITY DEFINER-gatewayfuncties die UITSLUITEND de minimale loginrol
--      login_gateway mag uitvoeren (patroon microsoft_vault / ai_gateway);
--    * de hookhelper login_private.identiteit_toegestaan — de enige verhoogde
--      functie in het hookpad; eigenaar = NOLOGIN-rol login_hook_owner met alleen
--      SELECT op de bindingstabel (RLS-policy) en search_path '';
--    * public.fn_access_token_hook — SECURITY INVOKER, draait als
--      supabase_auth_admin, leest auth.identities binnen de GoTrue-transactie.
--
--  WAT NIET
--    * geen browser-bereikbare functie: anon, authenticated en service_role
--      hebben nul rechten in login_private en kunnen de hook niet uitvoeren;
--    * geen loginroutes, callback, UI of linkIdentity-orchestratie (T2);
--    * geen activering: de hook wordt hier NIET in het Supabase-project
--      ingeschakeld (dashboard/Management API, runbook F1B) en geen enkel fonds
--      krijgt actief = true.
--
--  RLS-IMPACT   deny-by-default op alle private tabellen (RLS aan, alle rechten
--               gerevoked; één select-policy voor login_hook_owner). Publieke
--               configtabel: select eigen fonds voor authenticated, verder niets.
--  GATE-IMPACT  publiek: fonds_microsoft_login (REL), fn_fonds_microsoft_login_standaard,
--               fn_fonds_microsoft_login_audit en fn_access_token_hook (FUNC) — allen
--               in allowlist-grants.tsv; login_private valt buiten V3 en wordt door
--               supabase/checks/2026_09_06_microsoft_login_fase1b.sql getoetst.
--  VOLGORDE     1. rollen login_gateway (login) en login_hook_owner (nologin)
--               provisionen (security/MICROSOFT-365-F1B-RUNBOOK.md); 2. deze
--               migratie; 3. de suite; 4. pas in T3: hook inschakelen, Azure-
--               provider, jwt_expiry en fondsflag. Zonder hook zijn de tabellen inert.
--  IDEMPOTENT   create … if not exists / or replace / drop … if exists / on conflict.
--  ROLLBACK     ../rollbacks/2026_09_06_microsoft_login_fase1b_ROLLBACK.sql
-- ============================================================================

begin;

-- ── 0. Rol-grendel ───────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'login_gateway' and rolcanlogin) then
    raise exception 'login_gateway-login ontbreekt; provision deze volgens security/MICROSOFT-365-F1B-RUNBOOK.md vóór de migratie';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'login_hook_owner' and not rolcanlogin) then
    raise exception 'login_hook_owner (NOLOGIN) ontbreekt; provision deze volgens security/MICROSOFT-365-F1B-RUNBOOK.md vóór de migratie';
  end if;
end $$;

-- ── 1. Privaat schema ────────────────────────────────────────────────────────
create schema if not exists login_private;
revoke all on schema login_private from public, anon, authenticated, service_role;

-- ── 2. Publieke fondsconfiguratie (standaard uit) ───────────────────────────
create table if not exists public.fonds_microsoft_login (
  fonds_id        uuid primary key references public.fondsen(id) on delete cascade,
  actief          boolean not null default false,
  entra_tenant_id text,
  pilotstatus     text not null default 'uit' check (pilotstatus in ('uit','pilot','actief')),
  bijgewerkt      timestamptz not null default now(),
  -- actief vereist een toegestane tenant: fail-closed bij ontbrekende configuratie.
  constraint fonds_microsoft_login_actief_vereist_tenant
    check (not actief or (entra_tenant_id is not null and entra_tenant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
);
comment on table public.fonds_microsoft_login is
  'Microsoft-login fase 1B (#335, besluit 0211): per fonds standaard uit; alleen via migratie/gecontroleerde SQL schrijfbaar.';

insert into public.fonds_microsoft_login (fonds_id, actief, pilotstatus)
select id, false, 'uit' from public.fondsen
on conflict (fonds_id) do nothing;

create or replace function public.fn_fonds_microsoft_login_standaard() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  insert into public.fonds_microsoft_login (fonds_id, actief, pilotstatus)
  values (new.id, false, 'uit')
  on conflict (fonds_id) do nothing;
  return new;
end $$;
revoke all on function public.fn_fonds_microsoft_login_standaard() from public, anon, authenticated;
drop trigger if exists trg_fonds_microsoft_login_standaard on public.fondsen;
create trigger trg_fonds_microsoft_login_standaard
  after insert on public.fondsen for each row execute function public.fn_fonds_microsoft_login_standaard();

alter table public.fonds_microsoft_login enable row level security;
revoke all on public.fonds_microsoft_login from public, anon, authenticated;
grant select on public.fonds_microsoft_login to authenticated;
drop policy if exists "microsoft login config lezen eigen fonds" on public.fonds_microsoft_login;
create policy "microsoft login config lezen eigen fonds" on public.fonds_microsoft_login
  for select to authenticated
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- ── 3. Private tabellen ──────────────────────────────────────────────────────
create table if not exists login_private.microsoft_identiteiten (
  id                    uuid primary key default gen_random_uuid(),
  fonds_id              uuid not null references public.fondsen(id),
  user_id               uuid not null references auth.users(id) on delete cascade,
  tid                   text not null,
  oid                   text not null,
  sub                   text not null,
  status                text not null check (status in ('pending','active','revoking','revoked','failed')),
  pending_verloopt_op   timestamptz,
  gekoppeld_door        uuid not null,
  gereserveerd_op       timestamptz not null default now(),
  geactiveerd_op        timestamptz,
  laatst_gebruikt_op    timestamptz,
  intrekking_gestart_op timestamptz,
  ingetrokken_op        timestamptz,
  ingetrokken_door      uuid,
  foutcategorie         text,
  correlatie_id         text not null,
  constraint microsoft_identiteiten_pending_vereist_vervaltijd
    check (status <> 'pending' or pending_verloopt_op is not null),
  constraint microsoft_identiteiten_geen_lege_sleutels
    check (length(tid) > 0 and length(oid) > 0 and length(sub) > 0)
);
-- Eén levende binding per identiteit en per account, over alle fondsen heen.
-- Verlopen pending-rijen worden bij elke reservering eerst naar failed gezet,
-- zodat het predicaat zonder now() kan (partial-indexpredicaten moeten immutable zijn).
create unique index if not exists microsoft_identiteiten_levend_per_identiteit
  on login_private.microsoft_identiteiten (tid, oid)
  where status in ('pending','active','revoking');
create unique index if not exists microsoft_identiteiten_levend_per_account
  on login_private.microsoft_identiteiten (user_id)
  where status in ('pending','active','revoking');
create index if not exists microsoft_identiteiten_fonds_idx
  on login_private.microsoft_identiteiten (fonds_id);

create table if not exists login_private.oauth_transacties (
  state_hash     text primary key,
  fonds_id       uuid not null references public.fondsen(id),
  user_id        uuid references auth.users(id) on delete cascade,   -- null bij inloggen
  intent         text not null check (intent in ('koppelen','inloggen')),
  verloopt_op    timestamptz not null,
  gebruikt_op    timestamptz,
  sleutel_versie integer not null,
  iv             text not null,
  tag            text not null,
  ciphertext     text not null,
  aad            text not null,
  constraint oauth_transacties_koppelen_vereist_user
    check (intent <> 'koppelen' or user_id is not null)
);

create table if not exists login_private.audit_log (
  id              uuid primary key default gen_random_uuid(),
  fonds_id        uuid not null,
  user_id         uuid,
  gebeurtenis     text not null,
  foutcategorie   text,
  identiteit_hash text,
  correlatie_id   text not null,
  aangemaakt      timestamptz not null default now()
);

-- Append-only: update/delete is voor iedere rol geblokkeerd (ook de eigenaar).
create or replace function login_private.fn_audit_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'login_private.audit_log is append-only (%)', tg_op using errcode = 'insufficient_privilege';
end $$;
drop trigger if exists trg_login_audit_no_update on login_private.audit_log;
create trigger trg_login_audit_no_update before update on login_private.audit_log
  for each row execute function login_private.fn_audit_append_only();
drop trigger if exists trg_login_audit_no_delete on login_private.audit_log;
create trigger trg_login_audit_no_delete before delete on login_private.audit_log
  for each row execute function login_private.fn_audit_append_only();

alter table login_private.microsoft_identiteiten enable row level security;
alter table login_private.oauth_transacties      enable row level security;
alter table login_private.audit_log              enable row level security;

-- ── 4. Config-audit: elke wijziging aan de fondsconfiguratie in het private log ──
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
drop trigger if exists trg_fonds_microsoft_login_audit on public.fonds_microsoft_login;
create trigger trg_fonds_microsoft_login_audit
  after insert or update or delete on public.fonds_microsoft_login
  for each row execute function public.fn_fonds_microsoft_login_audit();

-- ── 5. Gatewayfuncties (execute uitsluitend login_gateway) ──────────────────
-- Foutcategorieën komen als message terug (geen inhoud): fonds_mismatch,
-- binding_conflict, ongeldige_overgang, onbekende_binding.

create or replace function login_private.lees_config(p_fonds uuid)
returns table(actief boolean, entra_tenant_id text, pilotstatus text)
language sql security definer set search_path = login_private, public, pg_temp stable as $$
  select c.actief, c.entra_tenant_id, c.pilotstatus
    from public.fonds_microsoft_login c
   where c.fonds_id = p_fonds
$$;

create or replace function login_private.verval_verlopen_reserveringen()
returns integer
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare v_n integer;
begin
  with verlopen as (
    update microsoft_identiteiten
       set status = 'failed', foutcategorie = 'pending_verlopen'
     where status = 'pending' and pending_verloopt_op <= now()
    returning fonds_id, user_id, correlatie_id, tid, oid
  )
  insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, identiteit_hash, correlatie_id)
  select fonds_id, user_id, 'koppelen.mislukt', 'pending_verlopen', encode(extensions.digest(tid || ':' || oid, 'sha256'), 'hex'), correlatie_id
    from verlopen;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Geeft (id, categorie) terug in plaats van te raisen: een auditregel in een
-- functie die daarna een exception werpt, verdwijnt met de subtransactie. Zo
-- blijft een fondsmismatch of bindingsconflict áltijd in de audit staan.
drop function if exists login_private.reserveer_identiteit(uuid, uuid, text, text, text, text);
create or replace function login_private.reserveer_identiteit(
  p_fonds uuid, p_user uuid, p_tid text, p_oid text, p_sub text, p_correlatie text
) returns table(id uuid, categorie text)
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare v_id uuid; v_hash text;
begin
  v_hash := encode(extensions.digest(p_tid || ':' || p_oid, 'sha256'), 'hex');
  -- Fondsconsistentie is een DB-invariant: de binding hoort bij het fonds van het profiel.
  if not exists (select 1 from public.profielen p where p.id = p_user and p.fonds_id = p_fonds) then
    insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, identiteit_hash, correlatie_id)
    values (p_fonds, p_user, 'koppelen.mislukt', 'fonds_mismatch', v_hash, p_correlatie);
    return query select null::uuid, 'fonds_mismatch'::text; return;
  end if;
  perform verval_verlopen_reserveringen();
  begin
    insert into microsoft_identiteiten (fonds_id, user_id, tid, oid, sub, status, pending_verloopt_op, gekoppeld_door, correlatie_id)
    values (p_fonds, p_user, p_tid, p_oid, p_sub, 'pending', now() + interval '10 minutes', p_user, p_correlatie)
    returning microsoft_identiteiten.id into v_id;
  exception when unique_violation then
    insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, identiteit_hash, correlatie_id)
    values (p_fonds, p_user, 'koppelen.mislukt', 'binding_conflict', v_hash, p_correlatie);
    return query select null::uuid, 'binding_conflict'::text; return;
  end;
  insert into audit_log (fonds_id, user_id, gebeurtenis, identiteit_hash, correlatie_id)
  values (p_fonds, p_user, 'koppelen.gereserveerd', v_hash, p_correlatie);
  return query select v_id, null::text;
end $$;

create or replace function login_private.activeer_identiteit(p_id uuid, p_user uuid, p_sub text)
returns boolean
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare r microsoft_identiteiten%rowtype;
begin
  select * into r from microsoft_identiteiten where id = p_id and user_id = p_user and sub = p_sub for update;
  if not found then raise exception 'onbekende_binding' using errcode = 'no_data_found'; end if;
  if r.status = 'active' then return true; end if;                 -- idempotent
  if r.status <> 'pending' or r.pending_verloopt_op <= now() then
    raise exception 'ongeldige_overgang' using errcode = 'check_violation';
  end if;
  update microsoft_identiteiten set status = 'active', geactiveerd_op = now(), pending_verloopt_op = null where id = p_id;
  insert into audit_log (fonds_id, user_id, gebeurtenis, identiteit_hash, correlatie_id)
  values (r.fonds_id, r.user_id, 'koppelen.geactiveerd', encode(extensions.digest(r.tid || ':' || r.oid, 'sha256'), 'hex'), r.correlatie_id);
  return true;
end $$;

-- Idempotente herstelroute na een crash tussen linkIdentity en activeren: de
-- app heeft geverifieerd dat de Supabase-identiteit (provider_id = sub) bestaat
-- voor deze gebruiker; een verlopen pending mag dan alsnog worden geactiveerd.
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

create or replace function login_private.markeer_mislukt(p_id uuid, p_user uuid, p_categorie text)
returns void
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare r microsoft_identiteiten%rowtype;
begin
  select * into r from microsoft_identiteiten where id = p_id and user_id = p_user for update;
  if not found then raise exception 'onbekende_binding' using errcode = 'no_data_found'; end if;
  if r.status <> 'pending' then raise exception 'ongeldige_overgang' using errcode = 'check_violation'; end if;
  update microsoft_identiteiten set status = 'failed', foutcategorie = p_categorie, pending_verloopt_op = null where id = p_id;
  insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, identiteit_hash, correlatie_id)
  values (r.fonds_id, r.user_id, 'koppelen.mislukt', p_categorie, encode(extensions.digest(r.tid || ':' || r.oid, 'sha256'), 'hex'), r.correlatie_id);
end $$;

create or replace function login_private.start_intrekking(p_fonds uuid, p_user uuid, p_door uuid, p_correlatie text)
returns uuid
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare r microsoft_identiteiten%rowtype;
begin
  select * into r from microsoft_identiteiten
   where user_id = p_user and fonds_id = p_fonds and status in ('active','revoking') for update;
  if not found then raise exception 'onbekende_binding' using errcode = 'no_data_found'; end if;
  if r.status = 'revoking' then return r.id; end if;              -- idempotent
  update microsoft_identiteiten
     set status = 'revoking', intrekking_gestart_op = now(), ingetrokken_door = p_door
   where id = r.id;
  insert into audit_log (fonds_id, user_id, gebeurtenis, identiteit_hash, correlatie_id)
  values (r.fonds_id, r.user_id, 'ontkoppelen.gestart', encode(extensions.digest(r.tid || ':' || r.oid, 'sha256'), 'hex'), p_correlatie);
  return r.id;
end $$;

create or replace function login_private.voltooi_intrekking(p_id uuid, p_user uuid, p_correlatie text)
returns void
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare r microsoft_identiteiten%rowtype;
begin
  select * into r from microsoft_identiteiten where id = p_id and user_id = p_user for update;
  if not found then raise exception 'onbekende_binding' using errcode = 'no_data_found'; end if;
  if r.status = 'revoked' then return; end if;                    -- idempotent
  if r.status <> 'revoking' then raise exception 'ongeldige_overgang' using errcode = 'check_violation'; end if;
  update microsoft_identiteiten set status = 'revoked', ingetrokken_op = now() where id = p_id;
  insert into audit_log (fonds_id, user_id, gebeurtenis, identiteit_hash, correlatie_id)
  values (r.fonds_id, r.user_id, 'ontkoppelen.voltooid', encode(extensions.digest(r.tid || ':' || r.oid, 'sha256'), 'hex'), p_correlatie);
end $$;

create or replace function login_private.zoek_identiteit(p_tid text, p_oid text)
returns table(id uuid, user_id uuid, fonds_id uuid)
language sql security definer set search_path = login_private, public, pg_temp stable as $$
  select b.id, b.user_id, b.fonds_id
    from microsoft_identiteiten b
   where b.tid = p_tid and b.oid = p_oid and b.status = 'active'
$$;

create or replace function login_private.levende_binding(p_user uuid)
returns table(id uuid, fonds_id uuid, status text, pending_verloopt_op timestamptz, geactiveerd_op timestamptz, laatst_gebruikt_op timestamptz)
language sql security definer set search_path = login_private, public, pg_temp stable as $$
  select b.id, b.fonds_id, b.status, b.pending_verloopt_op, b.geactiveerd_op, b.laatst_gebruikt_op
    from microsoft_identiteiten b
   where b.user_id = p_user and b.status in ('pending','active','revoking')
$$;

create or replace function login_private.markeer_gebruikt(p_id uuid)
returns void
language sql security definer set search_path = login_private, public, pg_temp as $$
  update microsoft_identiteiten set laatst_gebruikt_op = now() where id = p_id and status = 'active'
$$;

create or replace function login_private.maak_transactie(
  p_state_hash text, p_fonds uuid, p_user uuid, p_intent text, p_verloopt timestamptz,
  p_sleutel integer, p_iv text, p_tag text, p_cipher text, p_aad text
) returns void
language sql security definer set search_path = login_private, public, pg_temp as $$
  insert into oauth_transacties (state_hash, fonds_id, user_id, intent, verloopt_op, gebruikt_op, sleutel_versie, iv, tag, ciphertext, aad)
  values (p_state_hash, p_fonds, p_user, p_intent, p_verloopt, null, p_sleutel, p_iv, p_tag, p_cipher, p_aad)
$$;

create or replace function login_private.consumeer_transactie(p_state_hash text)
returns table(fonds_id uuid, user_id uuid, intent text, sleutel_versie integer, iv text, tag text, ciphertext text, aad text)
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
begin
  return query
    update oauth_transacties t
       set gebruikt_op = now()
     where t.state_hash = p_state_hash and t.gebruikt_op is null and t.verloopt_op > now()
    returning t.fonds_id, t.user_id, t.intent, t.sleutel_versie, t.iv, t.tag, t.ciphertext, t.aad;
end $$;

create or replace function login_private.registreer_gebeurtenis(
  p_fonds uuid, p_user uuid, p_gebeurtenis text, p_fout text, p_identiteit_hash text, p_correlatie text
) returns void
language sql security definer set search_path = login_private, public, pg_temp as $$
  insert into audit_log (fonds_id, user_id, gebeurtenis, foutcategorie, identiteit_hash, correlatie_id)
  values (p_fonds, p_user, p_gebeurtenis, p_fout, p_identiteit_hash, p_correlatie)
$$;

-- ── 6. Rechten gateway: alles dicht, dan gericht open ───────────────────────
-- Bij een herhaalde run bestaat de helper al met eigenaar login_hook_owner; de
-- schema-brede revoke hieronder raakt hem alleen als postgres tijdelijk (met
-- INHERIT) lid is. De rol heeft door CREATE ROLE al een impliciet ADMIN-lidmaat-
-- schap zonder INHERIT/SET (PG16); dat is permanent en onschadelijk. Het
-- expliciete lidmaatschap wordt aan het eind van stap 7 weer ingetrokken.
grant login_hook_owner to postgres;
revoke all on all tables    in schema login_private from public, anon, authenticated, service_role;
revoke all on all functions in schema login_private from public, anon, authenticated, service_role;
alter default privileges in schema login_private revoke all on tables    from public, anon, authenticated, service_role;
alter default privileges in schema login_private revoke all on functions from public, anon, authenticated, service_role;


grant usage on schema login_private to login_gateway;
grant execute on function login_private.lees_config(uuid)                                                  to login_gateway;
grant execute on function login_private.reserveer_identiteit(uuid, uuid, text, text, text, text)           to login_gateway;
grant execute on function login_private.activeer_identiteit(uuid, uuid, text)                              to login_gateway;
grant execute on function login_private.herstel_koppeling(uuid, uuid, text)                                to login_gateway;
grant execute on function login_private.markeer_mislukt(uuid, uuid, text)                                  to login_gateway;
grant execute on function login_private.start_intrekking(uuid, uuid, uuid, text)                           to login_gateway;
grant execute on function login_private.voltooi_intrekking(uuid, uuid, text)                               to login_gateway;
grant execute on function login_private.zoek_identiteit(text, text)                                        to login_gateway;
grant execute on function login_private.levende_binding(uuid)                                              to login_gateway;
grant execute on function login_private.markeer_gebruikt(uuid)                                             to login_gateway;
grant execute on function login_private.maak_transactie(text, uuid, uuid, text, timestamptz, integer, text, text, text, text) to login_gateway;
grant execute on function login_private.consumeer_transactie(text)                                         to login_gateway;
grant execute on function login_private.registreer_gebeurtenis(uuid, uuid, text, text, text, text)         to login_gateway;
-- Bewust NIET voor login_gateway: verval_verlopen_reserveringen (intern), fn_audit_append_only (trigger),
-- identiteit_toegestaan (alleen de hook).


-- ── 7. Hookhelper: de enige verhoogde functie in het hookpad ─────────────────
-- De helper wordt AANGEMAAKT ALS login_hook_owner (tijdelijk lidmaatschap + CREATE
-- op het schema; beide direct weer ingetrokken). Zo is de eigenaar vanaf de eerste
-- statement de minimale NOLOGIN-rol, kan alleen die rol de functie vervangen, en
-- wordt de default-ACL (EXECUTE voor PUBLIC) door de eigenaar zelf ingetrokken.
-- De Supabase-`postgres`-rol is geen superuser; zonder lidmaatschap kan hij aan
-- een functie van een andere eigenaar niets meer verlenen of intrekken.
grant usage on schema login_private to login_hook_owner;
grant create on schema login_private to login_hook_owner;
set local role login_hook_owner;
create or replace function login_private.identiteit_toegestaan(p_user uuid, p_sub text, p_tid text, p_oid text)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1 from login_private.microsoft_identiteiten b
     where b.user_id = p_user
       and b.sub = p_sub and b.tid = p_tid and b.oid = p_oid
       and (b.status = 'active' or (b.status = 'pending' and b.pending_verloopt_op > pg_catalog.now()))
  );
$$;
revoke all on function login_private.identiteit_toegestaan(uuid, text, text, text) from public, anon, authenticated, service_role, login_gateway;
grant execute on function login_private.identiteit_toegestaan(uuid, text, text, text) to supabase_auth_admin;
reset role;
revoke create on schema login_private from login_hook_owner;
revoke login_hook_owner from postgres;

-- RLS staat aan; login_hook_owner is geen eigenaar en heeft geen BYPASSRLS. Zonder
-- policy ziet de helper nul rijen en wordt óók de juiste binding geweigerd.
grant select on login_private.microsoft_identiteiten to login_hook_owner;
drop policy if exists "hook owner leest bindingen" on login_private.microsoft_identiteiten;
create policy "hook owner leest bindingen" on login_private.microsoft_identiteiten
  for select to login_hook_owner using (true);

-- ── 8. Custom Access Token Hook (SECURITY INVOKER, supabase_auth_admin) ─────
-- `oauth` is in Supabase de generieke methode voor élke social/OAuth-login; de
-- hook bepaalt zelf welke identiteit is gebruikt en eist: precies één
-- OAuth-identiteit, provider azure, en sub/tid/oid exact gelijk aan de binding.
-- Niet-oauth-uitgiftes keren terug vóór enige databaseraadpleging. Geen enkele
-- claim, token of e-mailadres wordt gelogd.
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
    return event;                                   -- wachtwoord, magic link, herstel, totp: onaangeroerd
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
-- Supabase vereist voor een Postgres Auth-hook expliciet USAGE op het schema van de
-- hookfunctie; de helper staat in login_private, dus ook daar USAGE (geen tabelrechten).
grant usage on schema public to supabase_auth_admin;
grant usage on schema login_private to supabase_auth_admin;
grant execute on function public.fn_access_token_hook(jsonb) to supabase_auth_admin;

commit;
