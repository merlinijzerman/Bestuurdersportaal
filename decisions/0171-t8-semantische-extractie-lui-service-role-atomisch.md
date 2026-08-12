# 0171 — T8 semantische extractie: lui + geen type-filter, injecteerbaar per-chunk, atomische schrijf

- **Status:** Geaccepteerd
- **Datum:** 2026-08-12
- **Betrokkenen:** Merlin (product/architectuur), Claude Code (uitvoering)

## Context

T8 (epic Documentvergelijking, Fase 1, volgt op S1/T7) bouwt de productie-extractie
die de semantische laag (T7) vult: de actieve catalogus-concepten uit een document
extraheren naar `semantic_units`, kostbewust, versie-bewust en idempotent. S1 bewees
de haalbaarheid en wees de faalpatronen aan (datum-overbinding, negatie/polariteit,
ontdubbeling, gezag-correlatie). Randvoorwaarden: tenant-isolatie/RLS, reproduceer-
baarheid (append-only `extraction_run`, besluit [`0169`](./0169-t7-semantische-laag-datamodelkeuzes.md)),
service-role-isolatie (Variant-C, [`0066`](./0066-variant-c-cutover-optie-1.md)),
`maxDuration`/geen inline zwaar werk ([`0020`](./0020-ocr-engine-mistral.md)/[`0023`](./0023-ocr-in-generieke-curatie-pipeline.md)),
en terugdraaibaarheid (flag uit = geen gedragswijziging).

Binnen die kaders lagen enkele keuzes open die niet eenduidig uit de werkopdracht volgden.

## Besluit

1. **Kostenstrategie = lui, géén type-filter.** De extractie draait niet proactief
   bij ingest en niet gescoped op documenttype, maar **on-demand** (bij de eerste
   vergelijkingsbehoefte), daarna gecachet. Reden bij de type-keuze: de bestaande
   `documenten.documenttype`-enum kent de werkopdracht-typen (transitieplan/
   implementatieplan/reglement) niet; i.p.v. de enum uit te breiden of op `analyse`/
   `rapportage` te scopen is bewust géén type-filter gekozen — de luie trigger begrenst
   het volume al. De strategie zit achter parameters (`SEMANTISCHE_EXTRACTIE_STRATEGIE`,
   default `lui`); `type_scoped`/`beide` zijn gereserveerd maar niet gebouwd (vallen terug op `lui`).
2. **Hergebruik de bestaande async worker; geen aparte worker.** Een nieuwe
   `stap='semantische_extractie'` op `document_processing_jobs`, geclaimd door de
   bestaande stap-agnostische `documenten_claim_ingest_jobs` (FOR UPDATE SKIP LOCKED,
   lease/backoff) en gedispatcht in `verwerkJob`. Idempotente enqueue via de partiële
   unieke index `(document_id, stap)`.
3. **Tekstbron = `document_chunks`, extractie per chunk × actief concept.** De
   post-ingest chunks leveren `chunk_id`/`page`/`section` gratis, zijn de diff-eenheid,
   en zijn dezelfde productietekst (afkomstig van `document-extractie`). Eén geforceerde
   Haiku-tool-call (temperature 0, verbatim evidence) per (gewijzigde chunk, actief concept).
4. **Actieve scope = catalogus-status.** Alleen concepten met `status != 'uitgesteld'`
   worden geëxtraheerd; daarmee valt `transitiedatum` (uitgesteld) automatisch buiten —
   geen aparte code, en de datum-disambiguatie-werkstroom blijft de poort om het te promoveren.
5. **Faalpatronen deterministisch geborgd.** Negatie/polariteit via een deelzin-guard
   op de evidence (ontkende policy-binding valt weg); ontdubbeling per `(document, concept,
   genormaliseerde waarde)`; gezag-signaal via `document_status` (= `documenten.status`)
   op elke unit; bron-verankering via `evidence_verified` (verbatim-check). De normalisatie
   is deterministisch aan onze kant (het model levert alleen `value_raw` + evidence).
6. **Incrementeel via tekst-hash, geen schema-uitbreiding.** Chunks waarvan de
   whitespace-genormaliseerde tekst ongewijzigd is t.o.v. de voorganger
   (`vervangt_document_id`) worden niet opnieuw gemodelleerd; hun units worden hergebruikt
   (binding overgenomen, `chunk_id` herwezen). Er is bewust géén per-chunk hash-kolom
   toegevoegd — de hash wordt bij extractie berekend uit de chunk-rijen.
7. **Atomische schrijf via SECURITY INVOKER-functie.** `fn_schrijf_semantische_extractie`
   schrijft de append-only `extraction_run` + de (vervangbare) `semantic_units` in één
   transactie. INVOKER (draait als de aanroepende service-role, géén definer-bypass);
   EXECUTE ontzegd aan public/anon/authenticated, alleen aan `service_role` (gate H).

## Overwogen alternatieven

- **Type-gescoped/proactief bij ingest** — afgewezen: de documenttype-enum matcht de
  werkopdracht niet, en proactieve extractie kost ook voor nooit-vergeleken documenten.
  Lui is de goedkoopste modus; de parameter houdt de deur open.
- **Aparte semantische-worker + eigen claim** — afgewezen: de bestaande claim-RPC is
  stap-agnostisch en de lease/backoff/fair-share zijn al bewezen; een dispatch-branch is
  minder oppervlak dan een tweede worker. Aandachtspunt: semantische jobs delen het
  worker-tijdbudget met ingest (aanvaardbaar bij het lage, luie volume).
- **Her-extractie via re-extract van het bestand** (werkopdracht-hergebruikpunt) —
  afgewezen ten gunste van `document_chunks`: die geven `chunk_id`-koppeling + de diff-
  eenheid gratis en vermijden een tweede download/extractie; nog steeds dezelfde productietekst.
- **Per-chunk hash-kolom op `document_chunks`** — afgewezen (voorlopig): de diff werkt
  met een on-the-fly hash; een gematerialiseerde kolom raakt het hete ingest-pad en is een
  latere optimalisatie als het volume het vraagt.
- **Sequentiële supabase-js schrijf (run, dan units)** — afgewezen: append-only maakt
  `gestart→geslaagd` onmogelijk, dus een run-vóór-units-schrijf laat bij een fout een
  geslaagde run zonder units achter (idempotentie zou dan onterecht overslaan). De atomische
  functie sluit dat venster.
- **SECURITY DEFINER-schrijffunctie** — afgewezen ten gunste van INVOKER: de enige aanroeper
  is de service-role, dus INVOKER volstaat en vermijdt de definer-bypass-zorg (gate H).

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd. Schrijven blijft service-role-only; `semantic_units`
  erft de T7-`fonds_id`-RLS. De nieuwe functie is niet aanroepbaar door tenants.
- **Audit/reproduceerbaarheid:** elke unit hangt via `extraction_run_id` aan een run die
  `model`/`prompt_version`/`extractor_version`/`catalog_version` vastlegt; `catalog_version`
  is een deterministische hash over de catalogus (elke wijziging invalidateert de cache).
- **Datamodel/migraties:** puur additief — één stap-enumwaarde, `concepts.normalization`-
  backfill (catalogus-hints), één schrijffunctie, één skip-index. ROLLBACK dropt alles.
- **Terugdraaibaarheid:** flag `SEMANTISCHE_EXTRACTIE` (default uit) = geen enqueue, geen
  verwerking, geen gedragswijziging.
- **Bewust geaccepteerde grenzen:** negatie-guard is deelzin-heuristiek (precision-first,
  niet volledig); incrementele diff is tekst-hash op chunkniveau (paragraaf-verschuivingen
  zonder tekstwijziging tellen als ongewijzigd — gewenst). **Twee interne poorten blijven
  open vóór T5/T9 hard worden:** (1) validatie op ≥1 echt dossier (S1 was synthetisch),
  (2) occurrence-niveau precision (S1 mat document-niveau). T8 levert de meethaken; het
  oordeel is mensenwerk (meet mee in T11).

## Referenties

- Migratie: [`2026_08_12_t8_semantische_extractie.sql`](../supabase/migrations/2026_08_12_t8_semantische_extractie.sql) (+[ROLLBACK](../supabase/migrations/2026_08_12_t8_semantische_extractie_ROLLBACK.sql))
- Gedragstoets: [`2026_08_12_t8_semantische_extractie.sql`](../supabase/checks/2026_08_12_t8_semantische_extractie.sql)
- Code: [`core/lib/semantische-concepten.ts`](../core/lib/semantische-concepten.ts) (+`.sanity`), [`core/lib/semantische-extractie.ts`](../core/lib/semantische-extractie.ts), [`platform/lib/semantische-extractie-job.ts`](../platform/lib/semantische-extractie-job.ts), dispatch in [`platform/lib/ingest-orchestrator.ts`](../platform/lib/ingest-orchestrator.ts), route [`app/api/internal/semantische-extractie/route.ts`](../app/api/internal/semantische-extractie/route.ts)
- Ontwerp: [`T8-SEMANTISCHE-EXTRACTIE-ONTWERP.md`](../T8-SEMANTISCHE-EXTRACTIE-ONTWERP.md)
- Eerdere besluiten: [`0169`](./0169-t7-semantische-laag-datamodelkeuzes.md) (T7-schema), [`0066`](./0066-variant-c-cutover-optie-1.md) (service-role-isolatie), [`0020`](./0020-ocr-engine-mistral.md)/[`0023`](./0023-ocr-in-generieke-curatie-pipeline.md) (async i.p.v. inline)
