-- ============================================================================
-- ROLLBACK van 2026_08_06_status_bij_ingest.sql
-- ----------------------------------------------------------------------------
-- Zet fn_document_status_transitie terug naar de vorm van
-- 2026_06_18_documentstatus_metadata.sql: zonder de twee ingest-regels.
--
-- ⚠️ Draai dit ALLEEN samen met een code-rollback van besluit 0136. De
-- server-side poort zit in app/api/documents/upload/route.ts en leest
-- core/lib/document-status-transities.ts, niet deze functie. Draai je alleen
-- deze rollback, dan blijft de ingest-verklaring werken en loopt de SQL-spiegel
-- juist wél uit de pas — het omgekeerde van wat je wilt.
--
-- Geen datawijziging: documenten die al met een verklaarde status zijn
-- aangeleverd, behouden die status en hun auditregel.
-- ============================================================================

begin;

drop function if exists public.fn_document_status_transitie(text, text);
create function public.fn_document_status_transitie(
  p_van text, p_naar text
)
returns table (
  toegestaan boolean,
  redenplicht boolean,
  vereist_vervangen_door boolean,
  herindexering boolean,
  bruikbaar_actueel boolean
)
language sql immutable as $$
  select t.toegestaan::boolean,
         t.redenplicht::boolean,
         t.vereist_vervangen_door::boolean,
         t.herindexering::boolean,
         t.bruikbaar_actueel::boolean
  from (values
    ('concept',           'ter_bespreking',     true,  false, false, true,  false),
    ('ter_bespreking',    'ter_besluitvorming', true,  false, false, true,  false),
    ('ter_besluitvorming','vastgesteld',        true,  true,  false, true,  true ),
    ('vastgesteld',       'van_kracht',         true,  false, false, true,  true ),
    ('van_kracht',        'vervangen',          true,  true,  true,  true,  false),
    ('van_kracht',        'alleen_historisch',  true,  true,  false, true,  false),
    ('concept',           'gearchiveerd',       true,  true,  false, true,  false),
    ('ter_bespreking',    'gearchiveerd',       true,  true,  false, true,  false),
    ('ter_besluitvorming','gearchiveerd',       true,  true,  false, true,  false),
    ('vastgesteld',       'gearchiveerd',       true,  true,  false, true,  false),
    ('van_kracht',        'gearchiveerd',       true,  true,  false, true,  false),
    ('vervangen',         'gearchiveerd',       true,  true,  false, true,  false),
    ('alleen_historisch', 'gearchiveerd',       true,  true,  false, true,  false)
  ) as t(van, naar, toegestaan, redenplicht, vereist_vervangen_door, herindexering, bruikbaar_actueel)
  where t.van = p_van and t.naar = p_naar;
$$;

commit;
