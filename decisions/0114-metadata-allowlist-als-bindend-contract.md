# 0114 — Metadata-allowlist als bindend contract voor `retrieval_meta`

- **Status:** Geaccepteerd
- **Datum:** 2026-08-04
- **Betrokkenen:** IB, ontwikkeling

## Context

`retrieval_meta` is in twee jaar uitgegroeid tot ruim vijftig sleutels en draagt inmiddels zélf inhoud: `zoekvraag` is de (soms geherformuleerde) vraag van de gebruiker, `sources[].fragment` is letterlijke documenttekst, `sources[].snippet` idem voor webbronnen, en daarnaast `scope.titels`, `terugval`, `jargon_expansie` en `invoer.historie_hash`. Zonder ingreep zou de scheiding uit [[0107]] cosmetisch zijn: de vraag blijft dan gewoon in een append-only jsonb-veld staan.

Tegelijk lezen de P5-monitoringsignalen rechtstreeks uit dit veld met de service-role. Een te ruwe ingreep laat die signalen stilvallen zónder foutmelding — precies de faalvorm die bevinding T-01 blootlegde.

## Besluit

Elke topsleutel van `retrieval_meta` is expliciet geclassificeerd als **basis** (operationele telemetrie), **bron** (bronidentiteit) of **inhoud** (letterlijke tekst), in `core/lib/audit-meta.ts`. Bij het schrijven splitst `splitsRetrievalMeta()` het inhoudsdeel af naar `governance_log_inhoud`; bij het lezen projecteren `meta_basisniveau()` en `meta_bronniveau()` dezelfde lijst. Een niet-geclassificeerde sleutel geldt fail-closed als inhoud én laat de sanitytest falen.

## Overwogen alternatieven

- **Striplijst in plaats van allowlist** — verworpen, en dit is de kern: rijen van vóór plateau A zijn nooit door de schrijfkant gegaan. Een striplijst kent de sleutels van gisteren niet; een allowlist laat alles wat zij niet kent vanzelf vallen. Voor historische rijen is de leesprojectie de énige bescherming.
- **`sources` als bronniveau** — verworpen: `AssistantSourceDocument.fragment` is documenttekst. De bronidentiteit die een auditor nodig heeft zit in `bronversie_audit` en `chunks`, die geen tekst dragen.
- **Handmatige inventarisatie zonder afdwinging** — verwatert bij het eerste nieuwe veld.

## Gevolgen

- **Audit:** het spoor houdt zijn analytische waarde (methode, telling, latency, tokens); bron-ID's vragen een aparte capability ([[0119]]).
- **Onderhoud:** een nieuw veld in `RetrievalMeta` laat `core/lib/audit-meta.sanity.ts` falen tot het bewust is ingedeeld. Dat is de bedoeling.
- **Dubbele bron:** de lijst staat in TypeScript én in SQL. Bewust — de leeskant moet ook werken op rijen die de schrijfkant nooit zagen. De sanitytest en de rol-/capabilitysuite bewaken de gelijkenis.
- **P5-koppeling:** de sanitytest pint expliciet vast dat `embedding_query_success`, `duur_model_ms`, `geselecteerd`, `zwakke_bronbasis`, `verduidelijking` en `tokens` op basisniveau blijven.

## Referenties

- `core/lib/audit-meta.ts`, `core/lib/audit-meta.sanity.ts`
- `supabase/migrations/2026_08_04_a2_audit_least_privilege.sql` (`meta_projectie`)
- `platform/lib/monitoring-health.ts:196`, `platform/lib/monitoring-queries.ts:311/356/400`
- [[0107]], [[0119]], [[0112]]
