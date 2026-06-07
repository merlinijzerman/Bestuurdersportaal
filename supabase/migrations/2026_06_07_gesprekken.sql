-- ============================================================================
-- Migratie: persistente AI-gesprekken (RAG Fase B2 — minimale variant)
-- ----------------------------------------------------------------------------
-- Doel: een gesprek in de AI-assistent overleeft een refresh en wordt
-- automatisch teruggehaald. Dit is een GEBRUIKERSGERICHTE opslag voor gemak en
-- continuïteit — bewust losgekoppeld van public.governance_log, dat het
-- append-only AUDITSPOOR blijft (vraag/antwoord/modus/bronnen/model). Deze
-- migratie raakt governance_log niet.
--
-- Keuzes (vastgelegd met gebruiker, 7 juni 2026):
--   - Zichtbaarheid: ALLEEN de auteur (RLS op gebruiker_id), plus fonds-scope
--     als extra grendel/defense-in-depth.
--   - Opslagmodel: berichten als jsonb-array op de gespreksrij (incl. bronnen
--     en modus per bericht), passend bij MVP-volume.
--   - Verwijderen: soft-delete via gearchiveerd-vlag; rijen worden niet hard
--     verwijderd in deze iteratie. Archiveren raakt governance_log nooit.
--
-- Idempotent: veilig herhaaldelijk uit te voeren. Eerst in Supabase draaien,
-- daarna de code deployen.
-- ============================================================================

create table if not exists public.gesprekken (
  id            uuid primary key default uuid_generate_v4(),
  gebruiker_id  uuid not null references auth.users(id) on delete cascade,
  fonds_id      uuid references public.fondsen(id) on delete cascade,
  titel         text,
  -- Berichten als jsonb: [{rol, tekst, bronnen?, modus?}, …]
  berichten     jsonb not null default '[]',
  gearchiveerd  boolean not null default false,
  aangemaakt    timestamptz default now(),
  bijgewerkt    timestamptz default now()
);

-- Snel het meest recente, niet-gearchiveerde gesprek van een gebruiker vinden
-- (auto-restore bij het openen van de assistent).
create index if not exists idx_gesprek_gebruiker
  on public.gesprekken(gebruiker_id, bijgewerkt desc)
  where gearchiveerd = false;

-- Migratie voor bestaande installaties (idempotent) — voor het geval een
-- eerdere variant van de tabel al bestond zonder deze kolommen.
alter table public.gesprekken add column if not exists gearchiveerd boolean not null default false;
alter table public.gesprekken add column if not exists bijgewerkt   timestamptz default now();

-- Row Level Security: een gebruiker ziet en beheert UITSLUITEND zijn eigen
-- gesprekken, en alleen binnen het eigen fonds. `with check` borgt dat ook
-- inserts/updates niet buiten deze grenzen kunnen treden (geen gesprek op naam
-- van een ander of een ander fonds).
alter table public.gesprekken enable row level security;

drop policy if exists "eigen gesprekken" on public.gesprekken;
create policy "eigen gesprekken" on public.gesprekken
  for all
  using (
    gebruiker_id = auth.uid()
    and fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  )
  with check (
    gebruiker_id = auth.uid()
    and fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );
