# MVP-definitie — Bestuurdersportaal

**Laatst bijgewerkt:** 2026-07-04
**Status:** as-built beschrijving van de MVP zoals die per 4 juli 2026 bestaat (120 commits, 27-04 t/m 01-07-2026; ongecommit hardening-werk van 03-07).

## 1. Wat de MVP is

Een **demonstreerbaar multi-tenant bestuurdersportaal voor pensioenfondsen met een AI-assistent (RAG)**: een beveiligde webomgeving waarin een fondsbestuur zijn documenten, vergaderingen, besluitvorming en risico's beheert, en waarin een AI-assistent vragen beantwoordt **uitsluitend op basis van de eigen fondsdocumenten en een platform-gecureerde generieke bibliotheek**, met traceerbare bronvermelding en volledige auditlogging.

- **Stack:** Next.js 15 (App Router, TypeScript strict) + Supabase (Postgres/Auth/RLS/Storage, EU-Frankfurt) + Vercel; Anthropic Claude (antwoorden), Mistral (embeddings `mistral-embed` + OCR), Mailgun (contactnotificaties, sandbox).
- **Omvang:** één demo-fonds (*Stichting Pensioenfonds Horizon*); het multi-tenant-fundament (RLS per `fonds_id`, aparte platform-back-office met eigen identiteiten en MFA) is gebouwd en werkend.
- **Drie surfaces:** publieke marketing-site (apex/www), besluitomgeving (`app.`), platform-back-office (`beheer.`, fail-closed).

## 2. Wat de MVP aantoont

1. **Haalbaarheid van RAG op bestuursdocumenten binnen tenantgrenzen.** Documenten (PDF/DOCX/XLSX/PPTX, met OCR-fallback) worden geëxtraheerd, structuurbewust gechunkt en hybride doorzocht (Dutch FTS + pgvector via RRF), met filtering op status/bronstatus/geldigheid **vóór** retrieval en RLS-afgedwongen tenant-isolatie. Elk antwoord heeft herleidbare bronnen; elke interactie wordt gelogd in `governance_log` inclusief retrieval-metadata.
2. **Governance-by-design.** Besluitvorming loopt via een Decision Object met 17-statusmachine, readiness-gating, append-only `governance_events` met sha256-hash per event, en een exporteerbaar auditdossier. Menselijke bevestiging blijft verplicht (notulen-indexering, metadata-review, statusovergangen); AI adviseert, mensen besluiten.
3. **Beheersbare multi-tenancy.** Platformcuratie van generieke bronnen staat los van tenantdata; platformhandelingen vereisen MFA (AAL2) en lopen door een twee-fasen, hash-geketend auditlog.
4. **Dat dit met een klein team en AI-ondersteunde ontwikkeling bouwbaar is** — 120 commits in ruim twee maanden, met vastgelegde besluiten (`decisions/`, 34 records) en migratie-eerst-discipline.

## 3. Wat de MVP níét aantoont

- Productiegeschiktheid (open securitywerk, geen CI, geen monitoring — zie `mvp-beperkingen.md`).
- Echte stuurinformatie: het Klantbeeld draait op 100% dummydata.
- Marktvalidatie: er is geen pilot of betalende klant; prijsstrategie is niet getoetst.

## 4. Voor wie de MVP is

| Doelgroep | Doel |
|---|---|
| **Mede-initiatiefnemers** | Gedeeld beeld van wat er staat en wat de volgende stap is (pilot-klaar maken); basis voor go/no-go- en investeringsgesprekken |
| **Potentiële klantfondsen / design-partners** | Demonstratie (zie `mvp-demo-script.md`): laten zien hoe AI-ondersteuning op eigen bestuursdocumenten werkt binnen een governance-kader |
| **Reviewers (technisch, security, compliance)** | Toetsbare as-built basis: code, migraties, besluitrecords, auditsporen en de acceptatiecriteria in `mvp-acceptatiecriteria.md` |

## 5. Relatie met andere documenten

- Scope en statuslabels per onderdeel: `mvp-scope.md`, `mvp-functionaliteiten.md`.
- Beperkingen en pad naar productie: `mvp-beperkingen.md`.
- Roadmap en backlog: `../06 Roadmap/`.
- Strategische afbakening: `../01 Strategie en aanpak/scope-en-afbakening.md`.
