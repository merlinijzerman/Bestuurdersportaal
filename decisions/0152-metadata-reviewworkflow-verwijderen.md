# 0152 — Metadata-reviewworkflow verwijderen (wijzigings-audit blijft)

- **Status:** Geaccepteerd
- **Datum:** 2026-08-09
- **Betrokkenen:** Merlin IJzerman, Claude Code

## Context

De documentmetadata is over meerdere increments complex geworden (zie impactanalyse `IMPACTANALYSE-metadata-simplificatie-v0.1.md`). Eén onderdeel is een **voorwaartse review-workflow**: documenten met ontbrekende/onzekere metadata krijgen een vlag, belanden in een review-queue en worden door een geprivilegieerde rol op `gecontroleerd`/`afgewezen` gezet (ingesteld bij 0010; review-afronding privileged bij 0015; de ingest-vlag "zonder type" bij 0140).

Op bestuursniveau is de aanname gerechtvaardigd dat metadata van documenten niet lichtvaardig wordt gewijzigd. Daarmee levert een pre-emptieve verificatie-queue in de MVP meer last dan waarde. Belangrijk onderscheid: deze workflow is iets **anders** dan de metadata-**wijzigings-audit** (`document_metadata_log`), die achteraf vastlegt wie welk veld waarom wijzigde — dát is juist het bewijs dat de aanname ("niet zomaar aangepast") onderbouwt.

## Besluit

De metadata-**reviewworkflow wordt verwijderd**. Concreet vervallen: de velden `metadata_te_controleren`, `metadata_review_status`, `metadata_gecontroleerd_door`, `metadata_gecontroleerd_op`; de review-queue-route (`app/api/metadata-review/queue`); de review-hub in het beheerscherm; de `ReviewQueue`-types; en de review-vlag die bij ingest wordt gezet voor een document "zonder type" (0140).

Expliciet **blijven ongemoeid**:
- De metadata-**wijzigings-audit** `document_metadata_log` (append-only), inclusief redenplicht en capability-gating op RAG-impact- en governance-kritieke veldwijzigingen — de aantoonbaarheid van "niet zomaar aangepast".
- De statustransitie- en bronstatus-governance (`document-status-transities.ts`).
- De **generieke** content-reviewdatum `volgende_review` (T6) en de RAG-filter `isReviewVerlopen` — dit is een ánder mechanisme (veroudering van platform-gecureerde bronnen) en valt buiten dit besluit.

Dit besluit herziet 0010 en 0015 voor zover die de review-hub en de privileged review-afronding instelden.

## Overwogen alternatieven

- **Workflow behouden** — de veilige status quo, maar de queue voegt op bestuursniveau weinig toe en houdt vier velden, een route, een scherm en een capability in de lucht. Verworpen als onnodige complexiteit.
- **Ook de wijzigings-audit (`document_metadata_log`) schrappen** — zou de metadata-governance verder versimpelen, maar verzwakt de auditbaarheid die de kernaanname onderbouwt (relevant richting AI-governance/DNB). Verworpen; de audit is geen workflow-last maar bewijs.
- **Alleen de UI verbergen, velden laten staan** — halveert de winst: de velden blijven ruis in het model en in elke select. Verworpen, tenzij bij implementatie een onverwachte lezer van de velden opduikt (dan gefaseerd: eerst surface weg, kolommen later).

## Gevolgen

- **Impactklasse: data.** Migratie die de vier reviewvelden dropt (of, indien een resterende lezer opduikt, eerst het schrijven staakt en de kolommen in een vervolgmigratie verwijdert). Documentatiehaak vuurt (00–09 + as-built + `doc-actualisatie-log.md`); de structurele gates moeten schoon draaien.
- **Verwijdersurface (verifiëren tegen de code):** `core/lib/document-metadata.ts` (`MetadataReviewStatus`, `ReviewQueue*`, labels), `app/api/metadata-review/queue/route.ts`, de review-hub in `app/(dashboard)/beheer/_components/BeheerClient.tsx`, verwijzingen in `bibliotheek/page.tsx`, `document-bijzonderheden.ts`, `documentlijst.ts`, de metadata-PATCH-route, en de ingest-vlag in het 0140-pad. **NB:** de `rag.ts`-verwijzing die bij het zoeken opdook is `volgende_review` (generiek), níét een reviewworkflow-veld — niet aankomen.
- **Sanity-tests:** verwijder/actualiseer de reviewworkflow-assertions; bevestig dat `document_metadata_log`-tests groen blijven.
- **Restrisico (R1, aanvaard):** het vangnet dat ongeclassificeerde documenten signaleert vervalt. Grotendeels ondervangen doordat `documenttype` in de processtroom verplicht wordt (werkopdracht rapportage/Optie B); de bewuste vergaderstroom-uitzondering (0140) betekent dat een deel van de vergaderstukken ongeclassificeerd kan blijven zonder signaal. Op bestuursniveau aanvaard. Eigenaar: AI Governance Owner.
- **Subagents:** `audit-evidence-reviewer` bevestigt dat het append-only bewijsspoor intact blijft na verwijdering; `code-reviewer` als eindstap.

## Referenties

- `IMPACTANALYSE-metadata-simplificatie.md`. Besluiten 0010 (review-hub), 0015 (privileged review-afronding), 0140 (classificatie bij aanlevering / ingest-vlag). Betrokken: `core/lib/document-metadata.ts`, `app/api/metadata-review/queue/route.ts`, `app/(dashboard)/beheer/_components/BeheerClient.tsx`, migratie `2026_06_18_documentstatus_metadata.sql`.
