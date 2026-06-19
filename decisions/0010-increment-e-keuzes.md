# 0010 — Increment E: refresh-mechanisme, queue-routes, confidence-drempels en bouwvolgorde

- **Status:** Geaccepteerd (2026-06-19) — vastgesteld in Plan-modus vóór de bouw van Increment E
- **Datum:** 2026-06-19
- **Betrokkenen:** Merlin IJzerman
- **Scope:** Increment E (indexering + procesclassificatie)

## Context

Het bouwticket voor Increment E (`04 Technische inrichting/Bestuurdersportaal - Increment E werkopdracht en bouwticket v1.0.md`) laat vier uitvoeringskeuzes expliciet open. Elk raakt een randvoorwaarde: betrouwbaarheid van de denormalisatie die G's filtering voedt, RLS/tenant-isolatie, append-only audit, en de gebruiks-/beheerervaring (vertrouwen van de bestuurssecretaris in auto-koppeling). Leidend blijft "bij twijfel wint de code + migraties" (`CLAUDE.md`). Increment E ligt op het kritisch pad `0→A→B→C→E→G` en is de harde voorwaarde voor G.

## Besluit

1. **Bouwvolgorde — B/C-verificatie eerst.** De live-deployverificatie van B en C wordt afgerond vóórdat E code wijzigt. E denormaliseert uit de C-velden; bouwen op een ongeverifieerde C-laag riskeert dat fouten naar chunkniveau doorwerken en E's backfill overgedaan moet worden. *De fast-follow-migratie `2026_06_19_documenten_agendapunt_vergadering_trigger.sql` is bevestigd op live Supabase gedraaid (Merlin, 19-06-2026).* Resterend vóór E-start: de B/C-regressie-/integriteitsquery's tegen de live DB + de pre-merge subagent-reviews.
2. **Refresh-mechanisme = DB-trigger.** De gedenormaliseerde chunkvelden worden synchroon gehouden via een trigger op `documenten` (en de primaire koppeling), niet via een applicatie-job. Consistentie wordt in de database afgedwongen; correctheid mag niet afhangen van applicatiediscipline.
3. **Queue-routes = gedeelde hub-GET + aparte classificatie-actieroutes.** Het overzicht loopt via de bestaande "Te beoordelen"-hub (`GET /api/metadata-review/queue?stream=classificatie`, één scherm); de schrijfacties zijn classificatie-specifiek (`POST /api/classificatie/[id]/beoordeel`, `POST /api/classificatie/[id]/terugdraai`), omdat ze tegen `classificatie_voorstellen` werken met eigen statusovergangen.
4. **Confidence-drempels = conservatieve, centraal configureerbare default; validatie door bestuurssecretaris.** De drempels (`hoog`→auto-koppelen, `middel`→bevestigen, `laag`/`geen_match`→queue) staan als één configconstante; "hoog" alleen bij eenduidige match (bv. exacte titel-/periodematch tegen één kandidaat). Default wordt door de bouw geleverd, gevalideerd in de demo-toetsing met de bestuurssecretaris na E.

## Overwogen alternatieven

- **E parallel aan B/C-verificatie bouwen** — verworpen als standaard: stapelt ongeteste oppervlakte en kan E-backfill-herwerk veroorzaken. Bewust beschikbaar als de planning snelheid laat prevaleren, mits expliciet geaccepteerd.
- **Refresh via app-job** — verworpen: consistentie hangt dan aan élk schrijfpad; een toekomstig endpoint dat `documenten` muteert en de refresh vergeet, geeft stille drift in de G-filtering. Wel acceptabel als aanvullend vangnet (periodieke reconciliatie-query naast de trigger).
- **Alle queue-acties op de hub-route met een actie-discriminator** — verworpen: mengt twee datamodellen (`document_metadata_review_queue` vs. `classificatie_voorstellen`) en hun transitieregels in één endpoint; slechter te testen en te auditen.
- **Confidence-drempels per fonds beheerbaar maken** — uitgesteld (latere optimalisatie): voor v2 volstaat één centrale default; beheerbaarheid komt pas als fondsen aantoonbaar verschillende drempels nodig hebben.

## Gevolgen

- **Datamodel/migraties:** nieuwe migratie voegt nullable denorm-kolommen + index op `document_chunks` toe, plus `classificatie_voorstellen` en een refresh-trigger/-functie. Additief + idempotent; migratie-eerst-dan-deploy. NULL-denorm tijdens overgang breekt retrieval niet (E wijzigt retrievalgedrag niet; filtering = G).
- **RLS/tenant-isolatie:** `classificatie_voorstellen` RLS per `fonds_id` (anon-key); auto-koppeling schrijft de primaire `documenten.procesinstantie_id` onder de bestaande fondsconsistentie-trigger — classifier koppelt nooit cross-fonds.
- **Audit/reproduceerbaarheid:** auto-koppeling, bevestiging, afwijzing en terugdraai landen append-only in `document_metadata_log` (uit C), met confidence + bron; `classificatie_voorstellen` houdt de voorstel-historie.
- **Beheer-/gebruikservaring:** auto-koppeling is altijd terugdraaibaar (1-klik) en zichtbaar gemeld; expliciete metadata is leidend en expliciet gekoppelde documenten worden nooit omgehangen (FO §10). Conservatieve drempel beschermt het vertrouwen van de bestuurssecretaris.
- **AI-governance:** E voegt een nieuwe AI-verwerkingsstap toe (procesclassificatie op fondsdocumenten, geen nieuwe persoonsgegevens). Geen volledige B10-checkpoint (die hoort bij F/G), wél `ai-governance-reviewer` + een korte notitie in de AI-governance/DPIA-administratie (model, data, menselijke bevestiging).
- **Bewust geaccepteerde schuld:** de DB-trigger kan bij een metadatawijziging veel chunkrijen in één transactie raken; begrensd en gedekt door een consistentie-regressietest. Aanname te verifiëren bij de bouw: chunks per document bescheiden (tientallen).

## Uitvoering (Claude Code, 2026-06-19)

Increment E is gebouwd na akkoord. Drie bouwverfijningen op de vier kernkeuzes, vastgesteld in Plan-modus en bevestigd door Merlin:

1. **Denorm bij insert via een BEFORE INSERT-trigger op `document_chunks`** (niet een app-side additieve set in de upload-/her-extract-routes). Dezelfde gedeelde afleiding `fn_chunk_denorm(document_id)` voedt zowel die insert-trigger als de AFTER UPDATE-trigger op `documenten` — één bron van waarheid, geen tweede afleiding die kan driften, en de gevoelige RAG-uploadpipeline blijft ongemoeid. Dit is een extensie van besluit 2 (DB-trigger) in dezelfde geest ("consistentie in de DB, niet in applicatiediscipline"); het wijkt bewust af van de letter van ticket §3 ("kleine additieve set bij insert").
2. **De classificatie-engine is regelgebaseerd, géén LLM-call.** Conform §4a ("geen ondoorzichtige getalsscore") en het precedent `lib/vraagtype.ts`: auditbaar, deterministisch testbaar (12 sanity-tests), geen documenttekst naar een model (kleiner DPIA-oppervlak), en `CLASSIFICATIE_DREMPELS` blijft tunebaar. De `ai-governance-reviewer` + DPIA-notitie gelden nog steeds (geautomatiseerde classificatie die een governance-koppeling schrijft). Een eventuele LLM-ondersteunde inhoudsmatch (S4) is een latere optimalisatie achter dezelfde confidence-mapping.
3. **"Open procesinstantie" voor S2/auto-koppeling = `{gepland, lopend, ter_besluitvorming, heropend}`** (named constant in `CLASSIFICATIE_DREMPELS`). `besloten`/`in_implementatie`/`afgerond`/`gearchiveerd` tellen bewust niet als open → een periodematch daarop kapt af op "middel" (mens bevestigt), passend bij de conservatieve, asymmetrisch-risico-default. De bestuurssecretaris kan de set in de demo-toetsing verbreden zonder logica-redeploy.

Aanvullende, kleinere bouwkeuze: `geen_match`-documenten krijgen in de backfill een marker-rij (`status='afgewezen'`, `beoordeeld_door` NULL) zodat de batch-backfill termineert (patroon embeddings-backfill "overgeslagen"); de review-queue toont alleen `status='open'`, dus die markers vervuilen de actielijst niet.

## Referenties

- `04 Technische inrichting/Bestuurdersportaal - Increment E werkopdracht en bouwticket v1.0.md`.
- `03 Functioneel ontwerp/Bestuurdersportaal - Doorontwikkeling v2 functioneel ontwerp v1.2.md` §10.
- `04 Technische inrichting/Bestuurdersportaal - Doorontwikkeling v2 technisch ontwerp v1.2.md` §2.6, §5, §6.
- `06 Roadmap/Bestuurdersportaal - Doorontwikkeling v2 roadmap v1.2.md` (ticket E).
- `mvp/decisions/0006` (B5 classificatie half-automatisch), `0008` (documentkoppeling B/C), `0009` (Increment C: herindexering = log-only in C, denormalisatie naar E/G).
- `mvp/app/api/metadata-review/queue/route.ts` (hub met `stream`-parameter, voorbereid op `classificatie`).
