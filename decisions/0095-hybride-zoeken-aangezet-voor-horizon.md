# 0095 — Hybride zoeken aangezet voor Horizon (vectorarm terug in het retrievalpad)

- **Status:** Geaccepteerd
- **Datum:** 2026-07-30
- **Betrokkenen:** Merlin (opdrachtgever), Claude (analyse)

## Context

Een middag onderzoek naar "conceptdocumenten worden niet gevonden" leverde drie
deeloorzaken op (statusfilter, terugvraaglus, querybouw — besluiten 0091, 0092, 0094).
Geen ervan verklaarde het gedrag volledig. Het auditspoor gaf uiteindelijk de
doorslag: in **geen enkele** `governance_log`-regel stond `methode: "hybride_rrf"`.
Alles liep via `ilike`, het laatste vangnet uit de cascade.

De verklaring: `fonds_feature_flags.hybride_zoeken` stond niet op `true` en de
env-default `HYBRID_SEARCH` was niet gezet. De hele retrieval draaide dus **lexicaal** —
Dutch-FTS met AND-semantiek, en bij nul rijen een substringmatch zonder ranking. De
pgvector-arm (`document_chunks.embedding`, `vector(1024)`, mistral-embed, HNSW-index,
aangelegd 07-06-2026) deed niet mee, terwijl het portaal in ontwerp en presentatie wel
op semantisch zoeken leunt.

## Besluit

**Hybride zoeken staat aan voor Stichting Pensioenfonds Horizon**, gezet als
fondsvlag (`fonds_feature_flags.hybride_zoeken = true`) en niet als env-default: per
tenant terug te draaien, direct effect zonder redeploy, en de wijziging landt via
`fn_fonds_config_capture` (oud→nieuw + versie) in het configaudit.

## Meting (voor/na, identieke vraag)

| tijd | vraag | methode | embedding_query_success | opgehaald | uitkomst |
|---|---|---|---|---|---|
| 15:29 | "Welke documenten met beleggingsbeleid ken je?" | `ilike` | — | 30 | uitsluitend generieke kaders |
| **17:01** | identiek | **`hybride_rrf`** | **`true`** | 30 | **Bestuursvoorstel Wijziging Beleggingsbeleid, 5 passages geciteerd** |

Het antwoord noemde daarbij uit zichzelf de juiste nuance — *"dit is een voorstel, geen
vastgesteld beleid"* — en somde expliciet op wat er níet in de bronnen zat (integraal
beleggingsplan, VIB, ALM-studie, risicobudget). Dat is het gedrag dat de conceptregel
(FO §6 / TO §3.1) beoogt: zichtbaar, gelabeld, zonder schijnzekerheid.

## Gevolgen

- **Kwaliteit:** de vectorarm vindt inhoudelijk verwante passages die lexicaal niet
  matchen. Dit was de zwaarste van de vier deeloorzaken van vandaag.
- **Kosten/latency:** één embedding-call (Mistral) per vraag, in het kritieke pad.
  Vereist `MISTRAL_API_KEY` in de productie-omgeving; ontbreekt die, dan logt de route
  `embedding_query_success: false` + `fallback_reason: "embedding_error"` en valt stil
  terug op FTS. Gemeten: `true`, dus de sleutel staat er.
- **Reikwijdte:** RRF verandert de rangschikking voor **alle** vragen, ook de vragen die
  het al goed deden. Geen sanity-test vangt dat; alleen gebruik en de AQLab-regressieset.
- **Tenant:** alleen Horizon. Andere fondsen blijven op de env-default tot dit bewust
  wordt verbreed.
- **Geen** code-, migratie-, RPC- of RLS-wijziging. De RPC `zoek_chunks_hybride` en de
  HNSW-index bestonden al sinds juni.

## Openstaand

- **AQLab-regressierun** vóór/ná deze omzetting is niet gedaan. Dat was al een openstaand
  [OPS]-punt bij R1.3–R1.6 (0073) en geldt hier evenzeer: er is nu een materiële
  gedragswijziging zonder objectieve nulmeting.
- **Embedding-dekking** is niet volledig geïnventariseerd. Chunks zonder `embedding`
  blijven onzichtbaar voor de vectorarm; per document is herindexeren mogelijk vanuit de
  bibliotheek.
- **Volgorde richting 0073:** eerst deze omzetting laten bezinken en meten, daarna pas
  R1.3 (reranker) en R1.5 (relevantie-ondergrens). Eén ding tegelijk — precies het risico
  dat 0073 bij gelijktijdige activering benoemt en accepteert.

## Referenties

- Config: `core/lib/fonds-config.ts` (`hybrideZoekenAan`), `fonds_feature_flags`
  (migratie `2026_07_09_t8_config_manifestlaag.sql`), auditrigger
  `2026_07_09_t8b_config_audit_trigger.sql`.
- Retrieval: `core/lib/rag.ts` (`zoekRelevanteChunksMetMeta`, hybride RRF-tak),
  `core/lib/embeddings.ts` (mistral-embed, 1024 dim),
  `supabase/migrations/2026_06_07_fase_c_embeddings.sql` (kolom + HNSW-index).
- Bewijs: `governance_log.retrieval_meta` 2026-07-30 15:29 vs 17:01.
- Besluiten: [`0091`](./0091-expliciete-scopebepaling-en-voorstelvragen.md),
  [`0092`](./0092-terugvraag-wordt-gelogd-en-bewaard.md),
  [`0094`](./0094-verslapte-or-terugval-op-de-fts-arm.md) (zelfde onderzoekslijn),
  [`0073`](./0073-retrieval-reranker-haiku-en-gelijktijdige-activering.md) (R1.3–R1.6).
