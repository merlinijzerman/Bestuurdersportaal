# Runbook Preview/Productie-scheiding

- **Status:** technische Preview-livegang en tenant-/hostmatrix groen;
  volledige Auth-callbackcontrole, Preview-eigen AI-sleutels/quota en formele
  mergeblokkade nog open
- **Datum:** 2026-08-14
- **Actueel besluit:** [`0177`](../decisions/0177-app-blijft-productie-preview-ernaast-en-beheer-gescheiden.md),
  voortbouwend op [`0175`](../decisions/0175-preview-productie-scheiding.md) en
  [`0176`](../decisions/0176-fondsgerichte-preview-tenants.md)

## Doelarchitectuur

| Onderdeel | Preview | Productie |
|---|---|---|
| Generieke tenantomgeving | `app.preview.bestuurdersportaal.com` → generieke sandboxtenant | `app.bestuurdersportaal.com` → bestaande Horizon-/legacytenant |
| Fondsgerichte tenants | `pgb.preview.bestuurdersportaal.com`, `phenc.preview.bestuurdersportaal.com`, `huisartsenpensioen.preview.bestuurdersportaal.com` | `pgb.bestuurdersportaal.com`, `phenc.bestuurdersportaal.com`, `huisartsenpensioen.bestuurdersportaal.com` |
| Marketing | Niet nodig op Preview | `bestuurdersportaal.com`, `www.bestuurdersportaal.com` |
| Beheer | `beheer.preview.bestuurdersportaal.com` → alleen Preview | `beheer.bestuurdersportaal.com` → alleen Productie |
| Ongebruikt domein | `horizon.bestuurdersportaal.com` blijft afwezig | Niet registreren of koppelen |
| Vercel | custom environment **`preview-stable`**, vast gekoppeld aan branch `preview` → de vier exacte Preview-apphosts | `main` → Production |
| Supabase | eigen project of aantoonbaar geïsoleerde branch, eigen Auth/DB/Storage/secrets | bestaand Productieproject |
| AI | Aan, met Preview-only projecten/keys/budget en quota per gebruiker/fonds | Productie-only projecten/keys/budget/quotering |
| E-mail | sink/testmailbox; geen echte ontvangers | geaccordeerde Productieontvangers |
| Data | standaard uitsluitend synthetisch; niet-synthetisch pas na aparte provider-/dataresidentiepoort | echte Productiedata |
| Toegang | invite-only; minimale rol; MFA waar mogelijk; vervaldatum externen | reguliere Productieaccounts en rollen |
| Indexering | `noindex`, niet als openbare demo vindbaar | publiek/tenantafhankelijk |

`bestuurdersportaal.vercel.app` is geen gecommuniceerd Productiedomein. Beperk of
redirect het waar de provider dat veilig ondersteunt en neem het mee in host- en
Auth-tests. De beheeromgeving blijft Productie en valt buiten de domeinverhuizing;
haar secrets en service-role worden nooit aan Preview toegekend.

### De naam `preview-stable` is niet cosmetisch

De branch `preview` deployt naar het **custom environment** `preview-stable`, niet
naar het ingebouwde `Preview`. Dat laatste vangt alleen de niet-toegewezen
branches. Elke controle die op deploymentnamen leunt moet dus `preview-stable – …`
noemen.

Op 22-08-2026 ging dat één keer mis: branch protection op `main` eiste
`Preview – bestuurdersportaal` en `Preview – bestuurdersportaal-beheer` als
verplichte deployments. Een PR vanaf `preview` produceert die namen nooit, dus de
poort wachtte op iets dat niet bestond en hield niets tegen — drie merges gingen
er ongehinderd doorheen. Gerepareerd en op een echte PR geverifieerd; zie
`RELEASEWEG-PREVIEW-EERST.md` §5.2.

De scanner is de uitzondering: `bestuurdersportaal-scanner` heeft geen
`preview-stable` en valt dus wél onder `Preview – …`.

### Preview-hosts volgen de environment, geen losse deployment

De vijf Preview-apphosts zijn **domeinen van `preview-stable`**. Dit is de
enige toegestane koppeling; een handmatige `vercel alias` naar een afzonderlijke
deployment is geen herstelprocedure en mag niet als automatisering worden
toegevoegd. Bij een geslaagde Git-deploy van branch `preview` promoveert Vercel
de nieuwe deployment van deze environment en nemen alle vijf hosts die
deployment tegelijk over.

| Vaste host | Vercel-environment |
|---|---|
| `app.preview.bestuurdersportaal.com` | `preview-stable` |
| `pgb.preview.bestuurdersportaal.com` | `preview-stable` |
| `phenc.preview.bestuurdersportaal.com` | `preview-stable` |
| `huisartsenpensioen.preview.bestuurdersportaal.com` | `preview-stable` |
| `testfonds-w1.preview.bestuurdersportaal.com` | `preview-stable` |

De vijfde host, `testfonds-w1.preview.bestuurdersportaal.com`, is de **actieve,
blijvende** koppeling naar het synthetische `Testfonds W1` — de tenant-hostmapping
die de OMG-1-waarneming en de W7-preview-rondgang reproduceerbaar via de UI
bereikbaar maakt. Hij is géén tijdelijke uitzondering: hij hoort net als de andere
vier op `preview-stable` te staan en telt mee in de controle hieronder.

**Controle na een incident of wijziging aan domains/environments.** Open in
Vercel het project **bestuurdersportaal**: `Settings → Environments →
preview-stable`. Daar moet *Branch Tracking* ingeschakeld zijn met patroon
`Branch is: preview`, en moeten precies bovenstaande vijf hosts onder *Domains*
staan. Controleer daarna in `Deployments` dat de nieuwste `preview-stable`
deployment *Ready* is. Een host die als `Preview`, `Production` of een concrete
deploymentalias wordt getoond, is afwijking: herstel hem in de domeininstelling
naar `preview-stable` en leg de oorzaak vast.

**Uitvoeringsbewijs 2026-08-23 (OMG-2).** Deze native koppeling is in de
Vercel-omgeving waargenomen: branch tracking staat aan voor uitsluitend
`preview`; alle vier hosts tonen `Valid Configuration` en `preview-stable`; de
nieuwste `preview-stable`-deployment is *Ready*. Daardoor is er geen CI-secret,
deploy hook of per-deployment aliasactie nodig die zelf opnieuw kan verlopen.

**Aanvulling 2026-08-24.** De vijfde host `testfonds-w1.preview.bestuurdersportaal.com`
is bevestigd actief op `preview-stable` (opdrachtgever). Hij hoort structureel in
deze tabel en niet als afwijking te worden hersteld — de waarneming van 23-08
noemde vier hosts omdat de synthetische W1-host daarna is toegevoegd.

### Eén stack, meerdere fondsgerichte Preview-omgevingen

Een fondsgerichte Preview is standaard een **logische tenant**, geen eigen
Vercel- en Supabase-stack. Alle Preview-tenants delen dezelfde previewbranch,
schema-versie en Preview-providerkeys, maar zijn door hostmapping, profiel-
`fonds_id`, RLS, Storage-policies en quota van elkaar gescheiden. Dit test juist
de multi-tenantgrens die ook in Productie geldt en voorkomt migratiedrift tussen
vier losse teststacks.

`app.preview.*` is de generieke sandbox. Een gebruiker van een fondsgerichte
Preview logt rechtstreeks in op de eigen `<slug>.preview.*`-host; `app.*` is geen
Preview-loginhub, omdat de host↔fondscontrole een fondsgebruiker daar terecht zou
weigeren. `app.bestuurdersportaal.com` blijft intussen de bestaande Productiehost.

Een fysiek afzonderlijke Preview-stack per fonds is pas nodig als minimaal één
van deze situaties geldt:

- echte of niet volledig gesynthetiseerde fondsdata is expliciet toegestaan;
- het fonds heeft een eigen identity-provider of afwijkende Auth-config;
- een externe koppeling vereist fonds-eigen secrets of netwerkallowlists;
- contractuele isolatie vraagt een eigen database-/storagegrens;
- destructieve migratie-, load- of hersteltests mogen andere previewfondsen niet
  raken.

## Scheidingsregels

1. Geen gedeelde Supabase service-role, JWT-secret, database, storagebucket,
   e-mailkey of AI-key tussen Preview en Productie.
2. Geen kopie van Productiedata naar Preview. Alleen een gecontroleerde,
   aantoonbaar gesynthetiseerde dataset is toegestaan.
3. Een secret heeft precies één environment-scope; generieke waarden met zowel
   `Production` als `Preview` worden vóór de cutover gesplitst.
4. Preview-AI is functioneel gelijk waar nodig, maar financieel en qua data
   begrensd; een test vereist nooit Productierechten.
5. `TENANT_ENFORCE` is in Preview en Productie fail-closed. De code dwingt dit
   tevens af op basis van de deploymentomgeving.
6. Providerinstellingen worden als bewijs vastgelegd zonder secretwaarden.
7. Een eventuele wildcard-DNS/Vercel-domain voor `*.preview.*` is alleen routing:
   iedere toegestane host blijft een **exacte** actieve `tenant_domains`-rij.
   Een niet-geregistreerd subdomein faalt daardoor gesloten.
8. Fondsconfiguratie wordt als beoordeeld, inhoudsarm manifest naar Preview
   overgebracht; er is geen live databasekoppeling of automatische kopie vanuit
   Productie.
9. Iedere Vercel Preview-/Staging-build toont applicatiebreed de vaste markering
   `PREVIEW · GEEN PRODUCTIEOMGEVING`, afgeleid uit `VERCEL_ENV` of
   `VERCEL_TARGET_ENV` en niet uit een handmatige featureflag.

## Environmentmatrix

De precieze secretwaarden worden alleen in de provider gezet, nooit in dit
runbook, git, screenshots of tickets.

| Variabele/groep | Preview | Productie | Regel |
|---|---|---|---|
| `DEPLOY_TARGET` | `app` | `app` of `platform` per Productieproject | Dit is een surface, geen lifecycle-omgeving; `preview` zou worker-guards onbedoeld veranderen |
| `TENANT_ENFORCE` | `on` | `on` | Defense-in-depth; code faalt ook zonder deze waarde gesloten |
| `APP_HOST` | komma-lijst van `app.preview.*` en de drie exacte `<slug>.preview.*`-hosts | `app.bestuurdersportaal.com` plus uitsluitend bewust ondersteunde Productie-apphosts | Hostparser ondersteunt een lijst; Preview heeft geen marketingredirect |
| `PLATFORM_HOST` | `beheer.preview.bestuurdersportaal.com` in beheer-Preview | `beheer.bestuurdersportaal.com` in beheer-Productie | Nooit beide hosts/secrets in dezelfde environment |
| `MARKETING_HOST` | indien nodig eigen Previewwaarde | apex + `www` | Geen Preview-host in Productiescope |
| Supabase URL/anon/service-role | Previewproject | Productieproject | Alle drie gescheiden; service-role nooit browser/public |
| `CRON_SECRET` | eigen Previewwaarde | eigen Productiewaarde | Bearer voor de machineroutes; **≥ 32 tekens** (code weigert korter, fail-closed — W5b/#103); per omgeving verschillend |
| Anthropic/OpenAI/Mistral | Previewproject/key | Productieproject/key | Aparte budgetten, modelallowlist en kill switch |
| Mailgun/notify-variabelen | sink of volledig uit | geaccordeerde ontvangers | Test mag nooit echte notificatie sturen |
| monitoring/analytics | Previewdataset | Productiedataset | Geen vermenging van gebruikers/incidenten |

### Secretrotatie — `CRON_SECRET` (W5b / #103)

`CRON_SECRET` beschermt de zes service-role-machineroutes. Er is één statisch
secret per omgeving; per-route secrets kunnen niet (Vercel Cron stuurt precies
deze env-waarde als bearer).

- **Entropie-ondergrens.** De code (`platform/lib/cron-auth-core.ts`,
  `CRON_SECRET_MIN_LENGTE = 32`) weigert een secret korter dan 32 tekens
  fail-closed. Genereer met een CSPRNG, bijv. `openssl rand -hex 32` (64 hex-tekens)
  of `openssl rand -base64 48`.
- **⚠ Volgorde bij het invoeren van de ondergrens of bij rotatie.** Zet de nieuwe
  (lange) waarde in de provider **vóór** de code die de ondergrens afdwingt daar
  deployt. Andersom zetten de cron-routes zichzelf op 401 tot de rotatie rond is —
  dezelfde "config eerst, dan code"-regel als bij een migratie.
- **Cadans.** Roteer minimaal **elk kwartaal**, en direct bij elk vermoeden van
  blootstelling (zie ook stap 5 onder *Rollback*). Roteer Preview en Productie
  onafhankelijk; ze delen nooit een waarde.
- **Vastleggen bij elke rotatie:** datum, omgeving(en) en uitvoerder — bij het
  betreffende issue, zonder de waarde zelf.

**Rotatie-log (vul aan bij elke rotatie):**

| Datum | Omgeving(en) | Uitvoerder | Aanleiding |
|---|---|---|---|
| _(nog te vullen bij de W5b-rotatie, #103)_ | | | entropie-ondergrens ingevoerd |

## Productielogin en Supabase Auth

De huidige algemene marketing-`/login` mag voorlopig naar Productie-`app.*`
blijven sturen. Dit is een Horizon-/legacylogin, geen algemene fondskeuze. Een
generieke Productielogin wordt later apart besloten.

1. Productie behoudt `https://app.bestuurdersportaal.com` als Site URL-fallback
   en krijgt alleen exacte, benodigde Productiecallbacks.
2. Preview gebruikt `https://app.preview.bestuurdersportaal.com` als Site URL-
   fallback en allowlist exact de callbacks van `app.preview.*`, ieder actief
   `<slug>.preview.*`-domein en `beheer.preview.*` waar Auth dat vereist.
3. Productie- en Preview-redirectallowlists bevatten nooit elkaars hosts.
4. Oude Vercel-deployment-URL's worden verwijderd zodra ze niet bewust nodig
   zijn.

Geen wildcard naar alle `*.bestuurdersportaal.com` gebruiken: exacte callback-
hosts maken een verkeerde of overgenomen subdomainroute aantoonbaar onmogelijker.

## Uitvoeringsvolgorde

### Fase A — voorbereiden zonder extern effect

1. Maak een vaste previewbranch en een Vercel custom environment in zowel het
   app- als beheerproject.
2. Maak het geïsoleerde Supabase-project `bestuurdersportaal-preview` in dezelfde
   regio als Productie.
3. Pas alle schema-migraties toe; seed de generieke sandbox en drie gescheiden
   fondsgerichte Preview-tenants met uitsluitend synthetische data.
4. Map `app.preview.*` naar de sandbox en iedere exacte `<slug>.preview.*`-host naar de
   corresponderende Preview-tenant; registreer geen Productiehost in Preview.
5. Richt Preview Auth, AI-projecten, budgetten, quota per fonds, e-mailsink en
   monitoring in.
6. Maak testaccounts met minimale rollen, precies één Preview-tenant en een
   vervaldatum.
7. Voeg de vier tenant-hosts en `beheer.preview.*` aan de juiste Vercel Preview-
   environments toe. Een wildcard mag DNS/certificaten
   vereenvoudigen, maar vervangt nooit de exacte databasemapping.
8. Laat Productie-`app.*` en de bestaande loginroute ongemoeid en test dat geen
   enkele Previewcallback naar Productie terugvalt.

### Fase B — bewijzen

1. Draai build, sanity, cross-tenant en service-role-tests.
2. Test Preview lokaal via de Vercel deployment-URL voordat het custom domein
   verhuist; gebruik uitsluitend de Preview-Supabase en Previewkeys.
3. Voer de misbruiktests uit `DREIGINGSMODEL.md` uit.
4. Doorloop per fonds branding, modulemanifest, rollen, documentflow, retrieval en
   AI; controleer dat de configuratie van andere previewfondsen niet zichtbaar is.
5. Controleer op login, dashboard, AI en foutpagina dat de vaste Preview-markering
   zichtbaar blijft.
6. Controleer dat AI werkt, budget/quotering per Preview-tenant ingrijpt en e-mail
   alleen de sink bereikt.
7. Bewaar datum, reviewer en gesaneerde providerconfig als ASVS-bewijs.

### Fase C — additieve Preview-livegang

1. Verifieer dat geen `horizon.*`-record wordt aangemaakt en dat Productie-
   `app.* → Horizon` ongewijzigd blijft.
2. Neem een herstelbaar config-/databewijs op van de voorafsituatie.
3. Koppel uitsluitend de nieuwe `*.preview.*`-hosts aan de Preview-environments.
4. Werk Preview Auth Site URL/callbacks bij en voer per host login-, reset- en
   logoutsmoke uit.
5. Smoke `beheer.preview.*` met een interne AAL2-identiteit en bewijs dat de
   Productie-service-role niet aanwezig is.
6. Controleer Productie op `app.*`, de drie fondsdomeinen, marketing en beheer.

### Fase D — nazorg

1. Controleer 24 uur authfouten, 4xx/5xx, AI-kosten, quota en e-mail.
2. Verwijder oude Preview deployment-URL's uit Auth zodra ze niet meer nodig zijn.
3. Roteer tijdelijk gebruikte setupsecrets.
4. Leg het bewijs en resterende risico's vast in het ASVS-register.

## Rollback

Rollback wordt gestart bij cross-environment datatoegang, foutieve authredirects,
Productie-loginuitval, secretvermenging of onverwachte echte e-mail/AI-kosten.

1. haal de nieuwe `*.preview.*`-hosts van hun Preview-environments;
2. herstel de Preview Auth Site URL/redirectlijst uit het configbewijs;
3. laat Productie-`app.*` en de Productie-tenant-domainrij ongemoeid;
4. schakel Preview-AI en uitnodigingsaccounts uit;
5. roteer elk mogelijk blootgesteld of verkeerd gescoped secret;
6. behoud logs en noteer incident, tijdlijn en betrokken omgevingen.

Rollback naar `horizon.bestuurdersportaal.com` is geen optie; dat domein is bewust
uitgefaseerd.

## Wie doet wat

**Development/Codex**

- code, migratievoorstel, tests, securityheaders, auth-/hostlogica en documentatie;
- gesaneerde verificatiecommando's en een concrete providerchecklist opleveren;
- geen Productiesecrets tonen, kopiëren of in git zetten.

**Opdrachtgever**

- providerkeuzes en kostenplafonds accorderen;
- providerinrichting door Codex op het moment van externe creatie bevestigen;
- later het algemene Productie-loginpatroon kiezen;
- externe Preview-gebruikers, einddatum en toegestaan testmateriaal bepalen;
- de domeincutover en eventuele risicoacceptatie expliciet goedkeuren.

## Go/no-go

De nieuwe `*.preview.*`-omgevingen worden alleen vrijgegeven als alle onderstaande
punten groen zijn:

- [x] geïsoleerde Supabase DB/Auth/Storage en gescheiden Supabase-secrets;
- [ ] Preview-AI aan met aparte keys, quota per gebruiker/fonds, budgetalerts en kill switch;
- [ ] echte e-mail uit/sink;
- [x] uitsluitend synthetische testdata zolang de aparte dataresidentie-/providerpoort niet is goedgekeurd;
- [x] vaste Preview-markering zichtbaar op alle relevante routes;
- [ ] Productie-login en callbacks verwijzen nergens naar Preview, en omgekeerd;
- [x] Productie-`app.* → Horizon`-mapping aantoonbaar ongewijzigd;
- [x] Preview-`app.preview.* → sandboxtenant`-mapping aanwezig;
- [x] drie exacte `<slug>.preview.* → previewfonds`-mappings aanwezig;
- [ ] iedere previewgebruiker bereikt alleen het eigen previewfonds;
- [x] onbekende previewhost en tenantmismatch falen gesloten;
- [ ] `beheer.*` en `beheer.preview.*` hebben tegengestelde, niet-overlappende
      Supabase-/service-role-scopes;
- [x] volledige technische testset en uitgevoerde login-/route-browser-smokes groen;
- [ ] rollbackgegevens vastgelegd en verantwoordelijke beschikbaar.

## Uitvoeringsbewijs 2026-08-14

- Supabase-project `bestuurdersportaal-preview` schoon herbouwd met de baseline
  en 148 voorwaartse migraties.
- Laat aangemaakte functies opnieuw least-privilege gemaakt via
  `2026_08_14_security_grant_hygiene_late_recreate.sql`.
- `supabase/preview/seed.sql` toegepast: exact vier actieve Previewhosts.
- Structurele gates, tenantgrenzen en rollen/capabilities: groen.
- Eindtelling vóór testaccounts: `auth.users=0`, `storage.objects=0`,
  `documenten=0`, `document_chunks=0`.
- Lint, productiebuild, alle sanity-suites en 183 cross-tenanttests: groen.
- GitHub-branch `preview` volgt commit `3e5f205`; Productie volgt `main` op
  `e4b6110`. Beide commits hebben dezelfde applicatie-inhoud en de Vercel-
  releases zijn `Ready`.
- De vier apphosts en `beheer.preview.*` zijn gekoppeld aan `preview-stable`;
  Vercel rapporteert geldige DNS-configuratie zonder aanvullende Cloudflare-
  wijziging.
- Anoniem leveren alle vijf Previewhosts een `302` naar `vercel.com/sso-api`.
  Ingelogd routeren de vier apphosts naar `/login`, beheer naar
  `/platform/login`, telkens met de vaste Preview-markering.
- Een onbekende Previewhost krijgt geen geldige TLS-/projectroute. De bestaande
  vijf Productiehosts blijven ongewijzigd naar hun bestaande loginroutes
  verwijzen.
- Ingelogde browser-smokes waren groen op Meridiaan, PH&C, Huisartsen en
  Preview-beheer. Een Meridiaan-sessie op de PGB-host werd fail-closed geweigerd
  met `Geen toegang op dit adres`; er is geen testdata aangemaakt.
- De geautomatiseerde Preview-matrix `P1–P6` controleert exact vier seedhosts,
  afwezigheid van Productie-/Horizonhosts, alle twaalf vreemde-tenantcombinaties,
  onbekende hosts, niet-uitschakelbare Preview-enforcement en scheiding van app-
  en beheerroutes. De app-laag telt na uitbreiding 189/189 groene tests.
- Productiegrants zijn live least-privilege hersteld: `fn_chunk_denorm` is niet
  uitvoerbaar door `anon` en `fn_document_agendapunt_validatie` alleen door
  `service_role`. De corresponderende migratie staat in de repository.
- De actuele sluitingsstatus, CI-checknamen en resterende risico's staan in
  [`SPRINT-1-BEWIJS-2026-08-14.md`](./SPRINT-1-BEWIJS-2026-08-14.md).
