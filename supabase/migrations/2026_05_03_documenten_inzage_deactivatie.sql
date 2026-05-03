-- ============================================================
--  Migratie 2026-05-03 — Documenten: inzage + deactivatie + Storage
--
--  Toevoegingen:
--   1. Kolom `opslag_pad` op documenten — pad in Supabase Storage.
--   2. Kolommen voor deactivatie: actief, gedeactiveerd_op,
--      gedeactiveerd_door, deactivatie_reden.
--   3. Tabel `document_inzage` voor audit-trail (inzage,
--      deactivatie, reactivatie). Met titel-snapshot zodat de
--      logregel leesbaar blijft als het document zelf later
--      anders heet.
--   4. Storage bucket `documenten` (private) + RLS-policies
--      die het patroon van public.documenten volgen.
-- ============================================================

-- ── 1. documenten uitbreiden ──────────────────────────────────
alter table public.documenten add column if not exists opslag_pad text;
alter table public.documenten add column if not exists actief boolean not null default true;
alter table public.documenten add column if not exists gedeactiveerd_op timestamptz;
alter table public.documenten add column if not exists gedeactiveerd_door uuid references auth.users(id) on delete set null;
alter table public.documenten add column if not exists deactivatie_reden text;

create index if not exists idx_documenten_actief on public.documenten(actief) where actief = false;

-- ── 2. Inzage-log ─────────────────────────────────────────────
create table if not exists public.document_inzage (
  id                       uuid primary key default uuid_generate_v4(),
  document_id              uuid references public.documenten(id) on delete set null,
  document_titel_snapshot  text not null,
  fonds_id                 uuid references public.fondsen(id) on delete set null,
  gebruiker_id             uuid references auth.users(id) on delete set null,
  gebruiker_naam           text,
  actie                    text not null check (actie in ('inzage','download','gedeactiveerd','gereactiveerd')),
  reden                    text,
  aangemaakt               timestamptz default now()
);

create index if not exists idx_inzage_doc on public.document_inzage(document_id, aangemaakt desc);
create index if not exists idx_inzage_fonds on public.document_inzage(fonds_id, aangemaakt desc);
create index if not exists idx_inzage_gebruiker on public.document_inzage(gebruiker_id, aangemaakt desc);

alter table public.document_inzage enable row level security;

-- Lezen: alleen audit-regels van het eigen fonds
drop policy if exists "fonds inzage lezen" on public.document_inzage;
create policy "fonds inzage lezen" on public.document_inzage
  for select using (
    fonds_id is null
    or fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  );

-- Schrijven: alleen eigen logregels (server-side route schrijft met auth.uid())
drop policy if exists "eigen inzage schrijven" on public.document_inzage;
create policy "eigen inzage schrijven" on public.document_inzage
  for insert with check (gebruiker_id = auth.uid());

-- ── 3. Storage bucket + policies ──────────────────────────────
-- Bucket aanmaken (idempotent). Private — alleen via RLS-policies leesbaar.
insert into storage.buckets (id, name, public)
values ('documenten', 'documenten', false)
on conflict (id) do nothing;

-- Pad-conventie: <fonds_uuid>/<document_uuid>.pdf  (fonds-bibliotheek)
--                generiek/<document_uuid>.pdf       (generieke bibliotheek)

-- Lezen: matcht het toegangsmodel van public.documenten
drop policy if exists "documenten storage lezen" on storage.objects;
create policy "documenten storage lezen" on storage.objects
  for select using (
    bucket_id = 'documenten'
    and (
      -- generieke bibliotheek
      (storage.foldername(name))[1] = 'generiek'
      -- of het pad begint met het fonds_id van de gebruiker
      or (storage.foldername(name))[1] = (
        select fonds_id::text from public.profielen where id = auth.uid()
      )
    )
  );

-- Schrijven: alleen ingelogde gebruikers binnen hun eigen fonds of generiek
drop policy if exists "documenten storage schrijven" on storage.objects;
create policy "documenten storage schrijven" on storage.objects
  for insert with check (
    bucket_id = 'documenten'
    and auth.uid() is not null
    and (
      (storage.foldername(name))[1] = 'generiek'
      or (storage.foldername(name))[1] = (
        select fonds_id::text from public.profielen where id = auth.uid()
      )
    )
  );

-- Verwijderen uit Storage: in deze MVP alleen via service role
-- (deactivatie is logisch, geen fysieke delete). Geen policy = geen access.
