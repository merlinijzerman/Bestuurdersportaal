# 0219 — Gedeelde bronblokken-indexering, atomische (her)indexering en volledige sectie

- **Status:** Geaccepteerd voor Preview; herindexering en release naar Productie na apart akkoord
- **Datum:** 2026-10-05
- **Betrokkenen:** opdrachtgever (bestuurdersportaal), Claude Code
- **Ticket:** #548

## Context

Een meting op Kamerstuk 36 067 nr. 90 en de MvT bij de Wtp toonde drie gebreken in de PDF-extractie (zie `BRONBLOKKEN-EN-VOLLEDIGE-SECTIE-ONTWERP.md` §2):

- **Valse artikelkoppen.** Een afgebroken verwijzing `artikel 102a, heeft …` werd een kop.
- **Woordafbreking.** Woordafbrekingen werden niet hersteld.
- **Paginavoeten.** Kamerstuk-paginavoeten stonden in de doorzoekbare tekst.

Twee andere tekortkomingen kwamen erbij:

- **Gedeeltelijke chunkset.** De (her)indexering verving chunks met DELETE plus INSERT-batches. Bij een fout bleef een gedeeltelijke chunkset achter, terwijl geen zoekroute op `geindexeerd` of `verwerkingsstatus` filtert.
- **Volledige sectie.** Een volledige sectie opvragen kon alleen voor wetgeving met een BWB-link.

De opdrachtgever stelde de scope bij: de verbetering geldt voor **generieke én fondsdocumenten** (nieuwe uploads), terwijl alleen de **eenmalige herindexering van bestaande documenten** beperkt blijft tot de generieke bibliotheek.

## Besluit

1. **Extractie.** De gedeelde PDF-extractie bouwt leesbare bronblokken uit de tekstposities (`pdf-bronblokken.ts`). PDF, DOCX en nabewerkte OCR leveren tekst in het formaat "alinea per regel". De chunkstrategie volgt dat **tekstformaat, niet de bibliotheek**. Chunks uit die tekst dragen `indexering_versie = 'r2-bronblokken'` en laten geen tekst weg.
2. **Atomische vervanging.** Chunks worden atomisch vervangen via `fn_document_chunks_vervangen` (SECURITY INVOKER, RLS blijft de grens). Een (her)indexering die ná de vervanging faalt, ruimt de hele chunkset op en zet het document op `mislukt`. `geindexeerd = true` volgt pas na volledige verrijking. Er komt geen schaduwindex.
3. **Eenmalige herindexering.** De eenmalige herindexering selecteert per document en uitsluitend `bibliotheek = 'generiek'`. De uitkomst wordt vastgelegd in `document_processing_jobs` (stap `indexering`), zodat een mislukt document zonder chunks terug te vinden en te hervatten is. Bestaande fondsdocumenten blijven op hun huidige index.
4. **Volledige sectie.** Een expliciet verzoek om een **hele sectie** uit een toegelaten fonds- of generiek PDF/DOCX-document wordt zonder RAG-limiet en zonder modelcall beantwoord. De tekst wordt alleen letterlijk getoond als de volledigheid aantoonbaar is: index `r2-bronblokken`, geen OCR, aaneengesloten, begin- en eindgrens, binnen de omvang. Anders volgt een melding met een link naar het origineel. Voor een oude index is volledigheid niet aantoonbaar, dus daar volgt altijd de melding.

## Overwogen alternatieven

- **Schaduwindex of parallelle indexversie met omschakeling.** Afgewezen door de opdrachtgever: tijdelijk ontbrekende fragmenten per document zijn aanvaardbaar. De atomische RPC voorkomt een gedeeltelijke set zonder tweede index.
- **`geindexeerd`/`verwerkingsstatus` in alle zoekroutes laten meewegen.** Afgewezen. Dat raakt elke zoek-RPC, de RLS-policies en meer dan tien leeswegen, terwijl het eigenlijke probleem de niet-atomische schrijfstap is.
- **Afscherming op `bibliotheek = 'generiek'`.** Eerst gepland, daarna door de opdrachtgever geschrapt. Nieuwe fondsuploads moeten de verbetering ook krijgen.
- **Tweede PDF-extractor of breed OCR.** Niet nodig volgens de meting. De tekstlaag was correct; alleen de reconstructie faalde.
- **Volledigheid van een oude index "afleiden".** Afgewezen. Een oude index liet chunks van ≤ 50 tekens weg en bevat paginaopmaak, dus volledigheid is daar niet te bewijzen.

## Gevolgen

- **RLS/tenant.** De RPC is INVOKER en geeft een tenant geen recht dat de policies niet al gaven (DB-test V1–V5). De sectieroute gebruikt de gebruikersclient en past bovenop RLS de fonds-, status-, datum-, review- en scanpoort toe, op document- én chunkniveau.
- **Audit.** De sectieroute logt via `schrijf_ai_interactie` (`methode: gerichte_documentsectie`, met de reden van de controle). Herindex-uitkomsten komen in `document_processing_jobs` en `reindex_runs`.
- **Datamodel.** Er is één nieuwe functie, en die staat in de allowlist. Er zijn geen nieuwe kolommen of tabellen.
- **Volgorde.** Eerst de migratie op `portal_preview`, dan de code.
- **Gedrag.**
  - Nieuwe uploads (beide bibliotheken) krijgen andere chunkgrenzen en labels.
  - Bestaande fondsdocumenten veranderen niet, maar krijgen geen letterlijke volledige sectie tot ze ooit opnieuw worden verwerkt.
  - Een generiek document is tijdens zijn herindexering kort niet of alleen via tekst doorzoekbaar.
- **Bewust geaccepteerd.**
  - Meerkoloms opmaak zonder kolomdetectie.
  - Formules als afbeelding.
  - Fondsdocumenten in `concept` krijgen geen volledige sectie.

## Referenties

- `core/lib/pdf-bronblokken.ts`, `core/lib/document-extractie.ts`, `core/lib/chunking.ts`, `core/lib/chunk-bouw.ts`, `core/lib/wetsgeschiedenis-structuur.ts`
- `core/lib/chunk-vervangen.ts`, `core/lib/herindex-kern.ts`, `core/lib/herindex-selectie.ts`, `platform/lib/ingest-orchestrator.ts`
- `core/lib/retrieval/document-sectie.ts`, `core/lib/retrieval/document-sectie-ophalen.ts`, `app/api/chat/route.ts`
- `supabase/migrations/2026_10_05_548_chunks_atomisch_vervangen.sql` (+ rollback en checks)
- `BRONBLOKKEN-EN-VOLLEDIGE-SECTIE-ONTWERP.md`; eerder: 0218 (zoekpad R1), 0207 (releaseweg)
