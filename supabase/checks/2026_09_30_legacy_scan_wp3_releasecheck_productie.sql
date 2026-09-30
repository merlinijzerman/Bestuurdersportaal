-- ============================================================================
-- RELEASECHECK (Productie, read-only) — WP3 legacy-scan van de 14 generieke
-- documenten met uitgesteld scanbewijs (Refs #500).
-- ----------------------------------------------------------------------------
-- NIET aangesloten op scripts/cross-tenant-ci.sh: deze check noemt de concrete
-- Productie-documenten (Pensioenwet a62e757b-…, de 14 ids en hun chunktellingen
-- van 30-09-2026) en is op een wegwerp-DB per definitie leeg/rood. De generieke
-- DB-bewijzen staan in supabase/checks/2026_09_30_legacy_scan_wp3.sql (wél in CI).
--
-- Uitvoeren na de productiedeploy, zo vaak als nodig (de reaper verwerkt
-- LEGACY_SCAN_BATCH=1 document tegelijk, dus de 14 lopen achter elkaar door):
--   npx -y supabase@2.114.0 db query --linked --project-ref aebwiufuegsiwhwpdrfb \
--     -o json -f supabase/checks/2026_09_30_legacy_scan_wp3_releasecheck_productie.sql
-- Eén SELECT-statement (de Management API toont alleen het laatste statement).
-- Geen inhoud: alleen ids, titels, tellingen, statussen en foutcodes.
--
-- ROL: postgres (read-only SELECT via de Management API; tellingen over alle
--      chunks zonder RLS-filter zijn hier precies de vraag).
--
-- Leesvolgorde van de uitkomst:
--   1. pensioenwet.ok = true: schoon hash-gebonden scanbewijs, beschikbaar +
--      geindexeerd, 968 → opnieuw geïndexeerd (chunks > 0, allemaal met
--      embedding en prefix, indexering_versie r1), metadata wetgeving/pw +
--      datums 2026-01-01 op elke chunk, artikelkop 150d aanwezig, laatste
--      scanjob geslaagd.
--   2. alle_14: per document scanstand, status, chunks (voor/na), embeddings,
--      laatste scanjob (status + foutcode). samenvatting.klaar = aantal met
--      schoon bewijs én beschikbaar én volledig ge-embed.
-- ============================================================================
with basis(id, chunks_voor) as (values
  ('2745d314-8f4c-4cb7-a920-64c8ffe1d95d'::uuid, 110),
  ('2dad013e-a467-4650-8b2b-f366ac2d1dbe'::uuid, 40),
  ('2eae7da4-5bf0-4f5d-9e63-7353f31607cc'::uuid, 118),
  ('35152d52-11ef-4b0c-9a0b-8e2e499e04e2'::uuid, 167),
  ('35e24850-4608-427d-8f78-76f94c8408c9'::uuid, 625),
  ('59ddc312-edd9-4f7e-8db9-4ef8a3061550'::uuid, 67),
  ('65afa089-f39d-4097-877a-45b4487941b4'::uuid, 15),
  ('97c57653-26fe-485c-990c-1d776f9735ad'::uuid, 138),
  ('a62e757b-9102-4ba3-ba6b-b33b21705fbd'::uuid, 968),
  ('c1462151-73c6-4495-b8ad-4b431f166d97'::uuid, 136),
  ('c60fed60-8daa-4320-ac15-663c0bd03bd6'::uuid, 939),
  ('c78b86f6-fdfd-4df1-82af-41a1537230d1'::uuid, 88),
  ('c9d61347-2cf2-4e56-b661-3900fa2f856b'::uuid, 625),
  ('f80fb6f3-2c06-4405-8afa-9115926e223b'::uuid, 315)
),
per_doc as (
  select b.id, b.chunks_voor, d.titel, d.actief, d.verwerkingsstatus, d.geindexeerd,
         d.documenttype, d.wettelijk_regime, d.documentdatum, d.geldig_vanaf,
         coalesce(d.scan_resultaat->>'verdict', 'scan=' || (d.scan_resultaat->>'scan'), '∅') as scanstand,
         (d.scan_resultaat->>'verdict' = 'clean' and d.scan_resultaat->>'sha256' = d.bestand_hash
          and d.bestand_hash ~ '^[a-f0-9]{64}$') as schoon_bewijs,
         c.chunks, c.zonder_embedding, c.zonder_prefix, c.r1, c.meta_ok, c.art_150d,
         j.status as laatste_scanjob_status, j.foutcode as laatste_scanjob_foutcode,
         j.aangemaakt as laatste_scanjob_aangemaakt, j.eind as laatste_scanjob_eind,
         (select count(*) from document_processing_jobs o
           where o.document_id = b.id and o.status in ('wachtend','bezig')) as open_jobs
    from basis b
    left join documenten d on d.id = b.id
    left join lateral (
      select count(*) as chunks,
             count(*) filter (where dc.embedding is null) as zonder_embedding,
             count(*) filter (where dc.context_prefix is null) as zonder_prefix,
             count(*) filter (where dc.indexering_versie = 'r1-structuur-contextueel') as r1,
             count(*) filter (where dc.documenttype is not distinct from d.documenttype
                                and dc.wettelijk_regime is not distinct from d.wettelijk_regime
                                and dc.documentdatum is not distinct from d.documentdatum
                                and dc.geldig_vanaf is not distinct from d.geldig_vanaf
                                and dc.bronstatus is not distinct from d.bronstatus
                                and dc.documentstatus is not distinct from d.status
                                and dc.normgewicht is not distinct from d.normgewicht) as meta_ok,
             count(*) filter (where dc.structuur_label ~* '(^|[^a-z])artikel +150d([^0-9a-z]|$)') as art_150d
        from document_chunks dc where dc.document_id = b.id
    ) c on true
    left join lateral (
      select pj.status, pj.foutcode, pj.aangemaakt, pj.eind
        from document_processing_jobs pj
       where pj.document_id = b.id and pj.stap = 'scan'
         and pj.aangemaakt > timestamptz '2026-09-30 00:00:00+00'
       order by pj.aangemaakt desc limit 1
    ) j on true
)
select json_build_object(
  'pensioenwet', (
    select json_build_object(
      'ok', coalesce(p.schoon_bewijs, false)
            and p.verwerkingsstatus = 'beschikbaar' and p.geindexeerd
            and p.chunks > 0 and p.zonder_embedding = 0 and p.zonder_prefix = 0
            and p.r1 = p.chunks and p.meta_ok = p.chunks
            and p.documenttype = 'wetgeving' and p.wettelijk_regime = 'pw'
            and p.documentdatum = date '2026-01-01' and p.geldig_vanaf = date '2026-01-01'
            and p.art_150d >= 1 and p.laatste_scanjob_status = 'geslaagd',
      'schoon_bewijs', p.schoon_bewijs, 'scanstand', p.scanstand,
      'verwerkingsstatus', p.verwerkingsstatus, 'geindexeerd', p.geindexeerd,
      'chunks_voor', p.chunks_voor, 'chunks_na', p.chunks,
      'zonder_embedding', p.zonder_embedding, 'zonder_prefix', p.zonder_prefix,
      'indexering_r1', p.r1, 'metadata_consistent', p.meta_ok,
      'documenttype', p.documenttype, 'wettelijk_regime', p.wettelijk_regime,
      'documentdatum', p.documentdatum, 'geldig_vanaf', p.geldig_vanaf,
      'artikel_150d_chunks', p.art_150d,
      'laatste_scanjob', json_build_object('status', p.laatste_scanjob_status,
        'foutcode', p.laatste_scanjob_foutcode, 'eind', p.laatste_scanjob_eind),
      'open_jobs', p.open_jobs)
      from per_doc p where p.id = 'a62e757b-9102-4ba3-ba6b-b33b21705fbd'),
  'alle_14', (
    select json_agg(json_build_object(
      'id', p.id, 'titel', p.titel, 'actief', p.actief, 'scanstand', p.scanstand,
      'schoon_bewijs', p.schoon_bewijs, 'verwerkingsstatus', p.verwerkingsstatus,
      'geindexeerd', p.geindexeerd, 'chunks_voor', p.chunks_voor, 'chunks_na', p.chunks,
      'zonder_embedding', p.zonder_embedding, 'metadata_consistent', p.meta_ok,
      'laatste_scanjob_status', p.laatste_scanjob_status,
      'laatste_scanjob_foutcode', p.laatste_scanjob_foutcode, 'open_jobs', p.open_jobs,
      'klaar', coalesce(p.schoon_bewijs, false) and p.verwerkingsstatus = 'beschikbaar'
               and p.geindexeerd and p.chunks > 0 and p.zonder_embedding = 0)
      order by p.id) from per_doc p),
  'samenvatting', (
    select json_build_object(
      'documenten', count(*),
      'klaar', count(*) filter (where coalesce(schoon_bewijs, false) and verwerkingsstatus = 'beschikbaar'
                                  and geindexeerd and chunks > 0 and zonder_embedding = 0),
      'schoon_bewijs', count(*) filter (where schoon_bewijs),
      'nog_uitgesteld', count(*) filter (where scanstand = 'scan=uitgesteld_wp3'),
      'technisch_mislukt', count(*) filter (where laatste_scanjob_status = 'mislukt'
                                              and scanstand in ('scanner_unreachable','error','stale_definitions')),
      'gequarantineerd', count(*) filter (where verwerkingsstatus = 'gequarantineerd'),
      'geweigerd', count(*) filter (where verwerkingsstatus = 'geweigerd'),
      'open_jobs', sum(open_jobs),
      'chunks_voor', sum(chunks_voor), 'chunks_na', sum(chunks),
      'zonder_embedding', sum(zonder_embedding))
      from per_doc)
) as releasecheck;
