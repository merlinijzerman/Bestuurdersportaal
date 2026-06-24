# 0025 — RAG R1.1 + R1.2: structuurbewuste chunking + contextuele retrieval via één gedeelde, omkeerbare re-index

- **Status:** Geaccepteerd
- **Datum:** 2026-06-24
- **Betrokkenen:** Productowner/opdrachtgever (plansessie); uitvoering in Claude Code

## Context

De retrieval-kwaliteit (R1 uit het RAG-releaseplan) wordt op twee punten verbeterd: **R1.1** chunkt op documentstructuur (kop/§/artikel/definitie/besluit/tabel) zodat een fragment nooit over een structuurgrens loopt, en **R1.2** voegt per fragment een korte context-zin toe (Anthropic "contextual retrieval"), zodat een losgeknipt fragment ook zónder omliggende tekst vindbaar/duidbaar is. Beide moeten bestaande documenten ten goede komen **zonder her-upload**, en omkeerbaar zijn (geen schijnzekerheid, snapshot-integriteit). Randvoorwaarden: tenant-isolatie per `fonds_id` via RLS mag niet worden omzeild, het append-only auditspoor blijft ongemoeid, de bewerking is door een mens gestart (human-in-the-loop) met vooraf zichtbare kosten, en de FTS- én vector-index moeten over **dezelfde** verrijkte tekst lopen.

## Besluit

We slaan de context-zin op in een **aparte kolom `document_chunks.context_prefix`** (Optie A) en laten zowel de embedding als de generated `zoek_vector`-kolom over de **verrijkte** tekst `context_prefix || ' ' || tekst` lopen, terwijl de getoonde/geciteerde `tekst` exact ongewijzigd blijft. De prefix wordt gegenereerd met een goedkoop model (Haiku) op basis van een **begrensd "structuur-venster"** (titel + structuur-type/-label van het bovenliggende onderdeel + het fragment zelf), niet het hele document. Eén gedeelde, herhaalbare en **omkeerbare** re-index ([`lib/reindex.ts`](../lib/reindex.ts) via [`lib/chunk-ingest.ts`](../lib/chunk-ingest.ts)) bedient álle vier de chunk-producerende paden (upload, her-extract, generieke pipeline, en de nieuwe backfill), met lichte provenance per fragment (`prefix_model`, `indexering_versie`) plus één `reindex_runs`-rij per backfill-aanroep.

## Overwogen alternatieven

- **Prefix mengen in `tekst` zelf** — verworpen: breekt de prefix-isolatie. De context-zin zou dan in bronvermelding/citaat lekken en `tekst` zou geen exacte snapshot van het origineel meer zijn (snapshot-integriteit, reproduceerbaarheid).
- **Geen aparte kolom, prefix alleen in de embedding-input (niet in FTS)** — verworpen: dan zien BM25/FTS en de vector-arm verschillende tekst, wat de hybride RRF-fusie inconsistent maakt. De generated `zoek_vector` dwingt nu exact dezelfde verrijkte tekst af als de embedding.
- **Whole-document context (volledige Anthropic-recept)** — verworpen voor MVP: duurder en minder deterministisch dan het begrensde structuur-venster; het venster geeft genoeg context tegen voorspelbare kosten.
- **Re-index als één lange job** — verworpen: zou de Vercel-functietimeout raken (her-extractie + tientallen Haiku-/embedding-calls per document). Daarom **één document per aanroep**, met een client-lus tot `klaar`.

## Gevolgen

- **Datamodel/migratie:** [`2026_06_24_rag_structuur_contextueel.sql`](../supabase/migrations/2026_06_24_rag_structuur_contextueel.sql) (+ `_ROLLBACK`) voegt nullable kolommen `structuur_type`, `structuur_label`, `context_prefix`, `prefix_model`, `indexering_versie` toe, herbouwt de generated `zoek_vector` als `to_tsvector('dutch', coalesce(context_prefix || ' ', '') || tekst)`, en maakt de `reindex_runs`-provenancetabel. Migratie-eerst, dán code-deploy.
- **RLS/tenant-isolatie:** ongewijzigd afgedwongen. De **fonds**-backfill draait op de anon-key + RLS (alleen `bibliotheek='fonds'`); de **generieke** re-index draait uitsluitend achter `withPlatform` (service-role, `bibliotheek='generiek'`) omdat tenants op generieke chunks read-only zijn. `reindex_runs` heeft RLS per `fonds_id`; generieke runs schrijven `fonds_id=NULL` via service-role.
- **Reproduceerbaarheid/omkeerbaarheid:** `tekst` wordt nooit gemuteerd; chunks zijn altijd opnieuw af te leiden uit het Storage-origineel. Een document zonder bruikbaar origineel (geen origineel, niet-ondersteund type, of geen tekst ná OCR) wordt als **overgeslagen** gestempeld (`indexering_versie = 'r1-overgeslagen'`) zodat de backfill terminerend blijft en één onverwerkbaar document de rij niet blokkeert.
- **Audit:** `reindex_runs` is **provenance, géén append-only/hash-spoor** — bewuste keuze, want dit is index-bouw, geen governance-besluit. Het bestaande append-only auditspoor (`governance_events`/`platform_event_log`/`*_log`) blijft onaangeroerd; de generieke re-index is bovendien volledig geaudit via `withPlatform`. De prefix is een AI-call die **nooit gebruikersgerichte output** produceert (alleen index), dus de chat-AI-interactielogging-eis is hier niet van toepassing; per-fragment `prefix_model` + run-`prompt_versie` is proportioneel.
- **Gebruikers-/beheerervaring:** batch-knop "Bibliotheek her-indexeren" in beheer (fonds) en in de generieke bibliotheek (platform), met **kostenbevestiging vooraf**. Geen UI-wijziging voor eindgebruikers; getoonde brontekst/citaten blijven identiek.
- **Bewust geaccepteerde schuld / vervolgpunten:** (a) de exacte system-prompt (`SP_PREFIX`) wordt niet gehasht in `reindex_runs` — een prompt-edit zonder bump van `PREFIX_PROMPT_VERSIE` zou stil dezelfde versie houden; (b) `embedding_model` staat per chunk maar niet op run-niveau; (c) bij een tijdelijke/document-eigen fout (`mislukt`: download/extractie/opslag) stopt de backfill-lus en moet een mens het document nalopen vóór hervatten — bewust géén stil overslaan, om een transient infra-storing niet als permanente "mislukt"-stempel te verbergen.

## Referenties

- Code: [`lib/chunking.ts`](../lib/chunking.ts), [`lib/chunk-ingest.ts`](../lib/chunk-ingest.ts), [`lib/reindex.ts`](../lib/reindex.ts)
- Backfill: [`app/api/documents/reindex-backfill/route.ts`](../app/api/documents/reindex-backfill/route.ts) (fonds) + `curatieHerindexeren` in [`generieke-bibliotheek/acties.ts`](<../app/(platform)/platform/(beveiligd)/generieke-bibliotheek/acties.ts>) (generiek)
- Migratie: [`2026_06_24_rag_structuur_contextueel.sql`](../supabase/migrations/2026_06_24_rag_structuur_contextueel.sql) (+ `_ROLLBACK`)
- Ontwerp: [`RAG-VERBETERING-ONTWERP.md`](../RAG-VERBETERING-ONTWERP.md)
- Eerdere besluiten: [`0011`](./0011-increment-d-keuzes.md) (segmentchunks), [`0012`](./0012-bronsoort-denorm-vooruitgetrokken-naar-cplus-b13.md) (denorm `bibliotheek`), [`0001`](./0001-append-only-audit-geen-harddelete.md) (append-only)
