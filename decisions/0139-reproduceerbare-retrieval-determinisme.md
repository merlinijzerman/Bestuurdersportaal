# 0139 — Reproduceerbare retrieval: determinisme als eis (stille queryherschrijving + non-determinisme)

- **Status:** Geaccepteerd (implementatie) — ronde 1 (code + sanity): `tsc` exit 0, `npm run sanity` volledig groen. Ronde 2 (migratie): **gedraaid en geverifieerd in productie (2026-08-06)** — `pg_proc`: 5 tiebreakers, `proconfig` = alleen `search_path` (ef_search bewust uitgesteld), `has_function_privilege` anon=false/authenticated=true, en 10 identieke RPC-aanroepen onder `max_parallel_workers_per_gather=4` → 1 unieke id-volgorde. Nog open: structurele gates-run, criterium A live (10× identiek via de app), ef_search-mechanisme.
- **Datum:** 2026-08-06
- **Betrokkenen:** opdrachtgever (Merlin IJzerman), Claude (analyse + uitvoering)
- **Raakt:** [`0087`](./0087-ai-voortgang-zichtbaar-foutcontract-en-niet-gelogd.md) (voortgang), [`0094`](./0094-verslapte-or-terugval-op-de-fts-arm.md) (FTS-terugval/hybride retrieval), RAG Fase B1 (history-aware reformulatie)

## Context

Een bestuurder stelde binnen dezelfde gespreksdraad (`87a74d4b-…`) **tweemaal exact dezelfde vraag** — *"Wat zijn onze strategische doelstellingen?"* — en kreeg twee verschillende bronnensets. Uit `governance_log`:

| Tijd | Daadwerkelijk gezochte (herschreven) zoekvraag |
|---|---|
| **15:29:32** | `Wat zijn de strategische doelstellingen van Stichting Pensioenfonds voor Huisartsen?` |
| **15:34:04** | `Strategische doelstellingen Stichting Pensioenfonds voor Huisartsen` |

Zelfde draad, zelfde methode (`hybride_rrf`), zelfde filters, zelfde peildatum, `gereformuleerd = true` in beide beurten. Het enige verschil is de **herschreven zoekvraag** — en die verschilt omdat de history-aware reformulatie (RAG Fase B1) een **gesamplede modelcall zonder `temperature`** is. Het portaal belooft de bestuurder dat elke vraag wordt vastgelegd inclusief welke bron is gebruikt; als dezelfde vraag verschillende bronnen oplevert, is "de assistent zei X op basis van bron Y" niet reproduceerbaar. **Auditprobleem, geen UX-probleem.**

### Baseline (vóór wijziging, onherhaalbaar ná de fix)

10 identieke aanroepen van `reformuleerVraag()` op de huidige code (model `claude-sonnet-4-6`, `temperature` niet gezet), met een representatieve voorgeschiedenis over het fonds:

- **2 verschillende zoekvragen op identieke input** — woordelijk matchend met de twee logregels hierboven:
  - 8×: `Strategische doelstellingen Stichting Pensioenfonds voor Huisartsen SPH`
  - 2×: `Wat zijn de strategische doelstellingen van Stichting Pensioenfonds voor Huisartsen (SPH)?`

Het incident is daarmee gereproduceerd. Ruwe uitvoer bewaard buiten de repo (scratchpad `baseline-reformulatie-output.json`).

### Tweede defect — heuristiek vuurt op proxies

`heeftReformulatieNodig` reformuleerde op `woorden.length <= 5` (elke bondige vraag) en op de aanwezigheid van `het` in `VERWIJSWOORDEN` (het meest voorkomende lidwoord). Valse-reformulatie-fractie op een set zelfstandige vragen: **5/6**. Dit is hetzelfde patroon als de bronkeuze-twijfelbak en de vijf-woordenregel: een heuristiek die correleert met het probleem in plaats van het te detecteren.

### Latente risico's (bevestigd in code)

- **Geen tiebreaker** in `zoek_chunks_hybride` op drie sorteringen (twee per-arm `row_number()`'s + de finale RRF-sort); bij gelijke sleutel + `LIMIT` bepaalt de fysieke leesvolgorde de snijlijn. `zoek_chunks` hád de tiebreaker al.
- **`hnsw.ef_search` = `p_kandidaten` = 40**: de vector-arm vraagt exact zoveel rijen als de graaf maximaal levert en filtert pas daarná.
- **`fts_rang`/`vec_rang`** werden door de RPC teruggegeven maar niet overgenomen in `rijNaarChunk` → arm-herkomst onzichtbaar in het auditspoor.

## Besluit

**Reproduceerbare retrieval is een eis.** Dezelfde vraag in dezelfde draadstand levert dezelfde zoekvraag en dezelfde bronnenset. Maatregelen:

- **M-R1 — `temperature: 0`** op elke modelcall in de retrievalketen: `query-reformulatie.ts`, `rerank.ts` (borgt determinisme vóórdat de reranker ooit aangaat) en `chunk-ingest.ts` (context-prefix; index-reproduceerbaarheid). Generatie blijft ongemoeid (buiten scope, raakt de bronselectie niet).
- **M-R2 — reformulatie-conditie herzien.** De `<= 5`-lengteregel geschrapt; `het` uit `VERWIJSWOORDEN`; `dat/die/dit/deze` **positioneel** beoordeeld (determinator vóór een zelfstandig naamwoord → géén reformulatie; alleenstaand of vóór een functiewoord/werkwoord → wél). Valse-reformulatie-fractie **5/6 → 0/6**, alle echte anafora behouden (meetset in `query-reformulatie.sanity.ts`).
- **M-R3 — reformulatie is niet-destructief.** Bij `gereformuleerd = true` draait de hybride retrieval een **extra poging met de originele vraag** en fuseert de kandidatensets (union op chunk-id, beste RRF-rang wint). Eén generiek "extra retrievalpoging"-mechanisme (`fuseerHybridePogingen` + `gedeeldeHybrideParams`), harde bovengrens `MAX_HYBRIDE_POGINGEN = 3` (1 basis + M-R3 + de latere M1-FTS-terugval uit de recall-opdracht). Alle pogingen delen `p_fonds_id`/modus/filters per constructie identiek — fondsdiscipline blijft hard. Verworpen alternatief: gesplitste armen (origineel→FTS, herschreven→vector) — goedkoper maar dekt "reformulatie hielp lexicaal" en "origineel was semantisch beter" niet.
- **M-R4 — gebruikte zoekvraag zichtbaar.** `zoekvraag`/`gereformuleerd` gaan nu ook naar het onderbouwingspaneel (voorheen alleen `governance_log`). Alleen getoond bij `gereformuleerd = true`.
- **M-R5 — hygiëne.** (1) Deterministische tiebreaker `, dc.id` op de drie sorteringen in `zoek_chunks_hybride` (migratie 06-08); (2) `hnsw.ef_search = 100` op de functie-`SET`-clausule — **op Supabase geblokkeerd** (`ERROR 42501: permission denied to set parameter`): de migratie-rol mag dit parameter niet in een functie-SET zetten. ef_search blijft dus 40; uitgesteld als apart openstaand punt (opties: `alter role authenticated set hnsw.ef_search`, een plpgsql-wrapper met `set local`, of app-side `set_config`). (3) `fts_rang`/`vec_rang` + poging-herkomst in `retrieval_meta`.

## Gevolgen

- **Meetbasis onder de andere twee werkopdrachten.** Zonder reproduceerbare retrieval meten `WERKOPDRACHT-RETRIEVAL-RECALL.md` en `WERKOPDRACHT-ANTWOORDLENGTE.md` ruis. Deze opdracht gaat vóór beide. M1 (recall) haakt in het M-R3-mechanisme als derde poging.
- **Auditspoor uitsluitend additief**, append-only intact: nieuwe velden `retrieval_pogingen`, `poging_herkomst`, `fts_rang`/`vec_rang`; geen veld verdwenen.
- **Geen RLS-versoepeling.** Migratie wijzigt alleen de body + `SET`-clausules van `zoek_chunks_hybride`; signatuur ongewijzigd, `security invoker` behouden, ACL na `drop function` expliciet hersteld (r7-patroon; bevinding H-18).
- **Latentie.** M-R2 haalt de valse reformulaties (met de dure modelcall) weg op zelfstandige vragen → p95-winst; M-R3 kost +1 embedding +1 RPC uitsluitend op geherformuleerde beurten (~100-250 ms). `ef_search` 40→100 was verwacht verwaarloosbaar op deze corpus, maar is uitgesteld (Supabase 42501, zie M-R5).

## Openstaande punten

1. **Het patroon achter drie heuristieken** (bronkeuze-twijfelbak, reformulatie-lengteregel, `VERWIJSWOORDEN`) — vuren op een proxy i.p.v. het probleem. Vast te leggen als ontwerpprincipe. *Eigenaar: opdrachtgever/Claude.*
2. **Demonstratief vs. relatief `die`** ("documenten die vastgesteld zijn") blijft een benadering; met de M-R3-fusie non-destructief. *Eigenaar: Claude.*
3. **Reproduceerbaarheid over een index-mutatie heen.** Een HNSW-graaf muteert bij elke INSERT; een bronvermelding uit maart is niet noodzakelijk reproduceerbaar in augustus. Inherent, geen bug — expliciet vastgelegd omdat het auditspoor het tegendeel suggereert. *Eigenaar: opdrachtgever.*
4. **Model-drift** commentaar vs. code: `REWRITE_MODEL = claude-sonnet-4-6` behouden (code leidend); commentaar gecorrigeerd. *Afgehandeld.*
5. **`hnsw.ef_search` = 40 (M-R5.2 uitgesteld).** Supabase weigert de functie-SET (42501). De vector-arm blijft op ef_search = 40 = `p_kandidaten`; latent risico 4 (arm klapt in bij uitputting van de kandidatenlijst) staat dus nog open. Te kiezen mechanisme (`alter role`, plpgsql `set local`, of app-side `set_config`) elk met eigen test. *Eigenaar: opdrachtgever/Claude.*
