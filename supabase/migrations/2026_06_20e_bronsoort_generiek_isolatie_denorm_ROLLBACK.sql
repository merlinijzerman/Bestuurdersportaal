-- ============================================================================
-- ROLLBACK 2026-06-20e — bronsoort + tenant-isolatie generiek + bibliotheek-denorm.
-- ----------------------------------------------------------------------------
-- Draait de schemawijzigingen terug naar de Increment E-staat (2026_06_19e).
-- NIET teruggedraaid: de datacorrectie in §3 van de forward-migratie
-- (generiek+fonds_id -> 'fonds'). Die correctie herstelt een data-integriteits-
-- fout en kent geen betrouwbare originele waarde om naar terug te zetten; bij
-- een rollback blijven die documenten terecht op 'fonds' staan.
--
-- Storage-policies (storage.objects) worden apart beheerd; draai het bijbehorende
-- storage-rollback-blok handmatig terug indien nodig.
-- ============================================================================

-- ── 4. RLS terug: per-command-policies droppen, gecombineerde policy herstellen ──
drop policy if exists "documenten select"             on public.documenten;
drop policy if exists "documenten insert eigen fonds" on public.documenten;
drop policy if exists "documenten update eigen fonds" on public.documenten;
drop policy if exists "documenten delete eigen fonds" on public.documenten;

create policy "fonds documenten" on public.documenten
  for all using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    or bibliotheek = 'generiek'
  );

drop policy if exists "chunks select"           on public.document_chunks;
drop policy if exists "chunks write eigen fonds" on public.document_chunks;

create policy "fonds chunks" on public.document_chunks
  for all using (
    document_id in (
      select id from public.documenten where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
        or bibliotheek = 'generiek'
    )
  );

-- ── 2. Denorm terug naar de E-versie ────────────────────────────────────────
-- AFTER UPDATE-trigger terug zonder de bronsoort-kolommen.
drop trigger if exists trg_chunk_denorm_refresh on public.documenten;
create trigger trg_chunk_denorm_refresh
  after update of procesinstantie_id, vergadering_id, agendapunt_id, documenttype,
                  status, bronstatus, documentdatum, geldig_vanaf, geldig_tot
  on public.documenten
  for each row execute procedure public.fn_chunk_denorm_refresh();

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

-- Terug naar de D-staat (2026_06_20d): de COALESCE-fix BLIJFT behouden, alleen de
-- 4 bronsoort-velden vervallen. NIET terug naar de kale E-versie.
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
  end if;
  return new;
end;
$$;

-- DROP eerst: het return-type krimpt terug (4 kolommen eraf) en dat kan
-- create-or-replace niet. Triggers binden laat via naam, dus veilig.
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

drop index if exists public.idx_chunks_bronsoort;
alter table public.document_chunks
  drop column if exists bibliotheek,
  drop column if exists bronorganisatie,
  drop column if exists normgewicht,
  drop column if exists extern_url;

-- ── 1. Bronsoort-kolommen op documenten droppen ─────────────────────────────
alter table public.documenten drop constraint if exists documenten_normgewicht_check;
alter table public.documenten
  drop column if exists bronorganisatie,
  drop column if exists extern_url,
  drop column if exists normgewicht;
