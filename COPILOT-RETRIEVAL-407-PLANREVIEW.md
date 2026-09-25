# #407 — Planreview Copilot Retrieval API-spike (T0–T2)

Status: planreview vóór implementatie. Worktree `mvp-407-copilot-retrieval`, branch
`codex/407-copilot-retrieval-spike`, vertakt van `origin/preview` `718c2bc`.

Mandaat van deze tranche: **T0 (voorbereiding), T1 (bewijs- en veiligheidsketen) en T2
(hermetische kwaliteitsvergelijking)**. Expliciet buiten scope en niet uitgevoerd:
Microsoft-permissions, consent, billing/pay-as-you-go, featureflags en elke wijziging aan
productiecode voor live retrieval. De tranche stopt vóór T3.

## 1. Wat er al staat (vastgesteld in de code, niet uit documentatie)

| Onderdeel | Plaats | Relevantie |
|---|---|---|
| Spikeprototype met 3 routes | `scripts/spike/sharepoint-retrieval/prototype.ts` (1158 r.) | `microsoft_search`, `drive_search_extract`, `candidate_union` |
| Vaste toelatingsketen (11 stappen) | `maakKandidaat()` idem | fase 1 actualiteit → 5 previewbewijs, dubbele eTag/cTag |
| Graph-client met budget/retry/redirect | `class GraphClient` idem | `veiligeGraphUrl` eist `https://graph.microsoft.com/v1.0/…` |
| Spike-types + afwijscategorieën | `scripts/spike/sharepoint-retrieval/types.ts` | 8 categorieën, `VeiligeMeetrij` |
| Hermetische suite | `prototype.test.ts` (951 r., 36 tests) | geen netwerk, geen DB |
| Lokale runner + grendel | `run.ts` | eist `M365_RETRIEVAL_SPIKE=local`, weigert CI/Vercel/prod |
| Statische boundarygate | `scripts/sharepoint-retrieval-spike-boundary.test.mjs` | verbiedt import buiten één Preview-brug |
| Preview-brug (productiepad) | `core/lib/microsoft-sharepoint-retrieval-smoke.ts` + `app/api/microsoft/sharepoint/retrieval-smoke/route.ts` | **buiten scope van deze tranche** |
| Vaste PGB-acceptatieset | `core/lib/microsoft-sharepoint-retrieval-smoke-core.ts`, `security/MICROSOFT-365-PGB-RETRIEVAL-ACCEPTATIESET.md` | S00/S02/S03/S04/S04H/S08/S09/S08R |
| Fixtures | `tests/e2e/fixtures/pgb-sharepoint/` | 10 fixtures, alle op unieke canary-termen |

Conclusie: de vierde route past als **additieve arm** in een bestaand, volgroeid harnas.
Er hoeft niets aan de drie bestaande routes te wijzigen.

## 2. Bevindingen die het plan sturen

### G-1 (blokkerend voor het ontwerp) — Copilot levert `webUrl`, geen DriveItem-id

De bestaande twee zoekroutes leveren een `itemId` (`resource.id`), waarmee de hele
verificatieketen begint. `POST /v1.0/copilot/retrieval` levert per hit een `webUrl` plus
`extracts`; er is geen betrouwbaar DriveItem-id in het antwoord. De keten heeft dus een
nieuwe, exacte **locator→itemId**-stap nodig.

Twee opties zijn overwogen:

* **(a) URL-allowlist uit de bronregistratie.** `web_url` wordt wél geschreven door
  `sharepoint_upsert_documenten` (`core/lib/microsoft-vault.ts:148`), maar het leespad
  `sharepoint_lees_document` geeft het niet terug — `SharePointDocument` (r. 144-147) kent
  geen `web_url`. Deze optie vereist dus een **migratie op een `microsoft_private`-functie**.
  Dat is een DB-/productiewijziging en valt buiten het mandaat van deze tranche.
* **(b) Graph-resolutie via `/shares` — eerst gekozen, daarna VERWORPEN.** Microsoft noemt
  voor `GET /shares/{token}/driveItem` minimaal delegated `Files.ReadWrite`
  ([shares: get](https://learn.microsoft.com/en-us/graph/api/shares-get?view=graph-rest-1.0)).
  Daarmee zou een read-only spike schrijfrecht nodig hebben. Dat is onaanvaardbaar en de
  resolver is volledig verwijderd; de boundarygate bewaakt dat hij niet terugkeert.
* **(c) Read-only locatorregister vanaf de geregistreerde DriveItems (gekozen).** De hit-URL
  wordt eerst server-side getoetst tegen de opnieuw gelezen root (exacte host + padprefix);
  alles daarbuiten valt vóór élke vervolgstap af onder `root`. Daarna wordt de URL exact
  gematcht tegen een register dat wij zelf read-only hebben opgebouwd: elk al geregistreerd
  DriveItem wordt op zijn vertrouwde item-id gelezen (`GET /drives/{drive}/items/{item}`,
  voldoende met `Files.Read.All`/`Sites.Read.All`) en levert zijn door Graph geleverde
  `webUrl` als sleutel. Geen match is `mapping`, zonder netwerkcall.

Optie (c) draait de richting om en is daarmee strenger dan (b): wíj bepalen welke URL's
bestaan, en een URL die wij niet zelf hebben opgehaald bestaat voor deze arm niet. Geen
DB-wijziging, geen schrijfrecht, en geen call per hit — het register wordt eenmalig per
meting opgebouwd en pas wanneer er een hit binnen de root is.

Bewust geaccepteerde beperking: Office-weergave-URL's (`/:w:/…`, `/:p:/…`) volgen het
bibliotheekpad niet en vallen dus fail-closed af onder `mapping`. Zichtbaar in de teller,
en benoemd in het rapport.

### G-2 — Extractlokalisatie is een nieuwe faalmodus, en die past niet in de audit van de brug

De eis "het Microsoft-extract moet uniek in de actuele eigen extractie te lokaliseren zijn"
is een negende afwijsreden naast de bestaande acht. De acht zijn echter hard gecodeerd in
`SHAREPOINT_RETRIEVAL_AUDIT_AFWIJZINGEN` (`microsoft-sharepoint-retrieval-smoke-core.ts`),
die de DB-auditprojectie van de Preview-brug voedt. Uitbreiden daarvan is een wijziging aan
live-retrievalproductiecode.

Gekozen: de negende categorie (`lokalisatie`) komt in `SPIKE_AFWIJSCATEGORIEEN` in
`scripts/spike/.../types.ts` — spike-eigen code, geen productiecode. De brug blijft
ongeraakt omdat `maakVeiligeMeetrij()` acht expliciete platte velden schrijft en
`projecteerAuditAfwijzingen()` een vaste map van acht leest; een negende categorie
verandert daar niets aan, en de drie bestaande routes houden die teller altijd op 0.
De teller zelf komt in de vergelijkingslaag terug als `VeiligeVergelijkrij.afwijzingLokalisatie`,
een type dat de brug nooit ziet. `VeiligeMeetrij` blijft van vorm ongewijzigd.

*Geverifieerd:* de boundarygate controleert nu expliciet dat
`microsoft-sharepoint-retrieval-smoke-core.ts` het woord `lokalisatie` niet bevat, zodat
de auditprojectie niet ongemerkt kan meegroeien.

### G-3 — `SpikeRoute` mag niet verbreed worden

`SpikeRoute` verbreden met `"copilot_retrieval"` breekt de typecheck van de Preview-brug:
`maakVeiligeMeetrij()` levert daar een `VeiligeMeetrij` die als `SharePointRetrievalVeiligeMeting`
(3 routes) wordt teruggegeven (`microsoft-sharepoint-retrieval-smoke.ts:263-267`). Daarom:
`SpikeRoute` blijft ongewijzigd en de vergelijkingslaag gebruikt een nieuw, spike-eigen
`SpikeVergelijkRoute = SpikeRoute | "copilot_retrieval"`. `SpikeUitkomst` en `VeiligeMeetrij`
zijn daarvoor generiek gemaakt over de route (`SpikeUitkomstBasis<R>` / `VeiligeMeetrijBasis<R>`),
met de bestaande namen als alias op `SpikeRoute`. Nul regels productiecode.

### G-4 (blokkerend voor T2-kwaliteit, niet voor deze tranche) — semantische scenario's zijn met de huidige fixtures niet live te meten

Het ticket eist minimaal twee scenario's waarin de relevante passage **geen** letterlijke
term uit de vraag bevat. De #385-fixtures zijn juist volledig om unieke canary-termen
gebouwd — `bron/genereer-docx.py:165-194` zet de canaryterm, de vraag én het antwoordfeit
letterlijk in het document. Er is geen parafrase- of synoniemtekst aanwezig.

Gevolg: de semantische arm kan **hermetisch** volledig worden gebouwd en gemeten (met eigen
gegenereerde fixturebytes), maar een **live** semantische meting vereist eerst twee nieuwe
synthetische fixtures in het #385-manifest én in SharePoint. Dat is fixture-/tenantwerk en
hoort bij T3. Het staat als expliciete voorwaarde in de beslisnotitie.

Bijkomend, en belangrijk voor de interpretatie: de eigen passagekeuze
(`passageUitSegmenten`) is puur lexicaal. Bij een semantische vraag scoort elk segment 0 en
valt de kandidaat af onder `extractie`. Voor de Copilot-route is dat anders — daar bepaalt
de **lokalisatie van het Microsoft-extract** de passage. Dat verschil is precies de winst
die #407 wil meten, maar het moet in het rapport benoemd worden, anders leest het als een
bug in de bestaande routes.

### G-5 — vaste API-grenzen die afwijken van de bestaande routes

* `maximumNumberOfResults` ≤ 25, terwijl de bestaande routes tot 50 kandidaten gaan →
  clampen op 25 voor deze arm, en dat vastleggen in de vergelijking (k is niet gelijk).
* `queryString` ≤ 1.500 tekens, één zin, server-side begrensd.
* `filterExpression` volledig server-side uit de herlezen root; een ongeldige filtervorm
  moet **vóór** de netwerkcall blokkeren, omdat Microsoft documenteert dat ongeldige KQL
  ongescoped kan uitvoeren.
* `dataSource` staat vast op `sharePoint`; één databron per call, geen interleaving.
* Eigen requestbudget bovenop de Microsoft-grens van 200/uur/gebruiker.

### G-6 — `candidate_union` moet van 2 naar N armen

`verenigKandidaten()` neemt nu exact twee lijsten. Wordt generiek over N lijsten, met
dezelfde deterministische RRF-ordening. Bestaand gedrag voor twee lijsten blijft identiek
(regressietest).

## 3. Wat deze tranche oplevert

**T0 — voorbereiding**
* `copilot-retrieval.ts`: server-only client, vaste endpointpin, server-side filteropbouw
  met vormvalidatie vóór de call, eigen requestbudget, fout-/timeout-/cancellationnormalisatie.
* Additieve spike-types; nul wijziging aan `SpikeRoute`, `SPIKE_AFWIJSCATEGORIEEN`, `VeiligeMeetrij`.
* Stubs/fixtures voor `retrievalHits`, extracts, leeg, 401/403/429/5xx, timeout, cancellation.

**T1 — bewijs- en veiligheidsketen**
* URL-prefiltering op de herlezen root → read-only locatorregister → registercheck →
  de bestaande, ongewijzigde DriveItem-/versie-/preview-keten.
* Normalisatie en **unieke** lokalisatie van elk extract in de eigen extractie; niet-uniek,
  ontbrekend of gewijzigd = fail-closed onder `lokalisatie`.
* Geweigerde hits bereiken geen ranking, context, citaat, preview, audit of fallback.

**T2 — hermetische kwaliteitsvergelijking**
* Vergelijker over vier armen (DriveItem Search, Microsoft Search, Copilot Retrieval,
  meetunie) op dezelfde scenarioset, inclusief de twee semantische scenario's.
* Metrieken: exacte bronset, recall@k, kandidaatprecision@k, MRR, nDCG, locator-/passagedekking,
  semantische winst, actualiteitscorrectheid, mediaan/p95-latency, Graph-calls, downloads,
  bytes, retries, throttles en afvaltellingen per controle.
* Reproduceerbare runner met dezelfde lokale grendel als het bestaande harnas.

**Documenten**
* Deze planreview, een licentie-/kosten-/consentnotitie en een bijgewerkt spike-rapport.

## 4. Wat deze tranche expliciet NIET doet

* Geen Entra-appregistratie, scope, consent, grant of tokenkluiswijziging.
* Geen pay-as-you-go/billing-configuratie en geen enkele live Graph-call.
* Geen featureflag aangemaakt, gewijzigd of aangezet.
* Geen wijziging aan de Preview-brug, de beheerpagina of enig ander live-retrievalpad;
  de nieuwe route is uitsluitend bereikbaar via de lokale CLI en de hermetische tests, en
  de boundarygate dwingt dat af.
* Geen migratie, geen persistente opslag van inhoud, extracts, chunks of embeddings.

## 5. Verificatie

`npm run typecheck`, `npm run sanity`, de uitgebreide hermetische suite, de uitgebreide
boundarygate, `npm run security:secrets` en `npm run gates`.
