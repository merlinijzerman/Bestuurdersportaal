-- ============================================================
--  Migratie 2026-05-18 — Module Notificaties (Iteratie 3-A)
--  Eén tabel: notificaties (in-app, geen e-mail).
--  RLS strict op ontvanger_id = auth.uid().
--
--  Doel: persistente in-app notificaties voor bestuurders. Elke
--  rij is bestemd voor één gebruiker (`ontvanger_id`); `gelezen_op`
--  is nullable en wordt gezet bij eerste klik of "alles als gelezen".
--
--  Notificaties worden expliciet geschreven vanuit API-routes via
--  de helper `lib/notifications.ts` (zelfde patroon als `procedure_log`).
--  Geen DB-triggers — dat houdt het debug-baar en transparent.
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--  Idempotent: opnieuw draaien is veilig.
-- ============================================================

-- ── 1. Notificaties-tabel ──────────────────────────────────
create table if not exists public.notificaties (
  id                    uuid primary key default uuid_generate_v4(),
  ontvanger_id          uuid not null references auth.users(id) on delete cascade,
  fonds_id              uuid not null references public.fondsen(id) on delete cascade,
  type                  text not null check (type in (
                          -- Iteratie 3-A — v1-types die geen eigenaars-FK vereisen
                          'inbreng_geplaatst',          -- iemand plaatste inbreng op een agendapunt dat jij aanmaakte
                          'ai_validatie_wacht',         -- AI-output wacht op validatie in jouw domein (role-based)
                          'procedure_afgerond',         -- procedure die jij gestart hebt is afgerond
                          'besluit_geregistreerd',      -- besluit op procedure die jij gestart hebt
                          'dissent_formeel_vastgelegd'  -- dissent is formeel vastgelegd op besluit waarvan jij eigenaar bent
                        )),
  payload               jsonb not null default '{}',
  gerelateerd_aan_type  text,    -- bv. 'agendapunt', 'procedure', 'decision', 'ai_interaction'
  gerelateerd_aan_id    uuid,    -- ID in de bijbehorende tabel; gebruikt voor deeplink
  actor_id              uuid references auth.users(id) on delete set null, -- wie triggerde de notif
  actor_naam            text,    -- snapshot, voor het geval profiel later verandert
  aangemaakt            timestamptz default now(),
  gelezen_op            timestamptz  -- nullable; geset bij eerste klik of "alles lezen"
);

-- ── 2. Indexen ─────────────────────────────────────────────
-- Voor de homepage-query "geef mij ongelezen notificaties, nieuwste eerst":
create index if not exists idx_notif_ontvanger_aangemaakt
  on public.notificaties(ontvanger_id, aangemaakt desc);

-- Voor "telt ongelezen": kleine partial index alleen op ongelezen rijen,
-- die zijn typisch een fractie van de totale tabel.
create index if not exists idx_notif_ongelezen
  on public.notificaties(ontvanger_id, aangemaakt desc)
  where gelezen_op is null;

-- Idempotentie-check (zie helper lib/notifications.ts):
-- zoek snel naar bestaande notif binnen 5 min voor (type, ontvanger, gerelateerd_aan_id).
create index if not exists idx_notif_idempotent
  on public.notificaties(ontvanger_id, type, gerelateerd_aan_id, aangemaakt desc);

-- ── 3. Row Level Security ──────────────────────────────────
alter table public.notificaties enable row level security;

-- Een gebruiker mag alleen zijn eigen notificaties zien en updaten.
-- Toevoegen mag iedereen die geauthenticeerd is — de helper zorgt
-- dat de juiste ontvanger_id wordt meegegeven, en RLS op SELECT/UPDATE
-- voorkomt dat iemand andermans notificaties leest of als gelezen markeert.
drop policy if exists "eigen notificaties select" on public.notificaties;
create policy "eigen notificaties select" on public.notificaties
  for select using (ontvanger_id = auth.uid());

drop policy if exists "eigen notificaties update" on public.notificaties;
create policy "eigen notificaties update" on public.notificaties
  for update using (ontvanger_id = auth.uid());

-- INSERT — server-side flows mogen voor andere users inserten. We bewaken
-- dat de fonds_id matched met het eigen fonds van de actor, zodat een
-- gecompromitteerde user-token geen notif naar een ander fonds kan
-- schieten. De ontvanger zelf zit ook in het eigen fonds (RLS op profielen).
drop policy if exists "notificaties insert eigen fonds" on public.notificaties;
create policy "notificaties insert eigen fonds" on public.notificaties
  for insert with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- DELETE — bewust niet toegestaan via UI; notificaties zijn historisch
-- (audit-trail van wat een gebruiker te zien kreeg). Cleanup via een
-- toekomstige cron of administrator-functie.

-- ── 4. Comment voor schema-doc ────────────────────────────
comment on table public.notificaties is
  'In-app notificaties per gebruiker. Geen e-mail. RLS strict op ontvanger_id.';
comment on column public.notificaties.payload is
  'jsonb met type-specifieke velden: bv. {agendapunt_titel, actor_naam, vergadering_id} voor inbreng_geplaatst.';
comment on column public.notificaties.gerelateerd_aan_id is
  'Doelwit van de deeplink. UI gebruikt (gerelateerd_aan_type, id) om de juiste URL te bouwen.';
