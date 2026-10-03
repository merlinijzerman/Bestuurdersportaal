-- ============================================================================
-- RELEASECHECK (Productie, read-only) — R1 zoekpad (besluit 0218):
-- nulmeting vóór en nameting ná de migratie `zoek_chunks_begrensd` en het
-- per fonds aanzetten van de vlag ZOEK_TEKST_V2 / `zoek_tekst_v2`.
-- ----------------------------------------------------------------------------
-- NIET aangesloten op scripts/cross-tenant-ci.sh: deze check leest echte
-- beurten uit `governance_log` en is op een wegwerp-DB per definitie leeg.
-- NIET uitvoeren op Productie zonder apart akkoord (dit bestand is de
-- voorbereide query; de uitvoering is een releasestap, zie de deployvolgorde
-- in de PR-body van R1). Eén SELECT-statement; licht (één indexvriendelijke
-- scan over governance_log in het venster); geen EXPLAIN ANALYZE, geen
-- zoek-RPC-aanroepen. Geen inhoud: alleen tellingen, statussen, milliseconden
-- en gesloten markers uit `retrieval_meta.invoer.retrieval_fasetijden`.
--
--   npx -y supabase@2.114.0 db query --linked --project-ref <ref> \
--     -o json -f supabase/checks/2026_10_03_r1_releasecheck_productie.sql
--
-- ROL: postgres (read-only SELECT via de Management API; een telling over alle
--      beurten van alle fondsen is hier precies de vraag, en RLS zou haar
--      beperken tot één gebruiker).
--
-- WAT ER PER CORRELATIE-ID UITKOMT (`per_correlatie`, max 200, nieuwste eerst):
--   rpc_fts        — de gerangschikte tekstzoekfasen: per poging (strikt/
--                    terugval) status, ms en rijen; dit is de fase die R1 raakt;
--   totaal_ms / budget_ms, fallback_reason, methode;
--   tekstzoekpad   — de R1-marker: null (vlag uit; vóór de migratie altijd),
--                    'nieuw' (zoek_chunks_begrensd gebruikt) of
--                    'fallback_pgrst202' (functie ontbrak; terugval op
--                    zoek_chunks — telt ROOD).
-- Oordeel `ok = true` als in het venster:
--   - ten minste één beurt met fasetijden is (anders: niets te beoordelen);
--   - GEEN fase de status `db_timeout` (57014) heeft;             ← rood
--   - GEEN beurt de marker `fallback_pgrst202` draagt;             ← rood
--   - GEEN beurt `fallback_reason = volscan_begrensd` draagt;
--   - GEEN retrieval met uitkomst `timeout` eindigde;
--   - elke beurt een correlatie draagt en geen correlatie dubbel voorkomt;
--   - de p95 van elke rpc_fts-/rpc_hybride-fase onder een kwart van het
--     retrievalbudget ligt.
-- Daarnaast informatief: `tekstzoekpad_verdeling` (hoeveel beurten nieuw /
-- fallback / zonder marker) — ná het per fonds aanzetten verwacht je `nieuw`
-- te zien groeien en `fallback_pgrst202` op 0.
--
-- ── NULMETING (vóór de migratie, vlag uit) ──────────────────────────────────
-- Draai deze query met `vanaf` op een venster van normale beurten vóór de
-- migratie. Verwacht: tekstzoekpad overal null; `rpc_fts`-p50/p95 zijn de
-- referentie (Productie 02-10-2026 ná #505: p95 ≈ 285 ms; vóór #505 17–21 s).
-- Bewaar de JSON-uitvoer bij de release.
--
-- ── NAMETING NA DE PRODUCTIEMIGRATIE (licht, ≤ 12 aanroepen) ────────────────
-- 1. Migratie toepassen met de vlag UIT (ZOEK_TEKST_V2 niet gezet). Daarna:
--      node tests/karakterisering/rls-505-meting.mjs --linked <ref> \
--        --stand r1-na --runs 3 --sub <pilot-sub> --fonds <pilot-fonds> \
--        --queries zcb_strikt,zoek_chunks_strikt --jwt 09,15
--    = 3 runs × 2 queries × 2 JWT's = 12 aanroepen (géén hybride, géén
--    verslapt): oud en nieuw naast elkaar op dezelfde Productiedata; verwacht
--    buffers nieuw ≤ 1/3 oud en dezelfde rijentelling.
-- 2. Vlag per fonds aan (`fonds_feature_flags.zoek_tekst_v2 = true` ná
--    ZOEK_TEKST_V2=on in Vercel — zonder env blijft álles uit), pilotvragen
--    stellen, dan deze query opnieuw met `vanaf` = het moment van aanzetten.
--    Verwacht: `tekstzoekpad = 'nieuw'` op die beurten, fallback 0, ok = true.
--
-- ── VERCEL-LOGCONTROLE (door de opdrachtgever; Claude heeft geen toegang) ───
-- Project `bestuurdersportaal` → Logs → Production → zelfde venster → zoek:
--   `[retrieval][fasetijden]`   — per correlatie precies één terminale regel;
--                                de JSON draagt `tekstzoekpad` zodra de vlag
--                                aan staat (zelfde waarde als hier);
--   `[retrieval][tekstzoekpad]` — de warn-regel van de PGRST202-terugval.
--                                Verwacht: 0 treffers. Elke treffer = de
--                                migratie ontbreekt waar de vlag aan staat:
--                                vlag uit zetten of migratie alsnog toepassen.
-- ============================================================================
with params as (
  -- AANPASSEN: het moment van de migratie (nulmeting: vóór; nameting: erna).
  select now() - interval '24 hours' as vanaf
),
beurten as (
  select g.id,
         g.aangemaakt,
         g.retrieval_meta->'invoer'->'retrieval_fasetijden' as ft,
         g.retrieval_meta->'invoer'->'retrieval_fasetijden'->>'tekstzoekpad' as tekstzoekpad,
         g.retrieval_meta->>'fallback_reason' as fallback_reason,
         g.retrieval_meta->>'methode' as methode,
         g.retrieval_meta->>'correlation_id' as correlatie
    from public.governance_log g, params p
   where g.aangemaakt >= p.vanaf
     and g.retrieval_meta ? 'invoer'
     and g.retrieval_meta->'invoer' ? 'retrieval_fasetijden'
),
fasen as (
  select b.id,
         f->>'fase' as fase,
         f->>'poging' as poging,
         f->>'status' as status,
         nullif(f->>'ms', '')::numeric as ms,
         nullif(f->>'rijen', '')::int as rijen
    from beurten b, jsonb_array_elements(coalesce(b.ft->'fasen', '[]'::jsonb)) f
),
rpc as (
  select fase,
         count(*) as n,
         percentile_cont(0.5) within group (order by ms) as p50_ms,
         percentile_cont(0.95) within group (order by ms) as p95_ms,
         max(ms) as max_ms
    from fasen
   where fase in ('rpc_fts', 'rpc_hybride') and status not in ('overgeslagen', 'ongebruikt')
   group by fase
),
samen as (
  select (select vanaf from params) as vanaf,
         (select count(*) from beurten) as beurten,
         (select count(distinct id) from fasen where status = 'db_timeout') as beurten_met_db_timeout,
         (select count(*) from fasen where status = 'db_timeout') as fasen_db_timeout,
         (select count(*) from beurten where tekstzoekpad = 'fallback_pgrst202') as fallback_pgrst202,
         (select count(*) from beurten where fallback_reason = 'volscan_begrensd') as volscan_begrensd,
         (select count(*) from beurten where ft->>'uitkomst' = 'timeout') as retrieval_timeouts,
         (select jsonb_build_object(
                   'nieuw', count(*) filter (where tekstzoekpad = 'nieuw'),
                   'fallback_pgrst202', count(*) filter (where tekstzoekpad = 'fallback_pgrst202'),
                   'zonder_marker', count(*) filter (where tekstzoekpad is null)) from beurten) as tekstzoekpad_verdeling,
         (select coalesce(jsonb_object_agg(methode, n), '{}'::jsonb) from (
            select coalesce(methode, 'onbekend') as methode, count(*) as n from beurten group by 1) m) as methode_verdeling,
         (select max(nullif(ft->>'budget_ms', '')::numeric) from beurten) as budget_ms_max,
         (select percentile_cont(0.95) within group (order by nullif(ft->>'totaal_ms', '')::numeric) from beurten) as totaal_p95_ms,
         (select max(nullif(ft->>'totaal_ms', '')::numeric) from beurten) as totaal_max_ms,
         (select coalesce(jsonb_agg(jsonb_build_object('fase', fase, 'n', n, 'p50_ms', round(p50_ms::numeric),
                    'p95_ms', round(p95_ms::numeric), 'max_ms', max_ms) order by fase), '[]'::jsonb) from rpc) as rpc_fasen,
         (select max(p95_ms) from rpc) as rpc_p95_max,
         -- Per unieke correlatie: de rpc_fts-fasen (poging/status/ms/rijen),
         -- totaal/budget, fallback_reason, methode en de R1-marker. Inhoudsvrij.
         (select coalesce(jsonb_agg(x order by x->>'aangemaakt' desc), '[]'::jsonb) from (
            select jsonb_build_object(
                     'correlatie', b.correlatie,
                     'aangemaakt', min(b.aangemaakt),
                     'governance_regels', count(*),
                     'tekstzoekpad', max(b.tekstzoekpad),
                     'methode', max(b.methode),
                     'fallback_reason', max(b.fallback_reason),
                     'rpc_fts', (select coalesce(jsonb_agg(jsonb_build_object(
                                   'poging', f.poging, 'status', f.status, 'ms', f.ms, 'rijen', f.rijen)
                                   order by f.ms desc), '[]'::jsonb)
                                   from fasen f where f.id = any(array_agg(b.id)) and f.fase = 'rpc_fts'),
                     'db_timeout', bool_or(exists (select 1 from jsonb_array_elements(coalesce(b.ft->'fasen','[]'::jsonb)) f
                                                    where f->>'status' = 'db_timeout')),
                     'volscan_begrensd', bool_or(b.fallback_reason = 'volscan_begrensd'),
                     'totaal_ms', max(nullif(b.ft->>'totaal_ms','')::numeric),
                     'budget_ms', max(nullif(b.ft->>'budget_ms','')::numeric)) as x
              from beurten b
             group by b.correlatie
             order by min(b.aangemaakt) desc
             limit 200) y) as per_correlatie,
         (select count(*) from (select correlatie from beurten group by correlatie having count(*) > 1) d) as dubbele_correlaties,
         (select count(*) from beurten where correlatie is null) as zonder_correlatie
)
select s.*,
       (s.beurten > 0
        and s.fasen_db_timeout = 0
        and s.fallback_pgrst202 = 0
        and s.volscan_begrensd = 0
        and s.retrieval_timeouts = 0
        and s.dubbele_correlaties = 0
        and s.zonder_correlatie = 0
        and coalesce(s.rpc_p95_max, 0) < coalesce(s.budget_ms_max, 20000) / 4) as ok
  from samen s;
