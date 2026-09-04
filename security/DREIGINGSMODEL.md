# Technisch dreigingsmodel

- **Versie:** 1.0
- **Datum:** 2026-08-14
- **Scope:** Productie, Preview, beheeromgeving, Supabase, Vercel, AI-providers,
  e-mailprovider en documentverwerking
- **Herziening:** bij een nieuwe vertrouwensgrens, provider, authmethode,
  gevoelige gegevenssoort of Critical/High-bevinding

## Te beschermen waarden

- fondsdocumenten, bestuursinformatie en mogelijk gevoelige persoonsgegevens;
- tenant- en rolgrenzen, inclusief individueel stem-/reflectiegedrag;
- accounts, sessies, herstelstromen en MFA-status;
- auditspoor, besluitvorming, afschriften en integriteitszegels;
- Supabase service-role/JWT-secrets, AI- en e-mailproviderkeys;
- AI-budget, modelinstructies en vertrouwelijke prompt-/retrievalcontext;
- beschikbaarheid en reputatie van de Productie- en Preview-domeinen.

## Vertrouwensgrenzen en hoofdstromen

1. browser ↔ Vercel/Next.js;
2. Next.js user-session ↔ Supabase RLS/PostgREST/Storage;
3. server-/workerroute ↔ Supabase service-role;
4. Next.js ↔ Anthropic/OpenAI/Mistral en web-retrieval;
5. Next.js ↔ e-mailprovider;
6. Productie ↔ Preview — **geen datastroom toegestaan**;
7. tenant A ↔ tenant B — alleen gedeelde code/infrastructuur, nooit gedeelde
   autorisatie of dataresultaten;
8. beheeridentiteit ↔ platformdata — afzonderlijke identiteit, live AAL2 en
   expliciete capability vereist.

## Misbruikcases en risicoregister

| ID | Scenario | Impact | Huidige control | Status / eerstvolgende maatregel |
|---|---|---|---|---|
| R-01 | Gebruiker manipuleert host, fonds-ID of object-ID en leest/schrijft bij ander fonds | Kritiek | RLS, server-side fonds-ID, host↔fondscontrole, cross-tenant-tests | Deels — complete PostgREST/Storage/RPC-objectmatrix en negatieve runtimetests |
| R-02 | Service-role-secret komt in clientbundle/log of een service-route mist platformauth | Kritiek | Server-only clients, lekscanner, gescheiden routes, AQLab-wrapper | Deels — alle servicepaden inventariseren; secret rotation en bundle-scan bewijzen |
| R-03 | Preview gebruikt Productiedata, Productiesecrets of Productie-AI-project | Kritiek | Doelarchitectuur verbiedt koppeling | Open tot providercutover — eigen Supabase, storage en providerkeys verplicht |
| R-04 | Productie-login, magic link of callback landt op een `*.preview.*`-host, of andersom | Hoog | Afzonderlijke domeinzones als doelarchitectuur | Open tot inrichting — per omgeving exacte Site URL/redirectallowlist en negatieve callbacktests |
| R-05 | Kwaadaardig document/webresultaat instrueert het model data of secrets te lekken | Hoog | Weballowlist, capabilitygate, bronmarkering en server-side tools | Deels — prompt-injection-evals, strikte toolallowlist, output-/URL-validatie |
| R-06 | Externe Preview-gebruiker jaagt AI-kosten op of misbruikt modellen | Hoog | App-auth en geplande aparte key | Open — user+Preview-tenantquota, providerbudget, concurrencylimiet, alert en account-expiry |
| R-07 | Directe Storage/API-aanroep omzeilt UI-/routeautorisatie | Hoog | RLS en enkele routeguards | Deels — alle buckets/policies/signed URLs en directe aanroepen negatief testen |
| R-08 | `SECURITY DEFINER`-RPC heeft te brede grants, zoekpadinjectie of vertrouwt caller-input | Hoog | Bestaande self-gating patronen en migratietests | Deels — volledige DEFINER/ACL-review en databasegedragstoets |
| R-09 | Parallelle requests omzeilen een check-then-write-rate limit | Hoog | Rate limiting aanwezig | Open — atomische increment/check in Postgres, concurrencytest |
| R-10 | Malware, polyglot of decompression bomb wordt geüpload en verwerkt | Hoog | Type-/grootte-, magic-byte-/OOXML- en decompressiecontrole plus paginacap | Deels — quarantine en malware-scan vóór parser/OCR; alle uploadpaden runtime-testen |
| R-11 | Bedrijfsmutatie slaagt maar audit faalt, of andersom | Hoog | Append-only logs en integriteitszegel op delen | Deels — kritieke mutatie+audit in één transactie/RPC |
| R-12 | Gestolen of oude sessie blijft bruikbaar; MFA is niet breed genoeg | Hoog | Supabase Auth; platform vereist AAL2 | Deels — tenant-MFA-besluit, timeout, revocation en cookie-tests |
| R-13 | Kwetsbare of gecompromitteerde npm/GitHub dependency bereikt Productie | Hoog | Lockfile en huidige testpoorten | Open/Deels — SCA, SBOM, provenance/updatebeleid en branch protection |
| R-14 | XSS via inline script, documentweergave of fouttekst | Hoog | React-escaping en CSP; `unsafe-eval` alleen development | Deels — nonce/hash-CSP, sinkinventaris en browser-XSS-regressietests |
| R-15 | Persoons-/documentinhoud belandt in logs, analytics, AI-telemetrie of e-mail | Hoog | Auditmetadata is op delen inhoudsarm | Deels — logclassificatie/redactie, providerretentie en DPA/config toetsen |
| R-16 | Onbekende host of env-fout schakelt tenantgrens uit | Hoog | Deploymentdetectie dwingt fail-closed af | Gedekt in code; nog runtimebewijs voor elk custom environment bewaren |
| R-17 | Externe Preview-account blijft onbeperkt actief of krijgt beheerrechten | Hoog | Nog in te richten | Open — invite-only, minimale rol, MFA, einddatum en periodieke accountcontrole |
| R-18 | Foutieve DNS/domain-koppeling of dangling domain maakt takeover/phishing mogelijk | Hoog | Vercel domeinvalidatie | Deels — `horizon.*` niet herintroduceren, ongebruikte records verwijderen en periodiek controleren |
| R-19 | Fondsgerichte Preview-host resolveert naar de verkeerde Preview-tenant of een extern account ziet een ander previewfonds | Kritiek | Exacte hostmapping, RLS, host↔fonds fail-closed | Deels — host×account-matrix en directe REST/Storage/RPC-tests voor ieder previewfonds |
| R-20 | Aanvaller koppelt zijn Microsoft-account aan de portaalaccount van een ander, replayt callback/state of wisselt tenant | Kritiek | Bestaande Supabase-sessie, eenmalige 10-minutentransactie, PKCE, nonce, tenant-/audiencevalidatie en exact callbackpad | Deels — Preview-smoke en negatieve route-tests uitvoeren |
| R-21 | Token/cache, code of secret lekt naar browser, log, audit of directe PostgREST-toegang | Kritiek | AES-256-GCM, private schema, minimale database-rol, no-store en inhoudsarme audit | Deels — grantscontrole, ciphertext-tampertest en loginspectie uitvoeren |
| R-22 | Outlook-sync mengt agenda/event van andere tenant, mailbox of kalender, of dupliceert een meeting | Kritiek | Private selectie bindt tenant+mailbox+calendar; immutable event-key; unieke actieve run; server verifieert lijstresultaat | Deels — echte Preview-negatieve test en DB-check uitvoeren |
| R-23 | Delta-run markeert een afspraak onterecht verdwenen of lekt private/Teams/deelnemerdetails | Hoog | Cursor pas na volledige run; `@removed` is overgeslagen; privacyregel en inhoudsarme audit | Deels — Preview-scenariobewijs voor sensitivity, annulering en foutpad |

## AI-specifieke grenzen voor Preview

AI blijft bewust aan op Preview om het echte pad te kunnen testen. Dat is alleen
acceptabel met de volgende cumulatieve controls:

- aparte providerprojecten en keys; nooit Productiekeys kopiëren;
- harde providerbudgetten plus waarschuwingen vóór het maximum;
- applicatiequota per gebruiker én per fondsgerichte Preview-tenant;
- alleen goedgekeurde modellen en tools, met korte timeouts en outputlimieten;
- geen Productiedocumenten; standaard uitsluitend synthetisch testmateriaal.
  Niet-synthetisch materiaal blijft buiten AI/OCR tot dataresidentie, provider en
  technische uitsluiting/verwerking expliciet zijn goedgekeurd;
- web-retrieval alleen met `ai.deskresearch` en de padsegment-whitelist;
- externe accounts krijgen de minimaal benodigde rol en een vervaldatum;
- een extern account is aan precies één Preview-tenant gekoppeld, tenzij een
  expliciete testrol cross-fund-toegang vereist en apart is geaccordeerd;
- prompts/responses niet onbeperkt bij de provider bewaren; instellingen als
  bewijs registreren zonder keywaarden;
- een kill switch om AI in Preview direct uit te zetten zonder Productie te raken.

## Misbruiktests die vóór de cutover groen moeten zijn

1. Productiesessie/cookie/token werkt niet in Preview en omgekeerd.
2. Preview-service-role en AI-key werken niet tegen Productieprojecten.
3. Gebruiker van tenant A krijgt voor elk kritisch object van tenant B een
   consequente weigering, ook via directe REST/Storage/RPC.
4. Iedere `<slug>.preview.*`-host resolveert alleen naar het bedoelde fonds;
   onbekende previewhosts en host-fondsmismatches falen gesloten.
5. Magic links, resetlinks en OAuth-callbacks kunnen alleen naar de exacte eigen
   omgevingshosts.
6. Prompt-injectiedocument kan geen tool buiten de allowlist starten en geen
   andere tenantdata, systeeminstructie of secret laten teruggeven.
7. Parallelle AI/API-requests overschrijden quota niet.
8. Upload met verkeerde magic bytes, malwaretestbestand of excessieve
   decompressieratio wordt vóór extractie geweigerd/geïsoleerd.

## Restrisico en acceptatie

`app.bestuurdersportaal.com` blijft Productie en wordt niet omgezet. Tot R-03 en
R-04 aantoonbaar dicht zijn, krijgen externen geen Preview-toegang. Tot R-01,
R-02, R-07 en R-08 volledig zijn getest, is er
geen basis voor een ASVS Level 2-claim. Tijdelijke uitzonderingen vermelden
minimaal eigenaar, zakelijke reden, compensatie, einddatum en hertestmoment.
