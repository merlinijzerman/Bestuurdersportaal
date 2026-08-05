# 0123 — Tijdens een reflectie draait er géén retrieval, in plaats van een bronsetfilter op de retrieval-RPC's

- **Status:** Geaccepteerd — **herziening van [[0111]] op het implementatiepunt**
- **Datum:** 2026-08-05
- **Betrokkenen:** Ontwikkeling, productverantwoordelijke

## Context

Besluit [[0111]] en technisch ontwerp §6.3 (G3) schrijven voor dat de bevroren reflectiebronset wordt afgedwongen via "de bestaande `p_document_ids`-parameter, op elk retrievalpad inclusief de PostgREST-terugval; geen nieuwe query-opbouw".

Bij de bouw bleken twee aannames daaronder niet te kloppen:

1. **Er ís geen `p_document_ids`-parameter.** `rpcFilterParams()` in `core/lib/rag.ts` kent `p_modus`, `p_peildatum`, `p_bronstatus`, `p_documentstatus`, `p_procesinstantie_ids` en `p_bronsoort` — meer niet. Het filter toevoegen betekent de signatuur van `zoek_chunks` én `zoek_chunks_hybride` wijzigen: een migratie op de heetste query van het product, buiten de scope van plateau B (één nieuwe tabel), met regressierisico voor élke bestaande retrieval.
2. **"Op elk retrievalpad" is een belofte die een filter niet kan waarmaken.** Naast de twee RPC's zijn er de PostgREST-terugval in `zoekViaFTS`, het dekkingsbrede pad via `haalDocumentChunks`, de reranker en de parent-verrijking. Elk pad dat het filter niet doorgeeft, is een gat — en een gat dat pas zichtbaar wordt wanneer er bronnen verschijnen die niet bij het antwoord horen.

## Besluit

Tijdens een actieve reflectieflow draait er **geen enkel retrievalpad**. `moetRetrieven` en `breedActief` worden hard `false`; de context wordt opgebouwd uit precies de chunks van het oorspronkelijke antwoord, opgehaald op ID via de nieuwe, deterministische `haalBevrorenChunks()` — geen embedding, geen ranking, geen drempel, geen terugval.

## Overwogen alternatieven

- **`p_document_ids` op de RPC's toevoegen (het TO-voorstel)** — verworpen: vergt een migratie op de retrieval-RPC's buiten de B-scope, en borgt alleen de paden die het filter kennen.
- **Filteren in TypeScript ná de retrieval** — verworpen: dan draait de zoekopdracht op de vrije reflectietekst wél, met alle kosten en latency, en met het risico dat een toekomstige refactor de nafilter overslaat. Bovendien zou de tekst dan alsnog als zoekvraag door de embedding-provider gaan.
- **Documentniveau in plaats van passageniveau** — verworpen: de bronset is de top-N van één antwoord, niet het hele document. Op documentniveau zou de reflectie passages kunnen aanhalen die de bestuurder nooit heeft gezien.

## Gevolgen

- **Strenger dan het ontwerp, niet losser.** Er is geen retrievalpad dat de bronset kan omzeilen, omdat er geen retrievalpad loopt. AC-19 en AC-20 zijn hiermee structureel geborgd in plaats van per pad.
- **Geen migratie op de retrieval-RPC's**, dus geen regressierisico voor de gewone chat.
- De fonds-discipline (`handhaafFondsdiscipline`, [[0045]]) blijft onverkort gelden op het bevroren pad. Dat is geen formaliteit: de bronset komt uit een logregel die dagen oud kan zijn, dus een ingetrokken of verlopen document valt hier alsnog af. **De bevriezing bevriest de selectie, niet de toegang.**
- **Bewust aanvaard:** een bevroren chunk die inmiddels is verwijderd, komt niet terug. De reflectie verliest dan die bron zonder melding. Het alternatief — een verwijderd fragment tóch tonen — is erger.
- Prestatiewinst als bijvangst: een reflectiebeurt kost geen embedding-call en geen reranker.

## Referenties

- `core/lib/rag.ts` (`haalBevrorenChunks`), `app/api/chat/route.ts` (G3-blok)
- Technisch ontwerp §6.3; ontwerp v1.0 §9.5; FR-54, FR-55; AC-19 t/m AC-21
- [[0111]], [[0045]], [[0108]]
