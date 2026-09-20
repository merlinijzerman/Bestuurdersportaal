# Copilot Retrieval — labsmoke (#407)

Een lokale, strikt begrensde runner die **één** Microsoft 365 Copilot
Retrieval-call kan doen tegen de geïsoleerde labtenant, en die in verreweg de
meeste gevallen de call juist **niet** doet.

Dit is de directe labsmoke. Hij sluit Copilot Retrieval **niet** aan op de
Preview-app en raakt geen productiepad.

## Wat de runner doet

| stap | wat er gebeurt | waar |
| --- | --- | --- |
| 1 | retrievalprofiel `pgb_m365_lab_copilot` lezen uit `bestuurdersportaal-integraties` | `registry.ts` |
| 2 | delegated aanmelden via public-client-PKCE als de geregistreerde labidentiteit | `auth.ts` |
| 3 | **driftcontrole** op tenant, actor, appregistratie en bronroot | `smoke.ts` |
| 4 | twee read-only scans | `graph.ts` |
| 5 | **de stopregel** | `smoke.ts` |
| 6 | expliciet akkoord vragen aan een mens | `run.ts` |
| 7 | precies één `POST` naar de Retrieval API | `core/lib/microsoft-retrieval/client.ts` (#415) |
| 8 | rootfiltering, categorisering, rapport | `smoke.ts` / `rapport.ts` |

Stap 3 en stap 5 zijn fail-closed: bij twijfel geen call.

## De stopregel

Vóór elke Retrieval-call draaien twee scans, en ze meten expres iets
verschillends:

- **inhoudscan** op `Zandloperbaken 12` — gaat door de SharePoint-zoekindex.
  Nul betekent: de index kent de inhoud nog niet.
- **bestandsnaamscan** op `PGB407-DOC-101*` — loopt de bibliotheek zélf af en
  raakt de index niet. Nul betekent: het bestand staat er niet.

Zolang één van beide nul treffers **binnen de geregistreerde bronroot** geeft,
vertrekt er geen Retrieval-call. De twee nulgevallen krijgen een eigen code
(`inhoud_niet_geindexeerd` versus `bestand_niet_aanwezig`), omdat ze om iets
volstrekt verschillends vragen: wachten op SharePoint, of uploaden.

## Grenzen die de runner afdwingt

- uitsluitend `POST https://graph.microsoft.com/v1.0/copilot/retrieval`, uit de
  endpointpin van #413 — de runner typt het adres nergens over;
- `dataSource = sharePoint`; `/beta` en `sharePointEmbedded` zijn uitgesloten;
- de scope komt uit de registratie en gaat als `filterExpression` mee; de vraag
  zit in een eigen veld en kan de scope niet raken;
- **maximaal één netwerkpoging** naar de Retrieval API — een requestbudget van 1
  én een grendel die de tweede `fetch` weigert, wat er ook in de configuratie
  staat;
- omleidingen worden niet gevolgd (`redirect: "manual"`), ook niet door de
  read-only Graph-calls;
- een te groot antwoord wordt in **bytes** afgekapt tijdens het lezen;
- resultaten buiten de geregistreerde SharePoint-root worden afgewezen en
  nergens meegeteld;
- geen clientsecret, geen refresh token (`offline_access` wordt niet gevraagd),
  geen token op schijf of in een logregel;
- geen extract of documentinhoud verlaat het proces: het rapport draagt alleen
  categorieën, tellingen, latency en fixturecodes.

De runner wijzigt **niets**: geen SharePoint-instelling, consent, permission,
licentie, billing, featureflag, database of deployment. Alles buiten de ene
`POST` is een `GET`.

## Uitvoeren

Voorwaarden: de registry-repository `bestuurdersportaal-integraties` staat als
zustermap naast deze repository (of `INTEGRATIES_REGISTRY_DIR` wijst ernaar), en
je kunt in een browser aanmelden als de geregistreerde labidentiteit.

Eerst de veilige stand — deze doet de scans wél en de Retrieval-call niet:

```bash
npm run smoke:m365-copilot-lab -- --dry-run
```

De volledige run. Die vraagt vlak vóór de call om akkoord; je moet dan letterlijk
`JA, VOER DE RETRIEVAL-CALL UIT` typen:

```bash
npm run smoke:m365-copilot-lab
```

Het rapport gaat naar stdout, alle voortgang naar stderr. Zo kun je het rapport
bewaren zonder nabewerking:

```bash
npm run smoke:m365-copilot-lab -- --rapport=VERIFICATIERAPPORT-labsmoke.md
```

### Vlaggen

| vlag | effect |
| --- | --- |
| `--dry-run` | stopt vóór de live call, ook als de poort openstaat |
| `--geen-browser` | opent de aanmeld-URL niet automatisch |
| `--rapport=<pad>` | schrijft het rapport ook naar een bestand |
| `--wacht-s=<n>` | wachttijd op de browserstap (standaard 300) |

### Exitcodes

| code | betekenis |
| --- | --- |
| `0` | gemeten, of `--dry-run` met open poort |
| `1` | fout |
| `2` | gestopt op drift |
| `3` | gestopt op de poort |
| `4` | gestopt omdat er geen akkoord kwam |

### Grendels op de omgeving

`M365_COPILOT_LAB_SMOKE=local` moet gezet zijn (het npm-script doet dat), en de
runner weigert CI, Vercel en `NODE_ENV=production`. Zonder interactieve terminal
is er niemand om akkoord te geven en volgt er dus geen call.

## Tests

De hermetische suite raakt het netwerk niet en draait in de required CI-job:

```bash
npm run test:smoke-copilot-lab
```

Negatieve tests die de opdracht expliciet vraagt:

| geval | waar |
| --- | --- |
| verkeerde tenant | `smoke.test.ts` — `idtoken_tenant_wijkt_af` |
| verkeerde actor | `smoke.test.ts` — drift uit id-token én `/me` |
| resultaat buiten de bronroot | `smoke.test.ts` — `buiten_bronroot`, ook bij een gelijke bestandsnaam |
| redirect | `smoke.test.ts` en `graph.test.ts` — niet gevolgd, één poging |
| te grote respons | `smoke.test.ts` en `graph.test.ts` — in bytes, lezen stopt |
| tweede netwerkpoging | `smoke.test.ts` — grendel én budget van 1 |

De boundarygate (`npm run test:spike-boundary`) bewaakt daarnaast dat de runner
onbereikbaar blijft vanuit `app`, `core`, `platform` en `fondsen`, dat hij onder
geen enkele automatische keten hangt, en dat hij het endpoint niet overtypt.

## Hergebruik

De runner leent bestaande, al gereviewde code in plaats van die te kopiëren:

- `core/lib/microsoft-retrieval/` (#413 PR-A / #415) — endpointpin, filterbouw,
  foutnormalisatie en de client met requestbudget en bytegrens;
- `scripts/spike/sharepoint-retrieval/copilot-retrieval.ts` (#407) —
  `hitUrlBinnenRoot` als enige toelatingsregel op de bronroot;
- `scripts/spike/sharepoint-retrieval/vergelijking-scenarios.ts` (#407) — SEM01;
- `scripts/spike/sharepoint-retrieval/fixturestatus.ts` (#407) — de
  serververtrouwde status van `PGB407-DOC-101`.
