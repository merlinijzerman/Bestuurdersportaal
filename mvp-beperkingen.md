# MVP-beperkingen — Bestuurdersportaal

**Laatst bijgewerkt:** 2026-07-04
**Doel:** eerlijk overzicht van wat de MVP níét is of níét kan, plus de noodzakelijke stappen richting productiegeschiktheid. Bronnen: feitenrapporten 4 juli 2026, `HANDOVER.md` §Bekende beperkingen, `SECURITY-ROUTE-A-IMPLEMENTATIE.md`, `CODE-REVIEW-2026-07-03.md` (afgekapt), `decisions/`.

## 1. Functionele beperkingen

| Beperking | Toelichting | Status |
|---|---|---|
| **Klantbeeld draait op 100% dummydata** | `lib/klantbeeld-data.ts` levert deterministische demo-cijfers (Wtp-cohorten, werkgevers); geen koppeling met een uitvoerder | Bewust — demo |
| Eén demo-fonds | Multi-tenant-fundament gebouwd, maar geen tweede echte tenant beproefd; her-introductie-gate (decision 0026) vóór fonds 2 | Aanname/Te valideren |
| Geen e-mail naar bestuurders | Alleen in-app notificaties; eigenaars/verantwoordelijken als vrije tekst (geen FK) blokkeert gerichte notificaties | Open |
| Notulen half-automatisch | Regelgebaseerde segmentatie; koppeling aan afgeronde vergaderingen beperkt | Open |
| Procedure-templates hardcoded | Nieuwe template = code-deploy; registry alleen Ontworpen (decision 0002) | Open |
| OCR niet in tenant-upload | Beeld-only PDF's worden in de tenantroute geweigerd; OCR alleen op her-extract-/curatiepad | Bewust (0020/0023) |
| Voorzitter bereikt document-review-UI niet | Rechten server-side aanwezig; blokkade is UI-gating van `/beheer` | Open (fix: aparte `/review`-route) |
| Geen web-retrieval | Besluit 0019 open; AI kent alleen fondsdocumenten + generieke bibliotheek + modelkennis | Openstaande keuze |

## 2. Infrastructurele en operationele beperkingen

| Beperking | Toelichting | Status |
|---|---|---|
| **Mailgun-sandbox** | Contactnotificaties alleen naar vooraf geautoriseerde ontvangers; geen eigen maildomein; mail is soft-fail (opslag in Supabase altijd) | Interim (decision 0033) |
| **Single-region, geen redundantie** | Eén Supabase-project (EU-Frankfurt) + Vercel; geen DR-plan, geen uitgewerkte back-up-/restore-procedure gedocumenteerd | Open/Onbekend |
| **Geen SLA, geen alerting, geen error-monitoring** | Sentry (WP7) uitgesteld; alleen Vercel-logs en handmatige waarneming | Uitgesteld |
| Anthropic spend-limiet niet gezet | Kosten-backstop is handmatige actie, nog open | Open |
| Synchrone AI-samenvatting bij upload | 5–20 sec bij grote PDF's | Bekend |
| Rate limiting fail-open | Bij DB-storing géén limiet; loginroute buiten scope | Bewust geaccepteerd |

## 3. Security-restpunten

| Beperking | Toelichting | Status |
|---|---|---|
| **Geen malwarescan op uploads (WP3)** | Expliciete `overgeslagen`-jobstap `scan_uitgesteld_wp3`; wel magic-bytes/OOXML-validatie + quarantainebucket | Open |
| **Geen prompt-injection-mitigatie (WP4)**, **geen CSRF/Origin-check (WP5)**, **geen Route A-eindverificatie (WP8)** | Route A onafgemaakt | Open |
| CSP met `unsafe-inline`/`unsafe-eval` | Next.js-hydratatie-concessie; strikte CSP via nonces = Route B | Bewust geaccepteerd |
| Open reviewbevindingen 03-07 | 5 van 8 Hoog, 12 Middel, 8 Laag open; governance_log-zwaktes (append-only niet overal afgedwongen; `FOR ALL` zonder `WITH CHECK`) | Open — deels Onbekend |
| Vercel CVE-branch niet gemerged; HSTS-preload niet ingediend | Kleine open acties | Open |

## 4. Kwaliteitsborging en documentatie

| Beperking | Toelichting | Status |
|---|---|---|
| **Geen CI en geen testframework** | Verificatie = handmatige `tsc`-check, sanity-scripts, SQL-checks, smoke-tests (reviewbevinding H6) | Open |
| ESLint niet functioneel | `npm run lint` bestaat, maar ESLint is niet geïnstalleerd/geconfigureerd | Open |
| **Afgekapte reviewdocumenten** | `CODE-REVIEW-2026-07-03.md` (2.966 bytes) en `BEVINDINGENLOG.md` (455 bytes) eindigen midden in een zin én zijn ongecommit; de volledige restpuntenlijst is nergens compleet gedocumenteerd; genoemde migratie `2026_07_03_security_hardening.sql` ontbreekt | Open — Te valideren |
| `supabase/schema.sql` loopt achter; geen gegenereerde Supabase-types | Documentatie-/typeschuld | Open |
| Verouderde documentatie-onderdelen | HANDOVER-secties bevroren snapshots; `.env.example` ontbreekt; tmp-bestanden in repo | Open |

## 5. Compliance

| Beperking | Toelichting | Status |
|---|---|---|
| Verwerkersovereenkomsten (DPA's) niet geverifieerd/afgesloten | Vercel, Supabase, Anthropic, Mistral, Mailgun; Mailgun ontbreekt mogelijk in het register | Open |
| Bewaartermijnen niet vastgesteld | O.a. `governance_log`, `contact_aanvragen` | Open |
| DPIA alleen als opzet; geen juridische toetsing | B10-checkpoint open vóór productief profielgebruik | Open |
| Datalekprocedure niet geoperationaliseerd | Map 07 benoemt de actie | Open |
| Formele AI-Act-classificatie extern te beoordelen | AI-governance-ontwerp is concept | Open |

## 6. Noodzakelijke stappen richting productiegeschiktheid

Geprioriteerd; 1–8 zijn randvoorwaardelijk voor een pilot met een echte klant, 9–12 voor productie/opschaling. Zie ook `../06 Roadmap/releaseplanning.md`.

1. **Werk van 3 juli afhechten en reconstrueren** — ongecommit werk committen; CODE-REVIEW/BEVINDINGENLOG herstellen; verifiëren waar de K2/K3/H1/H3-fixes zijn geland (ontbrekende migratie).
2. **Open Hoog-bevindingen fixen** incl. governance_log-hardening (append-only triggers, `WITH CHECK` op alle policy's); Middel/Laag trieren.
3. **Route A afronden**: WP5 (CSRF) en WP4 (prompt-injection) direct; WP3 (malwarescan) met dienstkeuze; WP8 als afsluitende verificatie.
4. **CI + testbasis**: pipeline met tsc, lek-check en sanity-scripts; testrunner introduceren; ESLint werkend maken.
5. **Compliance-basis**: DPA's, verwerkersregister (incl. Mailgun), bewaartermijnen, DPIA-toetsing (FG/jurist), datalekprocedure, B10-checkpoint.
6. **Mailgun-productie of Resend-besluit** — geverifieerd domein; sandbox-beperking opheffen.
7. **Operationele backstops**: Anthropic spend-limiet, Vercel CVE-branch mergen, HSTS-preload, back-up-/restore-procedure vastleggen (nu Onbekend).
8. **Monitoring**: Sentry-besluit (EU-residency + sub-verwerker-registratie) of gelijkwaardig alternatief; minimale alerting.
9. **Her-introductie-gate decision 0026** (vier-ogen, zware platformhandelingen, tenantbeheer) vóór een tweede fonds.
10. **Klantbeeld op echte data** — datakoppeling uitvoerder + verwerkersafspraken.
11. **Eigenaars-FK + e-mailnotificaties** voor bestuurders.
12. **Route B/C** (strikte CSP, pen-test, certificering) zodra een betalende klant in zicht is.
