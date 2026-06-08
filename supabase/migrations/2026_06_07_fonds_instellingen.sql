-- ============================================================================
-- Migratie: instellingen per fonds — runtime-schakelaars (o.a. hybride zoeken)
-- ----------------------------------------------------------------------------
-- Maakt het mogelijk om de hybride zoek-schakelaar in het portaal zelf te
-- beheren (per fonds), zonder env-wijziging/redeploy. De env-var HYBRID_SEARCH
-- blijft de standaardwaarde tot er een instelling is gezet.
--
-- RLS: een gebruiker leest/beheert uitsluitend de instelling van het eigen
-- fonds. De beperking "alleen voorzitter/beheerder mag wijzigen" wordt in de
-- API-route afgedwongen (rolcheck); RLS borgt de tenant-isolatie.
--
-- Idempotent. Eerst in Supabase draaien, dan code-deploy.
-- ============================================================================

create table if not exists public.fonds_instellingen (
  fonds_id       uuid primary key references public.fondsen(id) on delete cascade,
  hybride_zoeken boolean not null default false,
  bijgewerkt     timestamptz default now()
);

alter table public.fonds_instellingen enable row level security;

drop policy if exists "fonds instellingen" on public.fonds_instellingen;
create policy "fonds instellingen" on public.fonds_instellingen
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));
