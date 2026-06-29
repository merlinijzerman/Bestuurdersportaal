-- ============================================================================
-- Migratie 2026-06-29 — Publieke voorkant W0: tabel contact_aanvragen + RLS.
-- ----------------------------------------------------------------------------
-- Opslag voor publieke contactinzendingen vanaf de marketing-voorkant. NIET
-- tenant-gebonden (geen fonds_id): een aanvrager is geen ingelogde gebruiker.
-- Leidend: TO publieke voorkant §5.1 (datamodel) + §5.2 (RLS) + §5.3
-- (migratie-eerst-dan-deploy). FO REQ-PV-042 (niet publiek leesbaar).
--
-- RLS-strategie (§5.2):
--   - RLS AAN, met BEWUST GEEN anon/authenticated policies → de anon-key kan
--     niet lezen/schrijven/wijzigen/verwijderen (deny-by-default).
--   - De insert (W2, /api/contact) loopt server-side via de service-role-client,
--     die RLS bypasst. De browser schrijft dus nooit direct.
--   - Lezen/opvolgen = fase 2 (back-office of expliciete beheerderspolicy);
--     bewust nog GEEN leespolicy hier (open besluit TO §14 nr. 3).
--
-- Append-only-lijn (decisions/0001): geen hard-delete — opvolging via status.
-- Een DELETE-blokkerende trigger geldt voor ALLE rollen, óók de service-role.
-- UPDATE blijft toegestaan (status nieuw → in_behandeling → afgehandeld).
--
-- Conventies: idempotent (create ... if not exists, drop trigger if exists).
-- W0 deployt nog GEEN code die deze tabel gebruikt; de migratie is dus
-- standalone veilig toepasbaar (migratie-eerst-dan-deploy).
-- ============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()

create table if not exists public.contact_aanvragen (
  id                     uuid primary key default gen_random_uuid(),
  aangemaakt_op          timestamptz not null default now(),

  -- Aanvrager (verplichte velden, §5.1).
  naam                   text not null,
  organisatie            text not null,
  rol                    text not null,
  email                  text not null,
  telefoon               text,
  type_verzoek           text not null
                           check (type_verzoek in ('demo','pilot','vraag','samenwerking')),
  bericht                text not null,
  herkomst_pagina        text,

  -- Privacy/governance.
  privacy_version        text not null,   -- gekoppelde privacyverklaring-versie (FO §10)

  -- Misbruikbestrijding (dataminimalisatie: GEEN ruw IP; alleen gehasht en
  -- alleen indien rate-limiting/misbruikbestrijding dat vereist — anders NULL).
  ip_hash                text,
  user_agent_hash        text,

  -- Opvolging.
  status                 text not null default 'nieuw'
                           check (status in ('nieuw','in_behandeling','afgehandeld')),
  notificatie_verzonden  boolean not null default false,   -- gemiste mails opvolgbaar
  mail_error             text,            -- foutmelding bij soft-fail notificatie (§6)
  opgevolgd_door         text,            -- optioneel, fase 2
  afgehandeld_op         timestamptz      -- optioneel, fase 2
);

create index if not exists idx_contact_aanvragen_status
  on public.contact_aanvragen (status, aangemaakt_op desc);

-- ── RLS: aan, deny-by-default (geen policies) ──────────────────────────────
-- Geen permissive policies → anon/authenticated kunnen niet lezen/schrijven.
-- Alle schrijftoegang loopt via de service-role-client server-side (W2).
alter table public.contact_aanvragen enable row level security;

-- ── Append-only-lijn: blokkeer hard-delete (decisions/0001) ────────────────
-- Patroon overgenomen van fn_platform_event_immutable, maar UPDATE blijft toe
-- (status-opvolging). Geldt ook voor de service-role.
create or replace function public.fn_contact_aanvragen_no_delete()
returns trigger language plpgsql as $f$
begin
  raise exception 'contact_aanvragen is append-only — gebruik status i.p.v. delete';
end;
$f$;

drop trigger if exists trg_contact_aanvragen_no_delete on public.contact_aanvragen;
create trigger trg_contact_aanvragen_no_delete
  before delete on public.contact_aanvragen
  for each row execute procedure public.fn_contact_aanvragen_no_delete();
