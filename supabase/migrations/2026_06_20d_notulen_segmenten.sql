-- ============================================================================
-- Migratie 2026-06-20d — Increment D: Notulen op agendapuntniveau (bron=upload).
-- ----------------------------------------------------------------------------
-- Geüploade notulen (documenttype='notulen') worden op agendapuntniveau
-- benutbaar. Het systeem stelt half-automatisch segmenten voor (regelgebaseerd,
-- lib/notulen.ts), de secretaris bevestigt ze (capability notulen.segment.confirm),
-- en pas BEVESTIGDE segmenten worden geïndexeerd en door de AI gebruikt — met
-- bronvermelding "Vastgestelde notulen [vergadering], agendapunt N — [titel]".
--
-- Leidend: roadmap v1.2 §2 (ticket D), FO v1.2 §8 (Module 6), TO v1.2 §2.5,
-- decisions/0006 (B6 half-automatisch), 0007/0008 (fondsconsistentie),
-- 0010 (E-denorm + fn_chunk_denorm). De vijf D-keuzes: decisions/0011.
--
-- Deze migratie doet vijf dingen (additief, idempotent, if not exists):
--   1. Tabel notulen_segmenten (per agendapunt segmenteerbaar; bevestigd-gate).
--   2. Integriteitstrigger op notulen_segmenten (documenttype=notulen;
--      agendapunt↔vergadering; fondsconsistentie segment↔document↔vergadering).
--   3. COALESCE-FIX op de E-trigger fn_chunk_denorm_before_insert(): een reeds op
--      de NEW-rij gezette agendapunt_id/vergadering_id blijft staan (segmentchunk
--      draagt zijn EIGEN agendapuntcontext, niet die van het document). HARDE
--      voorwaarde (keuze 5) — anders krijgen segmentchunks de verkeerde context.
--   4. Markerkolom document_chunks.notulen_segment_id (onderscheidt segmentchunks
--      van whole-document-chunks; on delete cascade ruimt segmentchunks op).
--   5. RPC's fn_notulen_segment_bevestig/_ontbevestig/_verwijder — TRANSACTIONEEL
--      vervangen (keuze 2) + append-only audit in DEZELFDE transactie: bij de
--      eerste bevestiging worden de whole-document-chunks verwijderd en de
--      segmentchunks neergezet, mét de logregel. Idempotent / herhaalbaar.
--
-- Indexering = VERVANGING (keuze 2): voor documenttype='notulen' vervangen de
-- segmentchunks de whole-document-chunks. Onbevestigde segmenten produceren nooit
-- chunks. Nooit-gesegmenteerde notulen behouden hun whole-document-chunks.
--
-- Actieve-besluitbron-gate (§11.1): indexering vereist documenten.status =
-- 'vastgesteld' (hergebruik C-statusmodel; geen nieuw statusveld). Concept-notulen
-- krijgen daardoor nooit segmentchunks → "concept ≠ actieve bron" zonder de
-- retrieval-RPC's te wijzigen (statusfilter blijft Increment G).
--
-- Tenant-isolatie: notulen_segmenten draagt fonds_id + eigen RLS-policy (anon-key,
-- nooit service-role). Segmentchunks erven de bestaande "fonds chunks"-policy via
-- de join op documenten (document_chunks heeft géén eigen fonds_id).
--
-- Backfill: n.v.t. (nieuwe entiteit). Idempotent. EERST in Supabase draaien, DAN
-- code-deploy. ROLLBACK: 2026_06_20d_notulen_segmenten_ROLLBACK.sql.
-- ============================================================================

-- ── 1. Tabel notulen_segmenten ──────────────────────────────────────────────
create table if not exists public.notulen_segmenten (
  id             uuid primary key default uuid_generate_v4(),
  document_id    uuid not null references public.documenten(id)    on delete cascade,
  vergadering_id uuid not null references public.vergaderingen(id) on delete cascade,
  agendapunt_id  uuid          references public.agendapunten(id)  on delete set null,
  fonds_id       uuid not null references public.fondsen(id)       on delete cascade,
  segment_index  int  not null,
  titel          text,
  tekst          text not null,
  bevestigd      boolean not null default false,
  bevestigd_door uuid references auth.users(id) on delete set null,
  bevestigd_op   timestamptz,
  aangemaakt     timestamptz not null default now(),
  unique (document_id, segment_index)
);

create index if not exists idx_notulen_seg_doc
  on public.notulen_segmenten (document_id, segment_index);

-- Partial index: snelle lookup van bevestigde segmenten per agendapunt (de
-- enige set die de AI als agendapuntbron gebruikt).
create index if not exists idx_notulen_seg_agendapunt_bevestigd
  on public.notulen_segmenten (agendapunt_id)
  where bevestigd;

comment on table public.notulen_segmenten is
  'Increment D — half-automatische notulensegmenten per agendapunt. Alleen bevestigd=true wordt geïndexeerd (document_chunks) en door de AI als agendapuntbron gebruikt.';

-- ── 2. Integriteitstrigger (cross-tabel; geen FK kan dit uitdrukken) ─────────
-- Spiegelt fn_document_agendapunt_vergadering_check (C) + fondsconsistentie
-- (0007/0008). Eén BEFORE INSERT/UPDATE-trigger, drie regels.
create or replace function public.fn_notulen_segment_check()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_doc_type   text;
  v_doc_fonds  uuid;
  v_verg_fonds uuid;
  v_ap_verg    uuid;
begin
  -- Regel 1: document moet bestaan en documenttype='notulen' dragen.
  select documenttype, fonds_id into v_doc_type, v_doc_fonds
    from public.documenten where id = new.document_id;
  if not found then
    raise exception 'Notulensegment verwijst naar onbekend document %', new.document_id;
  end if;
  if v_doc_type is distinct from 'notulen' then
    raise exception 'Notulensegment mag alleen bij een document met documenttype=''notulen'' (document % heeft type %).',
      new.document_id, coalesce(v_doc_type, '(null)');
  end if;

  -- Regel 2: als agendapunt gezet — het moet bij DEZE vergadering horen (C-regel 3b).
  if new.agendapunt_id is not null then
    select vergadering_id into v_ap_verg
      from public.agendapunten where id = new.agendapunt_id;
    if v_ap_verg is null then
      raise exception 'Agendapunt % bestaat niet', new.agendapunt_id;
    end if;
    if new.vergadering_id is distinct from v_ap_verg then
      raise exception 'Agendapunt % hoort niet bij de opgegeven vergadering % (maar bij %).',
        new.agendapunt_id, new.vergadering_id, v_ap_verg;
    end if;
  end if;

  -- Regel 3: fondsconsistentie segment ↔ document ↔ vergadering.
  select fonds_id into v_verg_fonds
    from public.vergaderingen where id = new.vergadering_id;
  if v_verg_fonds is null then
    raise exception 'Vergadering % bestaat niet', new.vergadering_id;
  end if;
  if new.fonds_id is distinct from v_doc_fonds then
    raise exception 'Notulensegment-fonds % wijkt af van documentfonds %.', new.fonds_id, v_doc_fonds;
  end if;
  if new.fonds_id is distinct from v_verg_fonds then
    raise exception 'Notulensegment-fonds % wijkt af van vergaderingfonds %.', new.fonds_id, v_verg_fonds;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notulen_segment_check on public.notulen_segmenten;
create trigger trg_notulen_segment_check
  before insert or update on public.notulen_segmenten
  for each row execute procedure public.fn_notulen_segment_check();

-- ── 3. COALESCE-fix op de E-trigger (keuze 5, harde voorwaarde) ─────────────
-- E's fn_chunk_denorm_before_insert() overschreef agendapunt_id/vergadering_id
-- ALTIJD met de documentwaarde. Voor notulensegmentchunks zetten we die velden
-- al op de NEW-rij (de segment-agendapunt kan AFWIJKEN van het document). Coalesce
-- behoudt een reeds gezette waarde; de overige denorm blijft hard uit het document.
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
    -- COALESCE: een per-segment gezette koppeling blijft staan (D); anders erft
    -- de chunk de documentkoppeling (alle niet-segment-chunks).
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
-- Trigger zelf is in E al aangemaakt (trg_chunk_denorm_before_insert); create or
-- replace op de functie volstaat. Geen wijziging aan fn_chunk_denorm_refresh().

-- ── 4. Markerkolom op document_chunks ───────────────────────────────────────
-- Onderscheidt segmentchunks (notulen_segment_id gezet) van whole-document-chunks
-- (null). on delete cascade: een segment verwijderen ruimt zijn chunks op.
alter table public.document_chunks
  add column if not exists notulen_segment_id uuid
    references public.notulen_segmenten(id) on delete cascade;

create index if not exists idx_chunks_notulen_segment
  on public.document_chunks (notulen_segment_id)
  where notulen_segment_id is not null;

-- ── 5. RPC's: mutatie + chunk-opruiming + APPEND-ONLY AUDIT in ÉÉN transactie ─
-- Keuze 2 — segmentchunks vervangen whole-document-chunks. Elke RPC is één
-- transactie: de chunk-mutatie én de logregel in document_metadata_log slagen of
-- falen samen, zodat een (onomkeerbare) bron-mutatie NOOIT ongelogd kan blijven
-- (audit-evidence-review D, R2-precedent uit decisions/0010). security invoker →
-- RLS blijft gelden (geen service-role); de log-insert valt onder de bestaande
-- policy "schrijf document_metadata_log" (gewijzigd_door = auth.uid()) en de
-- hash-/immutability-triggers. De app levert chunks + embeddings (Mistral hoort
-- niet in SQL) en een optionele reden.

-- Gedeelde helper: schrijf één append-only auditregel voor een notulensegment.
create or replace function public.fn_notulen_segment_audit(
  p_document_id uuid,
  p_veld        text,
  p_oud         text,
  p_nieuw       text,
  p_reden       text,
  p_rag_impact  boolean
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_titel text;
  v_fonds uuid;
  v_naam  text;
begin
  select titel, fonds_id into v_titel, v_fonds from public.documenten where id = p_document_id;
  select naam into v_naam from public.profielen where id = auth.uid();
  insert into public.document_metadata_log (
    document_id, document_titel_snapshot, fonds_id,
    gewijzigd_door, gewijzigd_door_naam,
    veld_naam, oude_waarde, nieuwe_waarde, wijzig_reden, wijzig_type, rag_impact
  ) values (
    p_document_id, v_titel, v_fonds,
    auth.uid(), v_naam,
    p_veld, p_oud, p_nieuw, p_reden, 'notulen_segment', p_rag_impact
  );
end;
$$;

-- 5a. Bevestigen + (her)indexeren. p_chunks: jsonb-array van { chunk_index int,
--     tekst text, pagina int|null, paragraaf text|null, embedding text|null
--     (pgvector-literal), embedding_model text|null }.
create or replace function public.fn_notulen_segment_bevestig(
  p_segment_id uuid,
  p_chunks     jsonb,
  p_reden      text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_seg      record;
  v_status   text;
  v_base     int;
begin
  -- Segment laden (RLS filtert op fonds; not found = geen toegang).
  select id, document_id, vergadering_id, agendapunt_id, bevestigd
    into v_seg
    from public.notulen_segmenten
   where id = p_segment_id;
  if not found then
    raise exception 'Notulensegment % niet gevonden (of geen toegang).', p_segment_id;
  end if;

  -- Actieve-besluitbron-gate (§11.1): alleen vastgestelde notulen indexeren.
  select status into v_status from public.documenten where id = v_seg.document_id;
  if v_status is distinct from 'vastgesteld' then
    raise exception 'Notulen % zijn niet vastgesteld (status=%); indexering geweigerd.',
      v_seg.document_id, coalesce(v_status, '(null)');
  end if;

  -- Lege-segment-guard: nooit de whole-document-chunks weggooien zonder vervanging.
  if p_chunks is null or jsonb_array_length(p_chunks) = 0 then
    raise exception 'Notulensegment % levert geen chunks op; indexering geweigerd.', p_segment_id;
  end if;

  -- Bevestiging vastleggen.
  update public.notulen_segmenten
     set bevestigd = true, bevestigd_door = auth.uid(), bevestigd_op = now()
   where id = p_segment_id;

  -- Eerste-bevestiging-vervanging: whole-document-chunks weg (idempotent), dan dit
  -- segment opnieuw.
  delete from public.document_chunks
   where document_id = v_seg.document_id and notulen_segment_id is null;
  delete from public.document_chunks
   where notulen_segment_id = p_segment_id;

  -- chunk_index-offset zodat segmenten elkaar niet overschrijven.
  select coalesce(max(chunk_index), -1) + 1 into v_base
    from public.document_chunks where document_id = v_seg.document_id;

  -- Nieuwe segmentchunks. agendapunt_id/vergadering_id van het SEGMENT; de BEFORE
  -- INSERT-trigger (met COALESCE-fix) behoudt ze en vult de overige denorm.
  insert into public.document_chunks (
    document_id, chunk_index, tekst, pagina, paragraaf,
    embedding, embedding_model, notulen_segment_id, vergadering_id, agendapunt_id
  )
  select
    v_seg.document_id,
    v_base + (c->>'chunk_index')::int,
    c->>'tekst',
    (c->>'pagina')::int,
    c->>'paragraaf',
    case when coalesce(c->>'embedding', '') <> '' then (c->>'embedding')::vector else null end,
    nullif(c->>'embedding_model', ''),
    p_segment_id,
    v_seg.vergadering_id,
    v_seg.agendapunt_id
  from jsonb_array_elements(p_chunks) as c;

  -- Append-only audit in dezelfde transactie.
  perform public.fn_notulen_segment_audit(
    v_seg.document_id, 'segment_bevestigd',
    case when v_seg.bevestigd then 'true' else 'false' end, 'true',
    p_reden, true
  );
end;
$$;

-- 5b. Ont-bevestigen: chunks opruimen (whole-document-chunks NIET herstellen).
create or replace function public.fn_notulen_segment_ontbevestig(
  p_segment_id uuid,
  p_reden      text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_seg record;
begin
  select id, document_id, bevestigd into v_seg
    from public.notulen_segmenten where id = p_segment_id;
  if not found then
    raise exception 'Notulensegment % niet gevonden (of geen toegang).', p_segment_id;
  end if;

  update public.notulen_segmenten
     set bevestigd = false, bevestigd_door = null, bevestigd_op = null
   where id = p_segment_id;

  delete from public.document_chunks where notulen_segment_id = p_segment_id;

  perform public.fn_notulen_segment_audit(
    v_seg.document_id, 'segment_bevestigd', 'true', 'false', p_reden, true
  );
end;
$$;

-- 5c. Verwijderen: cascade ruimt de segmentchunks op; audit met snapshot vóór delete.
create or replace function public.fn_notulen_segment_verwijder(
  p_segment_id uuid,
  p_reden      text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_seg record;
begin
  select id, document_id, titel, bevestigd into v_seg
    from public.notulen_segmenten where id = p_segment_id;
  if not found then
    raise exception 'Notulensegment % niet gevonden (of geen toegang).', p_segment_id;
  end if;

  delete from public.notulen_segmenten where id = p_segment_id;

  perform public.fn_notulen_segment_audit(
    v_seg.document_id, 'segment_verwijderd', v_seg.titel, null, p_reden, v_seg.bevestigd
  );
end;
$$;

comment on function public.fn_notulen_segment_bevestig(uuid, jsonb, text) is
  'Increment D — bevestigen + transactioneel (her)indexeren van één notulensegment (vervangt whole-document-chunks, keuze 2) + append-only audit, alles in één transactie. Vereist documenten.status=''vastgesteld''.';

-- ── 6. RLS op notulen_segmenten (per fonds_id; anon-key, nooit service-role) ─
alter table public.notulen_segmenten enable row level security;

drop policy if exists "fonds notulen_segmenten" on public.notulen_segmenten;
create policy "fonds notulen_segmenten" on public.notulen_segmenten
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- ── 7. Verificatie (informatief; verschijnt in de migratie-output) ──────────
do $$
declare
  v_orphan bigint;
begin
  -- Segmentchunks waarvan het bovenliggende document niet (meer) 'notulen' is —
  -- verwacht 0 (de integriteitstrigger borgt het bij de segment-insert).
  select count(*) into v_orphan
    from public.document_chunks dc
    join public.documenten d on d.id = dc.document_id
   where dc.notulen_segment_id is not null
     and d.documenttype is distinct from 'notulen';
  raise notice 'Increment D: % segmentchunks horen bij een niet-notulen-document (verwacht 0).', v_orphan;
end $$;
