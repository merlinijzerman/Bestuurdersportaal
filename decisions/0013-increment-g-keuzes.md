# 0013 — Increment G: RAG-filtering vóór retrieval + antwoordmodusfamilie

- **Status:** Geaccepteerd
- **Datum:** 2026-06-20
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder), Claude Code (uitvoering)

## Context

Increment G past status-/bronstatus-/geldigheidsfiltering **vóór retrieval** toe op de
gedenormaliseerde chunkvelden (uit E + C+/B13, besluit `0010`/`0012`) en productiseert
bestuurlijke duiding + sparring als één **antwoordmodusfamilie** naast de bestaande
bron-modi. Vier bouwkeuzes vroegen om een expliciet besluit vóór de uitvoering
(werkopdracht §14). Randvoorwaarden: RLS per `fonds_id` blijft hard (de RPC's zijn
`security invoker`, filters zijn additief), append-only audit (`retrieval_meta`),
human-in-the-loop (modus zichtbaar/wisselbaar, geen besluit/voorkeursadvies),
migratie-eerst-dan-deploy, en geen schijnzekerheid (concept/historisch/verlopen niet
als actuele bron).

## Besluit

1. **Strikt bronstatus-exit-criterium = operationeel, geen datamigratie.** De RPC
   behandelt `NULL`-bronstatus coulant als actief (`coalesce(bronstatus,'actief')`);
   het strenge criterium (NULL uitsluiten) is een latere flip zodra de
   metadata-review-queue leeg genoeg is. `documentstatus`-NULL blijft wél uitgesloten:
   de C-backfill zette bestaande docs op `concept`, en concept is nooit actuele bron.
2. **Bronsoort-weging = pure TS-helper** (`lib/weeg-bronsoort.ts`), geen SQL-boost.
   Herordent de over-fetch-kandidatenset vóór `selecteerChunks` (die de volgorde
   behoudt). Transparant en programmatisch toetsbaar (regressie #17/#18/#24).
3. **Besluitvorming-bron = afgeleid uit de top-chunks** (denorm `procesinstantie_id` →
   `decision_objects.procedure_id`), begrensd op 1–3 instanties. `p_procesinstantie_ids`
   blijft als optionele override beschikbaar voor een toekomstig dossier-instappunt.
4. **Testniveau per laag:** filtering (#1–12) als deterministische DB-integratiecheck
   (`supabase/checks/2026_06_20g_retrieval_filtering.sql`); modusdetectie + weging
   (#17/#18/#24 + modusfamilie) als pure sanity-tests; bronkaarten/audit als smoke.

## Overwogen alternatieven

- **1B — streng nu met backfill.** Verworpen: vereist een lege review-queue (die er
  niet is); een blinde backfill naar 'actief' zou ongecontroleerde docs juist
  promoten tot actuele bron, en is onomkeerbaar zonder auditspoor.
- **2B — SQL-rrf-boost.** Verworpen: magisch te tunen, lastig te unit-testen (DB nodig
  per parameterwijziging), koppelt de weging hard aan de RPC-signatuur.
- **3B — expliciete dossiercontext eisen.** Verworpen als default: werkt niet voor een
  vrije besluitvormingsvraag in de chat; wél behouden als override-pad.
- **4 — alles als pure sanity.** Verworpen: een TS-test raakt de SQL-filterlaag niet en
  zou #1–12 niet écht bewijzen (schijnzekerheid).

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd. De RPC's blijven `security invoker`; de nieuwe
  parameters zijn additieve AND-filters, geen verbreding. Decision Object-injectie loopt
  onder de bestaande `decision_objects`-RLS (anon-key, geen service-role).
- **Audit:** `governance_log.retrieval_meta` draagt nu de toegepaste filters
  (modus/peildatum/bronstatus/documentstatus/bronsoort/procesinstantie) + de actieve
  antwoordmodus (óók in modus `algemeen`) + het aantal meegenomen besluitbronnen.
- **Datamodel/migratie:** enige schemawijziging is `gesprekken.actieve_antwoordmodus`
  (nullable) + RPC drop+recreate (signatuur- én return-type-wijziging). ROLLBACK herstelt
  de vorige signaturen en droppt de kolom.
- **Gebruiker/beheer:** zichtbare antwoordstijl-keuze (Auto + familie), wissel-melding bij
  autodetectie, bronkaarten met status/bronstatus/datum/peildatum + generiek-labels.
- **Bewust geaccepteerde schuld:** (a) `actueel` geeft lege antwoorden zolang er geen
  documenten op `vastgesteld`/`van_kracht` staan — eerlijk gedrag, opgevangen door
  "Bekijk ook als historisch/alles"; meet de voorraad vóór livegang. (b) Dedup tussen
  Decision Object en een besluitdocument-chunk is labeling-gebaseerd (formele bron
  leidend), geen harde ontdubbeling op documenttype — follow-up indien nodig.

## Referenties

- Werkopdracht: `04 Technische inrichting/Bestuurdersportaal - Increment G werkopdracht en bouwticket v1.0.md` (§1a Route 1, §14 beslispunten).
- Migratie: `supabase/migrations/2026_06_20g_retrieval_modusfamilie.sql` (+ `_ROLLBACK`).
- Regressiecheck: `supabase/checks/2026_06_20g_retrieval_filtering.sql`.
- Code: `lib/vraagtype.ts` (`bepaalAntwoordmodus`/`retrievalModusVoor`), `lib/weeg-bronsoort.ts`, `lib/besluitvorming-bron.ts`, `lib/rag.ts`, `app/api/chat/route.ts`.
- Eerdere besluiten: `0006` (B8 duiding+sparring, B12/B13 bronsoort), `0010` (E-denorm), `0012` (denorm-vooruittrekking).
