-- #413 PR-A — READ-ONLY botsingsmeting op microsoft_private.sharepoint_documenten.
-- ---------------------------------------------------------------------------
-- Doel: vaststellen of de geplande unieke index op (bron_id, web_url_canoniek)
-- vandaag zou kunnen ontstaan. De query SCHRIJFT NIETS, maakt niets aan en toont
-- geen URL, pad, bestandsnaam of identifier — uitsluitend vier totalen.
--
-- Draai hem als de eigenaarsrol (Supabase SQL Editor of de bestaande
-- databaseverbinding); `microsoft_private` is afgeschermd voor anon/authenticated.
-- Draai hem op PREVIEW én PRODUCTIE en noteer beide uitslagen.
--
-- De CASE-expressie hieronder is de canonicalisering die de migratie krijgt
-- (`microsoft_private.sharepoint_canoniek_weburl`), letterlijk hetzelfde:
--   1. alleen `https`;
--   2. authority zonder userinfo, `:443` verwijderd, kleine letters, en de host
--      moet op `.sharepoint.com` eindigen;
--   3. query en fragment vallen weg (ze horen niet bij een bibliotheekpad);
--   4. trailing slashes weg; een leeg pad is ongeldig;
--   5. controletekens maken de URL ongeldig;
--   6. padsegmenten worden BYTE-GELIJK overgenomen — niet gedecodeerd en niet
--      opnieuw gecodeerd. Decoderen zou `%2F` tot een scheidingsteken maken en
--      daarmee twee verschillende bestanden op elkaar kunnen afbeelden.
-- Alles wat niet door deze regels komt, telt als ongeldig en valt fail-closed
-- buiten de index.
with ontleed as (
  select
    d.id,
    d.bron_id,
    d.web_url,
    regexp_match(d.web_url, '^([A-Za-z][A-Za-z0-9+.-]*)://([^/?#]+)([^?#]*)') as delen
  from microsoft_private.sharepoint_documenten d
),
basis as (
  select
    o.id,
    o.bron_id,
    o.web_url,
    case
      when o.web_url is null then null
      when o.delen is null then null
      when lower(o.delen[1]) <> 'https' then null
      when position('@' in o.delen[2]) > 0 then null
      when lower(regexp_replace(o.delen[2], ':443$', '')) !~ '^[a-z0-9][a-z0-9.-]*\.sharepoint\.com$' then null
      when rtrim(o.delen[3], '/') = '' then null
      when rtrim(o.delen[3], '/') ~ '[[:cntrl:]]' then null
      else 'https://' || lower(regexp_replace(o.delen[2], ':443$', '')) || rtrim(o.delen[3], '/')
    end as sleutel
  from ontleed o
),
groepen as (
  select b.bron_id, b.sleutel, count(*) as rijen
  from basis b
  where b.sleutel is not null
  group by b.bron_id, b.sleutel
  having count(*) > 1
)
select
  (select count(*) from groepen)                                                as botsingsgroepen,
  (select coalesce(sum(g.rijen), 0) from groepen g)                             as betrokken_rijen,
  (select count(*) from basis where web_url is null)                            as null_urls,
  (select count(*) from basis where web_url is not null and sleutel is null)    as ongeldige_urls;
