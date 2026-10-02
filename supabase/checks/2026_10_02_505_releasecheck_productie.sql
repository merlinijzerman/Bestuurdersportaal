-- ============================================================================
-- RELEASECHECK (Productie, read-only) — #505 RLS-InitPlan: slagen normale
-- vragen weer via de NORMALE route, en niet via de time-outroute?
-- ----------------------------------------------------------------------------
-- NIET aangesloten op scripts/cross-tenant-ci.sh: deze check leest echte beurten
-- uit `governance_log` en is op een wegwerp-DB per definitie leeg. Het
-- gedragsbewijs staat in tests/karakterisering/artikelspoor-516-gedrag.mjs, het
-- performancebewijs in tests/karakterisering/artikelspoor-500-budget.mjs.
--
-- Uitvoeren na de productiemigratie, zodra er weer gewone AI-beurten zijn
-- geweest (pas `vanaf` hieronder aan naar het moment van de migratie):
--   npx -y supabase@2.114.0 db query --linked --project-ref aebwiufuegsiwhwpdrfb \
--     -o json -f supabase/checks/2026_10_02_505_releasecheck_productie.sql
-- Eén SELECT-statement (de Management API toont alleen het laatste statement).
-- Licht: één indexvriendelijke scan over governance_log in het venster; geen
-- EXPLAIN ANALYZE en geen zoek-RPC-aanroepen.
-- Geen inhoud: alleen tellingen, statussen en milliseconden uit
-- `retrieval_meta.invoer.retrieval_fasetijden` (die is zelf al inhoudsvrij).
--
-- ROL: postgres (read-only SELECT via de Management API; een telling over alle
--      beurten van alle fondsen is hier precies de vraag, en RLS zou haar
--      beperken tot één gebruiker).
--
-- Oordeel `ok = true` als in het venster:
--   - er ten minste één beurt met fasetijden is (anders: niets te beoordelen);
--   - GEEN enkele fase de status `db_timeout` (57014) heeft;
--   - GEEN beurt `fallback_reason = volscan_begrensd` draagt (de #516-
--     begrenzing grijpt alleen in na een 57014);
--   - GEEN retrieval met uitkomst `timeout` eindigde;
--   - de p95 van elke gerangschikte RPC-fase (`rpc_fts`, `rpc_hybride`) onder
--     een kwart van het retrievalbudget ligt ("ruim binnen budget").
-- Vóór #505 (02-10-2026, read-only gemeten): één `zoek_chunks`-aanroep kostte
-- 17–21 s met een realistische JWT; dan is deze check rood.
--
-- Lokaal gevalideerd (02-10-2026): een venster met 16 normale beurten (#505,
-- JWT 0,9/1,5 kB) geeft ok = true (RPC p95 285 ms); een venster met
-- geïnjecteerde 57014 (artikelspoor-516-gedrag.mjs) geeft ok = false.
--
-- VOORWAARDE. `retrieval_fasetijden` bestaat sinds #516. Staat #516 nog niet
-- op `main`, dan heeft Productie geen beurten met fasetijden en blijft
-- `beurten = 0` (dan: ok = false, "niets te beoordelen" — geen regressie).
--
-- ── STAP B: de serverlogregels (Vercel) — door de opdrachtgever ─────────────
-- Waarom: een beurt die de retrieval niet haalt (deadline, client-abort,
-- onverwachte fout) schrijft GEEN governance_log-regel, maar wél precies één
-- logregel `[retrieval][fasetijden] {…}` (orkestratie, `finally`; per uitgang
-- getest in tests/cross-tenant/retrieval-500-fasetijden.test.ts F11 + F12).
-- Alleen een harde platformkill valt buiten die `finally`; het budget is
-- begrensd op ≤ 60 s en de chatroute heeft maxDuration 300 s, dus de deadline
-- vuurt altijd eerst.
--
-- (a) Ophalen, read-only (Claude heeft geen Vercel-toegang):
--     - Dashboard: Vercel → project `bestuurdersportaal` (de app, níet
--       `bestuurdersportaal-beheer`) → Logs → omgeving Production → periode =
--       hetzelfde venster als `vanaf` hierboven → zoekveld:
--       `[retrieval][fasetijden]`. Exporteer of kopieer de regels.
--     - Of CLI: `vercel logs <productie-deployment-url> --json` (recente
--       runtimelogs), en filter lokaal:
--       `… | grep '\[retrieval\]\[fasetijden\]'`.
--     Regels met uitkomst `ok` staan op niveau info, de overige op warn.
-- (b) Beoordelen per regel (de JSON na het voorvoegsel):
--     - `uitkomst` = "ok" (geen "timeout", "annulering" of "fout");
--     - geen element in `fasen` met `status` = "db_timeout";
--     - geen `fts_plain`/`fts_ilike` = "overgeslagen" bij een 150d-vraag
--       (dat is de volscanbegrenzing na een 57014 = de time-outroute);
--     - `rpc_fts`/`rpc_hybride` `ms` < `budget_ms`/4, en `totaal_ms` < `budget_ms`.
-- (c) Tellen: het aantal logregels in het venster moet gelijk zijn aan het
--     aantal gestelde vragen (voor een pilotronde: het aantal vragen dat je
--     zelf stelde). Vergelijk de `correlatie`-waarden van de logregels met
--     `correlaties` uit deze query: een correlatie die wél in de logs staat
--     maar NIET hier, is een beurt zonder governance-regel — een afgebroken
--     beurt — en maakt de release rood, ook als `ok` hierboven true is.
--
-- ── NAMETING NA DE PRODUCTIEMIGRATIE (licht) ────────────────────────────────
-- Hooguit 3 runs per variant, alleen `zoek_chunks_strikt` en `chunks_count`
-- bij ~0,9 en ~1,5 kB (12 aanroepen, géén hybride; de vóór-meting van
-- 02-10-2026 belastte Productie met ~130 zware aanroepen):
--   node tests/karakterisering/rls-505-meting.mjs --linked aebwiufuegsiwhwpdrfb \
--     --stand na --runs 3 --sub d896cebb-1fea-41dc-a03f-05ffaab0a157 \
--     --fonds 222230a5-3a2a-4230-9bfe-419a28146abe \
--     --queries zoek_chunks_strikt,chunks_count --jwt 09,15
-- ============================================================================
with params as (
  -- AANPASSEN: het moment waarop de migratie op Productie is toegepast.
  select now() - interval '24 hours' as vanaf
),
beurten as (
  select g.id,
         g.aangemaakt,
         g.retrieval_meta->'invoer'->'retrieval_fasetijden' as ft,
         g.retrieval_meta->>'fallback_reason' as fallback_reason,
         g.retrieval_meta->>'correlation_id' as correlatie
    from public.governance_log g, params p
   where g.aangemaakt >= p.vanaf
     and g.retrieval_meta ? 'invoer'
     and g.retrieval_meta->'invoer' ? 'retrieval_fasetijden'
),
fasen as (
  select b.id,
         f->>'fase' as fase,
         f->>'status' as status,
         nullif(f->>'ms', '')::numeric as ms
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
         (select count(*) from beurten where fallback_reason = 'volscan_begrensd') as volscan_begrensd,
         (select count(*) from beurten where ft->>'uitkomst' = 'timeout') as retrieval_timeouts,
         (select max(nullif(ft->>'budget_ms', '')::numeric) from beurten) as budget_ms_max,
         (select percentile_cont(0.95) within group (order by nullif(ft->>'totaal_ms', '')::numeric) from beurten) as totaal_p95_ms,
         (select max(nullif(ft->>'totaal_ms', '')::numeric) from beurten) as totaal_max_ms,
         (select coalesce(jsonb_agg(jsonb_build_object('fase', fase, 'n', n, 'p50_ms', round(p50_ms::numeric),
                    'p95_ms', round(p95_ms::numeric), 'max_ms', max_ms) order by fase), '[]'::jsonb) from rpc) as rpc_fasen,
         (select max(p95_ms) from rpc) as rpc_p95_max,
         -- Voor de vergelijking met de Vercel-logregels (stap B hieronder):
         -- request-id's, geen inhoud.
         (select coalesce(jsonb_agg(correlatie order by aangemaakt), '[]'::jsonb)
            from (select correlatie, aangemaakt from beurten order by aangemaakt desc limit 200) x) as correlaties
)
select s.*,
       (s.beurten > 0
        and s.fasen_db_timeout = 0
        and s.volscan_begrensd = 0
        and s.retrieval_timeouts = 0
        and coalesce(s.rpc_p95_max, 0) < coalesce(s.budget_ms_max, 20000) / 4) as ok
  from samen s;
