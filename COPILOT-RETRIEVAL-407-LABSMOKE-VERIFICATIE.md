# #407 — labsmokerunner Copilot Retrieval: lokaal verificatierapport

- datum: 2026-09-20
- branch: `codex/407-lab-smokerunner`, vertakt van `origin/preview` (`4bf7404`)
- retrievalprofiel: `pgb_m365_lab_copilot`
- runner: `scripts/smoke/m365-copilot-lab/`

**Er is in deze ronde geen Copilot Retrieval-call gedaan, en geen enkele
Microsoft-call van welke soort dan ook.** Alles hieronder is hermetisch
geverifieerd. Wat alleen live vast te stellen is, staat in §5 als openstaand.

## 1. Wat er is gebouwd

| bestand | rol |
| --- | --- |
| `registry.ts` | leest en valideert het labprofiel uit `bestuurdersportaal-integraties` |
| `auth.ts` | delegated aanmelding via public-client-PKCE, zonder secret en zonder refresh token |
| `graph.ts` | begrensde read-only Graph-laag met de twee stopregelscans |
| `smoke.ts` | driftcontrole, de poort, de ene meting, rootfiltering en categorisering |
| `rapport.ts` | de enige uitvoerweg; draagt alleen categorieën, tellingen, latency en fixturecodes |
| `run.ts` | CLI met lokale grendel en het expliciete akkoord vlak vóór de call |
| `README.md` | uitvoerinstructie |

Hergebruikt in plaats van gekopieerd: de endpointpin, filterbouw,
foutnormalisatie en client uit `core/lib/microsoft-retrieval/` (#413 PR-A /
#415), en `hitUrlBinnenRoot`, de SEM01-scenariodefinitie en het
fixturestatusregister uit het #407-spikeharnas.

## 2. Registratie — gelezen, niet gereconstrueerd

De runner is tegen de echte registry gedraaid (alleen lezen) en loste het
profiel correct op: tenant `Bestuurdersportaaltest.onmicrosoft.com`, actor
`pgb-test@…`, public-client-appregistratie zonder secret, bronroot
`…/sites/PGBRetrievalLab/Shared Documents`. Niets daarvan staat in de runner
hardgecodeerd; het enige vaste gegeven is het profiel-**id**.

De registry meldde bij het schrijven van dit rapport `index_status:
reindex_requested_zero_results` (gecontroleerd op 2026-09-20). Die stand is
**geen** poort — de runner meet zelf — maar maakt wel waarschijnlijk dat de
eerste live run op `inhoud_niet_geindexeerd` stopt.

## 3. Testuitslag

Alle suites lokaal gedraaid op 2026-09-20, Node v24.15.0.

| suite | commando | uitslag |
| --- | --- | --- |
| labsmoke hermetisch | `npm run test:smoke-copilot-lab` | **43/43 pass** |
| boundarygate | `npm run test:spike-boundary` | **13/13 pass** (was 9, nu 4 tests méér) |
| volledige contractgate | `npm run test:contract` | **alle subsuites pass** (xtenant, seed-guard, nightly-fidelity 7, coverage-contract 4, e2e-guard 49, lint-quality 4, ci-ownership 6, spike-boundary 13, spike-fixture 14, labsmoke 43) |
| typecheck | `npm run typecheck` | schoon |
| grenslint | `npm run lint:boundaries` | schoon |
| secretscan | `npm run security:secrets` | geen committed secrets |

### 3.1 De zes gevraagde negatieve tests

| geval | assertie | uitslag |
| --- | --- | --- |
| verkeerde tenant | id-token uit een andere tenant → `tenant/idtoken_tenant_wijkt_af` | pass |
| verkeerde actor | afwijkende `oid` en UPN leveren drift uit **twee** bronnen (id-token én `/me`); een id-token dat `/me` tegenspreekt is apart drift | pass |
| resultaat buiten bronroot | een hit met **dezelfde bestandsnaam** op een andere site en een hit op een andere tenant-host vallen allebei onder `buiten_bronroot`; ze tellen niet mee in fixturecodes of extracts | pass |
| redirect | 302 wordt niet gevolgd (`redirect: "manual"`), levert `copilot_configuratie` en géén tweede poging; hetzelfde is apart getoetst voor de read-only Graph-laag | pass |
| te grote respons | 3 MB aan drie-byte-tekens: het lezen stopt vóór de laatste chunk. Ook getoetst dat een te grote `content-length` de call stopt zónder te lezen | pass |
| tweede netwerkpoging | de grendel weigert de tweede `fetch`; daarnaast levert een 429 (op zichzelf herhaalbaar) bij budget 1 aantoonbaar één poging | pass |

### 3.2 Aanvullend vastgelegd

- **De filter is server-side.** De uitgaande body is byte-voor-byte getoetst:
  `dataSource: "sharePoint"`, `filterExpression:
  path:"https://…/sites/PGBRetrievalLab/Shared%20Documents"`, en de vraag zit
  uitsluitend in `queryString`.
- **De poort onderscheidt twee nulgevallen.** `inhoud_niet_geindexeerd` versus
  `bestand_niet_aanwezig`, plus `beide_nul`. Een inhoudstreffer búiten de
  bronroot opent de poort niet.
- **Het rapport lekt niets.** Op een gerenderd rapport met een echte labachtige
  respons is vastgesteld dat de tekst geen extract, geen `https://`, geen
  `.docx`, geen bestandsnaam en geen token bevat.
- **De grendels werken.** Zonder `M365_COPILOT_LAB_SMOKE=local` en met `CI=1`
  stopt de runner met exitcode 1, vóór elke registratie- of netwerkstap.
- **Scanterm-hygiëne.** Een term met quote, wildcard, operator of regeleinde
  komt de OData-functie niet in; een sitepad met onverwachte tekens stopt vóór
  het netwerk.

## 4. Wat er niet is aangeraakt

Geen SharePoint-instelling, consent, permission, licentie, billing,
featureflag, migratie, database, RLS-regel, productiewiring of deployment.
Buiten de ene mogelijke `POST` doet de runner uitsluitend `GET`s. Er is in deze
ronde ook die `POST` niet gedaan.

## 5. Openstaand — alleen live vast te stellen

1. **De twee read-only scans zijn nog niet tegen de labtenant gedraaid.** Dat
   vereist een interactieve browseraanmelding als `pgb-test@…`; die kan alleen
   de eigenaar van dat account doen. Draai daarvoor:

   ```bash
   npm run smoke:m365-copilot-lab -- --dry-run
   ```

   Die stand doet de scans wél en de Retrieval-call niet.

2. **De verwachting op grond van de registratie is dat de poort dichtgaat** op
   `inhoud_niet_geindexeerd`: de fixtures staan op de labsite, maar de
   SharePoint-index gaf daar op 2026-09-20 nul resultaten. Dan is er geen
   Retrieval-call en is de juiste vervolgstap wachten op de herindexering, niet
   opnieuw proberen.

3. **De live Retrieval-call zelf** blijft daarnaast hangen aan het licentie- en
   kostenbesluit uit `COPILOT-RETRIEVAL-407-LICENTIE-EN-CONSENT.md` §5. De
   runner vraagt vlak vóór die call om een letterlijk getypt akkoord, maar dat
   akkoord vervangt dat besluit niet.

4. **Indexstand terugschrijven.** Zodra de scans wél treffers geven, hoort
   `index_status` in `registry/data-sources.json` bijgewerkt te worden; de
   runner leest die waarde maar schrijft hem nooit.
