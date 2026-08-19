# 0169 — T7 semantische laag: datamodelkeuzes (denorm-lock, service-role-writes, private-aware oordelen, append-only)

- **Status:** Geaccepteerd
- **Datum:** 2026-08-12
- **Betrokkenen:** Merlin (product/architectuur), Claude Code (uitvoering)

## Context

T7 (epic Documentvergelijking, Fase 1, volgt op S1) legt het datamodel voor de
semantische laag: getypeerde, aan een canoniek concept gebonden "semantic units",
reproduceerbare extractie-/vergelijkingsruns en een plek voor menselijke oordelen.
S1 bewees de haalbaarheid op een gecureerde catalogus; T7 legt het schema, als
voorwaarde voor T8 (extractie-pijplijn), T5 (vergelijking + `comparison_results`)
en T9. Randvoorwaarden die meewegen: tenant-isolatie via RLS per `fonds_id`,
reproduceerbaarheid/audit, de privacylijn rond persoonlijke uitingen
([`0112`] — geen reflectiemarkering), en de bestaande service-role-isolatie
(Variant-C, [`0066`]). Het schema moet puur additief en terugdraaibaar zijn:
geen gedragswijziging in de bestaande app zolang T8 niet schrijft.

Binnen die kaders lagen vier ontwerpkeuzes open die niet eenduidig uit de
werkopdracht volgden.

## Besluit

1. **Denorm-lock via composite-FK, niet via trigger.** Het gedenormaliseerde
   `semantic_units.type` wordt aan `concept.type` vastgeklonken met een
   composite-FK `(concept_id, type) → concepts(id, type)` (met `uq_concepts_id_type`
   als doel). Waardetypering (juiste `value_*`-kolom per type) en niet-lege
   `evidence` via `CHECK`-constraints.
2. **Service-role-only schrijfpad** op de pijplijn-tabellen `semantic_units`,
   `extraction_run`, `comparison_run`: `authenticated` krijgt uitsluitend SELECT
   onder RLS; INSERT/UPDATE/DELETE loopt server-side via de service-role.
3. **Auteur-scoped + private-aware** `difference_judgements` in plaats van
   letterlijk "eigen fonds": lezen als `user_id = auth.uid()` **OF**
   (`private = false` **EN** eigen fonds); schrijven alleen het eigen oordeel,
   binnen het eigen fonds.
4. **Append-only** op `extraction_run`, `comparison_run` en
   `difference_judgements`: geen UPDATE/DELETE-grant **plus** de gedeelde
   `public.fn_log_append_only()` before-trigger. `semantic_units` is bewust NIET
   append-only (her-extractie mag units vervangen). `concepts` is platform-globaal,
   read-only voor tenants, geschreven door de catalogus-eigenaar (service-role).

## Overwogen alternatieven

- **Waardetypering via trigger** — afgewezen: een composite-FK + `CHECK` borgt de
  invariant declaratief in de database, zonder de search-path-/definer-zorg die een
  trigger meebrengt, en kan niet stilletjes worden overgeslagen. Sluit aan op het
  fondsconsistentie-patroon (composite-FK standaard, [`0007`]).
- **Authenticated schrijfpad onder RLS** op de pijplijn-tabellen — afgewezen: een
  client zou dan extractie-provenance kunnen vervalsen (welk model/prompt/versie,
  welke evidence). De extractie is een server-side pijplijn (T8); service-role-writes
  zijn least-privilege en spiegelen de bestaande ingest-worker (Variant-C, [`0066`]).
- **Fonds-breed leesbare oordelen** (letterlijke opdracht-RLS) — afgewezen: dat zou
  individueel twijfel-/oneens-gedrag fondsbreed zichtbaar maken en botst met de
  privacylijn ([`0112`]). De `private`-vlag wordt de leesgrens; fondsbrede inzage
  ontstaat pas na bewuste promotie (T10).
- **Muteerbare runs/oordelen** (UPDATE op status/`promoted_to_dossier`) — afgewezen
  t.b.v. onveranderlijke reproduceerbaarheid; zie de geaccepteerde schuld hieronder.
- **`document_versions`-tabel** — bewust niet: versionering loopt al via `documenten`
  (nieuwe upload = nieuw document) + de self-FK's `vervangt_document_id` /
  `vervangen_door_document_id`. Een unit verwijst naar een concreet (versie-)document.
- **Many-to-many kandidaat-concepten met confidence** (`semantic_unit_concepts`) —
  uitgesteld naar Fase 3; T7 gebruikt een directe, promoteerbare `concept_id`-binding.

## Gevolgen

- **RLS/tenant-isolatie:** vier tabellen dragen eigen `fonds_id` (gate B-predikaat);
  `concepts` is platform-globaal en is toegevoegd aan de global-lijst (gate A1) én de
  select-allowlist (gate C) van `supabase/checks/2026_07_31_r1_structurele_gates.sql`.
  De gedragstoets bewijst leesisolatie en het ontbreken van een authenticated-schrijfpad.
- **Audit/reproduceerbaarheid:** elke unit hangt via `extraction_run_id` aan een run
  die model/prompt/versie/`catalog_version` vastlegt; runs en oordelen zijn immutable.
- **Datamodel/migraties:** puur additief; rollback-migratie dropt alle nieuwe objecten.
  Geen app-gedrag verandert tot T8 schrijft.
- **Geaccepteerde schuld / consequentie voor T8/T10:** door append-only kan een
  `extraction_run` niet van `gestart → geslaagd` worden bijgewerkt — T8 schrijft de
  run-rij **één keer bij afronding** (status/`finished_at` meteen definitief). Promotie
  van een oordeel (`promoted_to_dossier`) wordt in T10 een **nieuwe rij**, geen UPDATE.
- **Openstaand (governance):** de **catalogus-eigenaar van `concepts`** moet vóór
  productie benoemd zijn; zonder eigenaar geen beheerde catalogus. Vastgelegd als
  COMMENT op de tabel + als risico.

## Referenties

- Migratie: [`supabase/migrations/2026_08_12_t7_semantische_laag.sql`](../supabase/migrations/2026_08_12_t7_semantische_laag.sql) + [`_ROLLBACK`](../supabase/rollbacks/2026_08_12_t7_semantische_laag_ROLLBACK.sql)
- Gedragstoets: [`supabase/checks/2026_08_12_t7_semantische_laag.sql`](../supabase/checks/2026_08_12_t7_semantische_laag.sql)
- Structurele gates (aangepast): [`supabase/checks/2026_07_31_r1_structurele_gates.sql`](../supabase/checks/2026_07_31_r1_structurele_gates.sql)
- Eerdere besluiten: [`0007`](./0007-fondsconsistentie-composite-fk-vs-trigger.md) (composite-FK), [`0066`](./0066-variant-c-cutover-optie-1.md) (service-role-isolatie), [`0112`](./0112-geen-reflectiemarkering-in-enige-registratie.md) (privacylijn), [`0040`](./0040-bridge-ready-pool-standaard-dedicated-isolatie-premium.md) (RLS-hardening/tenant-model)
