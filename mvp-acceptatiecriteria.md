# MVP-acceptatiecriteria — Bestuurdersportaal

**Laatst bijgewerkt:** 2026-07-04
**Doel:** toetsbare acceptatiecriteria per module met de as-built status per 4 juli 2026.
**Statuslabels:** **Behaald** (aantoonbaar in code/checks/gebruik) / **Niet behaald** / **Te valideren** (aannemelijk maar niet onafhankelijk geverifieerd op de live omgeving).
**Kanttekening:** er is geen testframework/CI; "Behaald" steunt op code-analyse, sanity-scripts (`lib/*.sanity.ts`), SQL-regressiechecks (`supabase/checks/`) en handmatige smoke-tests. Onafhankelijke hertoetsing is onderdeel van Route A WP8.

## 1. AI-assistent

| # | Criterium | Status | Bron/toets |
|---|---|---|---|
| 1.1 | Een vraag over een fondsdocument levert een antwoord met minimaal één herleidbare bronvermelding naar dat document | Behaald | chat-route + citatie-validatie; dagelijks gebruik |
| 1.2 | De assistent gebruikt uitsluitend fondsdocumenten van het eigen fonds + generieke bibliotheek (geen cross-tenant-lekkage) | Behaald / Te valideren | RLS + regressiecheck `2026_06_20e`; hertoets na K1-fix gewenst |
| 1.3 | Documenten met status concept/inactief of verlopen geldigheid komen niet in retrieval | Behaald | Deterministische check `2026_06_20g_retrieval_filtering.sql` |
| 1.4 | Document-scope (@-mention) beperkt het antwoord aantoonbaar tot dat document | Behaald | Increment-ontwerp + smoke-tests |
| 1.5 | Elke chatinteractie staat in `governance_log` incl. bronnen, modus, model en retrieval-metadata | Behaald | insert na stream-voltooiing; `/governance`-viewer |
| 1.6 | Rate limiting: chat begrensd (20/5 min per gebruiker) | Behaald | WP2, migratie 10-06 |
| 1.7 | Prompt-injection via documentinhoud wordt gemitigeerd | **Niet behaald** | WP4 open |
| 1.8 | Antwoorden op actuele webinformatie | **Niet behaald** (buiten scope) | besluit 0019 open |

## 2. Bibliotheek en indexering

| # | Criterium | Status | Bron/toets |
|---|---|---|---|
| 2.1 | Upload PDF/DOCX/XLSX/PPTX ≤ 25 MB wordt geëxtraheerd, gechunkt en geëmbed | Behaald | extractie-/ingest-pipeline; sanity-tests chunking |
| 2.2 | Bestandsvalidatie fail-closed (magic-bytes, OOXML) | Behaald | `lib/bestand-validatie.ts` (sanity-tests) |
| 2.3 | Beeld-only PDF krijgt OCR-fallback op het curatie-/her-extractpad | Behaald | decision 0020/0023; OCR-audit-migratie |
| 2.4 | Geüploade bestanden worden op malware gescand | **Niet behaald** | WP3; expliciete `overgeslagen`-jobstap |
| 2.5 | Metadata-/statuswijziging vereist geldige transitie en wordt append-only gelogd | Behaald | `lib/document-status-transities.ts` (17 sanity-tests); `document_metadata_log` |

## 3. Vergaderingen en stemmingen

| # | Criterium | Status | Bron/toets |
|---|---|---|---|
| 3.1 | Vergadering met agendapunten, stukken en inbreng aanmaken/beheren | Behaald | routes + componenten; smoke-tests |
| 3.2 | AI-voorbereiding per agendapunt is privé voor de aanvrager | Behaald | RLS + server-side ophalen (decision 0028) |
| 3.3 | Stemmen incl. volmacht, met symmetrische bevestiging | Behaald | `lib/stemming.ts` (sanity-tests) |
| 3.4 | Uitslag rapporteert zonder rechtsgeldigheidsclaim | Behaald | expliciet in code/UI-tekst |

## 4. Notulen

| # | Criterium | Status | Bron/toets |
|---|---|---|---|
| 4.1 | Notulen worden regelgebaseerd gesegmenteerd; indexering pas na menselijke bevestiging | Behaald | `lib/notulen.ts`; decision 0011 |
| 4.2 | Segmentchunks vervangen documentchunks transactioneel | Behaald | RPC (decision 0011) |
| 4.3 | Koppeling notulen ↔ afgeronde vergadering volledig | **Niet behaald** (beperkt) | HANDOVER bekende beperking |

## 5. Procedures / Decision Object

| # | Criterium | Status | Bron/toets |
|---|---|---|---|
| 5.1 | Statusovergangen alleen volgens de 17-statusmachine; readiness-gate blokkeert besluit zonder vervulde vereisten | Behaald | `lib/decision.ts`; PROCEDURE-MVP1-AUDIT |
| 5.2 | `governance_events` is append-only met sha256-hash per event; UPDATE/DELETE geblokkeerd | Behaald | triggers; decision 0001 |
| 5.3 | Auditdossier exporteerbaar (HTML/JSON) met besluitmoment-snapshots; output ge-escaped | Behaald | export-code (112× escaping, reviewoordeel) |
| 5.4 | Decision Objects niet hard-verwijderbaar; annuleren via status | Behaald | decision 0001; FK `on delete restrict` |
| 5.5 | Alle `*_log`-tabellen technisch append-only | **Te valideren** | reviewbevinding H1 "gefixt" gemeld, maar fix-migratie niet traceerbaar in repo |

## 6. Risicomatrix

| # | Criterium | Status | Bron/toets |
|---|---|---|---|
| 6.1 | Risico's met maatregelen aanmaken; mutaties gelogd in `risico_log` | Behaald | routes + log-inserts |
| 6.2 | Kans/impact/niveau bewerken met motivering | **Niet behaald** | iteratie 2, backlog |

## 7. Beheer, profiel en notificaties

| # | Criterium | Status | Bron/toets |
|---|---|---|---|
| 7.1 | Catalogus/organen in DB beheren en importeren zonder deploy | Behaald | Increment A |
| 7.2 | Gebruiker kan uitsluitend het eigen profiel beheren; `rol`/`fonds_id` niet zelf muteerbaar | Behaald (code) / **Te valideren** (live) | K1-fix `2026_07_03_profielen_rls_hardening.sql` — draaien op live Supabase niet bevestigd |
| 7.3 | In-app notificaties bij relevante gebeurtenissen (12 typen) | Behaald | `lib/notifications.ts` |
| 7.4 | E-mailnotificaties bestuurders | **Niet behaald** (buiten scope MVP) | — |

## 8. Klantbeeld

| # | Criterium | Status | Bron/toets |
|---|---|---|---|
| 8.1 | Klantbeeld-UI toont cohorten/werkgevers/ontwikkeling | Behaald (als demo) | UI werkend |
| 8.2 | Cijfers gebaseerd op echte uitvoerderdata | **Niet behaald** (bewust) | 100% dummy, `lib/klantbeeld-data.ts` |

## 9. Platform-back-office

| # | Criterium | Status | Bron/toets |
|---|---|---|---|
| 9.1 | Platform-surface alleen bereikbaar op `PLATFORM_HOST`; ontbrekende env = overal 404 (fail-closed) | Behaald | middleware; decision 0021 |
| 9.2 | Platformhandelingen vereisen sessie + MFA (AAL2) + capability | Behaald | `withPlatform`-wrapper |
| 9.3 | Twee-fasen-audit: attempt vóór uitvoering (fail-closed) + gegarandeerd result-event, hash-geketend | Behaald | `lib/platform-audit.ts` |
| 9.4 | Service-role-key alleen in de server-only platformlaag | Behaald | `scripts/check-service-role-leak.sh` |
| 9.5 | Tenant-gebruikers kunnen generieke documenten niet muteren (read-only) | Behaald | RLS-split C+/B13; check `2026_06_20e` |

## 10. Publieke voorkant

| # | Criterium | Status | Bron/toets |
|---|---|---|---|
| 10.1 | Contactinzending wordt altijd opgeslagen, ook als mail faalt (soft-fail) | Behaald | `/api/contact`; decision 0033 |
| 10.2 | `contact_aanvragen` append-only, insert alleen via service-role, gehashte IP/UA | Behaald | decision 0031 |
| 10.3 | Bestaande gedeelde loginlinks blijven werken (redirect marketing → app) | Behaald | W0-cutovercriterium; decision 0030 |
| 10.4 | E-mailnotificatie naar willekeurige ontvangers | **Niet behaald** | Mailgun-sandbox: alleen geautoriseerde ontvangers |

## 11. Security en kwaliteit (dwarsdoorsnede)

| # | Criterium | Status | Bron/toets |
|---|---|---|---|
| 11.1 | Security headers incl. CSP op alle routes | Behaald | next.config.ts (WP1); CSP-concessie gedocumenteerd |
| 11.2 | Foutmeldingen lekken geen interne details | Behaald | WP6, `lib/api-errors.ts` |
| 11.3 | CSRF-bescherming via Origin-check | **Niet behaald** | WP5 open |
| 11.4 | Geautomatiseerde testsuite + CI-poort | **Niet behaald** | H6; alleen Vercel-build |
| 11.5 | `tsc --noEmit` exit 0 op main | Behaald (na H5-fix) / Te valideren op HEAD | reviewlog 03-07 |
| 11.6 | Alle Kritiek-bevindingen review 03-07 gefixt en traceerbaar | Deels — **Te valideren** | K1 traceerbaar (migratie); K2/K3-fixes niet als migratie terug te vinden |
| 11.7 | Onafhankelijke eindverificatie (WP8) uitgevoerd | **Niet behaald** | Route A open |

## 12. Scenario A — live web-retrieval (besluit 0072)

> Ontwerp: [`AI-WEBRETRIEVAL-ONTWERP.md`](./AI-WEBRETRIEVAL-ONTWERP.md). De feature staat achter de env-vlag `WEB_RETRIEVAL_ACTIEF` (uit = Scenario B, ongewijzigd). "Behaald (test)" = gedekt door sanity-/cross-tenant-tests; livegang vergt daarnaast Anthropic-accountactivering + EU-residentie-bekrachtiging (open, zie 0072 §12).

**Retrieval**

| # | Criterium | Status | Bron/toets |
|---|---|---|---|
| AC-1 | Niet-whitelist-URL wordt vóór ophalen geweigerd en gelogd; verschijnt niet in het antwoord | Behaald (test) | `allowedDomeinenUit` + `matchWhitelist`; `web-retrieval.sanity.ts`, `web-whitelist.sanity.ts` |
| AC-2 | Toegestaan subdomein (`domein+subdomeinen`) geaccepteerd met normgewicht van het hoofddomein | Behaald (test) | `web-whitelist.sanity.ts` |
| AC-3 | Elk op live-inhoud gebaseerd deel draagt URL + titel + ophaaldatum; geen ongeciteerde live-inhoud | Behaald | `bouwWebbronnen` + `OnderbouwingPaneel`; anti-fabricage KERNBESLUIT |
| AC-4 | Bij `bindend` vs. `sector_guidance`-conflict volgt het antwoord `bindend`; lager gewicht hooguit context | Behaald (test) | `weegWebbronnen`; `SP_WEB_REGELS` |
| AC-5 | Geen whitelist-treffer → terugval RAG/modelkennis + bestaande melding; geen verzonnen bron | Behaald (test) | `beoordeelWebGate`/fallback; `web-retrieval.sanity.ts` |
| AC-6 | Verborgen instructies in een opgehaalde pagina wijzigen gedrag/citatieplicht/weging niet | Behaald | `SP_WEB_REGELS` (data-niet-instructie) + tool-result-sandbox |
| AC-7 | Time-out/dode bron → gecontroleerde terugval + gelogde mislukte ophaalpoging | Behaald (test) | `extractWebResultaten` foutcode + `retrieval_meta.web.fallback` |
| AC-8 | Bij tijdgevoelige info zijn ophaaldatum én "verifieer bij de instantie zelf" zichtbaar | Behaald | `OnderbouwingPaneel` webbronnenblok |
| AC-9 | Auditlog per live-antwoord: geschoonde vraag, bevraagde + gebruikte bronnen (met normgewicht), ophaaltijdstip, fallback | Behaald | `governance_log.retrieval_meta.web` |
| AC-10 | Vraag met persoons-/fondsgegevens → live retrieval geblokkeerd (AVG); keuze gelogd | Behaald (test) | `bevatPersoonsgegevens` + `beoordeelWebGate`; `pii-gate.sanity.ts` |

**Beheerscherm (platform-surface)**

| # | Criterium | Status | Bron/toets |
|---|---|---|---|
| AC-B1 | Toevoegen zonder normgewicht of toelichting → geweigerd met validatiemelding | Behaald | `acties.ts` `valideer` |
| AC-B2 | Vier-ogen uit: één beheerder mag toevoegen én activeren | Behaald | `platform.config.manage` (niet-zwaar) |
| AC-B3 | Activatie direct live, append-only gelogd + genotificeerd aan overige beheerders | Behaald | `whitelistStatus` + `bron_whitelist_log` + wijzigingslog |
| AC-B4 | `padprefix`-entry: URL op zelfde domein buiten het pad wordt geweigerd | Behaald (test) | `matchWhitelist`; `web-whitelist.sanity.ts` |
| AC-B5 | `domein+subdomeinen`-entry: subdomein-URL toegestaan met tier/normgewicht hoofddomein | Behaald (test) | `web-whitelist.sanity.ts` |
| AC-B6 | Deactiveren haalt het domein uit retrieval; entry blijft met historie zichtbaar | Behaald | RLS (alleen actief in retrieval) + status-behoud |
| AC-B7 | Verstreken `review_datum` → in het overzicht als "review nodig" gemarkeerd | Behaald | `BronnenWhitelistClient` review-signalering |
| AC-B8 | Look-alike/ongeldig domein triggert waarschuwing bij opslaan (harde validatie blijft) | Behaald (test) | `isGeldigDomein` + `detecteerLookAlike`; `web-whitelist.sanity.ts` |
