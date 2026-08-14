# OWASP ASVS Level 2 — register en uitvoeringsplan

- **Normbasis:** OWASP ASVS 5.0.0 (stabiele release, mei 2025)
- **Doelniveau:** Level 2, dus alle toepasselijke vereisten met niveau 1 of 2
- **Scope:** webapplicatie, API-routes, Supabase/Postgres/Storage, Vercel,
  authenticatie, AI-providers, documentverwerking en beheeromgeving
- **Statusdatum:** 2026-08-14
- **Eigenaar:** opdrachtgever/product owner; uitvoering door development
- **Beoordelingsstatus:** nulmeting — nog geen ASVS-conformiteitsclaim

De canonieke vereistentekst blijft de officiële OWASP ASVS 5.0.0 CSV/JSON. In
bewijsstukken gebruiken we altijd versievaste IDs als `v5.0.0-1.2.5`; daardoor
kan een volgende ASVS-versie niet stil de betekenis van bestaande bewijslast
wijzigen.

## Statusmodel

| Status | Betekenis |
|---|---|
| `Voldoet` | Implementatie én verificatiebewijs aanwezig; gereviewd |
| `Deels` | Control bestaat, maar dekking of bewijs is onvolledig |
| `Open` | Geen toereikende control of verificatie |
| `N.v.t.` | Aantoonbaar niet toepasselijk, met technische motivatie |
| `Risico geaccepteerd` | Tijdelijk niet voldaan, met eigenaar, einddatum en compensatie |

`N.v.t.` en `Risico geaccepteerd` worden nooit door de ontwikkelaar alleen
toegekend. De opdrachtgever accordeert ze; voor gevoelige persoonsgegevens of
juridische gevolgen wordt ook de passende privacy-/securityrol betrokken.

## Huidige technische nulmeting per ASVS-hoofdstuk

Dit hoofdstukregister is de werkverdeling. De volgende stap is elk toepasselijk
Level 1/2-vereiste uit de canonieke CSV als afzonderlijke bewijsregel opnemen.

| ASVS 5.0 | Huidige status | Reeds aanwezig / bewijs | Belangrijkste ontbrekende stap |
|---|---|---|---|
| V1 Encoding and Sanitization | Deels | React-escaping; parametrische Supabase-aanroepen; sanitytests | Alle HTML, CSV/XLSX, regex, URL en documentexports per sink inventariseren en testen |
| V2 Validation and Business Logic | Deels | Servervalidatie, capabilities, statusmachines en regressietests | Mutatie + audit atomisch maken; negatieve business-logic-tests completeren |
| V3 Web Frontend Security | Deels | Securityheaders; CSP zonder `unsafe-eval` buiten development | Nonce-/hash-CSP ontwerpen zodat algemeen `unsafe-inline` vervalt; DOM-XSS-testen |
| V4 API and Web Service | Deels | Originchecks op publieke contactroute; route-auth en rate limiting op delen van API | Uniform API-policyprofiel; atomische rate limiting; schema-/content-type-/methodtests |
| V5 File Handling | Deels | Extensie-/groottebeperkingen, magic-byte-/OOXML-subtypecontrole, decompressiebudget en extractiepaden | Malware-scan, quarantine vóór verwerking en runtimebewijs op alle uploadpaden |
| V6 Authentication | Deels | Supabase Auth; platformbeheer vereist live AAL2/MFA | MFA-beleid tenantgebruikers bepalen; enumeratie, herstel, lockout en providerconfig testen |
| V7 Session Management | Deels | Supabase SSR-cookies en server-side usercontrole | Idle/absolute timeout, rotatie, logout/revocation en cookie-attributen aantoonbaar testen |
| V8 Authorization | Deels | RLS, fonds-ID server-side, host↔fonds fail-closed, capabilities | Directe Storage- en RPC-paden volledig negatief testen; DEFINER-functies en grants reviewen |
| V9 Self-contained Tokens | Deels | JWT-afhandeling primair via Supabase | Claims, audience/issuer, expiratie, keyrotatie en afwijzing gemanipuleerde tokens bewijzen |
| V10 OAuth and OIDC | Te bepalen | Alleen van toepassing op werkelijk ingeschakelde federatieve providers | Providerinventaris en redirect-/state-/nonce-/PKCE-bewijs; anders gemotiveerd N.v.t. |
| V11 Cryptography | Deels | TLS bij providers; HMAC-integriteitszegel voor auditinhoud | Sleutelregister, rotatie, algoritme-/lengtecontrole en secret-lifecycle aantoonbaar maken |
| V12 Secure Communication | Deels | Vercel TLS, HSTS/securityheaders | TLS-/certificaatconfig, interne providerverbindingen en redirect naar HTTPS periodiek toetsen |
| V13 Configuration | Deels | Security-CI, boundarylint, service-role scanner, fail-closed deploymentdetectie | Preview/Productie-secrets isoleren; dependency/SBOM/secretscan; providerconfig als bewijs vastleggen |
| V14 Data Protection | Open/Deels | RLS en Preview zonder Productiedata als doelarchitectuur | Dataclassificatie, bewaartermijnen, export/verwijdering, back-up/restore en logredactie sluiten |
| V15 Secure Coding and Architecture | Deels | Decision records, codegrenzen, dit dreigingsmodel | Security-architectuurreview per wijziging; SAST/SCA en misbruikcases als CI-poorten |
| V16 Security Logging and Error Handling | Deels | Governance-/platformaudit en app-errorregistratie | Securityeventcatalogus, PII-redactie, alarmen, integriteit en atomische audit compleet maken |
| V17 WebRTC | Waarschijnlijk N.v.t. | Geen WebRTC-functionaliteit gevonden | Repo- en runtimecontrole vastleggen; daarna formeel N.v.t. accorderen |

## Technische werkpakketten

### S1 — basis hardening en regressiepoort (uitgevoerd in code)

- service-role-lekscan hersteld en uitvoerbare toegang als criterium genomen;
- `ai.deskresearch` ook server-side afgedwongen vóór live web-retrieval;
- web-whitelist beperkt tot exacte paden en echte padsegmenten;
- tenant enforcement fail-closed voor Production, Preview en Staging;
- CSP: geen `unsafe-eval` buiten development en kleinere `connect-src`;
- AQLab-service-role-reads achter één AAL2/capability/audit-wrapper;
- TypeScript, sanity, boundary-, kleur- en cross-tenant-tests als ondergrens.

Dit pakket verlaagt risico, maar bewijst nog niet alle corresponderende ASVS-
vereisten. Providerinstellingen en runtime-negatieve tests blijven nodig.

### S2 — Preview/Productie-isolatie (eerste operationele prioriteit)

1. Maak één stabiele Vercel Preview-environment/branch voor `app.preview.*` en de
   fondsgerichte hosts `<slug>.preview.bestuurdersportaal.com`.
2. Maak een afzonderlijk Supabase-project of geïsoleerde branch zonder
   Productiedata; deel geen service-role, JWT-secret of storagebucket.
3. Richt daarin een generieke sandboxtenant en per fonds een eigen Preview-tenant
   in; iedere host krijgt exact één actieve `tenant_domains`-rij.
4. Gebruik aparte AI-providerkeys/projecten met harde maand-, fonds- en
   requestlimieten.
5. Zet echte e-mailnotificaties uit of naar een sink; geen Productie-ontvangers.
6. Maak alleen synthetische testdocumenten beschikbaar, gescheiden per Preview-
   tenant. Niet-synthetisch materiaal mag pas na expliciete dataresidentie-/
   providergoedkeuring en een technisch aantoonbare AI-uitsluiting of goedgekeurd
   AI-verwerkingspad.
7. Richt uitnodigingsaccounts in voor precies één Preview-tenant, met MFA waar
   mogelijk en een einddatum.
8. Houd de bestaande Productie-`app.*`-login intact en scheid de Preview-Auth-
   redirects exact van Productie.

**Acceptatiebewijs:** screenshots/exports van scopes zonder secretwaarden, exacte
Auth-redirectlijsten, negatieve login-, cross-fund- en cross-environment-tests,
AI-budgetalert per Preview-tenant, testmail naar sink en aantoonbaar gescheiden
synthetische Preview-datasets.

### S3 — autorisatie en databasegrenzen

1. Inventariseer alle tabellen, views, RPC's, buckets en signed-URL-paden.
2. Test per rol en tenant: toegestaan pad, vreemde tenant, geen sessie, verlopen
   sessie, gemanipuleerd object-ID en directe PostgREST/Storage-aanroep.
3. Review iedere `SECURITY DEFINER`-functie op vaste `search_path`, eigen
   identity-/fondscheck, minimale grants en veilige foutuitvoer.
4. Vervang niet-atomische check-then-write-rate limiting door één atomische DB-
   operatie.
5. Koppel kritieke mutatie en audit-event transactioneel waar dat nog niet zo is.

**Acceptatiebewijs:** volledige objectmatrix, 100% negatieve tests op kritieke
objecten, grant/RLS-export en herhaalbare migratieverificatie.

### S4 — authenticatie, sessies, bestanden en AI

1. Leg tenant-MFA, sessieduur, herstel en revocation vast en test dit live.
2. Behoud de bestaande bestandssignatuur- en decompressielimieten en voeg een
   malware-scan met quarantaine toe vóór extractie/indexering.
3. Behandel opgehaalde webtekst en documenten als onvertrouwde AI-input:
   bronscheiding, toolallowlist, outputvalidatie en exfiltratietests.
4. Voeg per gebruiker én per tenant atomische AI-quotering, modelallowlists,
   timeouts en kostenalarmen toe.
5. Redigeer prompts, documenten, tokens en persoonsgegevens uit logs en errors.

### S5 — sluiting en onafhankelijke verificatie

1. Importeer alle ASVS 5.0.0 L1/L2-regels in het bewijsregister.
2. Vul per regel scope, status, eigenaar, bewijslink en hertestdatum.
3. Laat een onafhankelijke reviewer de bewijslast en configuratie controleren.
4. Voer een gerichte pentest uit op tenant-isolatie, auth, Storage/RPC, uploads,
   AI prompt injection en Preview→Productie.
5. Sluit bevindingen en voer een hertest uit; pas daarna Level 2 communiceren.

## Verplichte CI-poorten

Deze commando's moeten op elke wijziging slagen:

```bash
bash scripts/check-service-role-leak.sh
npm run lint:boundaries
npm run lint:colors
npm run sanity
npm run test:xtenant
npx tsc --noEmit --skipLibCheck
npm run build
```

Aan te vullen in S3/S4: dependency review/SBOM, secret scanning, SAST en tests
tegen een tijdelijke Supabase-omgeving met echte RLS/Storage/RPC-evaluatie.

## Rapportage en definitie van gereed

Per sprint rapporteren we:

- aantal toepasselijke L1/L2-regels;
- `Voldoet`, `Deels`, `Open`, `N.v.t.` en geaccepteerde risico's;
- open Critical/High-risico's uit het dreigingsmodel;
- verlopen of ontbrekend bewijs;
- wijzigingen sinds de vorige meting.

Level 2 is pas gereed als alle toepasselijke regels `Voldoet` zijn, of een
expliciet geaccordeerde en tijdgebonden uitzondering hebben, en er geen open
Critical/High-bevinding uit de onafhankelijke verificatie resteert.

## Bron

- [OWASP ASVS-project en stabiele 5.0.0-release](https://github.com/OWASP/ASVS)
- [OWASP: wat ASVS is en hoe versievaste IDs worden gebruikt](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x03-What-is-the-ASVS.md)
