-- ============================================================
--  Migratie 2026-04-29 — Voorbereidingen op agendapunten
--  Persoonlijke AI-ondersteunde voorbereiding per bestuurder.
--  Alleen eigen voorbereidingen zichtbaar (privé).
-- ============================================================

create table if not exists public.voorbereidingen (
  id              uuid primary key default uuid_generate_v4(),
  agendapunt_id   uuid not null references public.agendapunten(id) on delete cascade,
  gebruiker_id    uuid not null references auth.users(id) on delete cascade,
  diepte          text not null check (diepte in ('snel','grondig')) default 'snel',
  ai_output       jsonb not null default '{}',
  eigen_notities  jsonb not null default '{}',
  bronnen_meta    jsonb not null default '{}',
  gegenereerd_op  timestamptz default now(),
  bijgewerkt_op   timestamptz default now(),
  unique (agendapunt_id, gebruiker_id)
);

create index if not exists idx_voorbereiding_user on public.voorbereidingen(gebruiker_id, bijgewerkt_op desc);

alter table public.voorbereidingen enable row level security;

drop policy if exists "eigen voorbereiding" on public.voorbereidingen;
create policy "eigen voorbereiding" on public.voorbereidingen
  for all using (gebruiker_id = auth.uid())
  with check (gebruiker_id = auth.uid());
