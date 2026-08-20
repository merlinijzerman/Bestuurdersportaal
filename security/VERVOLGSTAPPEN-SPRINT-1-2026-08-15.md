# Vervolguitvoering na Sprint 1

- **Statusdatum:** 2026-08-16
- **Scope:** providerbewijs, Preview-AI, Auth-/accountbewijs, dependencies en
  rollback/nazorg
- **Werkwijze:** gesaneerd; geen keys, tokens, wachtwoorden of secretwaarden
- **Relatie:** aanvulling op
  [`SPRINT-1-BEWIJS-2026-08-14.md`](./SPRINT-1-BEWIJS-2026-08-14.md)
- **Conclusie:** de technische Sprint 1-basis blijft staan, maar ASVS Level 2
  is nog niet aangetoond. Werkpakket 1 bevat concrete providerafwijkingen en
  Werkpakket 4 bevat nog tien actuele productiedependencymeldingen.

## Beslis- en uitvoeringsstatus

| Werkpakket | Status | Eerstvolgende poort |
|---|---|---|
| 1. Providerbewijs | **Technische cutover uitgevoerd — aanvullend bewijs open** | Service-rolefingerprints bij gecontroleerde rotatie vastleggen; oude Previewdeployments met voormalige brede auditsecretscope beheerst uitfaseren |
| 2. Preview-AI | **Deels gerealiseerd — providers gescheiden en normale route groen** | Applicatiequota en kill switch bouwen en testen; heractivering vóór Huisartsen-live door Merlin, daarna vier-ogen met Robert |
| 3. Auth en accounts | **Deels — drie fondssessies en negatieve smokes groen** | Verse logins voor drie bestaande fondsaccounts en beheerlogout afronden; PGB wacht op een testaccount. Robert pas bij Huisartsen-live als AAL2-beheerder activeren |
| 4. Dependencies | **Next.js-patchtranche lokaal groen — 1 critical, 9 high resterend** | Runtime-smoke/PR voor `15.5.23`; daarna een aparte Next 16-tranche en een afzonderlijk `xlsx`-vervangingsbesluit |
| 5. Rollback en nazorg | **Deels — eigenaren en technisch runbook aanwezig** | Opslaglocatie, bewaartermijn en 24-uursrooster vastleggen |
| 6. Productie-auditketen en T14b-drift | **P1 lokaal/Preview afgerond; applicatierestore groen; Productie NO-GO en ongewijzigd** | Back-upchecksum, 118 public-tabellen, migraties 1–3 en P1/platformchecks groen. De geteste snapshot had 270 events versus later 272 live; de ongewijzigde seed weigerde terecht. Volledige restore blokkeerde omdat de losse lokale Postgres-image niet dezelfde managed Auth-schemaversie had. Maak een nieuwe back-up en herstel die naar een actueel, leeg Supabase-doelproject of exact overeenkomende lokale stack vóór Merlins afzonderlijke go/no-go. Vanaf Huisartsen-live wordt Robert tweede reviewer en geldt vier-ogen |

## 1. Gesaneerde providerconfiguratiematrix

Gecontroleerd en waar vermeld aangepast in de Supabase- en Vercelconsoles op
2026-08-15. De controle vermeldt uitsluitend projectrefs, variabelenamen en
scopes. Er zijn geen secretwaarden geëxporteerd of vastgelegd.

| Provider / omgeving | Controle | Uitkomst | Afwijking / actie | Controleur |
|---|---|---|---|---|
| Supabase Preview `swviwoytzvaqypieqgji` | Auth Site URL | `https://app.preview.bestuurdersportaal.com` | Geen | Codex |
| Supabase Preview | Auth redirects | **Groen:** exact de vijf hieronder vermelde callbacks | Beheerwildcard verwijderd en vervangen door exact `/auth/callback` | Codex |
| Supabase Productie `aebwiufuegsiwhwpdrfb` | Auth Site URL | `https://app.bestuurdersportaal.com` | Geen | Codex |
| Supabase Productie | Auth redirects | **Groen:** exact de twee hieronder vermelde callbacks | Beheerwildcard en twee oude `bestuurdersportaal.vercel.app`-URL's verwijderd | Codex |
| Vercel appproject | `SUPABASE_SERVICE_ROLE_KEY` | Niet aanwezig | **Groen:** app-surface ontvangt geen service-role | Codex |
| Vercel appproject | Supabase URL/anon | **Groen:** Productiewaarden `Production`-only; aparte waarden uitsluitend `preview-stable` | App Preview en Productie opnieuw gedeployed en bereikbaar | Codex |
| Vercel beheerproject | Supabase URL/anon/service-role | **Groen:** Productiewaarden `Production`-only; aparte waarden uitsluitend `preview-stable` | Vercel toont bestaande sensitive values niet terug; fingerprints zijn achteraf niet betrouwbaar af te leiden en moeten bij de eerstvolgende gecontroleerde rotatie vóór invoer worden berekend | Codex |
| Vercel appproject | Overige secretscopes | **Hersteld 2026-08-15:** legacy `AUDIT_HMAC_SLEUTEL` en `AUDIT_HMAC_SLEUTEL_VERSIE` gewijzigd van `Production and Preview` naar `Production`-only; aparte waarden blijven uitsluitend `preview-stable` | Geen waarde bekeken of gewijzigd en geen Productiedeployment gestart. Bestaande oude Previewdeployments behouden hun build-time configuratie tot gecontroleerde herbouw/uitfasering | Codex |
| Vercel app en beheer | Anthropic/OpenAI | **Groen:** Productiewaarden `Production`-only; Preview-eigen Anthropicworkspace en keys uitsluitend `preview-stable`; OpenAI niet in Preview | End-to-end Preview-AI-call groen; Productiekeys ongewijzigd | Codex |
| Vercel app en beheer | Mistral | **Groen:** Productiewaarden `Production`-only; aparte keys uit de Previewworkspace uitsluitend `preview-stable` | Mistral-appkey toont gebruik op 2026-08-15 na de retrievalsmoke | Codex |
| Vercel beheerproject | Hosts/deploy/cron | Productiewaarden `Production`-only; aanwezige Previewwaarden uitsluitend `preview-stable` | `CRON_SECRET` niet meer beschikbaar in Preview | Codex |
| Vercel app | E-mail | Geen `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` of `CONTACT_NOTIFY_FROM`; `CONTACT_NOTIFY_TO` nu `Production`-only | **Groen:** Preview bevat geen complete verzendconfiguratie en geen echte ontvanger | Codex |
| Lokale ontwikkelomgeving | Supabase-doel | CLI-link = Preview, maar `.env.local`-URL = Productie en lokale service-role is aanwezig | **Hoog:** maak Preview de veilige lokale default; bewaar een eventuele Productieconfig apart en alleen voor expliciete, gecontroleerde operaties | Codex, lokaal gesaneerd |

### Voorgestelde exacte Auth-allowlists

De code bevat één callbackroute: `/auth/callback`. Wachtwoordlogin zelf heeft
geen wildcard nodig. Controleer reset/herstel pas nadat de resetflow expliciet
is geïmplementeerd of het exacte benodigde pad is vastgesteld.

**Preview**

```text
https://app.preview.bestuurdersportaal.com/auth/callback
https://pgb.preview.bestuurdersportaal.com/auth/callback
https://phenc.preview.bestuurdersportaal.com/auth/callback
https://huisartsenpensioen.preview.bestuurdersportaal.com/auth/callback
https://beheer.preview.bestuurdersportaal.com/auth/callback
```

**Productie**

```text
https://app.bestuurdersportaal.com/auth/callback
https://beheer.bestuurdersportaal.com/auth/callback
```

Voeg fondsgerichte Productiecallbacks alleen toe wanneer de bijbehorende
authflow ze werkelijk gebruikt. Gebruik geen wildcard en geen Vercel-deploy-URL
als structurele fallback.

### Cutovervolgorde Werkpakket 1

1. Leg de huidige Site URL's en redirectlijsten gesaneerd vast.
2. Maak in beide Vercelprojecten alle bestaande Productiewaarden
   `Production`-only; laat de nieuwe waarden uitsluitend op `preview-stable`.
3. Controleer per deployment zonder secretwaarden:
   Supabase-projectref, aanwezigheid/afwezigheid service-role en een eenrichtings-
   fingerprint van iedere service-role. Sla nooit de waarde zelf op.
4. Verwijder de twee oude Productie-Vercelredirects en vervang beide
   beheerwildcards door `/auth/callback`.
5. Redeploy app en beheer voor Preview en Productie; voer health-, login- en
   negatieve hostsmokes uit.
6. Verwijder de Preview-scope van `CONTACT_NOTIFY_TO` en bevestig dat de overige
   Mailgunvariabelen in Preview afwezig blijven.
7. Roteer iedere key waarvan niet overtuigend is vast te stellen dat die nooit
   tussen lifecycle-omgevingen is gedeeld.

Stand na uitvoering op 2026-08-15: stappen 2, 4, 5 en 6 zijn uitgevoerd. App en
beheer zijn in zowel `preview-stable` als Productie opnieuw gedeployed. De vier
Preview-apphosts, beheer-Preview, app-Productie en beheer-Productie laden
correct. Productie toont de verwachte loginpoorten; beheer meldt MFA verplicht.
De resterende bewijsactie uit stap 3 is het gesaneerd vastleggen van de
service-rolefingerprints. De Vercelconsole toont de inhoud van bestaande
`Sensitive`-variabelen ook in de editweergave niet terug. Een poging om uit de
weergave een fingerprint af te leiden leverde daarom uitsluitend de hash van
een lege waarde en is nadrukkelijk **geen bewijs**. Leg bij de eerstvolgende
gecontroleerde rotatie de SHA-256-fingerprint lokaal vast vóór invoer in Vercel
en vergelijk die na deployment met een gesaneerde projectrefcontrole. Er is
geen secretwaarde gekopieerd naar dit document of een bestand.

Een tijdens de technische sleuteloverdracht zichtbaar geworden tijdelijke
Mistralsleutel en een tijdelijke Anthropicsleutel zijn onmiddellijk bij de
provider ingetrokken en nooit in Vercel gebruikt. Alle overige tussenversies
zijn na de geslaagde cutover ingetrokken. Het bewijs bevat uitsluitend namen,
scopes, gebruiksdata en bedragen; geen actieve secretwaarde of fingerprint.

## 2. Preview-AI — besluitrecord

Besloten op 2026-08-15. De eerste drie maanden gelden als leerfase; na 30 dagen
daadwerkelijk fondsgebruik en opnieuw na één volledige testmaand van twee fondsen
worden budgetten en quota herijkt op werkelijk verbruik.

| Besluit | Gekozen waarde | Toelichting |
|---|---|---|
| Anthropic werkbudget | **USD 150 per maand** | Waarschuwingen op USD 75 en USD 120; harde stop op USD 200 |
| Mistral werkbudget | **USD 25 per maand** | Waarschuwingen op USD 12,50 en USD 20; harde stop op USD 40 |
| Absolute gecombineerde stop | **USD 240 per maand** | Geen automatische overloop naar Productiekeys of Productiebudget |
| Toegestane Anthropicmodellen | `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5-20251001` | Reguliere Previewfunctionaliteit en hulppaden |
| Toegestane Mistralmodellen | `mistral-embed`, `mistral-ocr-latest` | Embeddings en OCR; `mistral-large-latest` alleen in een gepland intern AQLab-testvenster |
| Overige challengers | Standaard uit | OpenAI- en overige AQLab-challengers alleen intern, tijdelijk en met synthetische data |
| Quota per gebruiker | **150 AI-acties per maand** | Bestaande burstlimiet 20 verzoeken per 5 minuten blijft voorlopig staan |
| Quota per fonds | **500 AI-acties en 1.000 OCR-pagina's per maand** | Per fonds afzonderlijk gemeten en gehandhaafd |
| Globaal Previewquotum | **1.200 AI-acties per maand** | Financiële providerstop blijft altijd leidend |
| Kill-switchbedieners | **Merlin; Robert vanaf Huisartsen-live** | Merlin bedient de Previewstop zelfstandig in de huidige fase; Productiekey nooit nodig |
| Heractivering | **Merlin tot Huisartsen-live; daarna vier-ogen** | Vier-ogen wordt pas bij de daadwerkelijke livegang van Huisartsen actief; vanaf dat moment initieert de ene beheerder en keurt de andere goed |

De bediening komt op termijn in `beheer.bestuurdersportaal.com` en voor Preview
in `beheer.preview.bestuurdersportaal.com`. Primaire stop en quota worden als
beheerconfiguratie in de juiste Supabase-omgeving afgedwongen, zodat stoppen en
hervatten geen redeploy vereisen. Providerlimieten blijven als onafhankelijke
financiële backstop bestaan. De definitie van gereed is pas groen na drie tests:
normaal gebruik, quota-overschrijding en kill switch. Elke Previewtest moet
uitsluitend Preview raken.

### Uitvoeringsbewijs Preview-AI — 2026-08-15

- Anthropicworkspace `Bestuurdersportaal Preview` aangemaakt; de actieve key is
  uitsluitend gekoppeld aan `preview-stable` in app en beheer.
- Anthropic harde maandlimiet: **USD 200**; e-mailwaarschuwingen: **USD 75** en
  **USD 120**. De eerste geslaagde smoke staat als **USD 0,05** op de Previewkey.
- Mistralworkspace `Bestuurdersportaal Preview` aangemaakt met afzonderlijke
  app- en beheerkeys; de appkey toont providergebruik op 2026-08-15.
- Mistral werkt prepaid: **EUR 10 tegoed**, auto-recharge uit. De console biedt
  in dit account geen maandelijkse workspace-spendlimiet. Dit is voorlopig een
  strengere financiële stop dan het besluit van USD 40; ophogen van tegoed is
  een afzonderlijk financieel besluit.
- Normale gebruikstest groen op
  `huisartsenpensioen.preview.bestuurdersportaal.com`: vraag, scopekeuze,
  retrieval en antwoordgeneratie slaagden; geen Productiehost of Productiekey
  gebruikt.
- Beheer-Preview monitoring is bereikbaar, maar signalen zijn nog `Onbekend` en
  de pagina vermeldt expliciet dat alerting nog niet is ingericht.
- Quota-overschrijding en kill switch zijn nog niet als afgerond bewijs
  vastgelegd. Heractivering is in de huidige fase een enkelvoudig besluit van
  Merlin; vier-ogen met Robert wordt pas bij Huisartsen-live geactiveerd.

## 3. Herhaalbare Auth- en accountmatrix

Test geen reset/herstel voordat de exacte callbacks zijn toegepast. Gebruik
accounts uit een goedgekeurde wachtwoordmanager; neem alleen een pseudoniem,
rol en tenant in het bewijs op. Preview-testaccounts krijgen geen automatische
einddatum: zij bevatten geen Productiedata en blijven actief tot handmatige
intrekking. Kostenrisico wordt via quota, monitoring en de Preview-kill switch
beheerst. Deactiveer handmatig bij einde samenwerking, misbruik of op verzoek.

| Test | Meridiaan sandbox | PGB | PH&C | Huisartsen | Beheer Preview |
|---|---|---|---|---|---|
| Positieve login op eigen host | Bestaande sessie groen; verse login open | **Uitgesteld:** er bestaat nog geen PGB-testaccount | Bestaande sessie groen; verse login open | Bestaande sessie groen; verse login open | **Merlin groen:** live toegang tot beveiligd rechtenpad bewijst actuele AAL2; Robert wordt pas bij Huisartsen-live als tweede beheerder betrokken |
| Logout + sessie ongeldig | **Groen 2026-08-15** | **Uitgesteld:** geen testaccount | **Groen 2026-08-15** | **Groen 2026-08-15** | Te testen |
| Login op vreemde fonds-host | **Groen:** Meridiaanaccount op PGB-host geweigerd | Open voor overige combinaties | Open voor overige combinaties | Open voor overige combinaties | n.v.t. |
| Onbekende Previewhost | **Groen als infrastructuurtest:** verbinding wordt gesloten | Idem | Idem | Idem | n.v.t. |
| Productiehost met Previewaccount | **Groene steekproef:** Preview-sessie gaf op Productie alleen de loginpoort | Open per identiteit | Open per identiteit | Open per identiteit | **Groen voor Merlin:** Preview-beheersessie gaf op Productiebeheer alleen de MFA-loginpoort |
| Reset/herstel naar eigen host | Niet testbaar: geen resetflow in de code | Idem | Idem | Idem | Idem |

### Uitvoeringsbewijs Auth — 2026-08-15

- De generieke Previewhost opende een bestaande sessie voor pseudoniem
  `Previewtest Meridiaan`, rol beheerder, tenant Stichting Demofonds Meridiaan.
- PGB is bewust niet getest: in Preview Auth bestaat wel een technisch
  gebruikersrecord voor het PGB-testalias, maar er is geen bruikbare en
  geverifieerde testlogin beschikbaar. Dit is een ontbrekende testvoorwaarde,
  geen mislukte isolatie- of Auth-test.
- De PH&C-host opende een bestaande fondsgerichte sessie voor pseudoniem
  `Previewtest`, rol bestuurslid. De Huisartsenhost opende een afzonderlijke
  fondsgerichte sessie voor pseudoniem `Previewtest`, rol medewerker
  bestuursbureau. Deze bestaande sessies bewijzen hostbinding en autorisatie,
  maar nog niet de invoer van wachtwoord plus callback in een verse login.
- De Meridiaansessie werd op de PGB-host fail-closed geweigerd met de melding
  dat het adres bij een ander fonds hoort.
- Navigatie vanuit een Preview-fondssessie naar `app.bestuurdersportaal.com`
  eindigde uitsluitend op de Productie-loginpoort; de Preview-sessie werd daar
  niet geaccepteerd.
- De actieve Preview-beheersessie van Merlin werd evenmin geaccepteerd op
  `beheer.bestuurdersportaal.com`: Productie stuurde naar `/platform/login` en
  toonde de afzonderlijke MFA-loginpoort.
- Een onbekende Previewhost was niet bereikbaar (`ERR_CONNECTION_CLOSED`) en
  bood geen applicatie- of loginoppervlak.
- Meridiaan, PH&C en Huisartsen zijn expliciet uitgelogd. Alle drie hosts
  stuurden daarna naar hun eigen `/login`; de eerdere sessie gaf geen toegang
  meer.
- `beheer.preview.bestuurdersportaal.com/platform/rechten` was bereikbaar voor
  Merlin en toonde de vereiste configuratie-, observability- en
  securitycapabilities. Dit beveiligde leespad doet in de applicatie een live
  AAL2-hercontrole. Robert wordt conform het genomen besluit pas bij de
  daadwerkelijke livegang van Huisartsen als tweede beheerder/AAL2-reviewer
  geactiveerd; zijn afwezigheid is tot die gate geen blocker.
- Wachtwoorden, MFA-codes en volledige secretwaarden zijn niet bekeken,
  geëxporteerd of vastgelegd.
- Een repositorybrede controle vond geen geïmplementeerde wachtwoordreset- of
  recoveryflow. Reset/herstel is daarom niet ten onrechte als groen gemarkeerd;
  het vereist eerst een afzonderlijk ontwerp met exacte callback en e-mailpad.

Bewijsregel per identiteit:

```text
datum/tijd | accountpseudoniem | rol | toegestane tenant |
host | scenario | verwachte uitkomst | werkelijke uitkomst | reviewer
```

## 4. Dependency-nulmeting en Next.js-patchtranche

De nulmeting is reproduceerbaar uitgevoerd op 2026-08-15. Na een schone
`npm ci` bleek het lockfile, en niet de eerder gedrifte lokale `node_modules`,
de autoritatieve uitgangssituatie:

```bash
npm audit --omit=dev --audit-level=high --json
```

Exacte hoofdversies vóór de tranche: `next@15.5.15`, `xlsx@0.18.5`,
`@anthropic-ai/sdk@0.39.0`, `@supabase/supabase-js@2.104.1`,
`mammoth@1.12.0` en `unpdf@0.12.2`.

| Severity | Pakket | Direct | Fix | Hoofdactie |
|---|---|---:|---|---|
| Critical | `tar` | Nee | Ja | Transitieve keten upgraden |
| High | `next` | Ja | Deels binnen 15.5 | Directe Next-core-advisories zijn opgelost in `15.5.23`; ingebouwde PostCSS/Sharp-risico's vragen een aparte Next 16-tranche |
| High | `xlsx` | Ja | Nee in npm | Vervangen of tijdgebonden risicoacceptatie met compensaties |
| High | `@mapbox/node-pre-gyp`, `brace-expansion`, `form-data`, `nanoid`, `postcss`, `sharp`, `ws` | Nee | Ja | Na directe upgrades lockfile opnieuw oplossen en audit herhalen |

### Uitvoering Next.js-patch — 2026-08-16

`next` is exact gepind op `15.5.23`; het lockfile is uitsluitend voor Next.js,
`@next/env` en de platformgebonden `@next/swc-*`-pakketten bijgewerkt. Er is
bewust geen `npm audit fix --force`, override of semver-major toegepast.

De auditstand blijft numeriek **1 critical en 9 high**, maar de inhoud is
verbeterd: de directe Next-core-advisories uit `15.5.15` zijn verdwenen. Het
resterende high-signaal op `next` loopt via de in Next 15.5 ingebouwde
`postcss@8.4.31` en optionele `sharp@0.34.5`. De huidige 15.5-lijn biedt daarvoor
geen verdere patch; oplossen vraagt een gecontroleerde upgrade naar Next 16
(ten tijde van de controle `16.3.1`) of een andere expliciet geteste oplossing.
Riskante package-overrides zijn niet toegepast.

Relevante geïnstalleerde versies na de tranche zijn `next@15.5.23`,
`postcss@8.4.31`, `sharp@0.34.5`, `form-data@4.0.5`, `nanoid@3.3.11`,
`ws@8.20.0` en `xlsx@0.18.5`. De audit meldt daarnaast lockfilepaden via
`tar`, `@mapbox/node-pre-gyp` en `brace-expansion`. `xlsx` blijft zonder
beschikbare npm-fix een zelfstandig vervangingsvraagstuk.

Lokaal verificatiebewijs op de schone lockfile-installatie:

- `npm ci`: groen;
- `npm run typecheck`: groen;
- `npm run sanity`: alle suites groen;
- `npm run build`: groen op Next.js `15.5.23`;
- `npm run test:xtenant`: 189/189 groen;
- volledige `scripts/cross-tenant-ci.sh` tegen een geïsoleerde wegwerp-
  Supabase/Postgres 17-database: groen, inclusief migratiereplay en DB-laag;
- lokale browsersmoke met expliciet onbruikbare Supabase-testwaarden: fondslogin
  en platformlogin renderen en hydrateren zonder browserfouten; een negatieve
  login toont uitsluitend de generieke foutmelding. Preview en Productie zijn
  bij deze lokale smoke niet benaderd.

De build vermeldt een niet-blokkerende, reeds omgevingsgebonden waarschuwing:
Next.js ziet ook `/Users/merlinijzerman/package-lock.json` en leidt daardoor een
te hoge workspace-root af. Dit heeft de build niet verhinderd en valt buiten
de dependencywijziging; los dit later op met `outputFileTracingRoot` of door de
onnodige bovenliggende lockfile gecontroleerd op te ruimen.

Resterende tranchevolgorde:

1. voer Preview-runtimesmokes uit op de Next.js-patch en lever deze als
   geïsoleerde pull request;
2. onderzoek Next 16 als aparte semver-majortranche, inclusief compatibiliteit,
   build, Auth, uploads/exports, AI, sanity en volledige cross-tenantgate;
3. herstel de overige transitieve ketens zonder `--force`, met dezelfde gates;
4. inventariseer alle `xlsx`-lees-/schrijfpaden en fixtures; kies daarna een
   vervanger op compatibiliteit, onderhoud en securityrespons;
5. maak de auditgate pas blokkerend als alle meldingen zijn opgelost of formeel
   voorzien van eigenaar, compensatie en einddatum.

Gebruik niet blind `npm audit fix --force`: dat mengt meerdere risicovolle
upgrades en maakt regressieherkomst onduidelijk.

## 5. Rollback en nazorg

| Verantwoordelijkheid | Primair | Vervanger | Status |
|---|---|---|---|
| Go/no-go providercutover | Merlin | Robert vanaf Huisartsen-live | Merlin toegewezen; vervanging later activeren |
| DNS/Vercel/Auth-rollback | Merlin | Robert vanaf Huisartsen-live | Merlin toegewezen; vervanging later activeren |
| Secretrotatie | Merlin | Robert vanaf Huisartsen-live | Merlin toegewezen; vervanging later activeren |
| 24-uurs nazorg | Merlin | Robert vanaf Huisartsen-live | Merlin toegewezen; vervanging later activeren |

Nog vast te leggen:

- beveiligde opslaglocatie met beperkte toegang voor schema-only dumps,
  configbewijs en checksums;
- bewaartermijn en vernietigingsprocedure voor rollbackartefacten;
- meetvenster en alarmgrenzen voor authfouten, 4xx/5xx, AI-kosten, quota en
  onverwachte e-mail;
- tijdlijnsjabloon voor incident/rollback en expliciete afsluitreview na 24 uur.

De rollbackcriteria uit `OMGEVINGEN-RUNBOOK.md` blijven leidend:
cross-environment datatoegang, verkeerde authredirect, Productie-loginuitval,
secretvermenging of onverwachte echte e-mail/AI-kosten.

## 6. Auditketen en T14b — Preview-eindstand

Afgerond op 2026-08-15, zonder wijziging aan Productie:

- de autoritatieve, transactioneel vergrendelde ketenkop en de T14b-
  driftreparatie staan op Preview;
- een append-only forkregister verklaart uitsluitend de twee exact vastgelegde
  historische Previewforks; gewijzigde, nieuwe of verouderde verklaringen
  maken de centrale validator fail-closed rood;
- bestaande events en hashes zijn niet gewijzigd, verwijderd of herberekend;
- de registry is niet rechtstreeks leesbaar of muteerbaar voor `anon`,
  `authenticated` of `service_role`, en UPDATE/DELETE wordt ook voor de eigenaar
  door een trigger geblokkeerd;
- `scripts/platform_checks.sql` is op Preview groen, inclusief multi-row-events,
  immutability, state/head/leaf-controle en een negatieve onverklaarde-forktest;
- `supabase/checks/2026_08_15_p1_audit_t14b.sql` is op Preview groen;
- de volledige §15-suite is vanaf een lege Supabase-Postgres `17.6.1.158`
  database groen: TypeScript, `189/189` app-tests, baseline plus zes
  voorwaartse migraties en alle DB-gates T3–T17, AQLab, G20, R1, P5 en BB;
- de testdatabase normaliseert vóór de schema-baseline de provider-default voor
  functiegrants. Daardoor herleven oude `anon=EXECUTE`-rechten niet bij een
  schone restore; alleen de drie expliciet publieke RPC's worden hersteld.

De Productiefork is inmiddels read-only exact geïnventariseerd: 272 events,
één root, geen hashafwijking/dubbele hash/ontbrekende link en één fork met vier
kinderen. De afzonderlijke Productie-seed en het fail-closed uitvoerplan zijn
gereed en lokaal negatief getest: op een verkeerde omgeving weigert de seed en
blijven nul declaraties achter. De volgende stap is de volledige volgorde testen
op een verse Productieback-up. Daarna volgt pas Merlins expliciete go/no-go.
Vanaf Huisartsen-live is daarnaast Roberts tweede goedkeuring verplicht.

## Go/no-go voor de eerstvolgende wijziging

**No-go** voor externe Previewgebruikers totdat minimaal is afgerond:

- AI-budget en quota zijn besloten; kill switch en enkelvoudige heractivering
  door Merlin zijn gebouwd en getest. Vier-ogen wordt pas bij Huisartsen-live
  een productievoorwaarde;
- Auth-matrix inclusief AAL2-beheer is groen;
- service-rolefingerprints zijn gesaneerd vastgelegd;
- rollbackeigenaar Merlin en vervanger Robert zijn beschikbaar.
