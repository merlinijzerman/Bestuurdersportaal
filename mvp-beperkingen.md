# MVP-beperkingen — Bestuurdersportaal

**Laatst bijgewerkt:** 2026-07-31 (securityreview 30-31 juli: §3 en §4 bijgewerkt; overige tekst per 2026-07-04)
**Doel:** eerlijk overzicht van wat de MVP níét is of níét kan, plus de noodzakelijke stappen richting productiegeschiktheid. Bronnen: feitenrapporten 4 juli 2026, `HANDOVER.md` §Bekende beperkingen, `SECURITY-ROUTE-A-IMPLEMENTATIE.md`, `CODE-REVIEW-2026-07-03.md` (afgekapt), `decisions/`.

## 1. Functionele beperkingen

| Beperking | Toelichting | Status |
|---|---|---|
| **Klantbeeld draait op 100% dummydata** | `lib/klantbeeld-data.ts` levert deterministische demo-cijfers (Wtp-cohorten, werkgevers); geen koppeling met een uitvoerder | Bewust — demo |
| Eén demo-fonds | Multi-tenant-fundament gebouwd, maar geen tweede echte tenant beproefd. Het tenant-model is inmiddels vastgelegd (decision 0040: bridge-ready pool standaard, dedicated isolatie premium) met een uitvoeringspad (T-serie); onboarding fonds 2 pas na de P0-go/no-go (gate G2) incl. her-introductie-gate 0026 | Aanname/Te valideren — model + pad vastgelegd (0040) |
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
| **Default privileges van `supabase_admin` niet te wijzigen** | `pg_default_acl` geeft nieuwe tabellen in `public` nog steeds `anon = arwdDxtm` en nieuwe functies `anon = X`; `postgres` is geen lid van die rol en kan de entry niet aanpassen. Objecten die door `supabase_admin` ontstaan (extensies, Supabase-platformmigraties) krijgen daarmee INSERT voor de publieke anon-key en TRUNCATE terug. Preventie niet haalbaar; gates F en H zijn de detectie | **Geaccepteerd restrisico** — besluit 0096 |
| **Storage-policy generieke tak nog niet gehard** | `documenten storage lezen`, tak `(storage.foldername(name))[1] = 'generiek'` mist `auth.uid() is not null` (M-02, derde locatie). Alleen handmatig in het Supabase-dashboard aan te passen, niet via migratie | Open |
| **Decompressiebudget vertrouwt de ZIP-header** | `beoordeelDecompressie` leest de gedeclareerde `uncompressedSize`, die de aanvaller zelf zet. Vangt de gewone zipbom, niet een archief dat klein declareert en bij extractie uitdijt. Harde cap tijdens extractie zou dit sluiten | Open — bekend en begrensd |
| **`ANTHROPIC_API_KEY` niet geroteerd** | Openstaand sinds de review van 30-07; `git log --all -- .env.vercel-now` nog niet gedraaid | Open |
| ~~Open reviewbevindingen 03-07 (K1/K2/K3)~~ | Opgevolgd in de ronde van 31-07-2026: K2 en K3 uit die review corresponderen met de nu gedichte bevindingen; `2026_07_03_profielen_rls_hardening.sql` bleek nooit gedraaid en is alsnog toegepast (R3) | Afgerond |

## 4. Kwaliteitsborging en documentatie

| Beperking | Toelichting | Status |
|---|---|---|
| **Geen CI en geen testframework** | Verificatie = handmatige `tsc`-check, sanity-scripts, SQL-checks, smoke-tests (reviewbevinding H6) | Open |
| ESLint niet functioneel | `npm run lint` bestaat, maar ESLint is niet geïnstalleerd/geconfigureerd | Open |
| **Afgekapte reviewdocumenten** | `CODE-REVIEW-2026-07-03.md` (2.966 bytes) en `BEVINDINGENLOG.md` (455 bytes) eindigen midden in een zin én zijn ongecommit; de volledige restpuntenlijst is nergens compleet gedocumenteerd; genoemde migratie `2026_07_03_security_hardening.sql` ontbreekt | Open — Te valideren |
| `supabase/schema.sql` loopt achter; geen gegenereerde Supabase-types | Documentatie-/typeschuld | Open |
| Verouderde documentatie-onderdelen | HANDOVER-secties bevroren snapshots; `.env.example` ontbreekt; tmp-bestanden in repo | Open |
| **Geen migratierunner; repo en productie lopen niet aantoonbaar gelijk** | Migraties worden handmatig in de SQL-editor geplakt zonder registratie. De review van 31-07 vond drie objecten die in productie stonden maar in geen enkele migratie (K-02, K-03, L-08). "De migratie staat in de repo" bewijst niets over productie | Open — **harde blocker vóór fonds 2** |
| **Structurele gates draaien nog niet in CI** | `supabase/checks/2026_07_31_r1_structurele_gates.sql` (gates A t/m H) moet handmatig worden gedraaid. Daarmee hangt de detectie van het `supabase_admin`-restrisico af van eraan denken | Open — **P1**, goedkoopste maatregel op de lijst |
| **Testgate kan stil falen** | `npm run sanity` stopte bij de eerste rode suite; daardoor hebben 45 suites twee weken niet gedraaid zonder dat iemand het zag (bevinding T-01). Het script draait nu alles door en rapporteert aan het eind, maar er is geen CI die het afdwingt | Deels opgelost |
| **Preview-deploys draaien tegen de productiedatabase** | Er is één Supabase-project. Een preview-omgeving test dus nieuwe code tegen echte productiedata en -policies, en de gedragstest `2026_07_31_r1_tenantgrenzen.sql` (seedt gebruikers in `auth.users`) kan daardoor niet volledig worden uitgevoerd | Open — **blocker vóór fonds 2** |

## 5. Compliance

| Beperking | Toelichting | Status |
|---|---|---|
| Verwerkersovereenkomsten (DPA's) niet geverifieerd/afgesloten | Vercel, Supabase, Anthropic, Mistral, Mailgun; Mailgun ontbreekt mogelijk in het register | Open |
| Bewaartermijnen niet vastgesteld | O.a. `governance_log`, `contact_aanvragen` | Open |
| DPIA alleen als opzet; geen juridische toetsing | B10-checkpoint open vóór productief profielgebruik | Open |
| Datalekprocedure niet geoperationaliseerd | Map 07 benoemt de actie | Open |
| Formele AI-Act-classificatie extern te beoordelen | AI-governance-ontwerp is concept | Open |
| Kopiëren uit de AI-chat wordt niet geregistreerd | Bewust besluit ([`0098`](./decisions/0098-kopieren-uit-de-chat-zonder-logging.md), 31-07-2026): een kopieeractie is geen besluit en geen dossier-export. Gevolg, aanvaard: dit is het **enige uitgaande pad zonder registratie** — een passage kan het portaal verlaten zonder spoor. Tegenmaatregel zit in de kopie zelf (verplichte bronnenlijst + herkomstregel), niet in het auditspoor. Handmatige muisselectie draagt die tegenmaatregel níet | Aanvaard |

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
9. **P0-fundament T-serie (decision 0040)** vóór een tweede fonds: tenant-resolver, deterministische fondskoppeling (R1), server-side auditfonds (R2), RLS-hardening, RAG-tenantdiscipline, dataclassificatie, demo/productie-scheiding en de geformaliseerde her-introductie-gate 0026 — samengevat in gate G2.
10. **Klantbeeld op echte data** — datakoppeling uitvoerder + verwerkersafspraken.
11. **Eigenaars-FK + e-mailnotificaties** voor bestuurders.
12. **Route B/C** (strikte CSP, pen-test, certificering) zodra een betalende klant in zicht is.
