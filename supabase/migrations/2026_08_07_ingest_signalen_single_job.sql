-- ============================================================================
-- Ingest-signalen afstemmen op het single-job-model (item 3, na F4/F6/F7).
-- ----------------------------------------------------------------------------
-- De twee FO §19-ingest-signalen werden gemeten met een stap-filter dat de
-- definitieve async worker niet zo vult: sinds F4/F6 draagt ÉÉN job de hele
-- keten (extractie→embedding) en blijft `stap` op de instapfase staan. Daardoor
-- was een embedding-fout op een extractie-entry-job onzichtbaar (blinde monitor,
-- FO §18.2). De meetqueries in platform/lib/monitoring-queries.ts meten nu op
-- STATUS i.p.v. stap. Deze migratie stemt label/toelichting in
-- platform_signaal_config daarop af, zodat de config-tabel identiek blijft aan de
-- code-registry (platform/lib/monitoring-signalen.ts) — de tabel wint immers.
--
-- Alleen DATA (config), geen schema-/policy-/grant-/functiewijziging → geen
-- structurele gates vereist. Idempotent (UPDATE op primary key). EERST in
-- Supabase draaien, dán code-deploy.
-- ROLLBACK: onderaan (herstelt de oorspronkelijke seed-teksten uit
-- 2026_08_03_p5_monitoring.sql).
-- ============================================================================

update public.platform_signaal_config
   set toelichting =
         'Aandeel mislukte ingest-jobs t.o.v. alle in het venster afgeronde jobs (geslaagd + mislukt).',
       bijgewerkt = now()
 where signaal = 'embedding_indexering_fouten';

update public.platform_signaal_config
   set label = 'Ingest-achterstand (wachtrij)',
       toelichting =
         'Momentopname: openstaande ingest-jobs (status wachtend of bezig).',
       bijgewerkt = now()
 where signaal = 'extractie_achterstand';

-- ── Verificatie (informatief) ───────────────────────────────────────────────
do $$
begin
  raise notice 'Ingest-signalen bijgewerkt: % rijen geraakt.',
    (select count(*) from public.platform_signaal_config
      where signaal in ('embedding_indexering_fouten', 'extractie_achterstand'));
end $$;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- update public.platform_signaal_config
--    set toelichting = 'Aandeel mislukte embedding-/indexeringsjobs t.o.v. alle jobs in die stappen.',
--        bijgewerkt = now()
--  where signaal = 'embedding_indexering_fouten';
-- update public.platform_signaal_config
--    set label = 'Extractie-/OCR-achterstand',
--        toelichting = 'Momentopname: jobs in stap extractie/ocr met status wachtend of bezig.',
--        bijgewerkt = now()
--  where signaal = 'extractie_achterstand';
