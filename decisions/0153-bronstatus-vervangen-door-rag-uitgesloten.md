# 0153 — Bronstatus vervangen door één `rag_uitgesloten`-vinkje

- **Status:** Geaccepteerd
- **Datum:** 2026-08-09
- **Betrokkenen:** Merlin IJzerman, Claude Code

## Context

De bronstatus-as (`actief`/`historisch`/`uitgesloten`/`actief_na_vaststelling`, NULL ≡ actief) overlapt in de beleving met de documentstatus ("is dit nog actueel?"). Geverifieerd tegen de retrieval-RPC (`2026_08_06_..._tiebreaker_efsearch.sql`, regels 117-129):

- **`historisch`** doet in de RPC exact hetzelfde als `geldig_tot` in het verleden of documentstatus `vervangen`/`alleen_historisch`: uit `actueel`, vindbaar in historisch/alles.
- **`actief_na_vaststelling`** heeft geen onafhankelijk effect — de documentstatus-poort weert een niet-vastgesteld stuk sowieso.
- **`uitgesloten`** is de enige echte functie: een harde RAG-uitsluiting. En die is vandaag alleen hard onder `actueel`; in historisch/alles hangt het ervan af of de app `p_bronstatus` meegeeft.

## Besluit

De **bronstatus-as vervalt** en wordt vervangen door één eigenschap **`rag_uitgesloten`** (boolean, default false), **orthogonaal aan de documentstatus** en **onvoorwaardelijk** in de retrieval-RPC afgedwongen in **alle** modi (naast `actief = true` en `documentstatus <> 'gearchiveerd'`). Daarmee:

- `uitgesloten` → `rag_uitgesloten = true` (document mag voor mensen zichtbaar blijven, maar niet als AI-bron dienen);
- `historisch` → documentstatus `historisch` en/of `geldig_tot`;
- `actief_na_vaststelling` → vervalt (de documentstatus-poort dekt het);
- `actief`/NULL → default.

Onderligger: `DOELMODEL-status-as v0.2`. Gezamenlijk geïmplementeerd met besluit 0154 (documentstatus), want ze delen de RPC-poort en de transitietabel.

## Overwogen alternatieven

- **Bronstatus behouden** — status quo, maar de as overlapt met documentstatus/geldigheid en levert een verwarrende tweede "actueel?"-dimensie. Verworpen.
- **Alleen verbergen (spoor A)** — bronstatus uit de standaard-invoer halen zonder de as te verwijderen; goede reversibele tussenstap, maar niet het eindmodel. Onderdeel van fase 1, niet het besluit.
- **`uitgesloten` als documentstatus i.p.v. eigenschap** — vermengt uitsluiting (een AI-keuze) met de levenscyclus; een document kan vastgesteld én uitgesloten zijn. Verworpen; orthogonaliteit is zuiverder.

## Gevolgen

- **Impactklasse: data + retrieval.** Migratie: `documenten` krijgt `rag_uitgesloten boolean`; `documenten.bronstatus` en de chunk-denorm ervan vervallen; RPC-poort herzien (bronstatus-eis eruit, `rag_uitgesloten` onvoorwaardelijk). Documentatiehaak vuurt; structurele gates schoon.
- **Datamigratie:** `uitgesloten → rag_uitgesloten=true`; `historisch → documentstatus historisch` (indien nu in de actueel-set); `actief`/`actief_na_vaststelling`/NULL → default.
- **Statusmachine:** de bronstatus-transities in `document-status-transities.ts` + de DB-trigger-spiegel vervallen; nieuwe capability `documents.rag.exclude` voor de toggle (met redenplicht + auditregel).
- **Ingest (0140):** de bronstatus-verklaring bij upload vervalt; de `rag_uitgesloten`-toggle komt in de plaats (capability-gated).
- **Retrieval:** `rag.ts` (`isPubliceerbaar` → `status ∈ {vastgesteld,van_kracht} && !rag_uitgesloten`).
- **Verplichte bewijsvoering:** before/after **RAG-bereik-diff** (actueel/historisch/uitgesloten per document + AQLab-testset) met verklaarde delta — nul onverklaarde verschuivingen.
- **Restrisico (aanvaard):** de migratie is onomkeerbaar; test op een kloon vóór productie. Eigenaar: Technical & Security Owner.

## Referenties

`DOELMODEL-status-as.md`, `IMPACTANALYSE-metadata-simplificatie.md`. Besluiten 0154 (documentstatus, samen te implementeren), 0136 (statusverklaring ingest), 0140 (classificatie ingest), 0152 (reviewworkflow). Betrokken: RPC `2026_08_06_..._tiebreaker_efsearch.sql`, `core/lib/document-status-transities.ts`, `core/lib/rag.ts`, `core/lib/document-ingest-classificatie.ts`.
