# T8 — Async semantische extractie bij ingestion (ontwerp)

> Epic Documentvergelijking · Fase 1 · volgt op S1 (spike) + T7 (schema). Levert de
> data voor T5 (vergelijking) en T9 (oordeel). Besluit: [`decisions/0171`](./decisions/0171-t8-semantische-extractie-lui-service-role-atomisch.md).
> Bron van waarheid blijft de code + `supabase/migrations/`; dit doc is de "wat en waarom".

## Doel

Bij (her)verwerking van een document de **actieve catalogus-concepten** extraheren naar
`semantic_units` (T7) — kostbewust, versie-bewust en idempotent — met de S1-faalpatronen
ingebakken. **In scope:** de extractie-job, validatie, ontdubbeling, incrementeel hergebruik,
de faalpatroon-werkstromen, de twee interne poorten. **Out of scope:** het schema (T7), de
vergelijking (T5), open concept-ontdekking, Sonnet/Opus-escalatie, UI.

## Architectuur in één alinea

Een **luie** (on-demand) async job plugt in de bestaande ingest-worker: een nieuwe
`stap='semantische_extractie'` op `document_processing_jobs`, geclaimd door de stap-agnostische
`documenten_claim_ingest_jobs` en gedispatcht in `verwerkJob`. De handler leest de
`document_chunks`, bepaalt incrementeel welke chunks gewijzigd zijn t.o.v. de voorganger,
vraagt per (gewijzigde chunk × actief concept) één **geforceerde Haiku-tool-call** (temperature 0,
verbatim evidence), normaliseert deterministisch aan onze kant, dedupliceert, en schrijft de
append-only `extraction_run` + de vervangbare `semantic_units` **atomisch** weg via
`fn_schrijf_semantische_extractie`. Alles achter de flag `SEMANTISCHE_EXTRACTIE` (default uit).

## Job-contract

- **Input:** `document_id` (trigger: `on_demand` — lui). Enqueue via
  `enqueueSemantischeExtractie(svc, documentId)` (T5 roept dit server-side aan; de interne
  route `POST /api/internal/semantische-extractie` is de handmatige/test-trigger).
- **Stappen (`verwerkSemantischeExtractieJob`):** document laden → **skip** als er al een
  geslaagde `extraction_run` is voor `(document_id, catalog_version)` → actieve concepten +
  `catalog_version` bepalen → chunks laden → incrementele diff → extractie van gewijzigde
  chunks → ontdubbelen → atomisch schrijven.
- **Idempotent + locking:** lock per document via de job-claim (`FOR UPDATE SKIP LOCKED` +
  lease) én de partiële unieke index `(document_id, stap)`; overslaan bij een bestaande
  geslaagde run voor dezelfde catalogus-versie.
- **Incrementeel/versie-bewust:** bij een voorganger (`vervangt_document_id`) worden chunks
  waarvan de whitespace-genormaliseerde tekst ongewijzigd is niet opnieuw gemodelleerd; hun
  units worden hergebruikt (binding overgenomen, `chunk_id` herwezen naar de huidige chunk).

## Kostenstrategie (besluit 0171)

Default **lui**, achter parameter `SEMANTISCHE_EXTRACTIE_STRATEGIE` (`lui`/`type_scoped`/`beide`;
alleen `lui` gebouwd). **Geen documenttype-filter** — de bestaande enum matcht de werkopdracht-
typen niet, en de luie trigger begrenst het volume al. Extractie per chunk × actief concept;
alleen gewijzigde chunks bij een nieuwe versie.

## Faalpatroon-werkstromen (uit S1)

| Patroon | Aanpak in T8 |
|---|---|
| **Datum-overbinding** | `transitiedatum` is `uitgesteld` → niet geëxtraheerd (status-filter). De datum-rol-disambiguatie blijft de poort om het te promoveren. |
| **Negatie/polariteit** | Scherpere instructie **+** deterministische deelzin-guard (`bindingNegated`): een policy-binding in een ontkende deelzin ("de individuele methode wordt níet toegepast") valt weg. |
| **Ontdubbeling** | Eén unit per `(document, concept, genormaliseerde waarde)`; de sterkste kandidaat (verbatim-geverifieerd, hoogste confidence) wint. |
| **Gezag-correlatie** | `semantic_units.document_status = documenten.status` (denorm); downstream weegt gezaghebbend ≫ werkdocument/vervallen. |
| **Bron-verankering (behouden)** | `evidence_verified` = evidence letterlijk (reflow-tolerant) in de chunk → goedkoop anti-hallucinatiesignaal. |

**`evidence_verified`-semantiek:** `true` alleen bij verbatim-match. Onverifieerbare units
worden wél bewaard maar als niet-betrouwbaar gemarkeerd; niet-normaliseerbare of ontkende
kandidaten worden gedropt (halen de `value_*`-CHECK toch niet, resp. faalpatroon 2).

## Datastromen & schema-raakvlakken

- **Lezen:** `concepts` (catalogus + `normalization`-hints: omschrijving + enum-trefwoorden),
  `documenten` (fonds/status/`vervangt_document_id`/geindexeerd), `document_chunks` (tekst +
  locatie), voorganger-`semantic_units` (voor hergebruik).
- **Schrijven (service-role, atomisch):** `extraction_run` (append-only, één keer),
  `semantic_units` (vervangen bij her-extractie).
- **`catalog_version`:** sha256(16) over de gesorteerde catalogus (`key/type/status/normalization`);
  elke catalogus-wijziging bumpt de versie → cache-invalidatie + her-extractie.

## Reproduceerbaarheid & governance

- Elke run legt `model` (`HAIKU_MODEL`), `prompt_version` (`t8-extract-v1`),
  `extractor_version` (`t8-v1`) en `catalog_version` vast. Temperature 0.
- Fondsdata → Claude API onder de bestaande DPA/EU-residency; `semantic_units` onder RLS (T7).
- Geen menselijk oordeel hier — puur extractie; het oordeel zit in T9/T10.
- **Openstaand:** de catalogus-eigenaar van `concepts` (T7-risico) moet vóór productie benoemd zijn.

## Terugdraaibaarheid

Flag `SEMANTISCHE_EXTRACTIE` (default uit) = geen enqueue, geen verwerking, geen
gedragswijziging. Migratie puur additief; ROLLBACK dropt functie, stap-waarde, hints, index.

## Teststrategie

- **Pure sanity** (`core/lib/semantische-concepten.sanity.ts`, `npm run sanity`): normalisatie,
  evidence-verbatim, negatie-guard (incl. twee-deelzin-casus), ontdubbeling, catalogus-versie-
  determinisme, actief-concept-filter (transitiedatum buiten), strategie-resolutie.
- **DB-gedragstoets** (`supabase/checks/2026_08_12_t8_semantische_extractie.sql`): stap-enum,
  functie-grants (gate H), catalogus-hints, atomische schrijf (geslaagd = run+units; her-run
  vervangt units + appendt run; mislukt = alleen provenance; run blijft append-only).
- **Engine/job** (`semantische-extractie.ts`/`-job.ts`): I/O-orchestratie met een injecteerbare
  extractor; bewust géén tsx-sanity (server-only, zoals de ingest-worker) — gedekt door de
  DB-toets + de real-dossier-poort. De risicovolle logica leeft in de pure, geteste laag.

## Twee interne poorten (vóór T5/T9 hard worden)

1. **Validatie op ≥1 echt dossier** — S1 was synthetisch; echte PDF's (tabellen, voetnoten,
   OCR-ruis) kunnen de cijfers drukken. T8 levert de meethaken; het draaien + aftekenen is mensenwerk.
2. **Occurrence-niveau precision** — S1 mat document-niveau. Meet mee in T11 (extraction
   precision/recall, binding-precision, waarde-/bron-accuraatheid), precision-first.

## Bestanden

- Migratie + rollback: `supabase/migrations/2026_08_12_t8_semantische_extractie.sql` (+`_ROLLBACK`)
- Gedragstoets: `supabase/checks/2026_08_12_t8_semantische_extractie.sql`
- Pure kern: `core/lib/semantische-concepten.ts` (+`.sanity.ts`)
- Modelcall-laag: `core/lib/semantische-extractie.ts`
- Job + enqueue: `platform/lib/semantische-extractie-job.ts`; dispatch in `platform/lib/ingest-orchestrator.ts`
- Interne route: `app/api/internal/semantische-extractie/route.ts`
- Besluit: `decisions/0171`
