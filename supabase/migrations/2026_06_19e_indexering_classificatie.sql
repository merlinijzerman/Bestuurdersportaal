-- ============================================================================
-- Migratie 2026-06-19e — Increment E: Indexering en procesclassificatie.
-- ----------------------------------------------------------------------------
-- Twee dingen:
--   1. DENORMALISATIE op document_chunks — gedenormaliseerde proces-/status-/
--      geldigheidsvelden zodat Increment G goedkoop kan filteren vóór retrieval.
--      E SLAAT alleen op; het daadwerkelijk filteren is Increment G. De hybride
--      zoek-RPC blijft ongewijzigd (selecteert expliciete kolommen), dus deze
--      additieve nullable kolommen wijzigen het retrievalgedrag NIET.
--   2. classificatie_voorstellen — AI-procesclassificatie + auto-koppeling (B5)
--      met confidence/bron/status, terugdraaibaar en auditbaar.
--
-- Leidend: FO v1.2 §10 (Module 8); TO v1.2 §2.6 (denorm + classificatie), §5
-- (capabilities), §6 (retrieval = G); decisions/0010 (E-keuzes: DB-trigger voor
-- de denorm-refresh, gedeelde hub-GET + aparte actieroutes, conservatieve
-- confidence-default); decisions/0009 (denorm hoort in E/G, niet C).
--
-- Refresh-mechanisme (besluit 0010): consistentie wordt in de DB afgedwongen,
-- niet via applicatiediscipline. Eén gedeelde afleiding (fn_chunk_denorm) voedt
--   • een BEFORE INSERT-trigger op document_chunks (nieuwe chunks dragen meteen
--     de juiste denorm — dekt upload, her-extract en backfill in één plek), en
--   • een AFTER UPDATE-trigger op documenten (RAG-impactvolle wijziging werkt
--     door naar de chunks). Géén re-embed: alleen de denorm-velden muteren.
--
-- Backfill: de denorm voor BESTAANDE chunks wordt set-based in deze migratie
-- gevuld (draait in Supabase, geen Vercel-timeout). De classificatievoorstellen
-- voor reeds ONGEKOPPELDE documenten worden batchgewijs door de backfill-route
-- gegenereerd (app-logica = de engine); expliciet gekoppelde docs worden nooit
-- omgehangen.
--
-- Tenant-isolatie: document_chunks heeft GEEN eigen fonds_id; de bestaande
-- "fonds chunks"-policy isoleert via de join op documenten. De denorm-kolommen
-- erven die isolatie. classificatie_voorstellen krijgt een eigen fonds-policy.
--
-- Idempotent. EERST in Supabase draaien, DAN code-deploy. ROLLBACK: zie
-- 2026_06_19e_indexering_classificatie_ROLLBACK.sql.
-- ============================================================================

-- ── 1. Denorm-kolommen op document_chunks (additief, allemaal nullable) ─────
-- Geen CHECK-constraints: dit zijn gedenormaliseerde spiegels van documenten/
-- procedures (die de CHECKs al dragen). Een CHECK hier zou de bron dupliceren
-- en bij een latere enum-uitbreiding stil kunnen breken.
alter table public.document_chunks
  add column if not exists procesmodel_id     uuid references public.procesmodellen(id) on delete set null,
  add column if not exists procesinstantie_id uuid references public.procedures(id)     on delete set null,
  add column if not exists vergadering_id     uuid references public.vergaderingen(id)  on delete set null,
  add column if not exists agendapunt_id      uuid references public.agendapunten(id)   on delete set null,
  add column if not exists documenttype       text,
  add column if not exists documentstatus     text,
  add column if not exists documentdatum      date,
  add column if not exists periode            text,
  add column if not exists bronstatus         text,
  add column if not exists geldig_vanaf       date,
  add column if not exists geldig_tot         date;

-- Index voor de G-filtering (scope-vóór-ranking). Bewust deze kolomvolgorde:
-- bronstatus + documentstatus zijn de scherpste filters, procesinstantie_id de
-- meest selectieve koppeling.
create index if not exists idx_chunks_denorm
  on public.document_chunks (bronstatus, documentstatus, procesinstantie_id);

-- ── 2. Gedeelde afleiding documenten(+procesinstantie) → chunk-denorm ───────
-- Eén bron van waarheid voor de mapping, gebruikt door BEIDE triggers (insert +
-- update). procesmodel_id en periode worden via de primaire procesinstantie
-- afgeleid (B-eis #4). periode = jaar van de procesinstantie, of anders het jaar
-- van de documentdatum.
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
  geldig_tot         date
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
    d.geldig_tot
  from public.documenten d
  left join public.procedures pr on pr.id = d.procesinstantie_id
  where d.id = p_document_id;
$$;

-- 2a. BEFORE INSERT op document_chunks: vul de denorm uit het parent-document.
-- Overschrijft expliciet eventueel app-geleverde denorm — de DB is leidend.
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
    new.vergadering_id     := v.vergadering_id;
    new.agendapunt_id      := v.agendapunt_id;
    new.documenttype       := v.documenttype;
    new.documentstatus     := v.documentstatus;
    new.documentdatum      := v.documentdatum;
    new.periode            := v.periode;
    new.bronstatus         := v.bronstatus;
    new.geldig_vanaf       := v.geldig_vanaf;
    new.geldig_tot         := v.geldig_tot;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chunk_denorm_before_insert on public.document_chunks;
create trigger trg_chunk_denorm_before_insert
  before insert on public.document_chunks
  for each row execute procedure public.fn_chunk_denorm_before_insert();

-- 2b. AFTER UPDATE op documenten: werk de denorm van alle chunks bij wanneer een
-- RAG-impactvolle kolom wijzigt. GEEN re-embed (tekst blijft ongemoeid). Eén
-- documentwijziging kan meerdere chunkrijen in één transactie raken (bewust
-- geaccepteerde schuld, decisions/0010; gedekt door regressietest §9.7).
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
         geldig_tot         = v.geldig_tot
    from public.fn_chunk_denorm(new.id) v
   where dc.document_id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_chunk_denorm_refresh on public.documenten;
create trigger trg_chunk_denorm_refresh
  after update of procesinstantie_id, vergadering_id, agendapunt_id, documenttype,
                  status, bronstatus, documentdatum, geldig_vanaf, geldig_tot
  on public.documenten
  for each row execute procedure public.fn_chunk_denorm_refresh();

-- ── 3. Denorm-backfill voor BESTAANDE chunks (set-based, Supabase-side) ─────
-- Géén re-embed; alleen de nieuwe denorm-velden vullen. Idempotent (kan
-- herhaald draaien). De BEFORE INSERT-trigger dekt nieuwe chunks vanaf nu.
update public.document_chunks dc
   set procesmodel_id     = pr.procesmodel_id,
       procesinstantie_id = d.procesinstantie_id,
       vergadering_id     = d.vergadering_id,
       agendapunt_id      = d.agendapunt_id,
       documenttype       = d.documenttype,
       documentstatus     = d.status,
       documentdatum      = d.documentdatum,
       periode            = case
                              when pr.periode_jaar is not null then pr.periode_jaar::text
                              when d.documentdatum is not null then extract(year from d.documentdatum)::text
                              else null
                            end,
       bronstatus         = d.bronstatus,
       geldig_vanaf       = d.geldig_vanaf,
       geldig_tot         = d.geldig_tot
  from public.documenten d
  left join public.procedures pr on pr.id = d.procesinstantie_id
 where dc.document_id = d.id;

-- ── 4. classificatie_voorstellen (uitsluitend AI-procesclassificatie; B5) ───
-- Metadata-/backfill-review loopt via document_metadata_review_queue (C); dit is
-- bewust een aparte tabel met eigen statusovergangen (decisions/0010).
create table if not exists public.classificatie_voorstellen (
  id                              uuid primary key default uuid_generate_v4(),
  document_id                     uuid not null references public.documenten(id) on delete cascade,
  fonds_id                        uuid not null references public.fondsen(id)    on delete cascade,
  voorgestelde_procesinstantie_id uuid references public.procedures(id)          on delete set null,
  voorgesteld_documenttype        text,
  confidence  text not null check (confidence in ('hoog','middel','laag','geen_match')),
  bron        text not null check (bron       in ('titel','inhoud','periode','synoniem')),
  status      text not null default 'open'
                check (status in ('open','bevestigd','afgewezen','auto_toegepast','teruggedraaid')),
  toelichting     text,
  toegepast_op    timestamptz,
  teruggedraaid_op timestamptz,
  beoordeeld_door uuid references auth.users(id) on delete set null,
  aangemaakt      timestamptz default now()
);

-- Hoogstens één OPEN/auto-toegepast voorstel per document → queue blijft schoon
-- en de backfill is idempotent (on conflict do nothing). Afgehandelde voorstellen
-- (bevestigd/afgewezen/teruggedraaid) blokkeren een nieuw voorstel niet.
create unique index if not exists uq_classificatie_actief_per_document
  on public.classificatie_voorstellen (document_id)
  where status in ('open','auto_toegepast');

create index if not exists idx_classificatie_fonds_status
  on public.classificatie_voorstellen (fonds_id, status);
create index if not exists idx_classificatie_document
  on public.classificatie_voorstellen (document_id);

-- RLS: lezen/schrijven uitsluitend binnen het eigen fonds (anon-key + fonds_id);
-- nooit service-role. Auto-koppeling schrijft de PRIMAIRE documenten.procesinstantie_id
-- onder de bestaande fondsconsistentie-trigger — de classifier koppelt nooit
-- cross-fonds.
alter table public.classificatie_voorstellen enable row level security;

drop policy if exists "fonds classificatie_voorstellen" on public.classificatie_voorstellen;
create policy "fonds classificatie_voorstellen" on public.classificatie_voorstellen
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- ── 5. Verificatie (informatief; verschijnt in de migratie-output) ──────────
do $$
declare
  v_chunks_zonder_denorm bigint;
  v_chunks_totaal        bigint;
begin
  select count(*) into v_chunks_totaal from public.document_chunks;
  select count(*) into v_chunks_zonder_denorm
    from public.document_chunks dc
    join public.documenten d on d.id = dc.document_id
   where dc.documentstatus is null and d.status is not null;
  raise notice 'Increment E denorm-backfill: % van % chunks heeft nog NULL-documentstatus terwijl het document een status draagt (verwacht 0).',
    v_chunks_zonder_denorm, v_chunks_totaal;
end $$;
