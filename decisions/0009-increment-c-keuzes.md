# 0009 — Increment C: routenaamgeving, capability-set, herindexering-scope en transitievalidatie

- **Status:** Geaccepteerd (2026-06-18) — bekrachtigd bij de bouw van Increment C
- **Datum:** 2026-06-18
- **Betrokkenen:** Merlin IJzerman
- **Scope:** Increment C (documentstatus/bronstatus + metadata-beheer + review-queue)

## Context

De werkopdracht voor Increment C laat vier uitvoeringskeuzes expliciet open ("beslis in Plan-modus"), die elk een spanning bevatten tussen ontwerp (FO/TO v1.2) en de as-built code. Randvoorwaarden: "bij twijfel wint de code + migraties" (`CLAUDE.md`), RLS per `fonds_id`, append-only audit, server-side capability-gating, en geen schijnzekerheid (niets claimen wat niet werkt).

## Besluit

1. **Routenaamgeving = Engels**, conform de bestaande `/api/documents/...`-conventie: `PATCH /api/documents/[id]/metadata`, `POST /api/documents/bulk-metadata`, `GET/POST /api/metadata-review/queue`, `GET/POST/DELETE /api/documents/[id]/procesinstanties`. Het ontwerp noemt `/api/documenten/...`; dat wijkt af van de live code, dus de code wint. Geen halve mix.
2. **Capability-set simpel** zoals de werkopdracht voorschrijft: `documents.metadata.update`, `documents.status.change`, `documents.bronstatus.change`, `metadata.review` — toegekend aan `beheerder` + `voorzitter`. De TO §5 fijnmazige split (`…update.own_before_final`/`…update.all`) is uitgesteld. "Secretariaat" is een functionele rol, geen autorisatierol; de privileged autorisatierollen dragen de capabilities.
3. **Herindexering = log-only in C.** De gedenormaliseerde chunkvelden (`bronstatus`/`documentstatus`/geldigheid op `document_chunks`) en de filtering-vóór-retrieval staan in Increment E/G (TO §2.6/§6.1) en bestaan nog niet. In C wordt RAG-impact berekend, vooraf getoond en in `document_metadata_log` gelogd; er is géén re-embed en géén chunk-denormalisatie. Doorwerking-in-RAG-zonder-herupload is een G-test, geen C-claim.
4. **Transitievalidatie server-side leidend + DB-trigger als defense-in-depth.** De spec leeft in `lib/document-status-transities.ts` (de route valideert ertegen) en wordt gespiegeld door de IMMUTABLE `fn_document_status_transitie` + een status-overgang-trigger op `documenten`. Admin-herstel (bv. `vervangen → van_kracht`) loopt via een session-GUC-bypass (`app.status_transitie_bypass`), niet via de normale flow.

## Overwogen alternatieven

- **Nederlandse routes (`/api/documenten/...`) volgen** — verworpen: zou een halve mix met de bestaande Engelse routes opleveren; de werkopdracht verbiedt dat expliciet.
- **Chunk-denormalisatie naar C trekken zodat edits direct doorwerken** — verworpen: vergroot de blast-radius en overlapt Increment E; bovendien is filtering pas in G zinvol. Kleiner en eerlijker om het in E/G te houden.
- **Alleen server-side validatie, geen DB-trigger** — verworpen: governance-gating mag niet uitsluitend in de applicatielaag zitten (`CLAUDE.md`); de trigger borgt "geen sprongen" ook bij directe DB-toegang.
- **Fijnmazige capability-split nu** — verworpen voor C: onnodige complexiteit; de simpele set dekt de C-acceptatiecriteria en kan later groeien zonder RLS-herontwerp (B11).

## Gevolgen

- **Datamodel/migraties:** `2026_06_18_documentstatus_metadata.sql` (+ ROLLBACK) voegt kolommen, `document_procesinstanties`, `document_metadata_log` (append-only + hash) en `document_metadata_review_queue` toe; backfill laat `bronstatus` NULL (≡ actief tijdens overgang) met een expliciet exit-criterium (queue leeg → strikte filtering in G).
- **RLS/tenant-isolatie:** alle nieuwe tabellen RLS per `fonds_id` (anon-key); `document_procesinstanties`-fondsconsistentie via trigger omdat `documenten.fonds_id` nullable is (`decisions/0007`).
- **Audit/reproduceerbaarheid:** elke metadatawijziging → één append-only record per veld met sha256-hash; reden verplicht bij governance-kritieke velden en bij de redenplichtige status-/bronstatusovergangen.
- **Bewust geaccepteerde schuld:** (a) TO §4 noemt Nederlandse routes — wijkt af van de as-built (Engels); bij te werken bij de volgende ontwerp-update. (b) De `/beheer`-pagina is gegate op rol `beheerder`, terwijl `voorzitter` server-side wél `metadata.review` heeft maar de hub-UI nog niet bereikt — losse UI-gate-verruiming als opvolging.

## Fast-follow na pre-merge subagent-reviews (19 juni 2026)

De vier subagents (`supabase-rls-reviewer`, `audit-evidence-reviewer`, `code-reviewer`, `ontwerp-sync-reviewer`) zijn ná de C-deploy gedraaid. Bevindingen en afhandeling:

- **Gedicht in fix-deploy 19 juni** (zie HANDOVER): review-beoordeling wordt nu append-only gelogd (`markeer_gecontroleerd` + queue-POST); `markeer_gecontroleerd` is capability-gated op `metadata.review`; geen rauwe DB-foutdetails meer naar de client; contextregel 3b (agendapunt hoort bij vergadering) DB-afgedwongen via trigger `fn_document_agendapunt_vergadering_check` (migratie `2026_06_19_…`); queue re-decision-guard; koppeling-DELETE logt alleen bij echte verwijdering; koppeling-logs dragen titel-snapshot + actornaam.
- **Bewust geaccepteerde schuld / resterende fast-follow** (niet blokkerend, later op te pakken): (1) **atomiciteit** tussen documentmutatie en logregel — nu twee losse statements; robuuste oplossing = DB-trigger-gebaseerde audit op `documenten` (vergt herontwerp van per-veld reden/rag_impact). (2) **Hash** in `document_metadata_log` dekt actor + fonds nog niet (geërfd van `governance_events`). (3) Geen CHECK op `wijzig_type`/`veld_naam`. (4) Bronstatus-transities alleen server-side geborgd (geen DB-trigger zoals bij documentstatus). (5) `vereistVervangenDoor` alleen in de planner, niet als DB-guard. (6) `/beheer`-review-tab toont voor alle rollen (POST blijft 403-gated); `<a>` i.p.v. `next/link`. Deze punten staan in de HANDOVER-release-entry van 19 juni als opvolglijst.

## Referenties

- `mvp/lib/document-status-transities.ts` (+ `.sanity.ts`), `mvp/lib/document-metadata.ts`, `mvp/lib/document-metadata-service.ts`, `mvp/lib/capabilities.ts`.
- `mvp/supabase/migrations/2026_06_18_documentstatus_metadata.sql` (+ `_ROLLBACK.sql`).
- `04 Technische inrichting/Bestuurdersportaal - Doorontwikkeling v2 technisch ontwerp v1.2.md` §2.4, §3, §3.1, §4, §6, §7.
- `03 Functioneel ontwerp/Bestuurdersportaal - Doorontwikkeling v2 functioneel ontwerp v1.2.md` §6, §7.
- `mvp/decisions/0006` (B11 capability-model), `mvp/decisions/0007` (fondsconsistentie), `mvp/decisions/0008` (documentkoppeling B/C).
