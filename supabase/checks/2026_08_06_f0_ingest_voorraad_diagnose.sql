-- ============================================================================
-- F0.4 — Diagnose bestaande ingest-voorraad (bouwticket async-ingest v2.1, §0c-5)
-- ----------------------------------------------------------------------------
-- READ-ONLY. Uitsluitend SELECTs — dit bestand muteert NIETS. Plak het in de
-- Supabase SQL-editor (of psql) tegen de DOELDATABASE om de huidige staat te
-- meten. De mutatie-templates onderaan staan BEWUST uitgecommentarieerd; voer ze
-- pas uit na de bijbehorende diagnose en in de volgorde uit §2.1-F0.4.
--
-- WAAROM: de veldwaarneming van 06-08-2026 vond voorraad met een geschonden
-- invariant: documenten met `geindexeerd = true` die tóch chunks met
-- `embedding is null` dragen, plus chunks met `indexering_versie is null`. Dit
-- bestand herproduceert die categorieën generiek, zodat je vóór en ná de
-- opruiming kunt meten.
--
-- INVARIANT (F0.2, geldt overal): `documenten.geindexeerd = true` ALLEEN als er
-- nul chunks met `embedding is null` voor dat document zijn. Query 1 hoort ná de
-- opruiming NUL rijen te geven.
-- ============================================================================

-- ── 1. INVARIANT-SCHENDING: geindexeerd=true mét niet-ge-embedde chunks ──────
--     Verwachting ná opruiming: 0 rijen. Dit is acceptatiecriterium 5.
select d.id                     as document_id,
       d.titel,
       d.bibliotheek,
       d.fonds_id,
       d.aangemaakt::date       as aangemaakt,
       count(c.*)               as chunks_totaal,
       count(*) filter (where c.embedding is null) as chunks_zonder_embedding
from   public.documenten d
join   public.document_chunks c on c.document_id = d.id
where  d.geindexeerd = true
group  by d.id, d.titel, d.bibliotheek, d.fonds_id, d.aangemaakt
having count(*) filter (where c.embedding is null) > 0
order  by d.aangemaakt;

-- ── 2. CHUNKS MET indexering_versie IS NULL (nog baseline / R1 gemist) ───────
--     Uitgesplitst naar bibliotheek en of ze al een embedding hebben. De twee
--     generieke DNB-documenten (embedding wél, prefix/structuur niet) en de
--     fondsdocumenten (embedding níet) vallen hier elk in een eigen bucket.
select d.bibliotheek,
       (c.embedding is not null)          as heeft_embedding,
       count(*)                           as chunks,
       count(distinct c.document_id)      as documenten
from   public.document_chunks c
join   public.documenten d on d.id = c.document_id
where  c.indexering_versie is null
group  by d.bibliotheek, (c.embedding is not null)
order  by d.bibliotheek, heeft_embedding;

-- ── 2b. Zelfde, per document (voor de gerichte volgorde-aanpak) ──────────────
select d.id                as document_id,
       d.titel,
       d.bibliotheek,
       d.aangemaakt::date  as aangemaakt,
       d.opslag_pad is not null as heeft_origineel,
       count(*)            as chunks_zonder_versie,
       count(*) filter (where c.embedding is null) as waarvan_zonder_embedding
from   public.document_chunks c
join   public.documenten d on d.id = c.document_id
where  c.indexering_versie is null
group  by d.id, d.titel, d.bibliotheek, d.aangemaakt, d.opslag_pad
order  by d.aangemaakt;   -- oudste eerst; let op het document rond 10-06 (§0c-5)

-- ── 3. ONHERSTELBAAR: documenten zonder Storage-origineel ────────────────────
--     Zonder origineel kan reindex/her-extract niets; kandidaat voor
--     deactivering (het pdf-duplicaat uit §0c-5). Controleer per rij vóór actie.
select d.id, d.titel, d.bibliotheek, d.aangemaakt::date as aangemaakt,
       d.actief, d.geindexeerd,
       count(c.*) as chunks
from   public.documenten d
left   join public.document_chunks c on c.document_id = d.id
where  d.opslag_pad is null
group  by d.id, d.titel, d.bibliotheek, d.aangemaakt, d.actief, d.geindexeerd
order  by d.aangemaakt;

-- ── 4. Documenten van vóór 24-06 zónder bestand_hash (buiten dedup, §10 pt 7) ─
select d.id, d.titel, d.bibliotheek, d.aangemaakt::date as aangemaakt
from   public.documenten d
where  d.bestand_hash is null
order  by d.aangemaakt;

-- ============================================================================
-- OPRUIM-RUNBOOK (uit te voeren in deze volgorde; elke stap ná zijn diagnose)
-- ----------------------------------------------------------------------------
-- STAP A — Onderzoek eerst het document rond 10-06 (query 2b, oudste na de
--          fase_c_embeddings-migratie). Her-indexeren wist het bewijs waarom het
--          geen embeddings kreeg; kijk dus eerst (chunks, opslag_pad, type) vóór
--          je iets muteert.
--
-- STAP B — Fondsdocumenten (bibliotheek='fonds', indexering_versie is null):
--          via de bestaande UI/route `reindex-backfill` (herhaald aanroepen tot
--          `klaar`). Die filtert al op `bibliotheek='fonds'` en zet de volledige
--          R1-verrijking. GEEN directe SQL nodig.
--
-- STAP C — De twee generieke DNB-documenten (bibliotheek='generiek'): via het
--          PLATFORM-reindex-pad (reindex-backfill sluit generiek uit). Draai het
--          generieke her-index/curatie-pad in de platform-back-office.
--
-- STAP D — Permanent niet-indexeerbare chunks stempelen als 'r1-overgeslagen'
--          (OVERGESLAGEN_VERSIE) i.p.v. null, zodat ze niet bij elke backfill
--          terugkeren. UITSLUITEND voor chunks die aantoonbaar niet te
--          verrijken zijn (geen origineel, onleesbaar type). Template — vul het
--          exacte document_id in en voer bewust uit:
--
--   -- update public.document_chunks
--   --    set indexering_versie = 'r1-overgeslagen'
--   --  where document_id = '<UUID>'
--   --    and indexering_versie is null;
--
-- STAP E — Het pdf-duplicaat zonder origineel (query 3): deactiveren via de
--          bestaande PATCH-actie 'deactiveren' in de bibliotheek-UI (audit-spoor
--          + reden), NIET via directe SQL-delete.
--
-- STAP F — Herhaal query 1. Verwachting: 0 rijen (invariant hersteld).
-- ============================================================================
