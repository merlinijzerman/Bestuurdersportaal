-- Spike T0.5 (#335) — WEGWERP-prototype van de Custom Access Token Hook. Geen migratie.
-- Uitsluitend voor de lokale CLI-stack. Inschakelen via supabase/config.toml:
--   [auth.hook.custom_access_token] enabled = true
--   uri = "pg-functions://postgres/public/spike_access_token_hook"
-- Opruimen: scripts/spike/spike-hook-ROLLBACK.sql
--
-- Ontwerp (ontwerpdoc §3.2):
--  * De publieke hook is SECURITY INVOKER en draait als supabase_auth_admin. Zij leest de
--    identiteiten van de gebruiker uit auth.identities (eigen schema van die rol) BINNEN de
--    transactie van GoTrue, zodat een zojuist via link_identity aangemaakte identiteit zichtbaar is.
--  * Alleen de kleine private helper heeft verhoogde rechten: SECURITY DEFINER, eigenaar is de
--    minimale NOLOGIN-rol spike_hook_owner met uitsluitend SELECT op de bindingstabel, en een
--    lege search_path (alle namen volledig gekwalificeerd).
--  * Toets: precies één OAuth-identiteit, provider = azure, en sub/tid/oid van die identiteit zijn
--    gelijk aan de active (of geldige pending) binding van deze gebruiker.
begin;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'spike_hook_owner') then
    create role spike_hook_owner nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
end $$;

create schema if not exists spike_private;
revoke all on schema spike_private from public, anon, authenticated;

create table if not exists spike_private.bindingen (
  user_id uuid primary key,
  status  text not null check (status in ('pending','active','revoking','revoked','failed')),
  pending_verloopt_op timestamptz,
  sub text not null, tid text not null, oid text not null
);
alter table spike_private.bindingen enable row level security;
revoke all on spike_private.bindingen from public, anon, authenticated;
grant usage on schema spike_private to spike_hook_owner, supabase_auth_admin;
grant select on spike_private.bindingen to spike_hook_owner;
-- RLS staat aan en spike_hook_owner is geen eigenaar en heeft geen BYPASSRLS: zonder policy
-- ziet de helper nul rijen en wordt óók de juiste binding geweigerd. Identiek in de
-- productiemigratie voor login_hook_owner.
drop policy if exists "spike hook owner leest bindingen" on spike_private.bindingen;
create policy "spike hook owner leest bindingen"
  on spike_private.bindingen for select to spike_hook_owner using (true);
-- Supabase vereist voor een Postgres Auth-hook expliciet USAGE op het schema van de hookfunctie.
grant usage on schema public to supabase_auth_admin;

-- Kleine private helper: alleen deze heeft verhoogde rechten (op de bindingstabel).
create or replace function spike_private.identiteit_toegestaan(p_user uuid, p_sub text, p_tid text, p_oid text)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1 from spike_private.bindingen b
     where b.user_id = p_user
       and b.sub = p_sub and b.tid = p_tid and b.oid = p_oid
       and (b.status = 'active' or (b.status = 'pending' and b.pending_verloopt_op > pg_catalog.now()))
  );
$$;
-- De managed/local Supabase-rol `postgres` heeft CREATEROLE maar is geen superuser.
-- Eigendom overdragen vereist daarom tijdelijk SET ROLE-recht én CREATE op het doelschema
-- voor de NOLOGIN-owner. Beide worden direct na de overdracht weer ingetrokken.
grant create on schema spike_private to spike_hook_owner;
grant spike_hook_owner to postgres;
alter function spike_private.identiteit_toegestaan(uuid, text, text, text) owner to spike_hook_owner;
revoke spike_hook_owner from postgres;
revoke create on schema spike_private from spike_hook_owner;
revoke all on function spike_private.identiteit_toegestaan(uuid, text, text, text) from public, anon, authenticated;
grant execute on function spike_private.identiteit_toegestaan(uuid, text, text, text) to supabase_auth_admin;

-- Publieke hook: SECURITY INVOKER (draait als supabase_auth_admin), geen verhoogde rechten.
create or replace function public.spike_access_token_hook(event jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_user uuid;
  v_oauth boolean;
  v_aantal_oauth integer;
  v_provider text; v_sub text; v_tid text; v_oid text;
begin
  v_oauth := (event->>'authentication_method') = 'oauth'
          or exists (
               select 1 from pg_catalog.jsonb_array_elements(coalesce(event->'claims'->'amr', '[]'::jsonb)) e
                where coalesce(e->>'method', e #>> '{}') = 'oauth');
  if not v_oauth then
    return event;                                   -- wachtwoord, magic link, herstel, totp: onaangeroerd
  end if;
  v_user := (event->>'user_id')::uuid;

  -- Precies één OAuth-identiteit (alles behalve email/phone), en die moet azure zijn.
  select count(*), min(i.provider), min(i.provider_id),
         min(i.identity_data->'custom_claims'->>'tid'), min(i.identity_data->'custom_claims'->>'oid')
    into v_aantal_oauth, v_provider, v_sub, v_tid, v_oid
    from auth.identities i
   where i.user_id = v_user and i.provider not in ('email','phone');
  if v_aantal_oauth <> 1 or v_provider <> 'azure' or v_sub is null or v_tid is null or v_oid is null then
    return pg_catalog.jsonb_build_object('error', pg_catalog.jsonb_build_object('http_code', 403,
      'message', 'Microsoft-login is niet gekoppeld aan dit account.'));
  end if;

  if spike_private.identiteit_toegestaan(v_user, v_sub, v_tid, v_oid) then
    return event;
  end if;
  return pg_catalog.jsonb_build_object('error', pg_catalog.jsonb_build_object('http_code', 403,
    'message', 'Microsoft-login is niet gekoppeld aan dit account.'));
exception when others then
  return pg_catalog.jsonb_build_object('error', pg_catalog.jsonb_build_object('http_code', 403,
    'message', 'Microsoft-login kan nu niet worden gecontroleerd.'));
end $$;
revoke all on function public.spike_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.spike_access_token_hook(jsonb) to supabase_auth_admin;

commit;
