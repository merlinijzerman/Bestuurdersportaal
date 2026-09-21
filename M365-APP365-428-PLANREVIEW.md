# #428 — Planreview M365-demo op `app365.bestuurdersportaal.com`

**Status:** ter akkoord; uitsluitend analyse en ontwerp.  
**Basis:** `origin/preview` op `b3961ba` (bevat T4-C via #424).  
**Datum:** 2026-09-21.  
**Nog niet uitgevoerd:** DNS, Vercel, Supabase, Auth, Entra, SharePoint,
integratieregistry, accounts, featureflags en live Retrieval.

## 0. Besluit in één oogopslag

De aanbevolen basisinrichting is een **zelfstandig logisch demo-fonds in de
bestaande Productie-stack**, op de normale `preview` → `main`-releaseweg. Een
volledig aparte Vercel-/Supabase-stack is voor de basisinrichting niet nodig.

Dit besluit geldt alleen onder deze harde grenzen:

1. uitsluitend synthetische data;
2. eigen host, accounts, branding en configuratie; geen PGB-alias of -kopie;
3. Supabase-login blijft bij de start leidend en Microsoft-login staat `uit`;
4. alle Microsoft-, Copilot- en retrievalpoorten staan expliciet dicht;
5. geen live Copilot-call, billingwijziging, consent of nieuwe permission tijdens
   de basisinrichting;
6. de latere Copilot-tokenbron kan tenant, app en credential **fondsgebonden**
   injecteren zonder een bestaand fonds om te configureren.

Punt 6 is een herbeoordelingspoort. T4-D legt vast dat de productieroute een
confidential-clientconnector gebruikt en dat het huidige public-client-labprofiel
alleen voor de smokerunner is. Als de uiteindelijke implementatie alleen globale
Vercel-credentials ondersteunt, mag de lab-app niet als globale vervanging worden
ingesteld: dan is minimaal een afzonderlijke Vercel-runtime nodig, of eerst een
fondsgebonden credentialontwerp. Een aparte Supabase-stack volgt pas als ook de
data-/Auth-grens dat vereist. Deze poort blokkeert **Copilot-activering**, niet de
inerte basisinrichting.

## 1. Bewijsbasis en geselecteerde context

De centrale integratieregistry is leidend. Voor deze review zijn uitsluitend de
relevante collecties gelezen; er is niets in gewijzigd.

| Onderdeel | Bestaande registry-id | Gebruik in #428 |
|---|---|---|
| Portaalomgeving | `portal_production` | doel van de uiteindelijke logische tenant |
| Releasevoorportaal | `portal_preview` | Preview-eerst code- en migratierepetitie |
| Microsoftomgeving | `microsoft_lab` | enige toegestane M365-omgeving |
| Entra-tenant | `entra_bestuurdersportaal_lab` | enige toegestane tenant |
| Bestaande app | `entra_app_copilot_retrieval_lab` | **niet** hergebruiken voor de productieroute; public client/PKCE, smokerunner |
| Bestaande identiteit | `m365_lab_pgb_test` | **niet** hergebruiken; PGB-identiteit is geen app365-bewijs |
| Bestaande bron | `sharepoint_pgb_retrieval_lab` | **niet** hergebruiken; PGB-root is geen app365-bron |

Nieuwe voorgestelde ids worden pas na de werkelijk uitgevoerde, duurzame
inrichting aan de registry toegevoegd:

- portalidentiteiten: `production_app365_demo_beheerder` en
  `production_app365_demo_bestuurder`;
- Entra-identiteit: `m365_lab_app365_demo`;
- appregistratie voor de productieroute:
  `entra_app_portal_copilot_app365`;
- bron: `sharepoint_app365_demo_retrieval_lab`;
- retrievalprofiel: `app365_m365_demo_copilot`.

De bestaande `m365_lab_pgb_test` mag hooguit als tenantbeheerbewijs dienen bij
de voorbereiding van een nieuwe identiteit, nooit als app365-actor, tokenbron of
acceptatiebewijs.

## 2. Isolatiereview: logisch fonds of aparte stack

`security/OMGEVINGEN-RUNBOOK.md` noemt vijf triggers voor een fysieke stack per
fonds. De beoordeling voor de veilige beginstand is:

| Isolatietrigger | Beginstand #428 | Oordeel |
|---|---|---|
| echte/niet-volledig synthetische data | verboden | geen fysieke stack nodig |
| eigen identity-provider of afwijkende Auth-config | Microsoft-login `uit`; Supabase Auth blijft leidend | geen trigger voor de basis; opnieuw beoordelen vóór Microsoft-login |
| fonds-eigen secrets of netwerkallowlists | geen Microsoftsecret in de basis; latere productietokenbron moet fondsgebonden zijn | activeringsblokker, nog geen stacktrigger |
| contractuele database-/storage-isolatie | niet van toepassing op een interne demo | geen fysieke stack nodig |
| destructieve migratie-, load- of hersteltests | verboden op app365; alleen ephemere test-DB | geen fysieke stack nodig |

### Besluit D-1

Richt `app365` in als logische tenant in `portal_production`. Maak niet alvast een
tweede Vercel-/Supabase-stack “voor de zekerheid”: dat verdubbelt migratie- en
releasebeheer zonder dat een actuele trigger dat rechtvaardigt.

### Harde herbeoordelingspoorten

Stop vóór de betreffende stap en heropen D-1 als één van deze condities ontstaat:

- Microsoft-login moet voor app365 naar een andere Entra-tenant/appregistratie
  dan de rest van dezelfde Vercel-runtime;
- de Copilot-productietokenbron kan app-/tenant-/secretconfig niet fondsgebonden
  en fail-closed injecteren;
- niet-synthetische data wordt voorgesteld;
- destructieve, load- of restoretests zijn nodig;
- contractuele of providergebonden isolatie wordt vereist;
- app365 heeft een eigen service-role, JWT-secret, Storage-grens of
  netwerkallowlist nodig.

Een trigger betekent niet automatisch “volledig nieuwe stack”: bepaal eerst de
kleinste veilige fysieke grens. Een credentialprobleem kan bijvoorbeeld een
aparte Vercel-runtime vereisen zonder meteen een tweede Supabase-project.

## 3. Tenantidentiteit, host en branding

### Besluit D-2

| Veld | Waarde |
|---|---|
| fondsnaam | `Bestuurdersportaal M365 Demo` |
| stabiele slug | `m365-demo` |
| Productiehost | `app365.bestuurdersportaal.com` |
| Preview-repetitie | dezelfde migratie tegen ephemere DB; geen tweede blijvende demo-identiteit zonder apart akkoord |
| logoletter | `D` |
| palet | generiek basispalet; geen klantkleur of -logo |
| vaste markering | `DEMO · GEEN KLANTOMGEVING` |

Het fonds wordt additief gemaakt en via slug opgelost. Geen UUID komt in Git.
De host krijgt exact één actieve `tenant_domains`-rij. `on conflict do nothing`
is onvoldoende als enige bescherming: de migratie controleert vóór de insert dat
een bestaande host niet naar een ander fonds wijst en controleert erna exact
`host → m365-demo, actief=true`.

De demo-indicatie is geen gewone, door een fondsbeheerder uitschakelbare
featureflag. De code krijgt een kleine pure allowlist voor de permanente host
`app365.bestuurdersportaal.com`, gebruikt door de root-layout, metadata, robots
en tests. Daardoor is de markering niet afhankelijk van `VERCEL_ENV`, een
database-read na login of een tenantconfiguratie die de demo zelf kan uitzetten.
De Preview-markering blijft daarnaast ongewijzigd bestaan op Preview-deployments.

## 4. Vercel, DNS en Supabase Auth

### Besluit D-3 — Vercel

- Project: bestaand Vercel-project `bestuurdersportaal`.
- Environment: **Production**, branch tracking via `main`.
- Domein: als native Production-domain aan het project koppelen.
- Verboden: `vercel alias` of een handmatige koppeling aan één deployment.
- `APP_HOST`: voeg exact `app365.bestuurdersportaal.com` toe aan de bestaande
  komma-lijst; laat alle bestaande hosts bytegelijk staan.
- DNS wordt pas toegevoegd nadat Vercel het domein claimt en de verwachte
  recordvorm toont. Controleer vóór publicatie op bestaande/dangling binding.

Een succesvolle `main`-deploy promoveert daarna automatisch alle Production-
domains, inclusief app365. Dit houdt app365 op dezelfde releaseversie als de
andere logische Productietenants.

### Besluit D-4 — Supabase en Auth

- Supabase-context: `portal_production`; geen nieuw project in de basis.
- Site URL blijft de bestaande Productiefallback; app365 wordt geen algemene
  loginhub.
- Voeg alleen de callbacks toe die de bestaande Supabase-flow werkelijk nodig
  heeft op `https://app365.bestuurdersportaal.com`.
- Geen wildcard voor `*.bestuurdersportaal.com`.
- Microsoft-callback
  `/auth/microsoft-login/callback` wordt **niet** toegevoegd tijdens de basis.
- Demoaccounts hebben ieder exact één profiel op `m365-demo`, minimale rol en
  geen PGB-/Horizonlidmaatschap.

Voorgestelde accounts:

| Registry-id | Portaalrol | Gebruik |
|---|---|---|
| `production_app365_demo_beheerder` | `beheerder` | inrichting en beheercontroles |
| `production_app365_demo_bestuurder` | `bestuurder` | normale gebruikerssmoke |

Concrete adressen en secretrefs worden tijdens provisioning gekozen. Wachtwoord,
MFA-materiaal en recoverycodes komen nooit in Git, issue, registry of bewijs.

## 5. Permanente markering en indexering

### Besluit D-5

De exacte app365-host krijgt applicatiebreed:

- een vaste badge `DEMO · GEEN KLANTOMGEVING`, ook op login-, fout- en lege
  toestanden;
- metadata `robots: { index: false, follow: false }`;
- `robots.txt` met `Disallow: /`;
- een lege sitemap, zoals voor de overige app-surfaces;
- geen canonical naar marketing of naar een bestaande fondshost.

De huidige `robots.ts` sluit app-surfaces al uit en `sitemap.ts` geeft daar een
lege lijst. De ontbrekende bewijslast is de expliciete `nofollow`-metadata en de
permanente demobadge. Beide krijgen hostmatrixtests. De bestaande
`PREVIEW · GEEN PRODUCTIEOMGEVING`-badge blijft uitsluitend lifecycle-informatie
en wordt niet gebruikt als demoherkenning.

## 6. Expliciete veilige beginmatrix

Ontbrekende rijen zijn voor app365 niet acceptabel wanneer code een env-fallback
kent. De provisioningmigratie schrijft iedere onderstaande waarde expliciet als
JSON-boolean of getal, zodat globale env-defaults de demo niet kunnen activeren.
Alle writes lopen via de bestaande configtabellen en het append-only
`fonds_config_log`-spoor.

### Modules

Alle manifestbeheerbare modules beginnen uit totdat er een afzonderlijk
vastgelegde synthetische fixture voor bestaat:

| Module | Beginstand |
|---|---:|
| `stuurinformatie` | `false` |
| `klantbeeld` | `false` |
| `ai` | `false` |
| `bibliotheek` | `false` |
| `vergaderingen` | `false` |
| `notulen` | `false` |
| `procedures` | `false` |
| `risicomatrix` | `false` |

`home`, `beheer`, `governance` en `assurance` blijven de niet-beheerbare
kernmodules uit de code-registry. `stemmingen` blijft productbreed uit.

### Fondsflags

| Flag | Beginwaarde | Reden |
|---|---:|---|
| `microsoft_copilot_retrieval` | `false` | fondsrollout dicht |
| `microsoft_sharepoint_retrieval_spike` | `false` | spikepad nooit productieroute |
| `microsoft_sharepoint_fase3` | `false` | geen SharePoint-connector in de basis |
| `microsoft_outlook_fase2a` | `false` | buiten scope |
| `hybride_zoeken` | `false` | geen env-fallback |
| `rerank` | `false` | geen providercall |
| `relevantie_drempel` | `false` | retrieval uit |
| `relevantie_drempel_waarde` | `20` | huidige codebaseline expliciet vastgelegd |
| `jargon_expansie` | `false` | retrieval uit |
| `parent_retrieval` | `false` | retrieval uit |
| `representatie_constraints` | `true` | guardrail staat al klaar vóór eventuele activering |
| `regime_weging` | `true` | veilige bestaande toepasselijkheidsbaseline |
| `vraagrouter_v2` | `false` | hoofdvlag uit |
| `vraagrouter_model` | `false` | afhankelijke vlag expliciet uit |
| `volledige_analyse_vervolg` | `false` | afhankelijke vlag expliciet uit |
| `retrieval_timeout_ms` | `20000` | huidige veilige codebaseline, inert zolang retrieval uit staat |

### Microsoft-login en globale Copilotpoorten

- `fonds_microsoft_login.modus='uit'` en `actief=false`;
- geen Entra-tenant-id op de loginconfig tijdens de basis;
- globale Copilot-rollout ontbreekt of staat `false`;
- geen billingbewijs voor app365;
- geen app365-verbinding/token-cache;
- geen consent, herconsent of scope-uitbreiding.

Alleen JSON-boolean `true` mag een booleanfondsflag openen. De databasecheck
verifieert daarom ook `jsonb_typeof(waarde)='boolean'`; de tekenreeks `"true"`
telt niet.

## 7. Microsoft- en SharePoint-doelontwerp

### Besluit D-6 — eigen actor, app en bron

De latere context bestaat uit één gesloten keten:

`m365-demo` → `m365_lab_app365_demo` →
`entra_app_portal_copilot_app365` →
`sharepoint_app365_demo_retrieval_lab` →
`app365_m365_demo_copilot`.

Voorgestelde SharePoint-root:

`https://bestuurdersportaaltest.sharepoint.com/sites/App365Demo/Gedeelde documenten/Retrieval`

Een eigen sitecollection heeft de voorkeur boven een map onder
`PGBRetrievalLab`: de bronroot, permissies, indexstatus en rollback zijn dan
zichtbaar onafhankelijk. Alleen gepinde synthetische fixtures mogen erin.

De productieroute hergebruikt niet `entra_app_copilot_retrieval_lab`, omdat die
volgens de registry en T4-D een `public_client_pkce`-profiel voor de smokerunner
is. De nieuwe appregistratie moet het door T4-D vereiste
`confidential_client_secret`-model volgen, met uitsluitend de na T4-D/E/F
goedgekeurde delegated scopes. De concrete redirect-URI, permission en consent
worden pas in de latere activeringstranche vastgelegd.

Vóór een Retrieval-call worden read-only bewezen:

1. exacte tenant, actor, client-id en bronroot;
2. fixturemanifest versus aanwezige bestanden;
3. SharePoint-indexcanaries;
4. geen PGB-root, PGB-actor of PGB-token in het profiel;
5. billing-/licentiestatus en kostenplafond;
6. fondsflag en globale kill switch nog dicht.

## 8. Afhankelijkheden en wat nu al inert kan

| Onderdeel | Actuele stand 2026-09-21 | Gevolg voor #428 |
|---|---|---|
| #423 / PR #425, T4-D | open; niet gemerged; rollbackcorrecties op de branch | basis mag worden voorbereid, geen migratie/activatie uit #423 toepassen vóór merge en gecombineerde review |
| #426 / PR #427, T4-E | alleen planreview; vijf blokkerende bevindingen; geen productiecode | geen aansluiting op chat/zoeken |
| T4-F | nog geen zelfstandig ticket gevonden; beheer/status/audit/kostenbewaking apart | harde activeringsblokker |
| registry-indexstatus | labbronnen stonden op 2026-09-20 nog op nul resultaten | geen live smoke tot eigen app365-canaries gereed zijn |

Nu al mogelijk ná akkoord op deze review:

- repositorywijzigingen voor permanente badge/noindex, hosttests en runbook;
- additieve provisioningmigratie, rollback en self-check;
- hermetische/ephemere DB-tests;
- expliciete inerte fondsconfiguratie.

Niet mogelijk zonder nieuwe activeringsgoedkeuring:

- Entra-app/permission/consent;
- Microsoft-login activeren;
- billingbewijs zetten;
- globale rollout openen;
- fondsflag `microsoft_copilot_retrieval=true`;
- token aanvragen of live Copilot Retrieval aanroepen.

## 9. Implementatie- en uitrolvolgorde

Elke fase heeft een afzonderlijk stopmoment. Een latere fase mag pas beginnen
nadat het bewijs van de vorige is beoordeeld.

### Fase 0 — planreview

1. Deze review goedkeuren of wijzigen.
2. D-1 opnieuw toetsen als de scope verandert.
3. Geen provider- of databasemutatie.

### Fase 1 — repository, nog inert

1. Migratie voor fonds, theming, expliciet modulemanifest en flags.
2. Afzonderlijke hostmigratie met precondition, postcondition en rollback.
3. Permanente hostgedreven demobadge en `noindex,nofollow`.
4. Host-, module-, flag-, rollback- en cross-tenanttests.
5. Runbook en providerchecklist.
6. Typecheck, boundaries, secretscan, securitybaseline, volledige cross-tenant/
   DB-laag, karakterisering, E2E en productiebuild.

### Fase 2 — Preview-eerst bewijs

1. Nieuwe migraties in een ephemere Supabase-DB toepassen.
2. De hostmatrix met een geïnjecteerde app365-host testen.
3. Rollback op een verse seed bewijzen.
4. Branch via `preview` laten deployen; geen Production-domain koppelen.
5. Bestaande Preview- en Productiehostcontracten regressietesten.

### Fase 3 — basisinrichting Productie, Copilot nog uit

1. Voorafbewijs van bestaande host-, Auth- en fondsconfig vastleggen.
2. Provisioningmigratie toepassen en self-check uitvoeren.
3. Exacte Supabase Auth-redirect(s) toevoegen.
4. Demoaccounts met één fondsprofiel provisionen.
5. `APP_HOST` uitbreiden en via `main` deployen.
6. Vercel Production-domain native koppelen; daarna DNS en TLS controleren.
7. Login/logout/reset/harde reload, badge en noindex smoken.
8. Bewijzen: nul Microsoft-tokenaanvragen en nul Copilot-netwerkcalls.
9. Registry nog niet uitbreiden met Microsoftobjecten die niet bestaan.

### Fase 4 — Microsoftobjecten, nog steeds inert

Pas na een apart akkoord:

1. eigen Entra-identiteit;
2. eigen confidential-clientapp volgens de definitieve T4-D/E-contracten;
3. eigen SharePoint-site/root en synthetisch fixturemanifest;
4. read-only indexcontrole;
5. registryobjecten en profiel toevoegen, status nog `inactive`/geblokkeerd;
6. `node scripts/validate-registry.mjs` groen.

### Fase 5 — één begrensde smoke

Alleen als #423 en #426 gemerged en gedeployed zijn, T4-F gereed is, de
gecombineerde review groen is en billing/consent/kostenplafond apart zijn
goedgekeurd. Volgorde:

1. configuratie- en registrybewijs;
2. fondsgebonden verbinding/herconsent;
3. billingbewijs;
4. uitsluitend app365-fondsflag aan;
5. globale rollout kort open;
6. één vaste synthetische smoke;
7. globale rollout onmiddellijk dicht;
8. app365-fondsflag terug naar `false`, tenzij blijvende activering apart is
   goedgekeurd.

## 10. Rollbackontwerp

Rollback is **disable-first** en raakt geen ander fonds.

1. globale Copilot-rollout dicht;
2. app365 Microsoft-/Copilotfondsflags expliciet `false`;
3. Microsoftverbinding intrekken/ontkoppelen en token-cache onbruikbaar maken;
4. app365-accounttoegang blokkeren;
5. Vercel-domain loskoppelen, daarna DNS verwijderen;
6. app365 uit `APP_HOST` en exacte Auth-redirects verwijderen via de normale
   releaseweg;
7. `tenant_domains`-rij deactiveren/verwijderen;
8. fondsconfiguratie terugschrijven als nieuwe, geaudite versie;
9. het fonds alleen fysiek verwijderen wanneer harde prechecks bewijzen dat er
   geen profielen, documenten, Storage-objecten of domeinaudit aan hangen.

Append-only auditlogs worden nooit door rollback verwijderd. Zodra het fonds is
gebruikt, is “tenant uitschakelen en behouden” de standaard; cascade-delete is
dan geen normale rollback.

## 11. Verificatiematrix

### Host en identiteit

- `app365.bestuurdersportaal.com` resolveert exact naar `m365-demo`;
- onbekende, verkeerd gespelde en `www.`-varianten zijn niet stil toegestaan;
- PGB-, Horizon-, PH&C- en Huisartsenbindings zijn ongewijzigd;
- PGB-/Horizonaccount op app365 wordt fail-closed geweigerd;
- app365-account op elke andere fondshost wordt fail-closed geweigerd.

### RLS en data

- app365 kan geen andere fondsdata, config, Storage, audit of retrievalbron lezen;
- andere fondsen kunnen geen app365-data lezen;
- service-role verschijnt niet in fonds- of retrievalroutes;
- fixtures zijn aantoonbaar synthetisch en manifest-gepind.

### Inerte Microsoftstand

- alle fondsflags exact van type boolean en `false` waar vereist;
- globale rollout afwezig/dicht;
- Microsoft-loginmodus `uit`;
- tellende stubs bewijzen 0 token- en 0 Retrieval-calls;
- readiness meldt alleen inhoudsvrije toestand.

### UX en SEO

- badge op login, dashboard, foutpagina en harde reload;
- metadata `noindex,nofollow`;
- `robots.txt` sluit alles uit;
- sitemap bevat app365 niet;
- geen echte e-mail/notificatie.

### Release en rollback

- app365 is een Production-domain, niet een deploymentalias;
- branch tracking wijst naar `main`;
- TLS geldig en geen dangling binding;
- rollback verwijdert alleen app365-bindingen;
- volledige repositorygate groen.

## 12. Goedkeuringspunt

Akkoord op deze planreview autoriseert uitsluitend **Fase 1 en Fase 2**:
repositorywijzigingen en hermetisch/ephemeer bewijs. Fase 3 bevat Production-
database- en providerwijzigingen en vereist daarna een afzonderlijk
uitvoeringsakkoord op het concrete migratie-, provider- en rollbackpakket.

De review keurt uitdrukkelijk nog niet goed: een aparte stack, Microsoftobjecten,
permissions, consent, billing, live tokens, Copilot-calls of blijvende
Copilot-activering.
