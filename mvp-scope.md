# MVP-scope — Bestuurdersportaal

**Laatst bijgewerkt:** 2026-07-04
**Statuslabels:** Geïmplementeerd / Deels / Ontworpen / Openstaande keuze / Aanname / Onbekend / Te valideren.
**Bronnen:** code + `supabase/migrations/`, `HANDOVER.md`, `decisions/`, feitenrapporten 4 juli 2026. Roadmapvertaling: `../06 Roadmap/mvp-scope.md`.

## 1. Binnen scope

| Onderdeel | Status | Toelichting |
|---|---|---|
| AI-assistent (chat, RAG, bronvermelding, antwoordmodi, document-scope, agendapunt-modus, transformatie) | Geïmplementeerd | Hybride retrieval (FTS + pgvector/RRF), automatische bronkeuze (decision 0014), profielsturing, retrieval-logging |
| Documentbibliotheek + indexering (PDF/DOCX/XLSX/PPTX, OCR-fallback) | Geïmplementeerd | Magic-bytes/OOXML-validatie, 25 MB-plafond; OCR alleen op her-extract-/curatiepad (decisions 0020/0023) |
| Documentstatus, bronstatus, metadata-beheer + review-queue | Geïmplementeerd | Increment C/C+; append-only `document_metadata_log` |
| Zoekmodule | Geïmplementeerd | Zelfde retrieval-RPC's als de assistent |
| Vergaderingen (kalender, agendapunten, inbreng, AI-voorbereiding) | Geïmplementeerd | V2 tranche 1+2 |
| Stemmingen (incl. volmacht) | Geïmplementeerd | Rapporteert; stelt geen rechtsgeldigheid vast |
| Notulen (segmentatie) | Geïmplementeerd (half-automatisch) | Regelgebaseerd; indexering pas na menselijke bevestiging (decision 0011) |
| Procedures / Decision Object | Geïmplementeerd | 17-statusmachine, readiness-gate, sha256-gehashte `governance_events`, auditdossier-export |
| Risicomatrix (iteratie 1) | Geïmplementeerd | CRUD + maatregelen + log; bewerken K/I/niveau = iteratie 2 (open) |
| Beheer: gebruikers, procescatalogus + organen | Geïmplementeerd | Catalogus in DB (Increment A); import van globale templates |
| Profiel (strikt zelfbeheerd) | Geïmplementeerd | Decision 0017; RLS-hardening 03-07 (K1-fix) — draaien op live **Te valideren** |
| Notificaties (in-app, 12 typen) | Geïmplementeerd | Geen e-mail |
| Governance-log-viewer | Geïmplementeerd | `/governance` |
| Platform-back-office (identiteiten, 12 capabilities, AAL2/MFA, hash-geketende audit, generieke curatie, contact-inbox) | Geïmplementeerd | P0/P1 + P2-light/P4-light (decision 0026) |
| Publieke marketing-site + contactformulier | Geïmplementeerd | Drie-hosts-model; Mailgun-sandbox, mail soft-fail (decision 0033) |
| Security: headers/CSP (WP1), rate limiting (WP2), error sanitization (WP6) | Geïmplementeerd | CSP met bewuste `unsafe-inline`/`unsafe-eval`-concessie |
| Klantbeeld / Wtp-stuurinformatie | **Deels (demo)** | UI werkend; data 100% dummy (`lib/klantbeeld-data.ts`) |

## 2. Buiten scope (bewust)

| Onderdeel | Status | Reden / bron |
|---|---|---|
| Malwarescan op uploads (WP3) | Openstaand — bewust uitgesteld | Expliciete `overgeslagen`-jobstap `scan_uitgesteld_wp3`; quarantainebucket bestaat (decision 0022) |
| Prompt-injection-mitigatie (WP4) | Openstaand | Route A-restwerk |
| CSRF/Origin-check (WP5) | Openstaand | Route A-restwerk |
| Route A eindverificatie (WP8) | Openstaand | Route A-restwerk |
| CI / testframework / ESLint | Openstaand (bewuste MVP-keuze) | Reviewbevinding H6; verificatie nu via tsc + sanity-scripts + smoke-tests |
| Sentry / error-monitoring (WP7) | Uitgesteld | Sub-verwerker-afweging (decision 0005); hook voorbereid |
| Live web-retrieval voor de AI | **Openstaande keuze** | Besluit 0019 (voorstel); `AssistantSource.web` voorbereid maar leeg |
| E-mailnotificaties bestuurders; volwassen mailtransport | Buiten MVP | Mailgun-sandbox alleen contactformulier; Resend/eigen domein = doelopzet (0033) |
| Echte datakoppeling uitvoerder (Klantbeeld) | Buiten MVP | Vereist productiebesluit + verwerkersafspraken |
| Vier-ogen-principe, zware platformhandelingen via UI, tenantbeheer-UI | Bewust uitgesteld met gate | Her-introductie verplicht vóór productie/fonds 2 (decision 0026) |
| Generieke procedure-registry (definitie-als-data volledig) + in-app template-editor | Ontworpen | Decision 0002; templates hardcoded in `lib/proces-templates.ts` |
| Eigenaars-FK naar `auth.users` | Buiten MVP | Vrije-tekstvelden; blokkeert gerichte notificaties |
| Versioning vergaderstukken | Buiten MVP | HANDOVER bekende beperking |
| Teams-/SharePoint-integratie, mapupload | Ontworpen/verkend | Roadmap v1.0 §5 |
| Multi-sector, sector-packs, runtime-subagents, Decision Object Plateau 3 | Ontworpen (ambitie) | Zie `../06 Roadmap/later-optimalisaties.md` |
| Mobiele app; internationale expansie | Buiten scope | Responsieve webapp; NL-focus |

## 3. Grensgevallen en kanttekeningen

- **Code review 03-07-2026:** 3 Kritiek gefixt; 5 van 8 Hoog, 12 Middel en 8 Laag open — detail deels **Onbekend** (bronbestand afgekapt). De in de review genoemde migratie `2026_07_03_security_hardening.sql` ontbreekt in de repo (**Te valideren**).
- **governance_log:** append-only nog niet overal technisch afgedwongen; policy-patroon `FOR ALL` zonder `WITH CHECK` deels aanwezig — hersteld voor profielen (K1), bredere doortrekking open.
- **Aanname:** de multi-tenant-claims zijn getoetst via RLS-regressiechecks (`supabase/checks/`) op één demo-fonds; gedrag met een echte tweede tenant is niet in productie beproefd.
