-- ============================================================================
-- WP3 legacy-scan — globale serialisatie via een "legacy-slot" (Refs #500).
-- ----------------------------------------------------------------------------
-- PROBLEEM. LEGACY_SCAN_BATCH=1 garandeerde niet dat er één legacy-document
-- tegelijk in de keten (scan → extractie → prefix → embedding → finaliseer)
-- zit: de reaper telde eerst de lopende scans en enqueuede daarna, in losse
-- PostgREST-requests. De cron draait elke minuut en een aanroep duurt tot
-- 300 s, dus twee overlappende aanroepen konden allebei "0 lopend" lezen en
-- elk een ander document starten. Race-vrij tellen-en-inserten kan niet in
-- losse requests; de kleinste DB-garantie is een partiële unieke index.
--
-- WIJZIGING (additief, geen datamigratie, geen RLS-/grantwijziging).
--   1. document_processing_jobs.legacy_slot smallint NULL, CHECK 1..2 — de
--      herkenbare markering van een legacy-rescanjob. Die ene job draagt de
--      hele keten (de worker yieldt/backofft op dezelfde rij en finaliseert
--      pas na de embeddings), dus "in de keten" = open job met legacy_slot.
--      Gewone uploads en pipelinejobs krijgen nooit een slot (NULL).
--   2. uq_dpj_legacy_slot_open: UNIQUE (legacy_slot) WHERE legacy_slot IS NOT
--      NULL AND status IN ('wachtend','bezig'). Twee gelijktijdige inserts op
--      hetzelfde slot: de tweede krijgt 23505. De reaper gebruikt alleen slots
--      1..LEGACY_SCAN_BATCH, dus hooguit BATCH (≤ 2) legacy-documenten
--      tegelijk, over alle workeraanroepen heen.
--   Terminale jobstatussen (geslaagd/mislukt/overgeslagen, ook via de
--   claimlimiet in documenten_claim_ingest_jobs) vallen buiten de index en
--   geven het slot vrij. De claim-RPC (returns setof … j.*) neemt de kolom
--   vanzelf mee; geen functiewijziging.
--
-- VOLGORDE. Eerst deze migratie (portal_preview, later portal_production), dan
-- de code. Oude code negeert de kolom. Nieuwe code zonder migratie: de insert
-- met legacy_slot faalt (PGRST204/42703) → de reaper enqueuet geen legacy-scan
-- (fail-closed; gewone pipeline ongewijzigd).
-- Idempotent. ROLLBACK: supabase/rollbacks/2026_09_30_legacy_scan_slot_ROLLBACK.sql
-- DB-/API-bewijs: scripts/legacy-scan-overlap.mts (in scripts/cross-tenant-ci.sh).
-- ============================================================================

begin;

alter table public.document_processing_jobs
  add column if not exists legacy_slot smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.document_processing_jobs'::regclass
       and conname = 'document_processing_jobs_legacy_slot_check'
  ) then
    alter table public.document_processing_jobs
      add constraint document_processing_jobs_legacy_slot_check
      check (legacy_slot is null or legacy_slot between 1 and 2);
  end if;
end $$;

comment on column public.document_processing_jobs.legacy_slot is
  'WP3 legacy-rescan: slot 1..LEGACY_SCAN_BATCH (max 2). Markeert de job die de hele legacy-keten draagt; uq_dpj_legacy_slot_open serialiseert.';

create unique index if not exists uq_dpj_legacy_slot_open
  on public.document_processing_jobs (legacy_slot)
  where legacy_slot is not null and status in ('wachtend', 'bezig');

commit;
