-- ============================================================================
-- Migratie 2026-06-24 — Increment P1: Generieke documentcuratie (platform).
-- ----------------------------------------------------------------------------
-- Voegt de DATA-laag toe waarop de platform-back-office-curatie van generieke
-- (sectorbrede, fonds-overstijgende) documenten rust. Volledig ADDITIEF: geen
-- wijziging aan tenant-RLS, profielen of bestaande documenten-policies.
--
-- Leidend: FO Platform-beheermodule (Increment P) v0.3 §8.1/§8.2/§8.3 + §21.1;
-- decisions/0021 (P0-fundament), 0006 (B12/B13/B14), 0001 (append-only, geen
-- harddelete), 0007 (fondsconsistentie). Bouwkeuzes: decisions/0022.
--
-- Inhoud (in volgorde):
--   1. documenten: toepasbaarheidsmetadata (B11) + uploadsecurity-velden (§8.2),
--      nullable/additief. RAG-availability-gate werkt via afwezigheid van chunks
--      (een geweigerd/gequarantineerd doc bereikt de chunking-stap nooit), dus
--      de retrieval-RPC's blijven ONGEWIJZIGD.
--   2. bestandstype-CHECK uitbreiden met 'pptx' (§8.2 vereist PPTX).
--   3. Deduplicatie-index op bestand_hash binnen de generieke bibliotheek.
--   4. document_processing_jobs: lichte per-stap pipelineregistratie (§8.2),
--      platform-intern (deny-by-default voor de anon-key, zoals de P0-tabellen).
--
-- Versiemodel (§8.3, decisions/0022): hergebruikt de BESTAANDE self-FK's
-- documenten.vervangt_document_id / vervangen_door_document_id + de bestaande
-- statustransitie van_kracht→alleen_historisch. Geen nieuwe versiekolom.
--
-- Normgewicht-gate voor RAG (acceptatiecriterium #6) zit in de CODE
-- (lib/rag.ts, default-uitsluiting van generiek normgewicht=informatief|onbekend),
-- niet in dit schema: normgewicht is al gedenormaliseerd op document_chunks
-- (2026_06_20e) en stroomt al door via de bestaande denorm-trigger.
--
-- Storage: de quarantainezone (§8.2) staat in een APART storage-blok
-- (2026_06_24_storage_quarantaine.sql) dat — net als 2026_06_20e_storage —
-- handmatig in Supabase wordt gedraaid (storage.objects/buckets).
--
-- Idempotent. EERST in Supabase draaien, DAN code-deploy (anders breken de
-- nieuwe CHECK-constraints). ROLLBACK: 2026_06_24_p1_generieke_curatie_ROLLBACK.sql.
-- ============================================================================

-- ── 1. documenten: toepasbaarheids- + uploadsecurity-velden (additief) ──────
alter table public.documenten
  add column if not exists toepassingsgebied   text,
  add column if not exists regelingstype       text,
  add column if not exists doelgroep           text,
  add column if not exists thema               text,
  add column if not exists statusinterpretatie text,
  add column if not exists verwerkingsstatus   text,
  add column if not exists scan_resultaat      jsonb,
  add column if not exists bestand_hash        text,
  add column if not exists mime_gedetecteerd   text;

do $$
begin
  -- regelingstype-enum (FO §8.1). NULL toegestaan (default 'algemeen' zet de UI).
  alter table public.documenten drop constraint if exists documenten_regelingstype_check;
  alter table public.documenten add  constraint documenten_regelingstype_check
    check (regelingstype is null or regelingstype in
      ('FTK','SPR','FPR','CVP','algemeen'));

  -- verwerkingsstatus = afgeleide hoofdstatus van de pipeline (§8.2). NULL =
  -- "niet via de generieke pipeline ingevoerd" (alle bestaande/tenant-docs);
  -- retrieval behandelt zo'n doc als beschikbaar zolang het chunks heeft. De
  -- gate "geen RAG vóór beschikbaar" werkt voor generiek via de pipeline:
  -- geweigerd/gequarantineerd → nooit chunks → nooit in RAG.
  alter table public.documenten drop constraint if exists documenten_verwerkingsstatus_check;
  alter table public.documenten add  constraint documenten_verwerkingsstatus_check
    check (verwerkingsstatus is null or verwerkingsstatus in
      ('ontvangen','gevalideerd','gescand','extractie','chunking','embedding',
       'beschikbaar','geweigerd','gequarantineerd','mislukt'));
end $$;

-- ── 2. bestandstype: PPTX erbij (§8.2) ──────────────────────────────────────
-- Drop+add: de bestaande CHECK (2026_05_03) staat alleen pdf/docx/xlsx toe.
alter table public.documenten drop constraint if exists documenten_bestandstype_check;
alter table public.documenten add  constraint documenten_bestandstype_check
  check (bestandstype in ('pdf','docx','pptx','xlsx'));

-- ── 3. Deduplicatie op inhoud-hash binnen de generieke bibliotheek (§8.2) ────
-- Partial-unique: zelfde inhoud niet dubbel gecureerd. Bewust alleen generiek
-- (de platform-pipeline zet bestand_hash); tenant-uploads raken dit niet.
create unique index if not exists ux_documenten_generiek_hash
  on public.documenten (bestand_hash)
  where bibliotheek = 'generiek' and bestand_hash is not null;

create index if not exists idx_documenten_verwerkingsstatus
  on public.documenten (verwerkingsstatus) where verwerkingsstatus is not null;

-- ── 4. document_processing_jobs — per-stap pipelineregistratie (§8.2, §21.1) ─
-- Voedt P5-pipelinegezondheid + gerichte herverwerking. Lichte variant: de
-- stappen worden SYNCHROON door de server-action geschreven (geen queue/worker
-- in P1; volwaardige async-orchestratie = TO/P5). NIET append-only: status en
-- retry_count zijn operationele state die mag muteren. Platform-intern:
-- deny-by-default voor de anon-key (zoals de P0-tabellen); toegang loopt
-- uitsluitend via de service-role achter withPlatform.
create table if not exists public.document_processing_jobs (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.documenten(id) on delete cascade,
  versie_id     uuid references public.documenten(id) on delete set null,
  stap          text not null check (stap in
                  ('validatie','scan','extractie','ocr','chunking','embedding','indexering')),
  status        text not null default 'wachtend' check (status in
                  ('wachtend','bezig','geslaagd','mislukt','overgeslagen')),
  start         timestamptz,
  eind          timestamptz,
  foutcode      text,
  retry_count   integer not null default 0,
  worker_id     text,
  correlatie_id uuid,           -- = platform_event_log.correlatie_id (audit-koppeling)
  aangemaakt    timestamptz not null default now()
);

create index if not exists idx_dpj_document   on public.document_processing_jobs (document_id, aangemaakt);
create index if not exists idx_dpj_status     on public.document_processing_jobs (status) where status in ('wachtend','bezig','mislukt');
create index if not exists idx_dpj_correlatie on public.document_processing_jobs (correlatie_id);

alter table public.document_processing_jobs enable row level security;
-- Deny-by-default: bewust GEEN policy. De anon-key ziet/raakt deze tabel niet;
-- de service-role (achter withPlatform) bypasst RLS. Tenant-RLS ongemoeid.

-- ── 5. Verificatie (informatief; verschijnt in de migratie-output) ──────────
do $$
declare
  v_pptx_ok boolean;
begin
  -- bestandstype-CHECK accepteert nu pptx?
  select exists (
    select 1 from pg_constraint
     where conname = 'documenten_bestandstype_check'
       and pg_get_constraintdef(oid) like '%pptx%'
  ) into v_pptx_ok;
  raise notice 'P1: bestandstype-CHECK accepteert pptx = % (verwacht t).', v_pptx_ok;

  raise notice 'P1: document_processing_jobs RLS aan = %.',
    (select relrowsecurity from pg_class where relname = 'document_processing_jobs');
end $$;
