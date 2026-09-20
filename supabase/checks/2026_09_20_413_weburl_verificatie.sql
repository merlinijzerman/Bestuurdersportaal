-- #413 T4-C — verificatie NA het plakken van
-- supabase/migrations/2026_09_20_413_weburl_canoniek_quarantaine.sql.
-- ---------------------------------------------------------------------------
-- CLAUDE.md: toets de uitkomst in de database, niet de intentie in de migratie.
-- Deze query leest alleen en toont uitsluitend aantallen en vlaggen — geen URL,
-- pad of identifier. Draai hem op Preview én Productie en bewaar de uitslag.
--
-- Verwacht na een geslaagde migratie:
--   A objecten_aanwezig      = t
--   B index_partieel         = t
--   C rechten_dicht          = t
--   D actieve_botsingen      = 0      (de invariant; anders is de index stuk)
--   E rijen_in_quarantaine   = Preview 6, Productie 0 (meting 20-09-2026)
--   F urls_bewaard           = t      (quarantaine wist nooit een web_url)
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
  ) as f_urls_bewaard;
