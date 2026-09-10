# #353 — M365 Fase 5 · T0 live SharePoint-retrievalspike

Status: **prototype en hermetisch securitybewijs gereed; live PGB-meting geblokkeerd door open issue #354**
Onderzoeksdatum: **10 september 2026**
Productiewiring: **geen**

## Uitkomst in het kort

De voorlopige voorkeursroute is **drive-/root-scoped Graph search met delegated toegang, gevolgd door een zeer kleine, begrensde set live contentdownloads en uitsluitend in-memory extractie**. Deze route kan PDF-pagina's en PowerPoint-dia's als locator leveren, Word minimaal per alinea, en kan eTag/cTag plus een tweede delegated GET als actueel versie- en rechtenbewijs vastleggen. De server volgt alleen reeds geregistreerde lokale fondsreferenties en controleert bronconfiguratie opnieuw vóór toelating.

Microsoft Search (`POST /search/query`) blijft als vergelijkingsroute in het harnas. Die route levert security-trimmed summaries en een Microsoft-rang, maar geen betrouwbaar pagina-/dia- of alinealocator en geen gegarandeerd eTag/cTag in de hit. Bovendien noemt Microsoft voor driveItem-search via deze API delegated `Files.Read.All`/`Sites.Read.All`, terwijl de huidige connector uitsluitend `Sites.Selected` toestaat. Dat is voor deze toepassing een ongunstiger permissionprofiel.

Het go/no-go is daarom nu **NO-GO voor een productieadapter**. Niet omdat de route technisch ongeschikt is, maar omdat de Definition of Done live bewijs met de #354-set vereist en die set nog niet bestaat. Er is geen consent, appregistratie, Preview-vlag of productiepad gewijzigd.

## Branch- en afhankelijkhedeninventaris

De spike staat op `codex/353-sharepoint-retrieval-spike`, opnieuw gebaseerd op `origin/preview` nadat PR #352 op 10 september 2026 merge-de. De tijdelijke contractspiegel is daarna verwijderd: `SpikeBronresultaat` breidt nu het echte `Bronresultaat` uit en een niet-aangesloten factory implementeert in de compiler en tests het echte `RetrievalAdapter`-contract. De productiegrens-test verbiedt imports vanuit `app`, `core`, `platform` en `fondsen`.

| Afhankelijkheid | Actuele status | Gevolg voor #353 |
|---|---|---|
| [PR #352 — typed retrievalcontract](https://github.com/merlinijzerman/Bestuurdersportaal/pull/352) | Gemergd | Contractmapping en rebase uitgevoerd |
| [Issue #354 — PGB-testbibliotheek en acceptatieset](https://github.com/merlinijzerman/Bestuurdersportaal/issues/354) | Open | Blokkeert uitsluitend de echte tenantdata, negatieve rechtenproeven en drie live meetrondes |

## Onderzochte officiële routes

| Route | Zoekgedrag | Passages/locator | Delegated permission volgens Microsoft | Versie/rechtenbewijs | Oordeel |
|---|---|---|---|---|---|
| Microsoft Search API, `POST /search/query` met `entityTypes: ["driveItem"]` en KQL `path:` | Full-text over OneDrive/SharePoint, Microsoft-ranking, security trimming voor ingelogde gebruiker, paginering via `from`/`size` | `summary` kan een gemarkeerd fragment bevatten; pagina/dia/alinea ontbreekt | Voor driveItem: `Files.Read.All` of `Sites.Read.All`; `Sites.Selected` staat niet in de endpointtabel | Altijd aparte delegated `GET driveItem` nodig voor eTag/cTag en verse permissionproof | Vergelijkingsroute; niet voorkeursroute |
| DriveItem search, `GET /drives/{drive}/items/{root}/search(q=...)` | Matcht bestandsnaam, metadata en file content binnen een folder-/drivehiërarchie; OData-paginering | Geen bruikbaar fragment in de response; topresultaten moeten worden opgehaald en in-memory uitgelezen | `Files.Read` least privileged; hogere scopes omvatten `Files.Read.All` en `Sites.Read.All`; application `Sites.Selected` is expliciet niet ondersteund | Aparte delegated GET vóór en na download/extractie; exact dezelfde eTag/cTag vereist | **Voorkeur, onder voorbehoud van live scopeproef** |
| Direct `GET driveItem` + `/content` zonder zoekendpoint | Geen fondsbrede zoekfunctie; wel geschikt voor een gerichte vraag op één reeds gekozen document | Lokale in-memory extractie geeft PDF-pagina, PPTX-dia en DOCX-alinea | `Files.Read` least privileged | Dubbele delegated metadata-GET rond de download; afwijkende of ontbrekende eTag/cTag faalt gesloten | Onderdeel van voorkeursroute, niet zelfstandig fondsbreed retrievalpad |
| Azure AI Search SharePoint-indexer met ACL-ingest | Eigen index, lexical/vector/semantic retrieval en eigen chunk-/locatorontwerp | Potentieel beste passagekwaliteit en voorspelbare latency na ingest | ACL-ingest vereist application permissions; delegated wordt hiervoor niet ondersteund | ACL/content is index-time en dus niet per definitie actueel; parent-ACL-wijzigingen vereisen expliciete resync | Alleen gerichte vervolgspike als live Graph de kwaliteits-/latencygrens mist |

Bronnen: [Microsoft Search-overzicht](https://learn.microsoft.com/en-us/graph/api/resources/search-api-overview?view=graph-rest-1.0), [Microsoft Search voor OneDrive en SharePoint](https://learn.microsoft.com/en-us/graph/search-concept-files), [search/query](https://learn.microsoft.com/en-us/graph/api/search-query?view=graph-rest-1.0), [DriveItem search](https://learn.microsoft.com/en-us/graph/api/driveitem-search?view=graph-rest-1.0), [DriveItem metadata](https://learn.microsoft.com/en-us/graph/api/driveitem-get?view=graph-rest-1.0), [DriveItem content](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0), [DriveItem preview](https://learn.microsoft.com/en-us/graph/api/driveitem-preview?view=graph-rest-1.0), [Graph throttling](https://learn.microsoft.com/en-us/graph/throttling), [Azure AI Search SharePoint-indexer](https://learn.microsoft.com/en-us/azure/search/search-how-to-index-sharepoint-online), [Azure AI Search SharePoint-ACL's](https://learn.microsoft.com/en-us/azure/search/search-indexer-sharepoint-access-control-lists).

## Permissionbesluit vóór live meten

De bestaande code en besluit 0210 staan alleen delegated `Sites.Selected` toe. Geen van de twee onderzochte zoekendpointtabellen noemt die scope als ondersteund delegated profiel. Dit moet empirisch worden vastgesteld, precies zoals #321 eerder voor list/delta/preview heeft voorgeschreven:

1. draai beide routes met de reeds verleende `Sites.Selected`-verbinding;
2. als drive-scoped search werkt, blijft consent ongewijzigd;
3. als die route 403 geeft, leg eerst een afzonderlijk consentbesluit voor voor uitsluitend delegated `Files.Read`;
4. accepteer niet stil `Files.Read.All` of `Sites.Read.All`; dat is alleen nodig voor Microsoft Search en vergroot de zichtbare user-scope aanzienlijk;
5. laat server-side bronbinding, lokaal ref-register en live hercontrole ook bij een scope-uitbreiding leidend blijven.

`Files.Read` is dus een **voorstel**, geen reeds verleende of geactiveerde permission. De live PGB-proef moet ook bewijzen of het de geconfigureerde SharePointbibliotheek daadwerkelijk kan lezen en zoeken.

## Prototype en security-eigenschappen

De standalone adapter staat onder `scripts/spike/sharepoint-retrieval/` en kan alleen via de lokale CLI worden gestart. Hij gebruikt voor een live run de bestaande `sharepointAccessToken`, `leesSharePointBron` en `leesSharePointDocument`-grenzen. Er is geen service-roleclient.

Per kandidaat is de toelatingsketen:

```text
vaultconfig A → delegated search → lokale ref-match → GET item A
→ summary óf begrensde download + in-memory extractie → GET item B
→ exact dezelfde eTag/cTag → vaultconfig B → previewcheck
→ vaultconfig C → toegelaten contractkandidaat
```

Het bewijs is gebonden aan lokale `ref`, fonds, portaalactor, correlation-id, configuratieversie en controletijd. Site-, drive- en item-id blijven binnen de adapter. De veilige meetvorm bevat alleen fixturecodes, geaggregeerde tellingen en een twaalftekens SHA-256-vingerafdruk van eTag/cTag.

Harde grenzen: maximaal 50 zoekhits, 3 pagina's, concurrency 3, JSON-responses 5 MiB, content 25 MiB, passage 1.200 tekens, 2 retries en standaard 15 seconden. `AbortSignal` loopt door alle fetches en retrywachttijden. Een 429 volgt begrensd `Retry-After`; 401/403, 404, 412, timeout, cancellation en providerfouten worden genormaliseerd.

Negatieve scenario's zijn hermetisch gedekt voor ingetrokken of afwezige toegang, actor-/tenantmismatch, gewijzigde bronconfiguratie, onbekend of gemanipuleerd item/drive/site, verplaatsing buiten de root, gewijzigde/ontbrekende versie, onveilige paginering, ongeldige preview, providerfout, timeout, cancellation en throttling. De PGB-run moet revoke, move, rename, change en delete daarnaast nog met echte SharePoint-mutaties bewijzen.

## Meetstatus

| Eis | Hermetisch bewijs | Live PGB-bewijs |
|---|---|---|
| delegated actor-, tenant- en fondsgrens | Ja | **Open — #354** |
| exacte eTag/cTag vóór/na verwerking | Ja | **Open — #354** |
| permissionproof met actor + correlation-id | Ja | **Open — #354** |
| actuele bronconfiguratieherlezing | Ja, tweemaal | **Open — #354** |
| intrekking/configuratiedrift geeft nul kandidaten | Ja | **Open — #354** |
| timeout/cancellation/throttling/paginering | Ja, synthetische Graph-responses inclusief onveilig vervolgpad | **Open — #354** |
| Word/PDF/PowerPoint passage en locator | PPTX bewezen; productextractors voor DOCX/PDF hergebruikt | **Open — #354** |
| drie rondes, recall, mediaan/p95, calls en bytes | Harnas gereed | **Open — #354** |
| geen persistente inhoud/chunks/embeddings | Ja, code- en boundarygate | Nog te controleren in runbewijs |

Er worden bewust geen gesimuleerde milliseconden als live latency gerapporteerd. Na #354 schrijft de runner per vraag en route drie of meer inhoudsvrije meetrijen en berekent hij mediaan/p95, recall, locator-, versie- en previewdekking, Graph-calls, response-/contentbytes, retries, throttles en foutcategorieën.

## Beslismatrix live Graph versus Azure AI Search

| Besliscriterium | Live drive-search + in-memory extractie | Azure AI Search SharePoint-indexer |
|---|---|---|
| Bronautoriteit | SharePoint live | Gekopieerde index |
| Rechtenmoment | Per kandidaat met delegated gebruiker | ACL uit laatste succesvolle ingest/resync |
| Intrekking | Kan in hetzelfde verzoek fail-closed worden gezien | Kan achterlopen; parent-scopewijziging vraagt expliciete resync |
| Persistente documentkopie | Nee | Ja, geïndexeerde tekst/chunks/metadata |
| Permissionmodel | Delegated; exacte scope nog live te bewijzen | ACL-ingest is preview en vereist application permissions |
| Passagekwaliteit | Lokale eenvoudige lexical passagekeuze; geen embeddings | Semantic/vector/hybrid mogelijk |
| Locator | PDF-pagina, PPTX-dia, DOCX-alinea | Zelf te ontwerpen in ingest/chunking |
| Actualiteit | Direct, onder Graph-/zoekindexactualiteit | Afhankelijk van indexerschema en sync |
| Querylatency | Meerdere Graphcalls + extractie; nog te meten | Waarschijnlijk lager/stabieler na ingest, maar niet in deze spike gemeten |
| Operationele last | Geen indexbeheer; wel Graph-fouten en downloadkosten | Index, indexer, ACL-sync, credentials, monitoring en kosten |
| Governancefit | Beste fit met “geen kopie” en directe userrechten | Alleen verdedigbaar als kwaliteit/latency zwaarder wegen en ACL-lag wordt beheerst |

### Drempel voor een Azure AI Search-spike

Start pas een afzonderlijke Azure AI Search-spike als de live PGB-meting één van deze vooraf te reviewen grenzen mist:

- recall lager dan 0,80 op de vaste set in twee van drie rondes;
- bruikbare locator/passagedekking lager dan 0,80;
- p95 hoger dan 8 seconden voor gerichte vragen of 12 seconden voor fondsbrede vragen;
- meer dan 10 Graphcalls of 25 MiB content per vraag in de representatieve set;
- Search-indexvertraging maakt actuele/historische versie niet betrouwbaar onderscheidbaar;
- delegated `Files.Read` blijkt onvoldoende en alleen `Files.Read.All`/`Sites.Read.All` maakt zoeken mogelijk;
- scan-PDF of andere noodzakelijke formaten vereisen structureel OCR/chunking buiten het requestpad.

Deze grenzen zijn werkhypothesen en moeten vóór de live ronde door opdrachtgever/security worden bevestigd.

## Afhankelijkheden en vervolgopdracht

Voor de productieadapter zijn minimaal nodig:

1. PR-B cancellation/timeout en PR-C V1–V5-toelatingspoort uit F4-T2-1;
2. afronding van #354 met de synthetische bibliotheek, tweede testidentiteit, rechtenmatrix en resetprocedure;
3. expliciet consentbesluit als de bestaande `Sites.Selected`-scope de voorkeursroute niet draagt;
4. een afzonderlijk ticket voor productie-adapterwiring; chat/zoeken/vergelijken blijven tot die tijd onaangeraakt;
5. alleen bij overschrijding van de meetdrempels: een begrensde Azure AI Search-spike, zonder automatische fallback.

## Reproduceren

Zie `scripts/spike/sharepoint-retrieval/README.md`. De hermetische controle is:

```bash
npm run test:spike:m365-retrieval
npm run typecheck
npm run security:secrets
```

De live runner weigert productie/CI, vereist een genegeerde `.local.json` met modus 0600 en produceert uitsluitend gesaneerde JSON. Intrekking en configuratiewijziging kunnen met de gedocumenteerde handmatige pauzefase midden in een request worden uitgevoerd.

## Uitgevoerde verificatie

| Controle | Resultaat |
|---|---|
| spike-adaptertests | 12/12 groen |
| statische productiegrens | 3/3 groen |
| TypeScript | groen |
| bestaande lokale PR-gates | groen; 513 cross-tenant tests groen |
| productiebuild | groen met de repository-eigen niet-geheime CI-placeholders |
| DB-laag van de gates | overgeslagen omdat `TEST_DATABASE_URL` niet was gezet; deze spike wijzigt geen database of migratie |

De lokale gates zijn uitgevoerd met Node 24.15.0 terwijl `package.json` Node 22.x voorschrijft. Dat leverde geen test- of compileerfout op, maar CI op Node 22 blijft leidend.
