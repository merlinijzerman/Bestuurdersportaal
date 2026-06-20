-- ============================================================================
-- Migratie 2026-06-20e — Increment C+/B13 (bronsoort + tenant-isolatie generiek)
--                        + bibliotheek-denorm op document_chunks.
-- ----------------------------------------------------------------------------
-- Eén gecombineerd increment, in deze volgorde (bewust):
--   1. Blok 1 — 3 nullable bronsoort-kolommen op documenten + normgewicht-CHECK.
--      'bibliotheek' (generiek|fonds) IS de bronsoort (B12); geen nieuw veld.
--   2. Denorm (vooruitgetrokken uit Increment G, sequencing-besluit G §1a):
--      fn_chunk_denorm + de twee triggers krijgen bibliotheek/bronorganisatie/
--      normgewicht/extern_url erbij, zodat G later schema-vrij kan filteren.
--      geldig_tot stroomt al via d.geldig_tot — generiek erft dat automatisch,
--      dus dat veld wordt NIET opnieuw aangeraakt. Set-based backfill, geen
--      re-embed, geen Vercel-timeout.
--   3. Datacorrectie vóór de policy-switch: ten onrechte als 'generiek'
--      gemarkeerde fondsdocumenten (fonds_id niet-NULL) terugzetten naar 'fonds'.
--   4. Blok 2 — RLS-split per command op documenten + document_chunks (B13):
--      SELECT gedeeld (eigen fonds OF generiek); INSERT/UPDATE alleen eigen
--      fonds ÉN bibliotheek='fonds'; DELETE alleen eigen fonds. Tenants worden
--      strikt read-only op generiek; generiek-curatie loopt interim via
--      service-role (omzeilt RLS), platform-UI komt in P1 (B14).
--
-- Leidend: bouwticket "Increment Cplus-B13 gecombineerd …" §2/§4; werkopdracht
-- "Increment G …" §1a (denorm hoort hier); decisions/0006 (B12/B13/B14),
-- 0007/0008 (fondsconsistentie), 0010 (fn_chunk_denorm = enige bron van waarheid),
-- 0012 (denorm-vooruittrekking). Capability generic.library.manage is
-- gereserveerd voor de B14-platformrol (code: lib/capabilities.ts), geen tenant-rol.
--
-- Idempotent. EERST in Supabase draaien, DAN code-deploy. Storage-policies voor
-- het generiek/-pad spiegelen de RLS-split en staan in een apart SQL-blok
-- (storage.objects) dat handmatig in Supabase wordt gedraaid; zie het ticket.
-- ROLLBACK: 2026_06_20e_bronsoort_generiek_isolatie_denorm_ROLLBACK.sql.
-- ============================================================================

-- ── 1. Blok 1: bronsoort-metadata op documenten (additief, nullable) ────────
alter table public.documenten
  add column if not exists bronorganisatie text,
  add column if not exists extern_url      text,
  add column if not exists normgewicht     text;

alter table public.documenten drop constraint if exists documenten_normgewicht_check;
alter table public.documenten add  constraint documenten_normgewicht_check
  check (normgewicht is null or normgewicht in
    ('bindend','toezichtverwachting','sector_guidance','informatief','onbekend'));

-- ── 2. Denorm-uitbreiding (vooruitgetrokken uit G) ──────────────────────────
-- 2a. Nieuwe denorm-kolommen op document_chunks (additief, nullable). Net als de
-- E-denorm: geen CHECK hier (gespiegeld vanuit documenten, dat de CHECK draagt).
alter table public.document_chunks
  add column if not exists bibliotheek     text,
  add column if not exists bronorganisatie text,
  add column if not exists normgewicht     text,
  add column if not exists extern_url      text;

-- Index voor de [BRONSOORT]-weging in G (scope-vóór-ranking). bibliotheek is de
-- scherpste bronsoort-discriminator (fonds vs. generiek).
create index if not exists idx_chunks_bronsoort
  on public.document_chunks (bibliotheek);

-- 2b. Gedeelde afleiding uitbreiden — DE enige bron van waarheid (besluit 0010).
-- We voegen alleen de 4 bronsoort-velden toe; alle bestaande velden (incl.
-- geldig_tot) blijven exact gelijk, zodat G's filtering ongewijzigd voortbouwt.
-- DROP eerst: het return-type (returns table) wijzigt (4 kolommen erbij) en dat
-- kan create-or-replace niet. De plpgsql-triggers roepen de functie via naam aan
-- (late binding, geen harde dependency), dus drop+recreate is veilig.
drop function if exists public.fn_chunk_denorm(uuid);
create or replace function public.fn_chunk_denorm(p_document_id uuid)
returns table (
  procesmodel_id     uuid,
  procesinstantie_id uuid,
  vergadering_id     uuid,
  agendapunt_id      uuid,
  documenttype       text,
  documentstatus     text,
  documentdatum      date,
  periode            text,
  bronstatus         text,
  geldig_vanaf       date,
  geldig_tot         date,
  bibliotheek        text,
  bronorganisatie    text,
  normgewicht        text,
  extern_url         text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    pr.procesmodel_id,
    d.procesinstantie_id,
    d.vergadering_id,
    d.agendapunt_id,
    d.documenttype,
    d.status as documentstatus,
    d.documentdatum,
    case
      when pr.periode_jaar is not null then pr.periode_jaar::text
      when d.documentdatum is not null then extract(year from d.documentdatum)::text
      else null
    end as periode,
    d.bronstatus,
    d.geldig_vanaf,
    d.geldig_tot,
    d.bibliotheek,
    d.bronorganisatie,
    d.normgewicht,
    d.extern_url
  from public.documenten d
  left join public.procedures pr on pr.id = d.procesinstantie_id
  where d.id = p_document_id;
$$;

-- 2c. BEFORE INSERT op document_chunks: ook de 4 nieuwe velden vullen.
-- LET OP: behoudt de COALESCE-fix uit Increment D (2026_06_20d, keuze 5) —
-- een per-segment gezette agendapunt_id/vergadering_id (notulensegmentchunk)
-- blijft staan; alleen NULL-velden erven uit het parent-document.
create or replace function public.fn_chunk_denorm_before_insert()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v record;
begin
  select * into v from public.fn_chunk_denorm(new.document_id);
  if found then
    new.procesmodel_id     := v.procesmodel_id;
    new.procesinstantie_id := v.procesinstantie_id;
    new.agendapunt_id      := coalesce(new.agendapunt_id, v.agendapunt_id);
    new.vergadering_id     := coalesce(new.vergadering_id, v.vergadering_id);
    new.documenttype       := v.documenttype;
    new.documentstatus     := v.documentstatus;
    new.documentdatum      := v.documentdatum;
    new.periode            := v.periode;
    new.bronstatus         := v.bronstatus;
    new.geldig_vanaf       := v.geldig_vanaf;
    new.geldig_tot         := v.geldig_tot;
    new.bibliotheek        := v.bibliotheek;
    new.bronorganisatie    := v.bronorganisatie;
    new.normgewicht        := v.normgewicht;
    new.extern_url         := v.extern_url;
  end if;
  return new;
end;
$$;

-- 2d. AFTER UPDATE op documenten: refresh ook de 4 nieuwe velden.
create or replace function public.fn_chunk_denorm_refresh()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.document_chunks dc
     set procesmodel_id     = v.procesmodel_id,
         procesinstantie_id = v.procesinstantie_id,
         vergadering_id     = v.vergadering_id,
         agendapunt_id      = v.agendapunt_id,
         documenttype       = v.documenttype,
         documentstatus     = v.documentstatus,
         documentdatum      = v.documentdatum,
         periode            = v.periode,
         bronstatus         = v.bronstatus,
         geldig_vanaf       = v.geldig_vanaf,
         geldig_tot         = v.geldig_tot,
         bibliotheek        = v.bibliotheek,
         bronorganisatie    = v.bronorganisatie,
         normgewicht        = v.normgewicht,
         extern_url         = v.extern_url
    from public.fn_chunk_denorm(new.id) v
   where dc.document_id = new.id;
  return new;
end;
$$;

-- De AFTER UPDATE-trigger luistert nu ook naar de bronsoort-velden, zodat een
-- curatiewijziging (platform/service-role) doorwerkt naar de chunks. bibliotheek
-- zit erbij voor de (zeldzame) interim-correctie generiek<->fonds; geen re-embed.
drop trigger if exists trg_chunk_denorm_refresh on public.documenten;
create trigger trg_chunk_denorm_refresh
  after update of procesinstantie_id, vergadering_id, agendapunt_id, documenttype,
                  status, bronstatus, documentdatum, geldig_vanaf, geldig_tot,
                  bibliotheek, bronorganisatie, normgewicht, extern_url
  on public.documenten
  for each row execute procedure public.fn_chunk_denorm_refresh();

-- 2e. Backfill voor BESTAANDE chunks (set-based, Supabase-side, geen re-embed).
-- Alleen de 4 nieuwe velden; de E-denorm is al gevuld. Idempotent.
update public.document_chunks dc
   set bibliotheek     = d.bibliotheek,
       bronorganisatie = d.bronorganisatie,
       normgewicht     = d.normgewicht,
       extern_url      = d.extern_url
  from public.documenten d
 where dc.document_id = d.id;

-- ── 3. Datacorrectie vóór de policy-switch (ticket §4/§8, risico #3) ────────
-- Een document met bibliotheek='generiek' hoort GEEN fonds_id te hebben. Zo'n
-- rij is een (vertrouwelijk) fondsdocument dat ten onrechte als generiek staat;
-- na de policy-switch zou het cross-tenant leesbaar worden. Zet zulke rijen
-- terug naar 'fonds' VÓÓR de policies worden ingeperkt. De AFTER UPDATE-trigger
-- spiegelt de correctie naar de chunks.
--
-- LET OP: deze migratie wordt pas gedraaid nadat de verificatiequery in §5 op
-- live Supabase is uitgevoerd en de gevonden rijen met Merlin zijn afgestemd.
-- De UPDATE is veilig en deterministisch (alleen rijen met een fonds_id).
--
-- AUDIT: deze correctie is een tenant-isolatie-kritieke bron-mutatie (bronsoort
-- generiek->fonds, raakt cross-tenant-zichtbaarheid). 'bibliotheek' is bewust
-- géén bewerkbaar metadataveld via de tenant-routes, dus deze omklap zou anders
-- spoorloos zijn. We leggen hem daarom expliciet append-only vast in
-- document_metadata_log (zelfde tabel/patroon als de metadata-routes), VÓÓR de
-- UPDATE zodat de oude waarde 'generiek' klopt. De hash wordt door de bestaande
-- insert-trigger gezet; gewijzigd_door is NULL = systeem/migratie.
insert into public.document_metadata_log (
  document_id, document_titel_snapshot, fonds_id,
  gewijzigd_door, gewijzigd_door_naam,
  veld_naam, oude_waarde, nieuwe_waarde, wijzig_reden, wijzig_type, rag_impact
)
select
  d.id, d.titel, d.fonds_id,
  null, 'systeem (migratie 2026_06_20e)',
  'bibliotheek', 'generiek', 'fonds',
  'B13 datacorrectie: ten onrechte als generiek gemarkeerd fondsdocument hersteld vóór de RLS-policy-switch (cross-tenant-isolatie).',
  'metadata', false
from public.documenten d
where d.bibliotheek = 'generiek'
  and d.fonds_id is not null;

update public.documenten
   set bibliotheek = 'fonds'
 where bibliotheek = 'generiek'
   and fonds_id is not null;

-- ── 4. Blok 2: tenant-isolatie generiek — RLS per command ───────────────────
-- documenten: de oude gecombineerde FOR ALL-policy splitsen per command.
drop policy if exists "fonds documenten" on public.documenten;

create policy "documenten select" on public.documenten
  for select using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    or bibliotheek = 'generiek');

create policy "documenten insert eigen fonds" on public.documenten
  for insert with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and bibliotheek = 'fonds');

create policy "documenten update eigen fonds" on public.documenten
  for update using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
  ) with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and bibliotheek = 'fonds');

create policy "documenten delete eigen fonds" on public.documenten
  for delete using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- document_chunks: SELECT gedeeld (incl. generiek), schrijven alleen eigen fonds.
drop policy if exists "fonds chunks" on public.document_chunks;

create policy "chunks select" on public.document_chunks
  for select using (
    document_id in (select id from public.documenten where
      fonds_id = (select fonds_id from public.profielen where id = auth.uid())
      or bibliotheek = 'generiek'));

create policy "chunks write eigen fonds" on public.document_chunks
  for all using (
    document_id in (select id from public.documenten where
      fonds_id = (select fonds_id from public.profielen where id = auth.uid())
      and bibliotheek = 'fonds')
  ) with check (
    document_id in (select id from public.documenten where
      fonds_id = (select fonds_id from public.profielen where id = auth.uid())
      and bibliotheek = 'fonds'));

-- ── 5. Verificatie (informatief; verschijnt in de migratie-output) ──────────
do $$
declare
  v_generiek_met_fonds bigint;
  v_chunks_zonder_bib  bigint;
begin
  -- Na §3 moet dit 0 zijn: geen generieke docs met een fonds_id.
  select count(*) into v_generiek_met_fonds
    from public.documenten
   where bibliotheek = 'generiek' and fonds_id is not null;
  raise notice 'C+/B13: % generieke documenten met fonds_id (verwacht 0 na correctie §3).',
    v_generiek_met_fonds;

  -- Denorm-backfill: chunks waarvan bibliotheek nog NULL is terwijl het document
  -- er een draagt (verwacht 0).
  select count(*) into v_chunks_zonder_bib
    from public.document_chunks dc
    join public.documenten d on d.id = dc.document_id
   where dc.bibliotheek is null and d.bibliotheek is not null;
  raise notice 'Bronsoort-denorm: % chunks met NULL-bibliotheek terwijl het document er een draagt (verwacht 0).',
    v_chunks_zonder_bib;
end $$;
