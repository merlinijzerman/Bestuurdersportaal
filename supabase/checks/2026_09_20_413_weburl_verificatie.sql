-- #413 T4-C — verificatie NA het plakken van BEIDE migraties:
--   supabase/migrations/2026_09_20_413_weburl_canoniek_quarantaine.sql
--   supabase/migrations/2026_09_21_413_weburl_office_viewer.sql
-- ---------------------------------------------------------------------------
-- CLAUDE.md: toets de uitkomst in de database, niet de intentie in de migratie.
-- Deze query leest alleen en toont uitsluitend aantallen en vlaggen — geen URL,
-- pad of identifier. Draai hem op Preview én Productie en bewaar de uitslag.
--
-- DIT IS DE STANDCONTROLE, GEEN GEDRAGSBEWIJS. Het gedrag van de locator en de
-- quarantaine (canonicalisering, omwisseling binnen één listing, botsing met een
-- rij buiten de listing, herstel, cross-tenant, Office-viewer-URL, sharinglink,
-- fail-closed opzoeking) staat in supabase/checks/2026_09_20_413_weburl_gedrag.sql
-- en de vectorlijst in …_canonicalisering_vectoren.sql; beide draaien blokkerend
-- mee in scripts/cross-tenant-ci.sh.
--
-- Verwacht na een geslaagde migratie:
--   A objecten_aanwezig      = t
--   B index_partieel         = t
--   C rechten_dicht          = t
--   D actieve_botsingen      = 0   ← de invariant; anders is de index stuk
--   E rijen_in_quarantaine   = OBSERVATIE, geen norm. Noteer het getal. Na de
--                                viewer-normalisatie kan het stijgen, omdat een
--                                viewer- en een bibliotheek-URL van hetzelfde
--                                pad voortaan samenvallen.
--   F urls_bewaard           = t   ← quarantaine wist nooit een web_url
--   G canonicalisering_actueel = t ← élke opgeslagen canonieke waarde is gelijk
--                                aan wat de functie NU oplevert
--   H viewer_genormaliseerd  = t   ← de vier Office-prefixen worden weggestreken
--                                en een sharinglink juist niet
--
-- WAAROM G ER STAAT. `web_url_canoniek` is een STORED generated column.
-- Postgres herberekent die NIET wanneer de canonicaliseringsfunctie verandert,
-- en waarschuwt daar niet voor (geverifieerd op postgres:17). Een migratie die
-- de functie vervangt zonder de kolom te herschrijven, laat de index dus op
-- oude waarden matchen en de opzoeking op nieuwe. G is het enige dat bewijst
-- dát de herschrijving werkelijk heeft plaatsgevonden.
select
  (
    to_regprocedure('microsoft_private.sharepoint_canoniek_weburl(text)') is not null
    and to_regprocedure('microsoft_private.sharepoint_zoek_document_op_weburl(uuid,uuid,text)') is not null
    and exists (
      select 1 from information_schema.columns
       where table_schema = 'microsoft_private' and table_name = 'sharepoint_documenten'
         and column_name in ('web_url_canoniek', 'mapping_status')
      having count(*) = 2
    )
  ) as a_objecten_aanwezig,
  exists (
    select 1 from pg_indexes
     where schemaname = 'microsoft_private'
       and indexname = 'sharepoint_documenten_weburl_canoniek_uniek'
       and indexdef like '%mapping_status = ''actief''%'
       and indexdef like '%web_url_canoniek IS NOT NULL%'
  ) as b_index_partieel,
  (
    not has_function_privilege('anon', 'microsoft_private.sharepoint_zoek_document_op_weburl(uuid,uuid,text)', 'execute')
    and not has_function_privilege('authenticated', 'microsoft_private.sharepoint_zoek_document_op_weburl(uuid,uuid,text)', 'execute')
    and has_function_privilege('microsoft_vault', 'microsoft_private.sharepoint_zoek_document_op_weburl(uuid,uuid,text)', 'execute')
  ) as c_rechten_dicht,
  (
    select count(*) from (
      select bron_id, web_url_canoniek
        from microsoft_private.sharepoint_documenten
       where web_url_canoniek is not null and mapping_status = 'actief'
       group by bron_id, web_url_canoniek
      having count(*) > 1
    ) g
  ) as d_actieve_botsingen,
  (
    select count(*) from microsoft_private.sharepoint_documenten where mapping_status = 'botsing'
  ) as e_rijen_in_quarantaine,
  (
    select coalesce(bool_and(web_url is not null), true)
      from microsoft_private.sharepoint_documenten where mapping_status = 'botsing'
  ) as f_urls_bewaard,
  (
    select coalesce(bool_and(
      web_url_canoniek is not distinct from microsoft_private.sharepoint_canoniek_weburl(web_url)
    ), true)
      from microsoft_private.sharepoint_documenten
  ) as g_canonicalisering_actueel,
  (
    microsoft_private.sharepoint_canoniek_weburl('https://check.sharepoint.com/:w:/r/sites/pgb/A.docx')
      is not distinct from 'https://check.sharepoint.com/sites/pgb/A.docx'
    and microsoft_private.sharepoint_canoniek_weburl('https://check.sharepoint.com/:p:/r/sites/pgb/A.pptx')
      is not distinct from 'https://check.sharepoint.com/sites/pgb/A.pptx'
    and microsoft_private.sharepoint_canoniek_weburl('https://check.sharepoint.com/:w:/s/EaBc123')
      is not distinct from 'https://check.sharepoint.com/:w:/s/EaBc123'
  ) as h_viewer_genormaliseerd;
