# MVP-functionaliteiten — Bestuurdersportaal

**Laatst bijgewerkt:** 2026-07-04
**Statuslabels:** Geïmplementeerd / Deels / Ontworpen / Openstaande keuze / Onbekend / Te valideren.
**Bron:** as-built code-analyse 4 juli 2026 (feitenrapport 03), `HANDOVER.md`, `decisions/`, migraties.

| Functionaliteit | Module | Status | Toelichting | Bron |
|---|---|---|---|---|
| Chat met RAG en traceerbare bronvermelding | AI-assistent | Geïmplementeerd | Hybride retrieval (Dutch FTS + pgvector/RRF), scope-vóór-ranking, citatie-validatie | `app/api/chat/route.ts`, `lib/rag*` |
| Automatische bronkeuze (fonds vs. generiek) | AI-assistent | Geïmplementeerd | Heuristiek `bepaalBronIntent`; "alleen fondsdocumenten"-restrictie blijft expliciet | decision 0014/0016 |
| Document-scope: vragen over één document (@-mention) | AI-assistent | Geïmplementeerd | Scoped RAG op `document_id` | HANDOVER; ontwerp v0.2 (map 03) |
| Agendapunt-modus (vraag de AI over een agendapunt) | AI-assistent | Geïmplementeerd | Toelichting als gelabelde seed-context, niet geëmbed | decision 0028 |
| Transformatie/antwoordmodi (o.a. bestuurlijke stijl) | AI-assistent | Geïmplementeerd | Modusfamilie Increment G/I-1; feature-flag `BESTUURLIJKE_STIJL` | git 22-06; feitenrapport 04 §2 |
| Profielgestuurde antwoorden en agendavoorbereiding | AI-assistent / Profiel | Geïmplementeerd | Increment F; B10-checkpoint open vóór productief gebruik | decision 0017; HANDOVER |
| Gesprekken-persistentie | AI-assistent | Geïmplementeerd | `gesprekken`-tabel, historie in UI | git 07–10-06 |
| Live web-retrieval | AI-assistent | Openstaande keuze | Besluit 0019 (voorstel); `AssistantSource.web` leeg; 2 code-TODO's | decision 0019 |
| Upload + extractie PDF/DOCX/XLSX/PPTX | Bibliotheek | Geïmplementeerd | unpdf/mammoth/xlsx/jszip; magic-bytes + OOXML-validatie, 25 MB | `lib/document-extractie.ts`, `lib/bestand-validatie.ts` |
| OCR-fallback (beeld-PDF's) | Bibliotheek | Deels | Mistral OCR op her-extract-/curatiepad; niet in tenant-upload-route | decisions 0020/0023 |
| RAG-indexering: structuurbewuste chunking + contextuele prefix + embeddings | Bibliotheek | Geïmplementeerd | Mistral `mistral-embed` 1024-dim; re-index-mechanisme | decision 0025; RAG-VERBETERING-ONTWERP |
| Documentstatus/bronstatus/metadata + review-queue | Bibliotheek | Geïmplementeerd | 17 sanity-tests op transitietabel; append-only metadata-log | Increment C/C+; decision 0009–0013 |
| RAG-filtering vóór retrieval (status/bronstatus/geldigheid) | Bibliotheek / AI | Geïmplementeerd | Deterministische SQL-regressiecheck aanwezig | `supabase/checks/2026_06_20g_…`; decision 0013 |
| Zoekmodule | Zoeken | Geïmplementeerd | `/api/zoeken` op retrieval-RPC's | feitenrapport 03 §6 |
| Vergaderkalender, agendapunten, inbreng | Vergaderingen | Geïmplementeerd | Incl. soft-delete/herstel + `agendapunt_log` | feitenrapport 03 |
| AI-voorbereiding per agendapunt (privé, RAG) | Vergaderingen | Geïmplementeerd | Profielgestuurd sinds 26–28-06 | git; HANDOVER |
| Stemmingen incl. volmacht | Stemmingen | Geïmplementeerd | Symmetrische volmacht-constraint; rapporteert, geen rechtsgeldigheid | V2-ontwerp rev 1.2; `lib/stemming.ts` |
| Notulen-segmentatie met bevestiging | Notulen | Geïmplementeerd (regelgebaseerd) | Segmentchunks vervangen document-chunks transactioneel (RPC) | decision 0011 |
| Decision Object: 17-statusmachine + readiness-gate | Procedures | Geïmplementeerd | Multi-dimensionele classificatie, evidence-requirements | PROCEDURE-MVP1-ONTWERP rev 2.1 |
| Append-only governance_events met sha256-hash | Procedures / audit | Geïmplementeerd | Triggers blokkeren UPDATE/DELETE; FK `on delete restrict` | decision 0001; feitenrapport 03 §8 |
| Auditdossier-export (HTML/JSON, besluitmoment-snapshots) | Procedures | Geïmplementeerd | 112× HTML-escaping (reviewoordeel) | git 08-05; CODE-REVIEW-2026-07-03 |
| Dossiers/procesinstanties + afgeleide dossierstatus | Procedures | Geïmplementeerd | `vw_dossier_status` (pure projectie) | decision 0008; Increment B |
| Risicomatrix: risico's + maatregelen + log | Risicomatrix | Geïmplementeerd | Iteratie 1; bewerken K/I/niveau = iteratie 2 (open) | feitenrapport 03 |
| Gebruikersbeheer + procescatalogus/organen | Beheer | Geïmplementeerd | Catalogus in DB + import globale templates | Increment A; decision 0007 |
| Persoonlijk profiel (zelfbeheer) | Profiel | Geïmplementeerd | K1-RLS-hardening 03-07; live draaien migratie **Te valideren** | decision 0017; migratie 2026_07_03 |
| In-app notificaties (12 typen) | Notificaties | Geïmplementeerd | Geen e-mail (eigenaars-FK ontbreekt) | `lib/notifications.ts` |
| Governance-log-viewer | Governance | Geïmplementeerd | Elke AI-interactie gelogd incl. `retrieval_meta` | `/governance`; feitenrapport 03 §8 |
| Wtp-stuurinformatie / Klantbeeld | Klantbeeld | **Deels (demo)** | UI werkend; 100% deterministische dummydata | `lib/klantbeeld-data.ts` |
| Platform-identiteiten + capabilities + MFA (AAL2) | Platform | Geïmplementeerd | Wederzijdse uitsluiting tenant/platform; fail-closed `PLATFORM_HOST` | decision 0021 |
| Twee-fasen, hash-geketend platform-auditlog | Platform | Geïmplementeerd | Attempt + gegarandeerd result-event; advisory lock | `lib/platform-audit.ts` |
| Generieke bibliotheek + curatie (incl. OCR, versionering) | Platform | Geïmplementeerd | Malwarescan-stap expliciet overgeslagen (WP3) | decision 0022/0023 |
| Contact-inbox back-office | Platform | Geïmplementeerd | Capability `platform.contact.manage` | decision 0034 |
| Marketing-site (drie hosts) + privacyverklaring + SEO-basis | Publiek | Geïmplementeerd | Scoped CSS (geen Tailwind); Vercel Analytics | decisions 0029/0032 |
| Contactformulier + opslag + Mailgun-notificatie | Publiek | Geïmplementeerd (sandbox) | Opslag altijd; mail soft-fail; rate-limit op gehashte IP | decisions 0031/0033 |
| Security headers + CSP (WP1) | Security | Geïmplementeerd | Bewuste concessie `unsafe-inline`/`unsafe-eval` | next.config.ts |
| Rate limiting in-stack (WP2) | Security | Geïmplementeerd | Postgres sliding-window; fail-open bij DB-storing (bewust) | decision 0005 |
| Error sanitization (WP6) | Security | Geïmplementeerd | Helper `lib/api-errors.ts` | WP6-log |
| Malwarescan (WP3), prompt-injection (WP4), CSRF (WP5), eindverificatie (WP8) | Security | Openstaand | Route A-restwerk | SECURITY-ROUTE-A-IMPLEMENTATIE |
| Sentry-monitoring (WP7) | Security | Uitgesteld | Hook voorbereid; sub-verwerker-afweging | decision 0005 |
| Restant reviewbevindingen 03-07 (5 Hoog, 12 Middel, 8 Laag) | Alle | Open — deels Onbekend | Bronbestand afgekapt; reconstructie nodig | CODE-REVIEW-2026-07-03 |
