-- ============================================================================
-- Migratie 2026-06-23 — Increment P0: Platformfundament.
-- ----------------------------------------------------------------------------
-- Levert de dragende laag voor de platform back-office (P1-P10): platform-
-- identiteiten (los van profielen), de capability-referentie (code-union als
-- bron-van-waarheid), per-identiteit capability-toekenning met anti-privilege-
-- escalatie-constraints, en het append-only platform_event_log met globale
-- hash-keten (advisory lock) + immutability-triggers.
--
-- P0 levert GEEN eindgebruikersfunctie; het is de gate waarop al het andere
-- rust. Additief op de bestaande stack: geen wijziging aan tenant-RLS of
-- profielen. Cross-tenant toegang loopt uitsluitend via de service-role-client
-- ACHTER de capability+audit-wrapper (lib/platform-wrapper.ts), niet via RLS-
-- policies op deze tabellen.
--
-- Leidend: TO v1.1 §2.1-§2.3 (datamodel), §4.3 (anti-escalatie-CHECKs),
-- §6 (hash-keten + advisory lock), §11 (migratievolgorde); FO v0.3 §6
-- (P0-eisen) + §6.3 (acceptatie). Interne keuzes: beslisnotitie B14 v0.2
-- (auth-3b, hosting-B, MFA-hard, twee-fasen-audit).
--
-- Conventies: idempotent (create ... if not exists, drop trigger if exists),
-- hash-patroon overgenomen van fn_doc_meta_log_hash (2026_06_18), uitgebreid
-- met pg_advisory_xact_lock voor een race-vrije globale keten.
-- ============================================================================

create extension if not exists "pgcrypto";   -- digest() voor de hash-keten

-- ── 1. platform_identities (TO §2.1) ───────────────────────────────────────
-- GEEN fonds_id, GEEN relatie naar profielen. id = auth-user-id in de
-- gescheiden platform-auth-context (3b binnen het bestaande Supabase-project).
-- mfa_enrolled is hooguit een cache; de bindende MFA-check is live AAL2 in code.
create table if not exists public.platform_identities (
  id             uuid primary key default gen_random_uuid(),
  email          text unique not null,
  naam           text not null,
  actief         boolean not null default true,
  mfa_enrolled   boolean not null default false,
  aangemaakt_op  timestamptz not null default now(),
  laatste_login  timestamptz
);

-- ── 2. platform_capabilities (referentie, TO §2.2) ─────────────────────────
-- Referentielijst t.b.v. FK-integriteit/inzicht. De BRON-VAN-WAARHEID blijft
-- de code-union in lib/platform-capabilities.ts (CI-check, TO §12 test 17).
-- Deactiveren (actief=false) i.p.v. verwijderen, zodat historie/FK intact blijft.
create table if not exists public.platform_capabilities (
  capability    text primary key,
  actief        boolean not null default true,
  omschrijving  text
);

-- Seed = exact de 11 caps uit de PlatformCapability-union. on conflict laat de
-- seed idempotent en non-destructief; bestaande rijen worden niet overschreven.
insert into public.platform_capabilities (capability, omschrijving) values
  ('platform.generic.library.manage', 'Generieke (platform-gecureerde) documentbibliotheek beheren'),
  ('platform.config.manage',          'Generieke beheerconfiguratie / feature flags beheren'),
  ('platform.tenants.manage',         'Fondsen aanmaken / (de)activeren'),
  ('platform.identities.manage',      'Platform-identiteiten aanmaken / blokkeren'),
  ('platform.capabilities.grant',     'Capabilities toekennen (extra zwaar — break-glass)'),
  ('platform.capabilities.revoke',    'Capabilities intrekken'),
  ('platform.observability.read',     'Operationele/technische observability inzien'),
  ('platform.logs.read',              'Cross-tenant logs / auditspoor inzien'),
  ('platform.security.operate',       'Securityoperaties (sessie-intrekking e.d.)'),
  ('platform.support.operate',        'Support-operations (tijdgebonden)'),
  ('platform.compliance.read',        'Governance-/compliancemonitoring inzien')
on conflict (capability) do nothing;

-- ── 3. platform_identity_capabilities (TO §2.2 + §4.3) ─────────────────────
-- Per-identiteit, least privilege. Append-only intrekken via ingetrokken_op.
-- CHECKs dwingen anti-privilege-escalatie af op DB-niveau (self-grant /
-- self-approval). De zwaardere regels (welke cap mag wie toekennen, grant-van-
-- grant via break-glass) zitten in de wrapper (actor-capabilities nodig).
create table if not exists public.platform_identity_capabilities (
  id              uuid primary key default gen_random_uuid(),
  identity_id     uuid not null references public.platform_identities(id),
  capability      text not null references public.platform_capabilities(capability),
  toegekend_door  uuid not null references public.platform_identities(id),
  vier_ogen_door  uuid references public.platform_identities(id),
  toegekend_op    timestamptz not null default now(),
  ingetrokken_op  timestamptz,
  constraint chk_pic_geen_self_grant    check (toegekend_door <> identity_id),
  constraint chk_pic_geen_self_approval check (vier_ogen_door is null or vier_ogen_door <> toegekend_door)
);

-- "Eén actieve grant per (identity, capability)" — partial unique index
-- (Postgres ondersteunt geen WHERE in een UNIQUE-constraint).
create unique index if not exists ux_pic_actief
  on public.platform_identity_capabilities (identity_id, capability)
  where ingetrokken_op is null;

create index if not exists idx_pic_identity on public.platform_identity_capabilities (identity_id);

-- ── 4. platform_event_log (audit-on-audit, twee-fasen, TO §2.3 + §6) ───────
-- Append-only + immutable + globale hash-keten. identity_id NULLABLE:
-- sessieloze pogingen (logSecurity) worden hier met identity_id=null gelogd
-- (P0-interim; een aparte security/auth-tabel is P9-scope). Geen PII/inhoud in
-- doel_object: alleen referenties (id's), nooit documentinhoud/profielwaarden.
create table if not exists public.platform_event_log (
  id              uuid primary key default gen_random_uuid(),
  correlatie_id   uuid not null,
  fase            text not null check (fase in ('attempt','result')),
  identity_id     uuid references public.platform_identities(id),
  capability      text not null,
  handeling       text not null,
  doel_fonds_id   uuid,
  doel_object     text,
  reden           text,
  bron_ip         inet,
  verwachte_scope jsonb,
  uitkomst        text check (uitkomst in ('succes','fout','geweigerd','geannuleerd')),
  foutcode        text,
  effect          jsonb,
  tijdstip        timestamptz not null default now(),
  prev_hash       text,
  hash            text not null
);

create index if not exists idx_pel_correlatie on public.platform_event_log (correlatie_id, tijdstip);
create index if not exists idx_pel_identity   on public.platform_event_log (identity_id, tijdstip desc);
create index if not exists idx_pel_keten      on public.platform_event_log (tijdstip desc, id desc);

-- Hardt de result-idempotentie van een "best effort" naar een DB-garantie:
-- maximaal één attempt + één result per correlatie_id. logResultGegarandeerd
-- (lib/platform-audit.ts) leest eerst zijn eigen result terug per iteratie, dus
-- een unique-violation bij een dubbele insert laat de retry-lus de bestaande rij
-- vinden en true teruggeven — géén fail-closed-regressie. Beide kolommen zijn
-- NOT NULL, dus een gewone unique index volstaat (geen partial nodig).
create unique index if not exists ux_pel_correlatie_fase
  on public.platform_event_log (correlatie_id, fase);

-- Append-only: blokkeer UPDATE/DELETE door ALLE rollen (patroon
-- fn_doc_meta_log_immutable). Geldt ook voor de service-role.
create or replace function public.fn_platform_event_immutable()
returns trigger language plpgsql as $f$
begin
  raise exception 'platform_event_log is append-only';
end;
$f$;

drop trigger if exists trg_platform_event_no_update on public.platform_event_log;
create trigger trg_platform_event_no_update
  before update on public.platform_event_log
  for each row execute procedure public.fn_platform_event_immutable();

drop trigger if exists trg_platform_event_no_delete on public.platform_event_log;
create trigger trg_platform_event_no_delete
  before delete on public.platform_event_log
  for each row execute procedure public.fn_platform_event_immutable();

-- Hash-keten (TO §6): globale keten, race-vrij gemaakt met een transaction-
-- scoped advisory lock op de ketenkop. Twee gelijktijdige inserts kunnen zo
-- nooit hetzelfde prev_hash krijgen (TO §12 test 11b). Canonical hash-input =
-- exact de veldvolgorde uit TO §6; bewust NIET in de hash: id (surrogaat) en
-- bron_ip (operationeel/PII). digest(...,'sha256') volgt het bestaande
-- codebase-patroon (fn_doc_meta_log_hash). De exacte spiegel van deze canonieke
-- string staat in scripts/platform_checks.sql (Deel B): een read-only
-- herberekening die elke hash + de prev_hash-keten verifieert (TO §12 test 11).
create or replace function public.fn_platform_event_hash()
returns trigger language plpgsql as $f$
begin
  if new.tijdstip is null then new.tijdstip := now(); end if;

  -- Serialiseer de ketenkop: één globale keten, geen vertakking.
  perform pg_advisory_xact_lock(hashtext('platform_event_log_chain'));

  new.prev_hash := (
    select hash from public.platform_event_log
    order by tijdstip desc, id desc
    limit 1
  );

  new.hash := encode(
    digest(
      coalesce(new.correlatie_id::text,'') || '|' ||
      new.fase                             || '|' ||
      coalesce(new.identity_id::text,'')   || '|' ||
      new.capability                       || '|' ||
      new.handeling                        || '|' ||
      coalesce(new.doel_fonds_id::text,'') || '|' ||
      coalesce(new.doel_object,'')         || '|' ||
      coalesce(new.reden,'')               || '|' ||
      coalesce(new.uitkomst,'')            || '|' ||
      coalesce(new.foutcode,'')            || '|' ||
      coalesce(new.effect::text,'')        || '|' ||
      new.tijdstip::text                   || '|' ||
      coalesce(new.prev_hash,''),
      'sha256'
    ), 'hex'
  );
  return new;
end;
$f$;

drop trigger if exists trg_platform_event_hash on public.platform_event_log;
create trigger trg_platform_event_hash
  before insert on public.platform_event_log
  for each row execute procedure public.fn_platform_event_hash();

-- ── 5. RLS op alle nieuwe tabellen (guardrail: nieuwe tabellen krijgen RLS) ─
-- Deze tabellen zijn service-role-beheerd: de platform-wrapper bypasst RLS via
-- de service-role-key. Voor de tenant-anon-key geldt deny-by-default — er zijn
-- bewust GEEN permissive policies, behalve zelf-lezen van de eigen identiteit
-- (sessie-/profielweergave, TO §2.1). Zo ziet een tenant-anon-sessie de
-- platform-tabellen niet, en blijft tenant-RLS volledig ongemoeid.
alter table public.platform_identities             enable row level security;
alter table public.platform_capabilities           enable row level security;
alter table public.platform_identity_capabilities  enable row level security;
alter table public.platform_event_log              enable row level security;

drop policy if exists "zelf-lees eigen platform-identiteit" on public.platform_identities;
create policy "zelf-lees eigen platform-identiteit" on public.platform_identities
  for select using (auth.uid() = id);

-- Geen verdere policies: platform_capabilities, platform_identity_capabilities
-- en platform_event_log zijn voor de anon-key niet leesbaar/schrijfbaar
-- (deny-by-default). Alle toegang loopt via de service-role achter de wrapper.
