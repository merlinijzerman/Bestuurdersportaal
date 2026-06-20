# 0012 — Bronsoort-denorm vooruitgetrokken naar Increment C+/B13 (i.p.v. G)

- **Status:** Geaccepteerd (2026-06-20)
- **Datum:** 2026-06-20
- **Betrokkenen:** Merlin IJzerman

## Context

De gedenormaliseerde chunkvelden (Increment E) voeden de schema-vrije filtering van
Increment G. G's `[BRONSOORT]`-weging heeft naast de E-velden ook de bronsoort
nodig op chunkniveau: `bibliotheek`, plus de C+/B13-velden `bronorganisatie`,
`normgewicht`, `extern_url` en de afgeleide `geldig_tot` voor generiek. Die velden
bestonden nog niet: `document_chunks` had geen `bibliotheek`-denorm (E nam dit niet
mee) en `documenten.bronorganisatie/extern_url/normgewicht` bestonden nog niet
(C+/B13). De vraag was in welk increment die denorm landt.

Randvoorwaarden: `fn_chunk_denorm` is per besluit 0010 de **enige bron van waarheid**
voor de chunk-denorm (BEFORE INSERT op `document_chunks` + AFTER UPDATE op
`documenten`); elke aanraking is een migratie-eerst-dan-deploy-cyclus met een
set-based backfill. Twee keer aanraken = twee backfills en twee rollback-oppervlakken.

## Besluit

De volledige bronsoort-denorm (4 nieuwe chunk-kolommen + uitbreiding van
`fn_chunk_denorm` en beide triggers + set-based backfill) landt in **Increment 1
(C+/B13)**, niet in G. G wordt een schema-vrije consument die de denorm alleen leest.
Dit volgt het sequencing-besluit in het Increment G-bouwticket §1a (Route 1).

## Overwogen alternatieven

- **Denorm in G laten (oorspronkelijke E/G-knip, besluit 0009)** — verworpen: dan
  raakt `fn_chunk_denorm` twee keer aan (C+/B13 voegt de documenten-kolommen toe, G
  de chunk-denorm), met twee backfills en een schema-afhankelijkheidsgat tussen de
  twee increments. Groter totaal code-oppervlak en troebeler rollback.
- **Alles naar G schuiven (ook de 3 documenten-kolommen + RLS-split)** — verworpen:
  C+/B13 is functioneel zelfstandig (tenant-isolatie + bronsoort-UI) en moet los
  kunnen leven; G's antwoordmodusfamilie/weging staat daar los van.

## Gevolgen

- **Datamodel/migraties:** migratie `2026_06_20e_bronsoort_generiek_isolatie_denorm.sql`
  voegt 4 nullable denorm-kolommen toe aan `document_chunks` (`bibliotheek`,
  `bronorganisatie`, `normgewicht`, `extern_url`), breidt `fn_chunk_denorm` +
  `fn_chunk_denorm_before_insert` + `fn_chunk_denorm_refresh` ermee uit, neemt de 4
  velden op in de AFTER UPDATE-triggerkolommen, en backfillt set-based (geen
  re-embed). `geldig_tot` stroomt al via E (`d.geldig_tot`) en wordt **niet** opnieuw
  aangeraakt — generiek erft het automatisch. Index `idx_chunks_bronsoort` op
  `bibliotheek` voor G's weging.
- **RLS/tenant-isolatie:** ongewijzigd t.o.v. de E-erfenis — `document_chunks` heeft
  geen eigen `fonds_id`; de chunk-policies isoleren via de join op `documenten`. De
  nieuwe denorm-kolommen erven die isolatie. (De RLS-split zelf zit in hetzelfde
  C+/B13-increment, los van deze denorm-keuze.)
- **Audit/reproduceerbaarheid:** geen nieuwe entiteit; de denorm is een afgeleide
  spiegel, geen bron. Curatiewijzigingen aan de bronsoort-velden werken via de
  AFTER UPDATE-trigger door naar de chunks zonder re-embed.
- **G wordt schema-vrij:** G voegt geen chunk-denorm of documenten-kolommen meer toe
  (enige G-migratie: `gesprekken.actieve_antwoordmodus` + RPC-signatuuruitbreiding).
- **Bewust geaccepteerde schuld:** zoals in 0010 kan één documentwijziging meerdere
  chunkrijen in één transactie raken; begrensd en aanvaard. De bronsoort-velden
  vergroten die transactie marginaal (4 extra kolommen per rij).

## Referenties

- `supabase/migrations/2026_06_20e_bronsoort_generiek_isolatie_denorm.sql` (+ `_ROLLBACK`).
- `supabase/migrations/2026_06_20e_storage_generiek_readonly.sql` (storage-spiegel).
- `supabase/migrations/2026_06_19e_indexering_classificatie.sql` (E-denorm + triggers).
- `04 Technische inrichting/Bestuurdersportaal - Increment G werkopdracht en bouwticket v1.0.md` §1a (Route 1).
- `04 Technische inrichting/Bestuurdersportaal - Increment Cplus-B13 gecombineerd … bouwticket v1.0.md`.
- `mvp/decisions/0006` (B12/B13/B14), `0009` (E/G-denormknip), `0010` (fn_chunk_denorm = enige bron van waarheid).
