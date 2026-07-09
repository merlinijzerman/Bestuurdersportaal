# 0048 — T6: canonieke geldigheidsstatus afgeleid (geen kolom) + beheerkenmerken generieke content

- **Status:** Geaccepteerd
- **Datum:** 2026-07-09
- **Betrokkenen:** Merlin IJzerman (opdrachtgever), Claude Code (uitvoering)

## Context

Increment T6 (gedeelde contentlaag, generic-MVP) formaliseert de fonds-overstijgende
("generieke") content als centraal beheerd, read-only voor fondsen en met een geldigheids-
status. De beslisnotitie v0.4 §7 (B3 / besluit 0040) schrijft een canonieke geldigheidsstatus
`draft/published/deprecated/withdrawn` voor plus de beheerkenmerken **versie, eigenaar,
publicatiedatum, reviewdatum, bronverwijzing**.

Het meeste is al as-built en wordt niet herbouwd: de classificatie (`bibliotheek='generiek'`
+ `fonds_id IS NULL`), de read-only-RLS op `documenten`, het rijke statusvocabulaire
(`status` 8-waarden + `bronstatus` 4-waarden, Increment C) en de published-only-RAG-gate
(T4 / besluit 0045: `status='van_kracht' AND coalesce(bronstatus,'actief')='actief'`). Het
as-built vocabulaire is primair ontworpen voor het besluit-/dossierproces van **fonds**-
documenten en wijkt af van de vier beslisnotitie-toestanden. Twee vragen moesten worden
beslist: (1) hoe verzoenen we de vier canonieke toestanden met de bestaande velden — afgeleid
of een aparte kolom? en (2) welke ontbrekende beheerkenmerken komen additief bij?

Randvoorwaarden: geen tweede, concurrerende status-bron van waarheid; het retrievalpad (0045)
mag niet wijzigen; RLS/tenant-isolatie ongemoeid; PII minimaliseren; migratie-eerst met
`_ROLLBACK`.

## Besluit

1. **De canonieke geldigheidsstatus is AFGELEID/documentair over de bestaande velden — géén
   aparte kolom.** De mapping staat in `lib/generiek-status.ts` (`generiekGeldigheidsstatus`),
   met `published` **exact gelijk** aan de 0045-gate (`isPublishedGeneriek` in `lib/rag.ts`).
   Alles wat niet `published` is faalt automatisch die gate, dus `deprecated`/`withdrawn` worden
   per constructie nooit als actuele bron gebruikt. De consistentie wordt programmatisch bewezen
   (`lib/generiek-status.sanity.ts`, volledige status × bronstatus-matrix).
2. **Drie beheerkenmerken komen additief/nullable bij** op `documenten` (migratie
   `2026_07_09_t6_generiek_beheerkenmerken.sql`): `eigenaar` (functioneel/team-label, géén
   persoonsnaam/FK — PII-minimaal), `volgende_review` (date) en `versie` (leesbaar label). De
   overige §7-kenmerken bestonden al (`gepubliceerd`, `bronorganisatie`/`extern_url`).
3. **De namespace-invariant wordt een harde CHECK** (`documenten_generiek_namespace_check`):
   `generiek ⇒ fonds_id NULL`, `fonds ⇒ fonds_id NOT NULL` (besluit 0045 verwees dit door naar
   T6), voorafgegaan door een pre-check tegen bestaande schendingen.

## Mapping (documentair)

| Canoniek | Afleiding uit `status` / `bronstatus` |
|---|---|
| `published` | `status='van_kracht' AND coalesce(bronstatus,'actief')='actief'` (≡ 0045-gate) |
| `withdrawn` | `status='gearchiveerd' OR bronstatus='uitgesloten'` |
| `deprecated` | `status IN ('vervangen','alleen_historisch') OR bronstatus='historisch'` |
| `draft` | al het overige (`concept`/`ter_bespreking`/`ter_besluitvorming`/`vastgesteld`) |

## Overwogen alternatieven

- **Aparte `generiek_status`-kolom (enum draft/published/deprecated/withdrawn).** Verworpen:
  creëert een tweede bron van waarheid náást `status`/`bronstatus` die kan divergeren van de
  0045-retrieval-gate, vergt synchronisatie-logica/trigger, en dwingt de retrieval-RPC's te
  wijzigen. De afgeleide mapping dekt alle gevraagde toestanden aantoonbaar (sanity-matrix).
- **`versie` afdekken met alleen de self-FK-lineage (geen kolom).** Overwogen (0022 koos self-FK
  voor lineage). Verworpen omdat §7 expliciet een leesbaar versiekenmerk vraagt; het label komt
  er additief bij, de lineage blijft de self-FK-keten (geen concurrentie).
- **`eigenaar` als uuid-FK naar `profielen`.** Verworpen: generieke content heeft geen fonds-
  eigenaar en platform-identiteiten hebben geen `profielen`-rij; een vrij team/functie-label
  past beter en minimaliseert PII.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd. Drie nullable kolommen + één CHECK die de classificatie
  hardt; geen leespolicy verzwakt, geen schrijfrecht verruimd. De namespace-CHECK geldt ook voor
  de service-role (curatie), wat de invariant borgt.
- **Retrieval (0045):** ongemoeid. `published` valt samen met de bestaande gate; de RPC's zijn
  niet aangeraakt. Zou een toekomstige mapping-wijziging de gate raken, dan coördineren met T4.
- **Datamodel/migraties:** `2026_07_09_t6_generiek_beheerkenmerken.sql` (+ `_ROLLBACK`),
  additief/idempotent, migratie-eerst. `supabase/schema.sql` bijgewerkt als documentatie.
- **Beheer-/gebruikservaring:** de drie velden zijn in te vullen via de bestaande platform-
  curatie (`curatieBijwerken`/`curatieAanmaken`). De HANDHAVING van periodieke review
  (verplicht, verloop-/intrekkingssignalering) is bewust **T10** — T6 levert alleen het veld.
- **Bewust geaccepteerde schuld:** de published-gate checkt géén datum-verloop (`geldig_tot <
  today`); datum-gebaseerde expiry is T10.

## Referenties

- Migratie: `supabase/migrations/2026_07_09_t6_generiek_beheerkenmerken.sql` (+ `_ROLLBACK`).
- Mapping + bewijs: `lib/generiek-status.ts`, `lib/generiek-status.sanity.ts`.
- Read-only + namespace-test: `supabase/checks/2026_07_09_t6_generiek_readonly.sql`
  (gebundeld in `scripts/cross-tenant-ci.sh`).
- Curatie: `app/(platform)/platform/(beveiligd)/generieke-bibliotheek/acties.ts`,
  `lib/generiek-curatie.ts`, `.../_components/GeneriekeBibliotheekClient.tsx`.
- Voorafgaand: `decisions/0040` (B3), `decisions/0045` (published-gate + namespace doorgeschoven),
  `decisions/0022` (self-FK-versiemodel), beslisnotitie v0.4 §7/§11/§12.
