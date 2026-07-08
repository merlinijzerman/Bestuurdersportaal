-- ============================================================================
-- Migratie 2026-07-08 — Host→fonds-mapping: tabel tenant_domains + RLS.
-- ----------------------------------------------------------------------------
-- Eerste, begrensde bouwsteen van de server-side tenant-resolver (besluit 0040,
-- B4: host→fonds-resolutie). De fondscontext wordt afgeleid uit de request-host
-- via deze mapping, niet uit de UI of de request-body. Onbekende host is
-- fail-closed; er is geen "eerste fonds"-fallback.
--
-- BEWUSTE GLOBALE / UITZONDERINGSTABEL (RLS-hardening 0040):
--   Anders dan de tenant-tabellen (RLS per fonds_id) is dit een GLOBALE
--   mappingtabel: één rij bindt één host aan één fonds, los van wie ingelogd is.
--   RLS staat AAN met DENY-BY-DEFAULT: er is BEWUST GEEN policy, dus geen enkele
--   authenticated/anon-sessie kan rijen lezen of schrijven. De resolver leest de
--   mapping uitsluitend server-side via de service-role (buiten RLS om); die
--   data-fetch + middleware-wiring komen in T1.2. Deze tabel is defense-in-depth
--   NAAST de RLS-isolatie, geen autorisatielaag (huispatroon 0039: RLS =
--   fonds-isolatie, code = rolgate).
--
-- Conventies: idempotent; migratie-eerst-dan-deploy; ROLLBACK-bestand apart.
-- gen_random_uuid() (pgcrypto) conform de gen_random_uuid-migraties (o.a.
-- 2026_06_29_contact_aanvragen.sql).
-- ============================================================================
create extension if not exists "pgcrypto";   -- gen_random_uuid()

create table if not exists public.tenant_domains (
  id            uuid primary key default gen_random_uuid(),
  -- Genormaliseerde host: lowercase, GEEN poort, GEEN leidende `www.`.
  -- Zie lib/tenant-host.ts (bepaalFondsContext) voor het normalisatiecontract.
  host          text not null unique,
  fonds_id      uuid not null references public.fondsen(id) on delete restrict,
  actief        boolean not null default true,
  aangemaakt_op timestamptz not null default now()
);

comment on table public.tenant_domains is
  'Globale host→fonds-mapping voor de server-side tenant-resolver (besluit 0040, B4). Bewuste globale/uitzonderingstabel: RLS aan, deny-by-default (geen policy), alleen leesbaar via de service-role. Defense-in-depth naast RLS, geen autorisatie.';
comment on column public.tenant_domains.host is
  'Genormaliseerde request-host: lowercase, zonder poort, zonder leidende www. (contract identiek aan lib/platform-host.ts normaliseerHost).';
comment on column public.tenant_domains.actief is
  'Alleen actieve rijen resolven naar een fonds; actief=false → host geldt als onbekend (fail-closed).';

-- Expliciete unieke index op host (naast de UNIQUE-constraint) — exacte,
-- case-gevoelige lookup op de reeds genormaliseerde host.
create unique index if not exists tenant_domains_host_idx
  on public.tenant_domains (host);

-- ── RLS: aan, deny-by-default — GEEN policy (bewuste globale tabel) ──────────
-- Geen SELECT/INSERT/UPDATE/DELETE-policy: gewone gebruikers zien niets. Lezen
-- gebeurt uitsluitend server-side via de service-role (buiten RLS om, T1.2).
alter table public.tenant_domains enable row level security;
