-- ============================================================================
-- Migratie 2026-06-22x — OCR-audit op documenten (besluit 0020)
-- ----------------------------------------------------------------------------
-- Audit-/herleidbaarheidsvelden voor de OCR-fallback bij beeld-only PDF's.
-- OCR (Mistral `mistral-ocr-latest`) draait alleen als de tekstlaag te dun is
-- en verandert uitsluitend de extractie-INPUT, niet de broninhoud. Deze velden
-- leggen per document vast óf OCR is toegepast en met welke engine.
--
-- Additief, nullable en idempotent: geen RLS-wijziging, geen impact op
-- bestaande rijen (default false / NULL). Eerst in Supabase draaien, dán de
-- code-deploy die ze vult — de her-extract-route schrijft ze best-effort, dus
-- een ontbrekende kolom breekt de route niet, maar deze migratie hoort vóór.
-- ============================================================================

alter table public.documenten
  add column if not exists ocr_toegepast boolean not null default false,
  add column if not exists ocr_engine    text;

comment on column public.documenten.ocr_engine is
  'OCR-engine indien toegepast bij extractie, bv. mistral:mistral-ocr-latest. NULL = tekstlaag gebruikt (geen OCR).';
comment on column public.documenten.ocr_toegepast is
  'True als de inhoud via OCR-fallback is verkregen i.p.v. de PDF-tekstlaag (besluit 0020).';
