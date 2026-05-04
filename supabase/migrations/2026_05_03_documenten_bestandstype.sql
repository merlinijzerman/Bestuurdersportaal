-- ============================================================
--  Migratie 2026-05-03 — Documenten: bestandstype-kolom
--
--  Aanvulling op de eerdere documenten-migratie. We ondersteunen nu
--  meerdere uploadformaten naast PDF (.docx, .xlsx) en willen op
--  recordniveau weten welk type het is — voor:
--    1. de download-route (juiste Content-Type + extensie)
--    2. de UI (icon en label per type)
--    3. de opslag-pad-conventie (extensie achter het document_uuid)
--
--  Bestaande PDF-records krijgen automatisch 'pdf' als waarde.
-- ============================================================

alter table public.documenten
  add column if not exists bestandstype text not null default 'pdf';

alter table public.documenten
  drop constraint if exists documenten_bestandstype_check;

alter table public.documenten
  add constraint documenten_bestandstype_check
    check (bestandstype in ('pdf', 'docx', 'xlsx'));

create index if not exists idx_documenten_bestandstype
  on public.documenten(bestandstype);

-- Pad-conventie wordt nu:
--   <fonds_uuid>/<document_uuid>.<bestandstype>  (fonds-bibliotheek)
--   generiek/<document_uuid>.<bestandstype>      (generieke bibliotheek)
--
-- Bestaande records met opslag_pad eindigend op .pdf blijven geldig;
-- nieuwe uploads gebruiken automatisch de juiste extensie.
