-- ============================================================================
-- ROLLBACK bij 2026-06-24 — Increment P1: Generieke documentcuratie.
-- ----------------------------------------------------------------------------
-- Draait 2026_06_24_p1_generieke_curatie.sql terug. Pré-productie-vangnet:
-- alleen draaien als de code-deploy is teruggerold, anders breken de
-- server-actions (verwerkingsstatus/processing-jobs) die op dit schema rusten.
--
-- Volgorde gespiegeld t.o.v. de forward-migratie. Idempotent. RAII-zwaar
-- (drop ... if exists) zodat een halve forward-run ook netjes opruimt.
--
-- LET OP — datavlag: bestaande generieke documenten die ná de forward-migratie
-- als 'pptx' zijn gecureerd, schenden ná deze rollback de oude
-- bestandstype-CHECK ('pdf','docx','xlsx'). De CHECK-herstelstap hieronder zou
-- dan FALEN. Controleer vooraf:
--   select id, titel from public.documenten where bestandstype = 'pptx';
-- en herstel/verwijder die rijen handmatig vóór de rollback (geen harddelete
-- zonder afweging — decisions/0001).
-- ============================================================================

-- ── 4. document_processing_jobs (incl. indexen, FK's, RLS vervallen mee) ─────
drop table if exists public.document_processing_jobs;

-- ── 3. Indexen op documenten ────────────────────────────────────────────────
drop index if exists public.ux_documenten_generiek_hash;
drop index if exists public.idx_documenten_verwerkingsstatus;

-- ── 2. bestandstype-CHECK terug naar de 2026_05_03-staat (zonder pptx) ───────
-- Faalt bewust als er nog 'pptx'-rijen bestaan (zie datavlag in de header).
alter table public.documenten drop constraint if exists documenten_bestandstype_check;
alter table public.documenten add  constraint documenten_bestandstype_check
  check (bestandstype in ('pdf','docx','xlsx'));

-- ── 1. CHECK-constraints + kolommen van de forward-migratie ─────────────────
alter table public.documenten drop constraint if exists documenten_regelingstype_check;
alter table public.documenten drop constraint if exists documenten_verwerkingsstatus_check;

alter table public.documenten
  drop column if exists toepassingsgebied,
  drop column if exists regelingstype,
  drop column if exists doelgroep,
  drop column if exists thema,
  drop column if exists statusinterpretatie,
  drop column if exists verwerkingsstatus,
  drop column if exists scan_resultaat,
  drop column if exists bestand_hash,
  drop column if exists mime_gedetecteerd;

-- Storage-quarantaine staat in een apart blok; rol die los terug via
-- 2026_06_24_storage_quarantaine.sql (ROLLBACK-sectie onderaan dat bestand).
