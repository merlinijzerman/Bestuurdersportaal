-- ==========================================================================
-- 2026-08-27 — governance_events als tenantketen (besluit 0192, #183b spoor T)
-- --------------------------------------------------------------------------
-- FUNDAMENT voor spoor T: alle brontabel-triggers schrijven governance_events,
-- en dat vereist eerst (1) een tenantsleutel op de tabel, (2) een trigger die die
-- sleutel met dalende autoriteit bepaalt, (3) een asymmetrische policy.
--
-- Supabase-eerst: deze migratie eerst op de doeldatabase draaien (forward →
-- rollback → forward op een productiegelijke DB), dán pas de spoor-T-triggers.
-- ==========================================================================

begin;

-- 1. Nullable tenantsleutel. GEEN backfill op bestaande rijen: de
--    immutability-trigger (fn_govevent_immutable) blokkeert elke UPDATE, en de
--    USING-OR-tak (§2c) houdt de bestaande, sleutelloze rijen zichtbaar.
alter table public.governance_events
  add column if not exists fonds_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'governance_events_fonds_id_fkey'
  ) then
    alter table public.governance_events
      add constraint governance_events_fonds_id_fkey
      foreign key (fonds_id) references public.fondsen(id);
  end if;
end $$;

-- 2. Vulling met DALENDE AUTORITEIT (0192 §2b). SECURITY INVOKER: de functie
--    leest alleen wat de aanroeper zelf mag zien (eigen profiel; decision_objects
--    van het eigen fonds). Fonds_id komt van, in volgorde: de sessie (profiel,
--    overschrijft de meegegeven waarde — anti-spoof) → de door een brontrigger
--    uit zijn eigen rij gezette waarde (service-role-pad; service_role omzeilt RLS
--    toch al) → het besluit → anders raise.
--    De trigger LEIDT ALLEEN AF. De fonds/decision-consistentie wordt NIET hier
--    afgedwongen maar declaratief door de composite FK in stap 3
--    (I5/§4.5: constraint waar het kan). Eén plek voor de regel, dekt álle paden
--    (ook service-role), kan niet stil regresseren zoals een triggerfunctie.
create or replace function public.fn_govevent_fonds()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_fonds uuid;
begin
  if v_uid is not null then
    select fonds_id into v_fonds from public.profielen where id = v_uid;
  elsif new.fonds_id is not null then
    v_fonds := new.fonds_id;                 -- brontrigger zette fonds uit eigen rij
  elsif new.decision_id is not null then
    select fonds_id into v_fonds from public.decision_objects where id = new.decision_id;
  end if;
  new.fonds_id := v_fonds;
  if new.fonds_id is null then
    raise exception 'governance_events: fonds_id niet af te leiden';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_govevent_fonds() from public, anon;
grant execute on function public.fn_govevent_fonds() to authenticated, service_role;

-- BEFORE INSERT: draait vóór de RLS-WITH CHECK, dus de check ziet de gevulde rij.
-- Volgorde t.o.v. trg_govevent_hash is irrelevant (fonds_id zit niet in de hash).
drop trigger if exists trg_govevent_fonds on public.governance_events;
create trigger trg_govevent_fonds
  before insert on public.governance_events
  for each row execute function public.fn_govevent_fonds();

-- 2b. HANDHAVING van de fonds/decision-consistentie — composite FK (I5/§4.5,
--     besluit 0192 §2e). Een rij mag een decision_id alleen dragen als dat besluit
--     tot HETZELFDE fonds behoort. MATCH SIMPLE (default): decision_id IS NULL slaat
--     de toets over — precies gewenst voor niet-besluit-gebonden gebeurtenissen.
--     Bestaande rijen dragen fonds_id = NULL (geen backfill) ⇒ FK-check overgeslagen
--     ⇒ ADD is schoon. De constraint bijt uitsluitend nieuwe rijen.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'decision_objects_id_fonds_uniek') then
    alter table public.decision_objects
      add constraint decision_objects_id_fonds_uniek unique (id, fonds_id);  -- FK-doel (id is al PK)
  end if;
  if not exists (select 1 from pg_constraint where conname = 'governance_events_decision_zelfde_fonds') then
    alter table public.governance_events
      add constraint governance_events_decision_zelfde_fonds
      foreign key (decision_id, fonds_id)
      references public.decision_objects (id, fonds_id);
  end if;
end $$;

-- 3. Asymmetrische policy (0192 §2c). USING houdt de OR-tak (oude, sleutelloze
--    rijen zichtbaar); WITH CHECK strikt op fonds_id (convergeert; de trigger
--    vult het, dus geen van de bestaande schrijfpaden breekt).
drop policy if exists "fonds governance_events" on public.governance_events;
create policy "fonds governance_events" on public.governance_events
  using (
    fonds_id = (select p.fonds_id from public.profielen p where p.id = auth.uid())
    or decision_id in (
      select d.id from public.decision_objects d
      where d.fonds_id = (select p.fonds_id from public.profielen p where p.id = auth.uid())
    )
  )
  with check (
    fonds_id = (select p.fonds_id from public.profielen p where p.id = auth.uid())
  );

commit;
