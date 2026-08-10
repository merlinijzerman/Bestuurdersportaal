# 0154 — Documentstatus van acht naar vijf

- **Status:** Geaccepteerd
- **Datum:** 2026-08-09
- **Betrokkenen:** Merlin IJzerman, Claude Code

## Context

De documentstatus telt acht waarden, maar de code leest daarvan slechts **vier uitkomsten** (geverifieerd): *in wording*, *actueel*, *historisch-vindbaar*, *weg*.

- `ter_bespreking`/`ter_besluitvorming` worden **op documentniveau nergens gelezen** — de treffers (`dossier.ts`, `decision-view.ts`) zijn de dossier-/procedurestatus, een ánder enum. De besluitvormingsfase leeft dus al op het dossier.
- `vervangen`/`alleen_historisch` worden alleen in `generiek-status.ts` gelezen, en dáár al samengevouwen tot dezelfde historische weergave.
- `vastgesteld`/`van_kracht` worden als één actueel-set gelezen (`rag.ts:1269/1315`).

## Besluit

De documentstatus gaat naar **vijf waarden**: `concept`, `vastgesteld`, `van_kracht`, `historisch`, `gearchiveerd`.

- `concept` absorbeert `ter_bespreking` + `ter_besluitvorming` (in wording).
- `historisch` is de merge van `vervangen` + `alleen_historisch`; `vervangen_door` blijft als optionele opvolger-FK.
- **Nieuwe transitie `vastgesteld → historisch`** — zodat een terminaal-vastgesteld type (rapportage, notulen, analyse) *historisch-vindbaar* kan worden en niet gedwongen alleen `gearchiveerd` (weg) kan.
- De "sprong verboden"-regel (`concept → vastgesteld`) **vervalt** (er zijn geen tussenstaten meer om te doorlopen).
- `van_kracht` **blijft**, maar uitsluitend voor de normatieve cluster via het statusprofiel-vlag `mag_van_kracht` (beleid, besluit, besluitdocument, besluitregistratie).
- `bestuursvoorstel`: route `concept → historisch` (behandeld, niet vastgesteld).
- Het opgeslagen token blijft `vastgesteld`; het per-type zichtbare **label** komt uit het statusprofiel ("Vastgesteld" bij een besluit, "Definitief" bij een memo/analyse/rapportage, "Van kracht" bij geldend beleid).
- `gearchiveerd` staat **expliciet** in de onvoorwaardelijke RPC-poort (`documentstatus <> 'gearchiveerd'`), naast `actief` en `rag_uitgesloten`.

Governancebetekenis (vastgelegd om misbruik te voorkomen): `historisch` = institutioneel geheugen, vindbaar; `gearchiveerd` = administratief bewaard, niet als context; `rag_uitgesloten` = zichtbaar voor mensen, niet voor AI.

Onderligger: `DOELMODEL-status-as v0.2`. **Gaat vóór 0153 (2026-08-09):** aanvankelijk samen gepland, maar 0153 (bronstatus) bleek de generieke-content-levenscyclus (T6/T10) te dragen en is losgetrokken tot een eigen track. 0154 is mechanisch (naam-remap van tussen-/eindstaten) en laag-risico; `bronstatus` blijft in deze migratie ongemoeid en de RPC-poort houdt voorlopig zijn `bronstatus='actief'`-eis (verwijderd in 0153).

## Overwogen alternatieven

- **Acht statussen behouden** — status quo; houdt ceremonie (rijpingsketen) in stand die geen documentlezer heeft. Verworpen.
- **`vastgesteld → definitief` hernoemen** (externe suggestie) — het onderliggende inzicht (levenscyclus-token ≠ weergavelabel) is juist, maar een surviving enum-waarde hernoemen voegt churn toe aan elke referentie, en `definitief` is voor een besluit juist zwakker. Verworpen; het per-type verschil wordt door de labellaag gedragen.
- **`van_kracht` schrappen** — de RAG onderscheidt vastgesteld/van_kracht niet, maar "geldende norm" is een natuurlijk bestuurlijk begrip (en voedt toekomstige tiering). Behouden; de inwerkingtreding-timing wordt overigens door `geldig_vanaf` afgehandeld, niet door de status.

## Gevolgen

- **Impactklasse: data + retrieval.** CHECK naar vijf waarden; transitietabel + **DB-trigger-spiegel** herzien; RPC-poort (`gearchiveerd` expliciet, NULL-veilig geldigheidsvenster ongewijzigd); `generiek-status.ts` (status→display), `rag.ts` (`ACTUELE_BRON_STATUSSEN`, `isPubliceerbaar`, `zouActueelZijn`); statusprofiel `mag_van_kracht` + per-type labels. Documentatiehaak vuurt; structurele gates schoon.
- **Datamigratie:** `ter_bespreking`/`ter_besluitvorming → concept`; `vervangen`/`alleen_historisch → historisch`; overige 1-op-1. `van_kracht` bij een niet-normatief type = mapping-signaal.
- **Verplichte bewijsvoering:** before/after **RAG-bereik-diff** (per document + AQLab-testset), delta verklaard, nul onverklaarde verschuivingen.
- **Restrisico (aanvaard):** onomkeerbaar (kloon-test vóór productie); `bestuursvoorstel`-semantiek als een fonds "vastgesteld" breed wil definiëren. Eigenaar: AI Governance Owner / Technical & Security Owner.

## Referenties

`DOELMODEL-status-as.md`, `IMPACTANALYSE-metadata-simplificatie.md`. Besluiten 0153 (bronstatus, samen te implementeren), 0152 (reviewworkflow), 0136, 0140. Betrokken: `core/lib/document-status-transities.ts`, RPC `2026_08_06_..._tiebreaker_efsearch.sql`, `core/lib/rag.ts`, `core/lib/generiek-status.ts`.
