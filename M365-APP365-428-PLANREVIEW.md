# #428 — Planreview M365-demo op `app365.bestuurdersportaal.com`

**Status:** versie 2 ter akkoord; uitsluitend analyse en ontwerp.
**Basis:** `origin/preview` op `b3961ba` (bevat T4-C via #424).  
**Datum:** 2026-09-21.  
**Nog niet uitgevoerd:** DNS, Vercel, Supabase, Auth, Entra, SharePoint,
integratieregistry, accounts, featureflags en live Retrieval.

**Verwerkt in versie 2:** een blijvende Preview-acceptatietenant, exacte
tenant-/apphostnormalisatie, environment-specifieke provisioning, eigenaar,
herbeoordelingsdatum, kostenlimiet en `generatie_timeout_ms`.

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

De Productietenant krijgt vóór livegang een blijvende tegenhanger op
`app365.preview.bestuurdersportaal.com`. Die gebruikt dezelfde slug en expliciete
configuratie in de geïsoleerde `portal_preview`-database, maar eigen Preview-
accounts en uitsluitend synthetische data. Hostrouting, login, badge, metadata en
harde reload worden daardoor eerst op de echte `preview-stable`-deployment getest.

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
| Releasevoorportaal | `portal_preview` | blijvende app365-acceptatietenant op `preview-stable` |
| Microsoftomgeving | `microsoft_lab` | enige toegestane M365-omgeving |
| Entra-tenant | `entra_bestuurdersportaal_lab` | enige toegestane tenant |
| Bestaande app | `entra_app_copilot_retrieval_lab` | **niet** hergebruiken voor de productieroute; public client/PKCE, smokerunner |
| Bestaande identiteit | `m365_lab_pgb_test` | **niet** hergebruiken; PGB-identiteit is geen app365-bewijs |
| Bestaande bron | `sharepoint_pgb_retrieval_lab` | **niet** hergebruiken; PGB-root is geen app365-bron |

Nieuwe voorgestelde ids worden per omgeving pas na de werkelijk uitgevoerde,
duurzame inrichting aan de registry toegevoegd:

- Previewportalidentiteiten: `preview_app365_demo_beheerder` en
  `preview_app365_demo_bestuurder`;
- Productieportalidentiteiten: `production_app365_demo_beheerder` en
  `production_app365_demo_bestuurder`;
- Entra-identiteit: `m365_lab_app365_demo`;
- appregistratie voor de productieroute:
  `entra_app_portal_copilot_app365`;
- bron: `sharepoint_app365_demo_retrieval_lab`;
- retrievalprofiel: `app365_m365_demo_copilot`.

De bestaande `m365_lab_pgb_test` mag hooguit als tenantbeheerbewijs dienen bij
de voorbereiding van een nieuwe identiteit, nooit als app365-actor, tokenbron of
acceptatiebewijs.

## 1.1 Eigenaarschap, herbeoordeling en kosten

| Onderwerp | Besluit |
|---|---|
| operationeel eigenaar | Merlin IJzerman |
| eerstvolgende herbeoordeling | 2026-12-21; daarna minimaal ieder kwartaal |
| maandelijkse kostenlimiet | EUR 100 exclusief btw per kalendermaand voor alle app365-specifieke Microsoft-licenties en variabele Copilot/Retrieval-kosten samen |
| signalering | waarschuwing op 50% en 80%; blokkade/kill switch uiterlijk op 100% |
| bij ontbrekend hard providerplafond | T4-F moet de 100%-grens operationeel afdwingen; tot die bewaking bewezen is blijft Copilot uit |

Een vaste licentie of minimale contractverplichting die de limiet overschrijdt,
vereist vooraf een gewijzigd kostenbesluit. Op de herbeoordelingsdatum is de
fail-closed standaard: Copilot blijft of gaat uit totdat eigenaar, bron, accounts,
permissions, indexstatus en kosten opnieuw zijn bevestigd.

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
| Previewhost | `app365.preview.bestuurdersportaal.com` |
| Previewcontext | `portal_preview`, Vercel `preview-stable`, branch `preview` |
| logoletter | `D` |
| palet | generiek basispalet; geen klantkleur of -logo |
| vaste markering | `DEMO · GEEN KLANTOMGEVING` |

Het fonds wordt additief en identiek geconfigureerd in beide geïsoleerde
Supabase-projecten en via slug opgelost. Geen UUID komt in Git. Iedere omgeving
krijgt via haar eigen provisioning exact één actieve `tenant_domains`-rij.
`on conflict do nothing` is onvoldoende als enige bescherming: elk script
controleert vóór de insert dat de host niet naar een ander fonds wijst en
controleert erna exact de omgevingseigen `host → m365-demo, actief=true`-binding.

De demo-indicatie is geen gewone, door een fondsbeheerder uitschakelbare
featureflag. De code krijgt een kleine pure allowlist voor de permanente host
`app365.bestuurdersportaal.com` en de acceptatiehost
`app365.preview.bestuurdersportaal.com`, gebruikt door de root-layout, metadata,
robots en tests. Daardoor is de markering niet afhankelijk van `VERCEL_ENV`, een
database-read na login of een tenantconfiguratie die de demo zelf kan uitzetten.
Op de Previewhost zijn zowel `DEMO · GEEN KLANTOMGEVING` als
`PREVIEW · GEEN PRODUCTIEOMGEVING` zichtbaar, zonder visuele overlap.

## 4. Vercel, DNS en Supabase Auth

### Besluit D-3 — Vercel

Beide hosts horen als native domain bij een Vercel-environment, nooit bij één
deployment:

| Host | Vercel-environment | Branch tracking | Portaalcontext |
|---|---|---|---|
| `app365.preview.bestuurdersportaal.com` | `preview-stable` | exact `preview` | `portal_preview` |
| `app365.bestuurdersportaal.com` | Production | `main` | `portal_production` |

- Project: bestaand Vercel-project `bestuurdersportaal`.
- Verboden: `vercel alias` of een handmatige koppeling aan één deployment.
- Preview-`APP_HOST`: voeg exact `app365.preview.bestuurdersportaal.com` toe.
- Production-`APP_HOST`: voeg exact `app365.bestuurdersportaal.com` toe.
- Laat alle bestaande hosts in de betreffende omgeving bytegelijk staan.
- DNS wordt per omgeving pas toegevoegd nadat Vercel het domein claimt en de
  verwachte recordvorm toont. Controleer vóór publicatie op een bestaande of
  dangling binding.

Een succesvolle deploy van `preview` promoveert eerst de Previewhost. Productie
wordt pas voorbereid nadat de volledige Preview-acceptatiematrix groen is. Een
latere succesvolle `main`-deploy promoveert vervolgens de Production-host samen
met de andere logische Productietenants.

### Besluit D-4 — Supabase en Auth

- Supabase-contexten: eerst `portal_preview`, na acceptatie
  `portal_production`; geen nieuw project in de basis.
- Site URL blijft per context de bestaande fallback; app365 wordt geen algemene
  loginhub.
- Voeg per omgeving alleen de callbacks toe die de bestaande Supabase-flow
  werkelijk nodig heeft op de eigen exacte app365-host.
- Geen wildcard voor `*.bestuurdersportaal.com`.
- Microsoft-callback
  `/auth/microsoft-login/callback` wordt **niet** toegevoegd tijdens de basis.
- Demoaccounts hebben ieder exact één profiel op `m365-demo`, minimale rol en
  geen PGB-/Horizonlidmaatschap.

Voorgestelde accounts:

| Registry-id | Portaalrol | Gebruik |
|---|---|---|
| `preview_app365_demo_beheerder` | `beheerder` | Preview-inrichting en beheercontroles |
| `preview_app365_demo_bestuurder` | `bestuurder` | Preview-gebruikers- en cross-hostsmoke |
| `production_app365_demo_beheerder` | `beheerder` | inrichting en beheercontroles |
| `production_app365_demo_bestuurder` | `bestuurder` | normale gebruikerssmoke |

Preview- en Productieaccounts zijn verschillende Auth-identiteiten en delen geen
lidmaatschap. Concrete adressen en secretrefs worden tijdens provisioning
gekozen. Wachtwoord, MFA-materiaal en recoverycodes komen nooit in Git, issue,
registry of bewijs.

### Besluit D-4a — exacte app-/tenanthosts, alleen marketing canonicaliseert `www`

De huidige gedeelde `normaliseerHost()` verwijdert altijd een leidende `www.`.
Daardoor kan `www.app365.bestuurdersportaal.com` nu dezelfde tenantbinding krijgen
als de exacte host zodra het verzoek de deployment bereikt. Dat is strijdig met
de vereiste exacte hostbinding en wordt vóór app365-provisioning gecorrigeerd.

De pure hostlogica wordt gesplitst:

- `normaliseerExacteHost`: trim, lowercase en poort verwijderen; laat alle
  DNS-labels, inclusief `www.`, intact;
- `normaliseerMarketingHost`: gebruikt de exacte normalisatie en canonicaliseert
  daarna uitsluitend voor de marketing-surface één leidende `www.`;
- `APP_HOST`, `PLATFORM_HOST`, `tenant_domains`, de tenant-RPC en de demohost-
  allowlist gebruiken uitsluitend `normaliseerExacteHost`;
- `MARKETING_HOST` en de marketingroute blijven apex/`www` samenvoegen;
- CSRF-/origincontroles blijven per surface expliciet: apphosts exact,
  marketing-apex en `www` alleen waar beide bewust in de marketingallowlist staan;
- de strengere `canoniekeFondsHost()` van Microsoft-login blijft exact en wordt
  niet versoepeld.

De fail-safe app-surface voor onbekende hosts blijft bestaan als routinglaag,
maar levert geen fondscontext op: de exacte tenantresolver classificeert
`www.<tenant-host>` als `onbekend`, waarna `TENANT_ENFORCE` de toegang blokkeert.

Regressiebewijs omvat alle bestaande exacte Preview- en Productiehosts, lokale
host-met-poortgevallen, marketing-apex/`www`, en negatieve `www.`-varianten van
app-, platform- en tenant-hosts. De bestaande test die `www.horizon.nl` naar
Horizon laat resolven wordt bewust omgekeerd naar `onbekend`; dit is de enige
beoogde gedragswijziging voor tenantnormalisatie.

## 5. Permanente markering en indexering

### Besluit D-5

Beide exacte app365-hosts krijgen applicatiebreed:

- een vaste badge `DEMO · GEEN KLANTOMGEVING`, ook op login-, fout- en lege
  toestanden;
- metadata `robots: { index: false, follow: false }`;
- `robots.txt` met `Disallow: /`;
- een lege sitemap, zoals voor de overige app-surfaces;
- geen canonical naar marketing of naar een bestaande fondshost.

De huidige `robots.ts` sluit app-surfaces al uit en `sitemap.ts` geeft daar een
lege lijst. De ontbrekende bewijslast is de expliciete `nofollow`-metadata en de
permanente demobadge op beide hosts. Beide krijgen hostmatrixtests. De bestaande
`PREVIEW · GEEN PRODUCTIEOMGEVING`-badge blijft uitsluitend lifecycle-informatie
en wordt niet gebruikt als demoherkenning.

## 6. Expliciete veilige beginmatrix

Ontbrekende rijen zijn voor app365 niet acceptabel wanneer code een env-fallback
kent. De gedeelde fonds-/configmigratie schrijft iedere onderstaande waarde
expliciet als JSON-boolean of getal in zowel Preview als Productie, zodat globale
env-defaults de demo niet kunnen activeren. Alle writes lopen via de bestaande
configtabellen en het append-only `fonds_config_log`-spoor. Hosts en overige
omgevingsdata staan nadrukkelijk niet in deze migratie; zie §9.

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
| `generatie_timeout_ms` | `120000` | huidige veilige generatiebaseline expliciet vastgelegd |

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
- gedeelde additieve fonds-/configmigratie zonder omgevingsdata;
- afzonderlijke Preview- en Productieprovisioning met elk een rollback en
  self-check;
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

### Artefactgrens: schema/config gedeeld, omgevingsdata gescheiden

De normale migratieketen bevat uitsluitend omgevingneutrale, additieve data:

- `supabase/migrations/2026_09_22_428_app365_demo_fonds_config.sql`:
  fonds `m365-demo`, neutrale theming, volledig modulemanifest, volledige
  flagmatrix en Microsoft-loginstand `uit`;
- `supabase/rollbacks/2026_09_22_428_app365_demo_fonds_config_ROLLBACK.sql`:
  weigert zolang een host, profiel, document, Storage- of andere tenantafhankelijkheid
  bestaat; verwijdert nooit auditlogs.

De gedeelde migratie bevat **geen** host, projectref, account, callback, domain of
andere Preview-/Productiewaarde. Omgevingsdata wordt per omgeving geprovisioned:

| Omgeving | Provisioning | Self-check | Rollback |
|---|---|---|---|
| `portal_preview` | `supabase/seeds/preview/2026_09_22_428_app365_preview_provision.sql` | `supabase/seeds/preview/2026_09_22_428_app365_preview_CHECK.sql` | `supabase/rollbacks/2026_09_22_428_app365_preview_ROLLBACK.sql` |
| `portal_production` | `supabase/seeds/production/2026_09_22_428_app365_production_provision.sql` | `supabase/seeds/production/2026_09_22_428_app365_production_CHECK.sql` | `supabase/rollbacks/2026_09_22_428_app365_production_ROLLBACK.sql` |

Een kleine runner controleert vóór de eerste databasehandeling twee onafhankelijke
bewijzen: `SEED_DOELOMGEVING` en de allowlisted Supabase-projectref uit de doel-URL.
Het SQL-pakket zelf controleert daarnaast een omgevingseigen fingerprint:

- Preview vereist de bekende `*.preview.bestuurdersportaal.com`-bindings en
  weigert als een Production-host in `tenant_domains` staat;
- Productie vereist de bestaande Productiebindings en weigert als een
  `*.preview.bestuurdersportaal.com`-host aanwezig is.

Elk provisioningscript weigert bij een bestaande verkeerde app365-binding,
schrijft uitsluitend zijn eigen exacte host en bewijst na afloop één actieve rij
naar `m365-demo`. De self-check verifieert ook de volledige flagmatrix,
Microsoft-login `uit`, afwezigheid van de andere omgevingshost en ongewijzigde
bestaande bindings. De environmentrollback raakt uitsluitend de eigen host en
weigert bij onverwachte drift. Vercel-domain, `APP_HOST`, Auth-callbacks en
accounts hebben in hetzelfde pakket een eigen providerrollbackchecklist.

### Fase 0 — planreview

1. Deze review goedkeuren of wijzigen.
2. D-1 opnieuw toetsen als de scope verandert.
3. Geen provider- of databasemutatie.

### Fase 1 — repository, nog inert

1. Gedeelde migratie voor fonds, theming, expliciet modulemanifest en flags;
   zonder omgevingsdata.
2. Twee environment-specifieke provisioning-, self-check- en rollbackpakketten.
3. Splits exacte hostnormalisatie van marketing-`www`-canonicalisatie.
4. Permanente hostgedreven demobadge en `noindex,nofollow` op beide hosts.
5. Host-, module-, flag-, rollback- en cross-tenanttests, inclusief bestaande
   hosts en negatieve `www.`-varianten.
6. Runbook en providerchecklists voor Preview en Productie.
7. Typecheck, boundaries, secretscan, securitybaseline, volledige cross-tenant/
   DB-laag, karakterisering, E2E en productiebuild.

### Fase 2 — blijvende Preview-acceptatietenant

Geselecteerde live context voor deze fase: `portal_preview`. Controleer vóór elke
actie opnieuw projectref, actor, host en Vercel-environment.

1. Nieuwe gedeelde migratie en beide environmentpakketten eerst in een ephemere
   Supabase-DB testen; beide verkeerde-doeltests moeten proven-red zijn.
2. Gedeelde fonds-/configmigratie via de normale Preview-migratieketen toepassen.
3. Uitsluitend de Preview-provisioning uitvoeren en de Preview-self-check draaien.
4. `app365.preview.bestuurdersportaal.com` als native domain van
   `preview-stable` toevoegen; branch tracking blijft exact `preview`.
5. Preview-`APP_HOST`, DNS en de exacte Preview Auth-callbacks toevoegen.
6. Twee eigen Previewaccounts provisionen, ieder alleen lid van `m365-demo`.
7. Login, logout, reset, harde reload, badge, metadata, robots, sitemap,
   cross-hostweigering en RLS browsermatig op de vaste Previewhost bewijzen.
8. Nul Microsoft-tokenaanvragen, nul Copilot-calls en uitsluitend synthetische
   data aantonen.
9. Previewrollback eerst ephemeer en daarna als read-only uitvoerbaarheidscheck
   tegen de werkelijke stand valideren; niet uitvoeren zonder rollbackreden.
10. Na duurzame inrichting uitsluitend de Previewhost en -identiteiten in de
    registry vastleggen; nog geen Microsoft-retrievalprofiel toevoegen.

### Fase 3 — basisinrichting Productie, Copilot nog uit

Deze fase vereist een afzonderlijk Productie-uitvoeringsakkoord op het groene
Previewbewijs en het concrete Productiepakket.

1. Voorafbewijs van bestaande host-, Auth- en fondsconfig vastleggen.
2. Bevestigen dat de gedeelde fonds-/configmigratie via de releaseweg op
   Productie staat.
3. Uitsluitend de Productieprovisioning uitvoeren en de Production-self-check
   draaien.
4. Exacte Supabase Auth-redirect(s) toevoegen.
5. Eigen Productie-demoaccounts met één fondsprofiel provisionen.
6. Production-`APP_HOST` uitbreiden en via `main` deployen.
7. Vercel Production-domain native koppelen; daarna DNS en TLS controleren.
8. Dezelfde acceptatiematrix als Preview uitvoeren en uitkomsten vergelijken.
9. Bewijzen: nul Microsoft-tokenaanvragen en nul Copilot-netwerkcalls.
10. Productiehost en -identiteiten in de registry vastleggen; nog geen
    Microsoftobjecten registreren die niet bestaan.

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
4. uitsluitend de accounts van de doelomgeving blokkeren;
5. de environmentrollback voor de geselecteerde context uitvoeren; het script
   weigert als projectref, fingerprint of host niet exact bij die context hoort;
6. het overeenkomstige Vercel-domain loskoppelen, daarna DNS verwijderen;
7. uitsluitend de omgevingseigen app365-host uit `APP_HOST` en exacte
   Auth-redirects verwijderen via de normale releaseweg;
8. fondsconfiguratie terugschrijven als nieuwe, geaudite versie;
9. het fonds alleen fysiek verwijderen wanneer harde prechecks bewijzen dat er
   geen profielen, documenten, Storage-objecten of domeinaudit aan hangen.

Append-only auditlogs worden nooit door rollback verwijderd. Zodra het fonds is
gebruikt, is “tenant uitschakelen en behouden” de standaard; cascade-delete is
dan geen normale rollback. Preview- en Productierollback zijn onafhankelijke
handelingen: terugdraaien van Preview raakt nooit de Production-host en omgekeerd.

## 11. Verificatiematrix

### Host en identiteit

- `app365.preview.bestuurdersportaal.com` resolveert in `portal_preview` exact
  naar `m365-demo`;
- `app365.bestuurdersportaal.com` resolveert exact naar `m365-demo`;
- beide hosts behoren native aan hun bedoelde Vercel-environment en volgen de
  bedoelde branch;
- onbekende, verkeerd gespelde en alle tenant-/app-/platform-`www.`-varianten
  leveren geen fondscontext; alleen marketing canonicaliseert apex/`www`;
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

- demobadge op beide hosts bij login, dashboard, foutpagina en harde reload;
- Previewhost toont daarnaast zonder overlap de Previewbadge;
- metadata `noindex,nofollow`;
- `robots.txt` sluit alles uit;
- sitemap bevat app365 niet;
- geen echte e-mail/notificatie.

### Release en rollback

- Preview-app365 is een `preview-stable`-domain met branch tracking exact
  `preview`, niet een deploymentalias;
- Productie-app365 is een Production-domain en volgt `main`, niet een
  deploymentalias;
- TLS geldig en geen dangling binding;
- iedere environmentrollback verwijdert alleen haar eigen app365-binding;
- volledige repositorygate groen.

## 12. Goedkeuringspunt

Akkoord op deze planreview autoriseert uitsluitend **Fase 1 en Fase 2**:
repositorywijzigingen, hermetisch/ephemeer bewijs en de blijvende
`portal_preview`-acceptatietenant. Preview-mutatiewerk begint pas nadat de Fase
1-artefacten zijn gereviewd en alle verkeerde-doeltests proven-red zijn. Fase 3
bevat Production-database- en providerwijzigingen en vereist daarna een
afzonderlijk uitvoeringsakkoord op het groene Previewbewijs en het concrete
Productie-, self-check- en rollbackpakket.

De review keurt uitdrukkelijk nog niet goed: een aparte stack, Microsoftobjecten,
permissions, consent, billing, live tokens, Copilot-calls of blijvende
Copilot-activering.
