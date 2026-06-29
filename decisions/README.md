# Besluitlog (Decision Records)

Per architectuur-, governance- of productbesluit één kort markdown-bestand met het **waarom** erachter. Dit log vult `HANDOVER.md` aan: de HANDOVER beschrijft *wat* er is en *wat er wanneer veranderde* (release-historie); dit log beschrijft *waarom* een keuze is gemaakt, welke alternatieven zijn overwogen en wat de gevolgen zijn.

## Wanneer een besluit vastleggen

Schrijf een entry bij een besluit dat:

- de architectuur, het datamodel of een RLS-/auditprincipe raakt;
- moeilijk of kostbaar is om later terug te draaien;
- een bewuste afweging tussen alternatieven inhoudt;
- of bewust iets uitstelt of uitsluit ("we doen X bewust níet" is ook een besluit).

Triviale of puur uitvoerende wijzigingen horen in de release-historie van `HANDOVER.md`, niet hier.

## Conventie

- Eén bestand per besluit: `NNNN-korte-titel.md` (oplopend nummer, bv. `0003-...`).
- Kopieer `TEMPLATE.md` als startpunt.
- **Append-only**, net als de governance-events in het product zelf: een geaccepteerd besluit wordt niet herschreven. Een nieuw inzicht is een nieuw besluit dat het oude op `Vervangen door 0NNN` zet.
- Houd het kort: context, besluit, alternatieven, gevolgen.
- Zet in de `CLAUDE.md`-Definition-of-Done al: "bij een besluit een decision-log-entry".

## Index

| Nr | Titel | Status | Datum |
|----|-------|--------|-------|
| [0001](./0001-append-only-audit-geen-harddelete.md) | Append-only audit; Decision Objects niet hard-verwijderbaar | Geaccepteerd | 2026-05-19 |
| [0002](./0002-generieke-proceduremodule-definitie-als-data.md) | Generieke proceduremodule: definitie als data, bouwblok-engine uitgesteld | Geaccepteerd (richting) | 2026-05-22 |
| [0003](./0003-subagent-werkwijze.md) | Laag-A-subagents als ontwikkel-werkwijze (review + ontwerpborging) | Geaccepteerd | 2026-05-22 |
| [0004](./0004-werkverdeling-plannen-vs-uitvoeren.md) | Werkverdeling: plannen in Cowork, uitvoeren in Claude Code | Geaccepteerd | 2026-05-22 |
| [0005](./0005-rate-limiting-en-monitoring-in-stack-mvp.md) | Rate limiting (Postgres) en monitoring (Supabase/Vercel) in-stack voor MVP; geen Upstash/Sentry | Geaccepteerd | 2026-06-07 |
| [0006](./0006-doorontwikkeling-v2-beslispunten-B1-B10.md) | Doorontwikkeling v2: beslispunten B1–B14 (B12 bronsoort, B13 tenant-isolatie generiek, B14 platform-identiteit), O1 multi-fonds, O2 dossierstatus-mapping | Geaccepteerd | 2026-06-19 |
| [0007](./0007-fondsconsistentie-composite-fk-vs-trigger.md) | Fondsconsistentie op koppeltabellen: composite-FK standaard, trigger waar nodig | Geaccepteerd | 2026-06-18 |
| [0008](./0008-documentkoppeling-vooruitgetrokken-naar-increment-b.md) | Documentkoppeling vooruitgetrokken naar Increment B: primaire kolom + trigger nu, join-tabel later | Geaccepteerd | 2026-06-18 |
| [0009](./0009-increment-c-keuzes.md) | Increment C: Engelse routes, simpele capability-set, herindexering log-only, transitievalidatie | Geaccepteerd | 2026-06-18 |
| [0010](./0010-increment-e-keuzes.md) | Increment E: B/C-verificatie eerst, refresh via DB-trigger, gedeelde queue-hub + aparte classificatie-acties, conservatieve confidence-drempels | Geaccepteerd | 2026-06-19 |
| [0011](./0011-increment-d-keuzes.md) | Increment D: NL-routes, segmentchunks vervangen whole-document-chunks (transactioneel/RPC), audit in document_metadata_log, regelgebaseerde segmentatie, COALESCE-fix op de E-trigger | Geaccepteerd | 2026-06-20 |
| [0012](./0012-bronsoort-denorm-vooruitgetrokken-naar-cplus-b13.md) | Bronsoort-denorm (bibliotheek + C+/B13-velden) vooruitgetrokken naar Increment C+/B13 i.p.v. G, zodat fn_chunk_denorm maar één keer wordt aangeraakt | Geaccepteerd | 2026-06-20 |
| [0013](./0013-increment-g-keuzes.md) | Increment G: RAG-filtering vóór retrieval + antwoordmodusfamilie | Geaccepteerd | 2026-06-20 |
| [0014](./0014-increment-i2-automatische-bronkeuze.md) | Increment I-2: automatische bronkeuze (Design A combineren-vloer + verduidelijking bij twijfel, asymmetrische compliance-drempels, geen zichtbare badge) | Geaccepteerd | 2026-06-22 |
| [0015](./0015-metadata-bewerking-opengesteld-bestuurders.md) | Metadata-bewerking (alle velden) opengesteld voor bestuurders; review-afronding blijft bij beheerder/voorzitter | Geaccepteerd | 2026-06-22 |
| [0016](./0016-i2-aanscherpingen-na-review.md) | Increment I-2 aanscherpingen na review: schijnzekerheid-melding altijd bij 0 fondstreffers + `bron_intent_override` in auditspoor | Geaccepteerd | 2026-06-22 |
| [0017](./0017-increment-f-keuzes.md) | Increment F (persoonlijk profiel): strikt zelfbeheer (geen `profile.manage.all`), B9 uit scope, profielsturing = prioritering niet filtering, "algemeen perspectief"-toggle | Geaccepteerd | 2026-06-22 |
| [0018](./0018-increment-h-zoekmodule-en-i3-bronvermelding.md) | Increment H (zoekmodule, hergebruik retrieval/geen migratie) + I-3 (uniform bronmodel, anti-fabricage in 3 lagen, markeer-handhaving, Scenario B + web-TODO) | Geaccepteerd | 2026-06-22 |
| [0019](./0019-scenario-a-live-web-retrieval.md) | Scenario A: live web-retrieval (Route 1 Anthropic web_search vs Route 2 eigen pijplijn vs Route 0 niet doen); whitelist + B10/DPIA + prompt-injection; aanbeveling Route 1-pilot | **Voorstel — ter besluitvorming** | 2026-06-22 |
| [0020](./0020-ocr-engine-mistral.md) | OCR-engine voor beeld-only PDF's: Mistral OCR (`mistral-ocr-latest`) via gedeelde `extractTekstMetOcrFallback`; geen embed-laag-wijziging; additieve audit-kolommen | Geaccepteerd | 2026-06-22 |
| [0021](./0021-platformfundament-P0-keuzes.md) | Increment P0 platformfundament (B14 Optie A): auth-context 3b (geen profielen-rij), hosting-variant B (route-group + hostname-middleware, `PLATFORM_HOST` fail-closed), globale hash-keten met advisory lock, `digest`-keuze, twee-fasen audit fail-closed | Geaccepteerd | 2026-06-23 |
| [0022](./0022-increment-P1-generieke-curatie-keuzes.md) | Increment P1 generieke curatie (platform back-office): keuzes rond uploadsecurity, quarantaine-promotie, verwerkingspipeline en statusmodel | Geaccepteerd | 2026-06-24 |
| [0023](./0023-ocr-in-generieke-curatie-pipeline.md) | Synchrone OCR-fallback (`extractTekstMetOcrFallback`) in de generieke curatie-pipeline; begrensde afwijking van 0020 (back-office/laagfrequent), gemitigeerd met `maxDuration=300` (Vercel Pro); hergebruik audit-kolommen | Geaccepteerd | 2026-06-24 |
| [0024](./0024-hard-delete-generiek-document-audit-overleeft.md) | Hard-delete generiek document: FK `document_metadata_log.document_id` droppen zodat het append-only auditlog de data overleeft (lost de append-only-vs-SET NULL-tegenstrijdigheid op); hard-delete blijft generiek-only | Geaccepteerd | 2026-06-24 |
| [0025](./0025-rag-structuur-contextueel-reindex.md) | RAG R1.1 + R1.2: structuurbewuste chunking + contextuele retrieval (Optie A `context_prefix`, begrensd structuur-venster) via één gedeelde, omkeerbare re-index over fonds + generieke bibliotheek; `reindex_runs`-provenance | Geaccepteerd | 2026-06-24 |
| [0026](./0026-p2-light-p4-light-en-vier-ogen-deferral.md) | P2-light + P4-light scope en bewuste vier-ogen-deferral | Geaccepteerd | 2026-06-26 |
| [0027](./0027-informatief-normgewicht-standaard-in-rag.md) | Normgewicht `informatief` standaard zichtbaar in RAG | Geaccepteerd | 2026-06-26 |
| [0028](./0028-agendapunt-toelichting-seed-context.md) | Agendapunt-toelichting als gelabelde seed-context (`[Toelichting agendapunt]`, herkomst `agendapunt:<id>`), aparte agendapunt-tak i.p.v. strict document-scope, server-fetch van de toelichting onder RLS | Geaccepteerd | 2026-06-28 |
| [0029](./0029-publieke-voorkant-host-indeling.md) | Publieke voorkant W0: drie host-surfaces (marketing apex/`www`, app `app.`, platform `beheer.`); pure `bepaalSurface`/`bepaalRoute`; fail-safe default `app`, platform fail-closed; cutover env-gedreven (A1) | Geaccepteerd | 2026-06-29 |
| [0030](./0030-loginhost-en-backward-compat.md) | Login op app-host; marketing `/login` = 307-redirect naar app-login (query behouden, → later 301), nooit homepage, geen lus, `noindex`; auto-skip-bij-ingelogd → W1 | Geaccepteerd | 2026-06-29 |
| [0031](./0031-contact-aanvragen-opslag-en-email.md) | `contact_aanvragen` (niet-tenant): RLS aan zonder anon-policy, service-role-insert, append-only (status i.p.v. delete), geen ruw IP; e-mail = Resend soft-fail, `reply-to` = aanvrager (W2) | Geaccepteerd | 2026-06-29 |
| [0032](./0032-publieke-voorkant-styling.md) | Publieke voorkant: scoped CSS met marketingtokens, app-styling (Tailwind) ongemoeid; Tailwind-port = fase 2 | Geaccepteerd | 2026-06-29 |
| [0033](./0033-w2-uitvoering-mailgun-en-ratelimit.md) | W2-uitvoering (supplement op 0031): Mailgun-sandbox als interim mailtransport (Resend blijft doel), rate-limit via ip_hash-telling op `contact_aanvragen` zonder migratie, eigen `lib/supabase-service.ts` | Geaccepteerd | 2026-06-29 |
