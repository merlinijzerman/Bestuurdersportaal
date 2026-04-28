-- ============================================================
--  Bestuurdersportaal — Supabase Database Schema
--  Plak dit in: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- Extensies
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";  -- voor full-text zoeken

-- ── 1. Fondsen ─────────────────────────────────────────────
create table if not exists public.fondsen (
  id          uuid primary key default uuid_generate_v4(),
  naam        text not null,
  slug        text unique not null,
  aangemaakt  timestamptz default now()
);

-- Voeg een standaard fonds in
insert into public.fondsen (naam, slug) values
  ('Pensioenfonds Metaal & Techniek', 'pmt')
on conflict (slug) do nothing;

-- ── 2. Gebruikers-profielen ────────────────────────────────
-- (Aanvullend op Supabase Auth)
create table if not exists public.profielen (
  id          uuid primary key references auth.users(id) on delete cascade,
  fonds_id    uuid references public.fondsen(id),
  naam        text,
  rol         text check (rol in ('bestuurder','voorzitter','beheerder')) default 'bestuurder',
  aangemaakt  timestamptz default now()
);

-- Automatisch profiel aanmaken bij registratie
create or replace function public.maak_profiel()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profielen (id, naam, fonds_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'naam', new.email),
    (select id from public.fondsen limit 1)
  );
  return new;
end;
$$;

drop trigger if exists bij_registratie on auth.users;
create trigger bij_registratie
  after insert on auth.users
  for each row execute procedure public.maak_profiel();

-- ── 3. Documenten ──────────────────────────────────────────
create table if not exists public.documenten (
  id            uuid primary key default uuid_generate_v4(),
  fonds_id      uuid references public.fondsen(id),
  bibliotheek   text check (bibliotheek in ('generiek','fonds')) not null,
  bron          text check (bron in ('DNB','AFM','Pensioenfederatie','Intern','Extern')) not null,
  titel         text not null,
  bestandsnaam  text,
  paginas       int,
  gepubliceerd  date,
  geindexeerd   boolean default false,
  opgeslagen_door uuid references auth.users(id),
  aangemaakt    timestamptz default now()
);

-- ── 4. Document chunks (voor zoeken) ──────────────────────
create table if not exists public.document_chunks (
  id            uuid primary key default uuid_generate_v4(),
  document_id   uuid references public.documenten(id) on delete cascade,
  chunk_index   int not null,
  tekst         text not null,
  pagina        int,
  paragraaf     text,  -- bijv. "§3.2" of "Art. 12"
  zoek_vector   tsvector generated always as (
    to_tsvector('dutch', tekst)
  ) stored,
  aangemaakt    timestamptz default now()
);

-- Index voor full-text zoeken
create index if not exists idx_chunks_zoek on public.document_chunks using gin(zoek_vector);
create index if not exists idx_chunks_document on public.document_chunks(document_id);

-- ── 5. Governance log ──────────────────────────────────────
create table if not exists public.governance_log (
  id              uuid primary key default uuid_generate_v4(),
  gebruiker_id    uuid references auth.users(id),
  gebruiker_naam  text,
  fonds_id        uuid references public.fondsen(id),
  vraag           text not null,
  antwoord        text,
  bronnen         jsonb default '[]',  -- [{document_id, titel, pagina, paragraaf}]
  modus           text check (modus in ('documenten','combineren','algemeen')) default 'documenten',
  model           text default 'claude-sonnet-4-5',
  aangemaakt      timestamptz default now()
);

-- Migratie voor bestaande installaties (idempotent)
alter table public.governance_log add column if not exists modus text default 'documenten';

create index if not exists idx_log_fonds on public.governance_log(fonds_id);
create index if not exists idx_log_gebruiker on public.governance_log(gebruiker_id);
create index if not exists idx_log_tijd on public.governance_log(aangemaakt desc);

-- ── 6. Row Level Security ──────────────────────────────────
alter table public.fondsen enable row level security;
alter table public.profielen enable row level security;
alter table public.documenten enable row level security;
alter table public.document_chunks enable row level security;
alter table public.governance_log enable row level security;

-- Profielen: alleen eigen profiel zien
create policy "eigen profiel" on public.profielen
  for all using (auth.uid() = id);

-- Documenten: alleen eigen fonds zien
create policy "fonds documenten" on public.documenten
  for all using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    or bibliotheek = 'generiek'
  );

-- Chunks: volgt documenten
create policy "fonds chunks" on public.document_chunks
  for all using (
    document_id in (
      select id from public.documenten where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
        or bibliotheek = 'generiek'
    )
  );

-- Governance log: alleen eigen fonds
create policy "fonds log" on public.governance_log
  for all using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- Fondsen: iedereen mag lezen
create policy "fondsen lezen" on public.fondsen
  for select using (true);
