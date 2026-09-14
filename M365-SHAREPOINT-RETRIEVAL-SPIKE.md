# #353 — M365 Fase 5 · T0 live SharePoint-retrievalspike

Status: **Preview-runner gereed voor de live PGB-meetrondes; productiewiring blijft geblokkeerd tot die metingen zijn afgerond**
Onderzoeksdatum: **10–14 september 2026**
Productiewiring: **geen; uitsluitend een dubbel begrensde Preview-smokeroute en beheerpagina**

## Uitkomst in het kort

De voorlopige voorkeursroute is **drive-/root-scoped Graph search met delegated toegang, gevolgd door een zeer kleine, begrensde set live contentdownloads en uitsluitend in-memory extractie**. Deze route kan PDF-pagina's en PowerPoint-dia's als locator leveren, Word minimaal per alinea, en kan eTag/cTag plus een tweede delegated GET als actueel versie- en rechtenbewijs vastleggen. De server volgt alleen reeds geregistreerde lokale fondsreferenties en controleert bronconfiguratie opnieuw vóór toelating.

Microsoft Search (`POST /search/query`) blijft als vergelijkingsroute in het harnas. Die route levert security-trimmed summaries en een Microsoft-rang, maar geen betrouwbaar pagina-/dia- of alinealocator en geen gegarandeerd eTag/cTag in de hit. Bovendien noemt Microsoft voor driveItem-search via deze API delegated `Files.Read.All`/`Sites.Read.All`, terwijl de huidige connector uitsluitend `Sites.Selected` toestaat. Dat is voor deze toepassing een ongunstiger permissionprofiel.

Het go/no-go blijft daarom **NO-GO voor een productieadapter**. De vaste #385-acceptatieset staat inmiddels in de PGB-testsite en de read-grant met delegated `Sites.Selected` is ingericht. De eerdere lokale uitvoerblokkade is opgelost met een server-side Preview-runner: die gebruikt de bestaande geheime runtimeconfiguratie zonder geheimen naar de browser te sturen. De drie vergelijkrondes en de tijdens-verzoekintrekking moeten nog live worden uitgevoerd en beoordeeld. Er is geen bredere consenttoestemming, chatwiring, persistente inhoudsopslag of productieactivatie toegevoegd.

## Branch- en afhankelijkhedeninventaris

De spike staat op `codex/353-sharepoint-retrieval-spike`, opnieuw gebaseerd op de actuele `origin/preview`. De tijdelijke contractspiegel is verwijderd: `SpikeBronresultaat` breidt het echte `Bronresultaat` uit en de niet-aangesloten factory implementeert in compiler en tests het echte `RetrievalAdapter`-contract. Eén expliciete uitzondering op de oorspronkelijke productiegrens is toegevoegd: een `server-only` Preview-bridge mag het harnas aanroepen vanuit precies één dedicated API-route. Chat, zoeken, vergelijken, AI-gateway, `platform` en `fondsen` mogen het prototype niet importeren; de boundarytest borgt dit.

| Afhankelijkheid | Actuele status | Gevolg voor #353 |
|---|---|---|
| [PR #352 — typed retrievalcontract](https://github.com/merlinijzerman/Bestuurdersportaal/pull/352) | Gemergd | Contractmapping en rebase uitgevoerd |
| [PR #355 — cancellation en deadline](https://github.com/merlinijzerman/Bestuurdersportaal/pull/355) | Gemergd | Spike opnieuw gerebased; uiteindelijke adapter kan de gedeelde grendel gebruiken |
| [Issue #385 — PGB-testbibliotheek en acceptatieset](https://github.com/merlinijzerman/Bestuurdersportaal/issues/385) | In uitvoering | Vaste synthetische fixtures en rechtenstructuur staan klaar; live vergelijkrondes, tijdens-verzoekintrekking en replay volgen via de Preview-runner |

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

De standalone adapter staat onder `scripts/spike/sharepoint-retrieval/`. Naast de lokale CLI is er één gecontroleerde Preview-ingang: `/beheer/microsoft-sharepoint-retrieval` roept via een dedicated `server-only`-bridge dezelfde adapter aan. Deze ingang vereist gelijktijdig `SEED_DOELOMGEVING=preview`, `VERCEL_ENV=preview`, fonds-slug `pgb`, de bestaande Microsoft-/SharePoint-pilotpoorten, de extra vlag `microsoft_sharepoint_retrieval_spike` en beheerdercapability. Buiten die combinatie antwoordt de route neutraal met 404. Er is geen service-roleclient.

De browser kan uitsluitend een vaste scenario-, route- en rondecode kiezen. De vragen komen server-side uit de #385-set; tokens, Graph-identifiers, SharePoint-paden, lokale refs, passages en inhoud verlaten de server niet. De respons bevat alleen fixturecodes, tellingen, timing, bytes, foutcategorieën en korte versiehashes. S08 pauzeert na de eerste rechten-/versiecontrole, zodat toegang tijdens hetzelfde verzoek kan worden ingetrokken; de laatste controle moet de kandidaat verwijderen. S09 bouwt als nieuw verzoek alle bron- en rechtenstaat opnieuw op. Een gevonden fixture in S08 of S09 wordt expliciet als `intrekking_niet_effectief` afgekeurd.

De delegated identiteit wordt op drie punten exact gebonden: de portaalactor aan diens eigen private Microsoft-verbinding, de tenant van die verbinding aan de actuele fondsbron en `actorObjectId` uit het opgehaalde token aan de private `microsoft_object_id` uit diezelfde verbinding. `bron.gebruiker_id` blijft auditprovenance van degene die de fondsbron configureerde en is geen leesvoorwaarde. Een gevulde maar afwijkende OID binnen dezelfde tenant faalt vóór de eerste Graph-call.

Per kandidaat is de toelatingsketen:

```text
vaultconfig A → delegated search → lokale ref-match → GET item A
→ summary óf begrensde download + in-memory extractie → GET item B
→ exact dezelfde eTag/cTag → vaultconfig B → previewcheck
→ vaultconfig C → toegelaten contractkandidaat
```

Het bewijs is gebonden aan lokale `ref`, fonds, portaalactor, correlation-id, configuratieversie en controletijd. Site-, drive- en item-id blijven binnen de adapter. De veilige meetvorm bevat alleen fixturecodes, geaggregeerde tellingen en een twaalftekens SHA-256-vingerafdruk van eTag/cTag.

Harde grenzen: maximaal 50 zoekhits, 3 pagina's, concurrency 3, JSON-responses 5 MiB, content 25 MiB, passage 1.200 tekens, 2 retries en standaard 15 seconden. `AbortSignal` loopt door alle fetches en retrywachttijden; normale retrywachttijden verwijderen hun abort-listener direct na afloop. Een 429 volgt begrensd `Retry-After`; 401/403, 404, 412, timeout, cancellation en providerfouten worden genormaliseerd.

Voor `/content` staat automatische redirectvolging uit. Graph moet exact `302` met een HTTPS-`Location` naar de eigen geconfigureerde SharePoint-host of `*.files.1drv.com` retourneren. Alleen de eerste call draagt het Bearer-token; de vooraf geautoriseerde downloadcall krijgt geen Authorization-header en mag niet nogmaals redirecten.

Negatieve scenario's zijn hermetisch gedekt voor ingetrokken of afwezige toegang, actor-/tenantmismatch, gewijzigde bronconfiguratie, onbekend of gemanipuleerd item/drive/site, verplaatsing buiten de root, gewijzigde/ontbrekende versie, onveilige paginering, ongeldige preview, providerfout, timeout, cancellation en throttling. De PGB-run moet revoke, move, rename, change en delete daarnaast nog met echte SharePoint-mutaties bewijzen.

## Meetstatus

| Eis | Hermetisch bewijs | Live PGB-bewijs |
|---|---|---|
| delegated actor-, tenant- en fondsgrens | Ja | **Runner gereed; live ronde open** |
| exacte eTag/cTag vóór/na verwerking | Ja | **Runner gereed; live ronde open** |
| permissionproof met actor + correlation-id | Ja | **Voor-verzoekproef groen; tijdens-verzoekproef open** |
| actuele bronconfiguratieherlezing | Ja, tweemaal | **Runner gereed; live ronde open** |
| intrekking/configuratiedrift geeft nul kandidaten | Ja | **Voor-verzoekintrekking groen; S08/S09 open** |
| timeout/cancellation/throttling/paginering | Ja, synthetische Graph-responses inclusief onveilig vervolgpad | **Runner gereed; live foutpadmetingen open** |
| Word/PDF/PowerPoint passage en locator | PPTX bewezen; productextractors voor DOCX/PDF hergebruikt | **Fixtures staan klaar; drie live rondes open** |
| drie rondes, recall, mediaan/p95, calls en bytes | Harnas en Preview-bediening gereed | **Uitvoering open** |
| geen persistente inhoud/chunks/embeddings | Ja, code- en boundarygate | Nog te controleren in runbewijs |
| drive/root permissionprobe met bestaande `Sites.Selected` | Harnas en veilige uitvoervorm gereed | Server-side Preview-runner neemt de niet-exporteerbare runtimegeheimen over; uitvoering volgt na activering van alleen de PGB-smokevlag |

Er worden bewust geen gesimuleerde milliseconden als live latency gerapporteerd. Na #354 schrijft de runner per vraag en route drie of meer inhoudsvrije meetrijen en berekent hij mediaan/p95, recall, locator-, versie- en previewdekking, Graph-calls, response-/contentbytes, retries, throttles en foutcategorieën.

### Operationeel bewijs permissionprobe — 10 september 2026

De acht vereiste `MICROSOFT_*`-namen zijn exact eenmaal aanwezig in Vercel custom environment `preview-stable`. Vier waarden zijn `Config`; de overige waarden die de probe nodig heeft zijn als niet-uitleesbaar `Secret` opgeslagen. De volgende veilige paden zijn beproefd zonder waarden te loggen of blijvend op te slaan:

- Vercel REST: metadata en `Config` zijn leesbaar, maar de gedecrypte endpoint geeft voor `Secret` bewust geen waarde terug;
- Vercel-dashboard: `Config` heeft *Reveal Value*, `Secret` niet; *Copy to Clipboard* is voor `Secret` uitgeschakeld;
- Vercel CLI 59.15.1 `env run -e preview-stable`: meldt dat 24 secretwaarden niet kunnen worden opgehaald en injecteert ze niet in het childproces.

Daarom heeft de runner geen vaultverbinding of delegated token geopend en is geen Graph-request gedaan. Tijdelijke helpers en de `0600`-config zijn verwijderd; er is geen secretbestand en geen meetbestand achtergebleven. Dit is een operationele blokkade, geen negatieve permissionmeting: over `Sites.Selected` versus `Files.Read` kan hieruit niets worden geconcludeerd.

De gekozen vervolgroute is een afzonderlijk geautoriseerde, Preview-only uitvoercontext waarin de geheimen runtime-only beschikbaar zijn. Die route is dubbel op Preview en PGB begrensd, gebruikt alleen vaste synthetische invoer en staat los van alle productieretrieval. Geheimen zichtbaar maken en scopes verbreden blijven uitgesloten.

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

1. PR-C met de V1–V5-toelatingspoort uit F4-T2-1;
2. afronding van de live #385-rondes met de synthetische bibliotheek, rechtenmatrix en resetprocedure;
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

De lokale live runner weigert productie/CI, vereist een genegeerde `.local.json` met modus 0600 en produceert uitsluitend gesaneerde JSON. De Preview-runner staat beschreven in `security/MICROSOFT-365-F5-RETRIEVAL-SMOKE.md`; hij gebruikt uitsluitend runtimegeheimen, vaste scenario's en een gesaneerde SSE-uitvoer. Intrekking kan met de gedocumenteerde pauzefase midden in één request worden uitgevoerd.

## Uitgevoerde verificatie

| Controle | Resultaat |
|---|---|
| spike-adaptertests | 14/14 groen |
| statische productiegrens | 4/4 groen, inclusief de ene toegestane `server-only` Preview-bridge |
| Preview-runnercontract | 4/4 cross-tenant contracttests en 4/4 kernsanitytests groen |
| TypeScript | groen |
| bestaande lokale PR-gates | groen; 729 cross-tenant tests groen |
| unit-/auditinventaris | 144/144 Vitest groen; inventaris vers gegenereerd met 118 geklasseerde handlers |
| productiebuild | groen met de repository-eigen niet-geheime CI-placeholders |
| DB-laag van de gates | overgeslagen omdat geen lokale Supabase-CLI/testdatabase beschikbaar was; deze tranche wijzigt geen database, migratie, grant of RLS-policy |

De lokale gates zijn uitgevoerd met Node 24.15.0 terwijl `package.json` Node 22.x voorschrijft. Dat leverde geen test- of compileerfout op, maar CI op Node 22 blijft leidend.
