-- ============================================================================
-- Migratie 2026-08-06 — Statusverklaring bij ingest: SQL-spiegel bijwerken
-- ----------------------------------------------------------------------------
-- WAAROM (besluit 0136): de statustransitietabel modelleert een document dat
-- IN het portaal ontstaat en via bestuurlijke besluitvorming rijpt. Een
-- pensioenreglement of jaarverslag dat je uploadt, is buiten het portaal al
-- vastgesteld. Dat door de keten duwen (concept -> ter_bespreking ->
-- ter_besluitvorming -> vastgesteld) laat in document_metadata_log een spoor
-- achter van drie bestuurlijke overgangen die nooit hebben plaatsgevonden.
-- Voor de aantoonbaarheid is dat slechter, niet beter.
--
-- Daarom twee nieuwe transities vanaf de pseudo-herkomst `upload`:
--     upload -> vastgesteld   (redenplicht, actuele bron na overgang)
--     upload -> van_kracht    (redenplicht, actuele bron na overgang)
--
-- WAT DEZE MIGRATIE WEL EN NIET DOET.
--   De statusovergang-trigger staat op `before update of status` en raakt dit
--   pad dus NIET: bij een upload is er geen oude status. De ingest-poort zit
--   volledig server-side in app/api/documents/upload/route.ts (transitietabel
--   + capability + redenplicht).
--   Deze migratie bestaat om de SQL-tweeling fn_document_status_transitie
--   1-op-1 gelijk te houden aan core/lib/document-status-transities.ts, zoals
--   de kop van 2026_06_18_documentstatus_metadata.sql voorschrijft. Zonder deze
--   update zou de spiegel stilzwijgend achterlopen — en dan is de functie geen
--   betrouwbare tweede lezing meer van wat er is toegestaan.
--
-- KETEN ONGEMOEID: er wordt niets verruimd vanaf `concept`. De bestaande rijen
-- zijn byte-identiek overgenomen; er komen alleen twee regels bij.
--
-- Idempotent (drop + create, zelfde patroon als de oorspronkelijke migratie).
-- Geen tabelwijziging, geen RLS-wijziging, geen datawijziging.
-- ROLLBACK: 2026_08_06_status_bij_ingest_ROLLBACK.sql
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
    -- Ingest-verklaringen (besluit 0136). `upload` is een pseudo-herkomst en
    -- komt nooit als old.status voor, dus de trigger raakt deze rijen niet.
    ('upload',            'vastgesteld',        true,  true,  false, true,  true ),
    ('upload',            'van_kracht',         true,  true,  false, true,  true ),
    -- Bestaande keten, ongewijzigd.
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

-- ============================================================================
-- CONTROLE
-- ============================================================================
-- Nieuw toegestaan, met redenplicht:
--   select * from public.fn_document_status_transitie('upload','van_kracht');
--   -> toegestaan = t, redenplicht = t, bruikbaar_actueel = t
--
-- De keten is NIET verruimd (moet leeg blijven):
--   select * from public.fn_document_status_transitie('concept','van_kracht');
--   select * from public.fn_document_status_transitie('concept','vastgesteld');
--
-- Bestaande overgang ongewijzigd:
--   select * from public.fn_document_status_transitie('ter_besluitvorming','vastgesteld');
