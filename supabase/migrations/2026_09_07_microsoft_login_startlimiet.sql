-- ============================================================================
--  Microsoft-login fase 1B — T2 aanvulling (#335, besluit 0211, V9): atomische
--  tempolimiet voor de ongeauthenticeerde startroute /auth/microsoft-login/start.
--
--  WAAROM
--    De bestaande limiter (public.fn_rate_limit_check) telt op auth.uid() en is
--    alleen door `authenticated` uitvoerbaar. De inlog-start heeft nog geen
--    sessie. Een teller in het Node-proces is per serverless-instantie en kan
--    "20 per 10 minuten" niet garanderen (reviewbevinding PR #339). Daarom één
--    minimale, atomische teller in het private schema, uitsluitend via de
--    gateway-rol login_gateway: de VEERTIENDE gatewayfunctie.
--
--  WAT
--    * login_private.start_pogingen — (sleutel, venster_start) → aantal. De
--      sleutel is een HMAC-SHA256 van ip|host onder de eigen loginsleutel
--      (core/lib/microsoft-login-ratelimit-core.ts): nooit een ruw IP.
--    * login_private.tel_startpoging(p_sleutel, p_limiet, p_venster_seconden)
--      → (toegestaan, resterend, reset_op). Atomisch via INSERT … ON CONFLICT DO
--      UPDATE … RETURNING op een vast venster (floor(epoch / venster)); ruimt
--      opportunistisch vensters ouder dan twee vensters op.
--
--  RECHTEN  Tabel: geen enkele rol (RLS aan, geen policies). Functie: SECURITY
--           DEFINER met gepind search_path; EXECUTE uitsluitend login_gateway.
--  GATE-IMPACT  Geen publieke objecten; V3-allowlist ongewijzigd. De F1B-check
--           telt nu 14 executes voor login_gateway (bijgewerkt).
--  IDEMPOTENT  Herhaald draaien is veilig.
-- ============================================================================

begin;

do $$
begin
  if to_regnamespace('login_private') is null then
    raise exception 'schema login_private ontbreekt; pas eerst 2026_09_06_microsoft_login_fase1b.sql toe';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'login_gateway') then
    raise exception 'login_gateway-login ontbreekt; provision deze volgens security/MICROSOFT-365-F1B-RUNBOOK.md vóór de migratie';
  end if;
end $$;

create table if not exists login_private.start_pogingen (
  sleutel       text        not null,
  venster_start timestamptz not null,
  aantal        integer     not null default 0 check (aantal >= 0),
  primary key (sleutel, venster_start),
  constraint start_pogingen_sleutel_is_hash check (sleutel ~ '^[0-9a-f]{64}$')
);
comment on table login_private.start_pogingen is
  '#335 V9 — atomische tempoteller voor /auth/microsoft-login/start per HMAC(ip|host) en vast venster. Geen ruw IP.';
alter table login_private.start_pogingen enable row level security;
revoke all on login_private.start_pogingen from public, anon, authenticated, service_role, login_gateway;

create or replace function login_private.tel_startpoging(p_sleutel text, p_limiet integer, p_venster_seconden integer)
returns table(toegestaan boolean, resterend integer, reset_op timestamptz)
language plpgsql security definer set search_path = login_private, public, pg_temp as $$
declare
  v_venster_start timestamptz;
  v_aantal integer;
begin
  if p_limiet is null or p_limiet < 1 or p_venster_seconden is null or p_venster_seconden < 1 then
    raise exception 'ongeldige_limiet' using errcode = 'check_violation';
  end if;
  if p_sleutel !~ '^[0-9a-f]{64}$' then
    raise exception 'ongeldige_sleutel' using errcode = 'check_violation';
  end if;
  v_venster_start := to_timestamp(floor(extract(epoch from now()) / p_venster_seconden) * p_venster_seconden);

  -- Opportunistische opruiming: alles ouder dan twee vensters.
  delete from start_pogingen s where s.venster_start < v_venster_start - make_interval(secs => 2 * p_venster_seconden);

  insert into start_pogingen as s (sleutel, venster_start, aantal)
  values (p_sleutel, v_venster_start, 1)
  on conflict (sleutel, venster_start) do update set aantal = s.aantal + 1
  returning s.aantal into v_aantal;

  return query select v_aantal <= p_limiet,
                      greatest(p_limiet - v_aantal, 0),
                      v_venster_start + make_interval(secs => p_venster_seconden);
end $$;

revoke all on function login_private.tel_startpoging(text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function login_private.tel_startpoging(text, integer, integer) to login_gateway;

commit;
