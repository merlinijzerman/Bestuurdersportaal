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
| 4 | het **geregistreerde root-item** opzoeken en twee read-only scans | `graph.ts` |
| 5 | **de stopregel** | `smoke.ts` |
| 6 | expliciet akkoord vragen aan een mens | `run.ts` |
| 7 | precies één `POST` naar de Retrieval API | `core/lib/microsoft-retrieval/client.ts` (#415) |
| 8 | rootfiltering, categorisering, rapport | `smoke.ts` / `rapport.ts` |

De volgorde zelf staat in `orkestratie.ts`, met geïnjecteerde afhankelijkheden,
zodat hij hermetisch te testen is; `run.ts` is alleen nog de bedrading naar
terminal en netwerk.

Stap 3 en stap 5 zijn fail-closed: bij twijfel geen call.

## De stopregel

Vóór elke Retrieval-call draaien twee scans, en ze meten expres iets
verschillends:

- **inhoudscan** op `Zandloperbaken 12` — gaat door de SharePoint-zoekindex.
  Nul betekent: de index kent de inhoud nog niet. Een treffer die niet te
  plaatsen is, telt niet als nul — zie hieronder.
- **bestandsnaamscan** op `PGB407-DOC-101*` — loopt de bibliotheek zélf af en
  raakt de index niet. Nul betekent: het bestand staat er niet.

Beide beginnen bij het **geregistreerde root-item**, niet bij de drive-root. Dat
is alleen toevallig hetzelfde zolang de bronroot de hele bibliotheek is; zodra
een profiel een submap registreert (`sharepoint_library_root` doet dat), zou een
scan vanaf de drive-root de metadata lezen van alles daarbuiten.

Zolang één van beide niets **geverifieerds binnen de geregistreerde bronroot**
oplevert, vertrekt er geen Retrieval-call. Elke nulstand krijgt een eigen code,
omdat ze om iets volstrekt verschillends vragen:

| code | betekenis | vervolgstap |
| --- | --- | --- |
| `geen_zoekresultaat` | de index kent de canaryterm niet | wachten op herindexering |
| `zoekresultaat_niet_verifieerbaar` | er is een treffer, maar zijn locatie is niet vast te stellen | uitzoeken |
| `zoekresultaat_buiten_root` | er is een treffer en die ligt aantoonbaar buiten de bron | bron opruimen |
| `bestand_niet_aanwezig` | het verwachte bestand staat niet in de bronroot | uploaden |
| `beide_nul` | geen enkele treffer | uploaden én wachten |

Komen "niet verifieerbaar" en "buiten root" samen voor, dan wint de eerste: dát
iets buiten de root ligt is een uitkomst, níet weten waar iets staat is een gat
in de meting.

### Verse DriveItem-bevestiging

Graph laat `parentReference.path` bij zoekresultaten regelmatig weg. Zo'n treffer
is daarmee niet te plaatsen — en dat is precies wat de live dry-run van 21-09
liet zien: één treffer, nul geaccepteerd, gerapporteerd als een koude index.

De runner leest het DriveItem nu **éénmalig** opnieuw op drive-id + item-id, en
accepteert alleen wanneer die verse respons zélf dezelfde drive heeft, geen
`remoteItem` is en een ouderpad onder de geregistreerde Graph-root draagt. Uit
het zoekresultaat wordt niets overgenomen behalve het item-id.

Grenzen: maximaal `MAX_VERSE_HERLEZINGEN` (5) verse lezingen per inhoudscan, elk
item hoogstens één keer, geen retry, en een deadline van 30 s per GET. Een
shortcut of een expliciet andere drive kost geen lezing — dat is al vastgesteld.

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
- het inwisselen van de autorisatiecode heeft een eigen deadline van 30 s en
  luistert naar de afbreking van de run, zodat Ctrl-C ook ná de browserstap
  werkt;
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

Voor een **afzonderlijk indexbewijs** bestaat een gesloten canarymodus. De
SharePoint-inhoudscan op `Zandloperbaken 12` is alleen een preflight: de gewone
run verstuurt SEM01, niet die term, naar de Retrieval API. De canarymodus
verstuurt na dezelfde drift-, root- en indexpoorten precies één Retrieval-vraag
met de vaste term en rapporteert `CANARY_INDEX_101`, nooit `SEM01`. Eerst de
dry-run; een live call vereist een afzonderlijk akkoord op actuele identiteit,
entitlement/kosten en het ene mogelijke quotumverbruik.

```bash
npm run smoke:m365-copilot-lab -- --exacte-canary --dry-run
# Alleen na afzonderlijk uitvoeringsakkoord:
npm run smoke:m365-copilot-lab -- --exacte-canary
```

Een treffer op `PGB407-DOC-101` bewijst bereikbaarheid van deze fixture via de
API. Nul kandidaten onderscheidt index, filter en ranking nog niet definitief;
de canary is geen semantische recallmeting. Het rapport bevat geen extracts.

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
| `--exacte-canary` | vaste inhoudsterm als aparte Retrieval-meting; geen vrije vraag |
| `--geen-browser` | opent de aanmeld-URL niet automatisch |
| `--rapport=<pad>` | schrijft het rapport ook naar een bestand |
| `--wacht-s=<n>` | wachttijd op de browserstap (standaard 300) |

Onbekende of dubbele vlaggen worden vóór aanmelden geweigerd.

### Exitcodes

| code | betekenis |
| --- | --- |
| `0` | gemeten, of `--dry-run` met open poort |
| `1` | fout |
| `2` | gestopt op drift |
| `3` | gestopt op de poort |
| `4` | gestopt omdat er geen akkoord kwam |
| `5` | de call is gedaan en fail-closed afgewezen — er is een rapport |
| `6` | afgebroken ná het vertrek van het verzoek — er is een rapport |

### Een afgewezen call is ook bewijs

Eindigt de Retrieval-call in een `CopilotFout` (401/403 geen toegang, 402
billing, 429 rate limit, 5xx provider, vormfout), dan schrijft de runner alsnog
een rapport met de vaste foutcode, de foutcategorie, de HTTP-status en het
aantal **feitelijk verbruikte** netwerkpogingen. Dat laatste is de reden dat het
moet: het ene toegestane verzoek is dan op, en zonder rapport staat dat nergens.

Een afbreking (Ctrl-C, verlopen deadline) is géén afwijzing, en het moment
waarop zij valt bepaalt wat er gebeurt:

- **vóór** het vertrek van het verzoek: er is niets verbruikt, de run stopt en
  er komt geen rapport;
- **ná** het vertrek: eigen eindstand `retrieval_afgebroken` (exitcode 6) met de
  afbrekingsreden (`annulering` of `timeout`) en `retrievalPogingen`. Of
  Microsoft het verzoek nog heeft verwerkt is niet vast te stellen, dus gaat de
  runner ervan uit dat het ene toegestane verzoek is verbruikt.

De pogingteller loopt daarom vóór de aanroep op, niet erna: bij twijfel liever
een ronde wachten dan een tweede call doen die er niet meer was.

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

En op de volgorde zelf (`orkestratie.test.ts`), steeds met een **open** poort —
de enige stand waarin die grendels iets betekenen:

| geval | assertie |
| --- | --- |
| `--dry-run` | nul Retrieval-pogingen én geen akkoordvraag |
| geen akkoord | wel gevraagd, geen call |
| wel akkoord | precies één poging naar het vastgepinde endpoint |
| drift | stopt vóór de scans en vóór het root-item; drie lezingen, geen scan |
| scanstartpunt | beide scans adresseren het root-item, nooit de drive-root |

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
