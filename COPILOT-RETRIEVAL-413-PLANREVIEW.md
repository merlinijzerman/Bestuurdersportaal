# #413 — Planreview T4-A: Copilot Retrieval als productie-adapter achter inerte poorten

Status: **planreview vóór productiecode** (tranche T4-A). Worktree
`mvp-413-copilot-productie`, branch `codex/413-copilot-productie-adapter`, vertakt van
`origin/preview` `1ddc705`.

Mandaat van deze tranche: uitsluitend ontwerp- en contractreview. Er is in deze tranche
**geen regel productiecode gewijzigd** — dit document is de enige oplevering. Productiecode
begint pas na akkoord op §4 en §8.

Alle onderstaande vaststellingen komen uit de code en de migraties op `origin/preview`
`1ddc705`, niet uit ontwerpdocumentatie.

---

## 1. Wat er al staat

| Onderdeel | Plaats | Betekenis voor #413 |
|---|---|---|
| Providerneutraal contract | `core/lib/retrieval/contract.ts` (438 r.) | `RetrievalAdapter`, `AdapterCapabilities`, `Toegangsbewijs`, `Versiebewijs`, hooks `verifieerVersies` / `verifieerBronregistratie` |
| Toelatingspoort V1–V5 | `core/lib/retrieval/toelatingspoort.ts` (421 r.) | 23 weiger­gronden, 4 categorieën, fail-closed, inhoudsvrije samenvatting |
| Orkestratie | `core/lib/retrieval/orkestratie.ts` (584 r.) | **één** adapter per opdracht; selectie, dedup, citatie, audit, afbreekgrendel |
| Opaque identiteit | `core/lib/retrieval/identiteit.ts` | `doc_v1_…`, `passage_v1_…`, `version_v1_…`, `citation_v1_…` (SHA-256) |
| Productie-ingangen | `app/api/chat/route.ts:3095`, `app/api/zoeken/route.ts:139`, `core/lib/vergelijk-productie.ts:237` | alle drie roepen `voerVolledigeRetrievalUit()` met `maakSupabaseAdapter(...)` |
| SharePoint-bronregister | `microsoft_private.sharepoint_bronnen` / `…_documenten` (migraties `2026_09_04_microsoft_sharepoint_fase3*.sql`) | site/drive/root/`configuratieversie`/status; per document `item_id`, `etag`, `ctag`, `mappad`, `web_url` |
| Private DB-rol | rol `microsoft_vault`, schema `microsoft_private` | `revoke … from public, anon, authenticated` + gerichte `grant execute` |
| Tokenkluis + consent | `core/lib/microsoft-connector.ts`, `core/lib/microsoft-config.ts` | scope-allowlist, incrementele consent, `doel`-gebonden uitbreiding (`retrieval_smoke`) |
| Preview-smokebrug (#353/#385) | `core/lib/microsoft-sharepoint-retrieval-smoke*.ts` + `app/api/microsoft/sharepoint/retrieval-smoke/*` | PGB-only, Preview-only, drie meetarmen, 8 vaste afwijzings­tellers |
| Rollout-grendel-patroon | `core/lib/microsoft-sharepoint-retrieval-smoke-gate.ts` | Preview-omgeving ∧ `fonds.slug = 'pgb'` ∧ `fonds_feature_flags` ∧ SharePoint actief |
| Copilot-spike (#407) | `scripts/spike/sharepoint-retrieval/copilot-retrieval.ts` (635 r.) + 864 r. tests | endpointpin, server-side `filterExpression`, KQL-injectiegrens, extract­lokalisatie |
| Boundarygate | `scripts/sharepoint-retrieval-spike-boundary.test.mjs` | verbiedt nú letterlijk de tekst `copilot/retrieval` in `app/`, `core/`, `platform/`, `fondsen/` |
| Beslispoortprofiel | `scripts/spike/sharepoint-retrieval/vergelijking-profielen.ts` | `copilot_beslispoort_4`: 2 rondes, 2 semantische scenario's, budget 1, plafond 4, stop-na-fout |

Conclusie: de veiligheidsketen bestaat al **tweemaal** — als providerneutraal contract met
toelatingspoort in productie, en als bewezen Graph-keten in het spikeharnas. #413 is
in essentie het samenbrengen van die twee, niet het bedenken van iets nieuws.

---

## 2. Bevindingen die het plan sturen

Nummering is ticketlokaal.

### B-1 (blokkerend voor T4-E) — de orkestratie is structureel single-adapter

`Orkestratieopdracht` draagt één `adapter` (`orkestratie.ts:72`). Daar hangen drie dingen aan
vast die een tweede bron nú onmogelijk maken:

* `perAdapter[i].naam = opdracht.adapter.naam` (r. 356) — élke spoorregel krijgt dezelfde naam;
* `metaBasis.methode = uitkomsten[0].methode` en `diagnostiek = uitkomsten[0].diagnostiek` (r. 431-433) — spoor 0 bepaalt de audit voor de hele beurt;
* `verifieerToelating(ctx, adapter, …)` leest **één** `capabilities()` en roept **één** paar hooks aan.

Drie routes zijn overwogen:

* **(a) Composite adapter** (één adapter die intern Supabase én Copilot bevraagt) — **verworpen, fail-open risico.** `AdapterCapabilities.permissionProof` is één boolean voor de hele uitkomst. Staat hij op `true`, dan worden alle Supabase-kandidaten geweigerd (`geen_bewijs`); staat hij op `false`, dan wordt het Microsoft-bewijs *niet getoetst* en is V1–V5 voor de Copilot-arm uitgeschakeld. Hetzelfde geldt voor `versiebeleid` en `ondersteundeFilters`. Een composite adapter kan zijn capabilities per definitie niet eerlijk declareren; het contract verbiedt dat terecht.
* **(b) Tweede, losse `voerVolledigeRetrievalUit()`-aanroep** — **verworpen.** Twee aanroepen leveren twee sentinels, twee citaatnummeringen, twee `RetrievalMeta`'s en twee deadlines; de route zou ze moeten samenvoegen en daarmee precies de selectie-/citatielogica dupliceren die besluit 0213 centraliseerde.
* **(c) Adapter per spoor (gekozen).** `Spoor` krijgt een optioneel `adapter`-veld; ontbreekt het, dan geldt `opdracht.adapter` — exact het huidige gedrag. De poort draait dan één keer per *adaptergroep*, met één gedeelde `poortNu` (nieuwe optionele parameter) zodat de "één beoordeling per verzoek"-regel intact blijft. `perAdapter[i].naam` wordt de naam van de adapter ván dat spoor; `metaBasis` blijft van spoor 0 (het primaire, eigen spoor).

Bewijslast bij (c): een karakteriseringstest die aantoont dat een opdracht **zonder** spoor-adapter byte-identieke `perAdapter`, `meta` en citaties oplevert als vandaag. Zonder dat bewijs is (c) niet acceptabel.

### B-2 (blokkerend voor T4-B) — de bestaande boundarygate verbiedt exact wat #413 moet bouwen

`scripts/sharepoint-retrieval-spike-boundary.test.mjs:32` markeert élk bestand in `app/`,
`core/`, `platform/`, `fondsen/` dat de tekst `copilot/retrieval` bevat als overtreding. De
productie-adapter bevat die tekst per definitie (de endpointpin).

De gate mag hierop **niet worden verzwakt**. Voorstel: de gate wordt omgedraaid en scherper.

1. De spike-bestanden blijven onbereikbaar vanuit `app/`/`core/`/`platform/`/`fondsen/` — ongewijzigd, inclusief de ene bestaande uitzondering (de #353-smokebrug).
2. Nieuw: de tekst `graph.microsoft.com/v1.0/copilot/retrieval` mag in productiecode op **precies één** plek staan (de adapterclient). Elk ander voorkomen is een overtreding.
3. Nieuw: `/beta`, `sharePointEmbedded`, `/v1.0/shares/` en `sharingToken` zijn in de hele productieboom verboden (T4-G-eis, structureel in plaats van per review).
4. De spike blijft bevroren bewijsmateriaal en wordt in #413 niet aangeraakt; productiecode importeert er niets uit (zie B-11).

### B-3 (blokkerend voor T4-C) — de locator→DriveItem-stap vereist een migratie én een verse bevestiging

`POST /v1.0/copilot/retrieval` levert per hit een `webUrl`, geen DriveItem-id (#407 G-1). In
#407 werd dat opgelost met een read-only register dat per meting uit Graph werd opgebouwd,
omdat een migratie buiten dat mandaat viel. In #413 mag dat wel, en dat is ook nodig: een
register per verzoek opbouwen kost een Graph-call per geregistreerd document en is op
productieschaal niet houdbaar.

`microsoft_private.sharepoint_documenten` bevat `web_url` (met een `https://….sharepoint.com/`
CHECK), maar `sharepoint_lees_document()` geeft die kolom **niet** terug en er is geen
opzoekfunctie op URL. Nodig is één nieuwe `security definer`-functie, met `grant execute` aan
uitsluitend `microsoft_vault`:

```
microsoft_private.sharepoint_zoek_document_op_weburl(p_fonds uuid, p_bron uuid, p_weburl text)
  -> dezelfde kolomset als sharepoint_lees_document
```

Exacte gelijkheid op een **genormaliseerde** sleutel (schema+host lowercase, geen query,
geen fragment, padsegmenten onveranderd); geen `like`, geen prefix, geen trigram. Geen
match = afwijzing `mapping`, zonder netwerkcall.

**Kritiek, en de reden dat de DB-lezing alléén niet volstaat:** `web_url` is een momentopname
uit de laatste listing. Na een rename of verplaatsing kan een *andere* file de oude URL
overnemen. Een zuivere DB-match zou dan een hit op document A aan document B koppelen.
Daarom is de mapping pas geldig nadat de verse `GET /drives/{drive}/items/{item}` — die we
voor rechten en versie tóch al doen — een `webUrl` teruggeeft die **exact gelijk** is aan de
genormaliseerde hit-URL. De DB-lezing is dus een index, nooit een bewijs. Ongelijkheid =
`mapping`, fail-closed, vóór elke download.

Bewust geaccepteerd (overgenomen uit #407): Office-weergave-URL's (`/:w:/…`, `/:p:/…`) volgen
het bibliotheekpad niet, matchen dus niet en vallen af onder `mapping`. Zichtbaar als teller.

### B-4 (beslispunt voor de opdrachtgever) — `Sites.Read.All` raakt de scope-allowlist

`MICROSOFT_TOEGESTANE_SCOPES` (`microsoft-config.ts:17`) kent `Sites.Read.All` niet;
`MICROSOFT_SEARCH_SPIKE_SCOPES` voegt alleen `Files.Read.All` toe, en alleen voor
`doel = "retrieval_smoke"` én alleen in de Preview-omgeving (`toegestaneScopes()`,
`microsoft-connector.ts:78-81`). `startKoppeling()` weigert elke scope buiten die verzameling.

T4-D vraagt beide scopes voor te bereiden; de harde uitvoeringsgrens verbiedt consent
"toevoegen of verbreden". Die twee botsen alleen schijnbaar: het verbod geldt de **tenant**
(Entra-grant, admin consent) en elke **live** aanvraag. Een constante die zonder volledige
readiness door geen enkel codepad bereikbaar is, verbreedt niets.

Voorstel — en dit is het scherpste punt van deze review, dus expliciet ter akkoord:

* nieuw `doel: "copilot_retrieval"` met `MICROSOFT_COPILOT_RETRIEVAL_SCOPES = [...SHAREPOINT, Files.Read.All, Sites.Read.All]`;
* `toegestaneScopes()` geeft die verzameling **alleen** terug bij Preview-omgeving ∧ globale kill switch uit ∧ fondsflag aan ∧ `fonds.slug = 'pgb'` — dezelfde conjunctie als de readinessbeslissing, niet een zwakkere;
* er komt in deze tranche **geen route** die de consent start. De consentroute is stap 6 van de uitrolpoort en landt pas in de activeringstranche, als apart, afzonderlijk te reviewen bestand;
* een hermetische test bewijst dat met flag uit (de enige stand die #413 oplevert) `toegestaneScopes("copilot_retrieval")` exact gelijk is aan de huidige verzameling.

Wie dit te ruim vindt, kan de constante ook volledig uit #413 houden; de adapter werkt dan
in T4-G uitsluitend tegen gestubde tokens. Dat is de veiligere, maar ook de latere variant.
**Keuze A of B in §8.**

### B-5 (gunstig) — `bronsoort: "sharepoint"` is vandaag al een gesloten deur

Geen enkele productieroute zet `sharepoint` in het bronbeleid: chat (`route.ts:605`, `:2272`,
`:3079`) en zoeken (`route.ts:144`) leveren alle drie `["fonds","generiek","notulen"]`.
`binnenCentraleServergrens()` weigert elke kandidaat met een bronsoort die niet zowel in het
bronbeleid als in de adaptercapabilities zit — categorie `buiten_scope`.

Dat is een tweede, al bestaande inerte laag, onafhankelijk van de nieuwe vlaggen. Het
bronbeleid moet daarom **server-side uit de fondsconfiguratie** worden afgeleid en nooit als
uitgebreide literal in de routes worden gezet; anders verdwijnt die laag stil.

### B-6 — identiteits- en versievorm dwingen de adapter, niet andersom

De poort toetst runtime op `passage_v1_[a-f0-9]{64}`, `doc_v1_…`, en voor sterke soorten op
`version_v1_[a-f0-9]{64}` (`toelatingspoort.ts:186-217`). De adapter moet dus:

* `maakDocumentIdentiteit(namespace, privateRef)` met namespace `sharepoint:<fondsId>:<bronId>`;
* `maakPassageIdentiteit(docId, passagesleutel)` waarin de passagesleutel de extract-/segmentpositie vastlegt;
* `maakVolledigeVersieHash(privateRef, `${configuratieversie}`, `${eTag}|${cTag}`)` als **publieke projectie** van de versie.

De ruwe eTag/cTag blijven adapterprivate; de dubbele versiecontrole (vóór download, ná
extractie) gebeurt op de ruwe waarden. `versiebeleid` wordt `{ sterk: ["etag","ctag"],
gedegradeerd: [] }` — leeg is fail-closed, en dat is hier de bedoelde stand.

### B-7 — de poort veroorzaakt zelf Graph-verkeer; dat hoort in het callbudget

`verifieerVersies()` wordt door de poort aangeroepen ná `zoek()` en levert de **actuele**
stand, die exact gelijk moet zijn aan wat de kandidaat draagt (`versie_gewijzigd` anders).
Dat is precies de "eTag/cTag ná extractie"-eis uit T4-C — en die valt dus structureel samen
met een contracthook in plaats van met adapter-eigen discipline. Gunstig, maar met twee
gevolgen:

* één verzoek kost: 1 × `POST copilot/retrieval` + N × item-`GET` (mapping/rechten/versie vóór) + M × download + K × item-`GET` (versie ná). Het budget telt **feitelijke netwerkpogingen** inclusief backoff en moet al die posten dekken, niet alleen de POST.
* `verifieerBronregistratie()` leest uitsluitend de DB (`sharepoint_bronnen.status`/`configuratieversie`) en kost geen Graph-call.

Beide hooks moeten afbrekingen **doorgooien** (`isAfbreking`), niet normaliseren: de poort
rekent daarop (`toelatingspoort.ts:333`, `:363`).

### B-8 — een nieuwe auditsleutel vergt twee allowlists, niet één

De kostenteller en de Copilot-diagnostiek reizen mee als `AdapterUitkomst.diagnostiek`
(`Partial<RetrievalMeta>`) en belanden in `governance_log.retrieval_meta`. Die vorm wordt
tweemaal begrensd: `META_BASIS` in `core/lib/audit-meta.ts` én `public.meta_projectie()`
(migratie `2026_09_11_toelating_auditprojectie.sql`, met een eigen allowlist). Een sleutel die
maar in één van beide staat, verdwijnt stil of wordt geweigerd. Beide worden in dezelfde PR
aangepast, met een sanity-test die de twee lijsten tegen elkaar houdt.

### B-9 — twee registers voor route-metadata

Een nieuwe route (readiness/beheerstatus) vereist een rate-limitsleutel in `core/lib/rate-limit.ts`
**en** in de allowlist van `core/lib/ratelimit-enforce.ts`, plus een audithandeling in de
auditinventaris (W11). Patroon: `microsoft_sharepoint_retrieval_spike` (`rate-limit.ts:96`,
`ratelimit-enforce.ts:77`).

### B-10 — `RetrievalAdapter["naam"]` is een gesloten unie

`"supabase-rag" | "microsoft-sharepoint"`. De Copilot-adapter neemt `"microsoft-sharepoint"`
over (het is dezelfde bron, een andere kandidaatweg) in plaats van een derde literal toe te
voegen. Dat houdt `perAdapter[].naam` en elke bestaande snapshot ongewijzigd; welke
kandidaatweg is gebruikt, staat in `methode` (`"sharepoint_live"` bestaat al in het contract)
en in de diagnostiek.

### B-11 — productiecode hergebruikt geen spikecode, en dat kost bewust duplicatie

De boundarygate verbiedt import uit `scripts/spike/…` buiten de ene smokebrug, en dat moet zo
blijven: de spike is bevroren bewijsmateriaal van #407 en mag niet meebewegen met
productiewijzigingen. De nieuwe keten komt daarom in `core/lib/microsoft-retrieval/`, als
eigen implementatie.

Dat is duplicatie van veiligheidslogica, en dat is een echt risico (twee implementaties die
uiteenlopen). Mitigatie: de productiekern krijgt de **hermetische tests van #407 als
karakterisering** — dezelfde invoerfixtures, dezelfde verwachte afwijzingen — zodat afwijkend
gedrag een rode test is en geen ontdekking achteraf. De smokebrug en zijn 8 vaste
auditafwijzingsvelden blijven letterlijk ongemoeid.

### B-12 — `billing` is niet waarneembaar zonder een call

Er bestaat geen lees-API om vast te stellen of de PAYG-billingpolicy actief is; dat blijkt pas
uit het uitblijven van een 402 op een echte call. `billing_ontbreekt` is daarom de
**default­stand tot een expliciete, handmatige registratie** door platformbeheer, en een
ontvangen 402 zet de stand terug naar `billing_ontbreekt` plus `tijdelijk_geblokkeerd` met een
`geblokkeerd_tot`. De beheerpagina toont "onbekend/gereed" en nooit een geraden waarde
(T4-B: "zonder consent/licentie zelf te raden").

---

## 3. De zeven gevraagde antwoorden

### 3.1 Inpassing in `RetrievalAdapter` en de V1–V5-poort

Eén nieuwe adapter, `naam: "microsoft-sharepoint"`, in `core/lib/microsoft-retrieval/adapter.ts`:

```
capabilities(): {
  bronsoorten: ["sharepoint"],
  strategieen: ["gericht", "volledig"],
  ondersteundeFilters: [...exact wat hij afdwingt, niets meer],
  versiebewijs: true,
  versiebeleid: { sterk: ["etag", "ctag"], gedegradeerd: [] },
  permissionProof: true,
  preview: false,          // previewrechten zijn een eigen keten; niet in #413
  cancellation: true,
  timeout: true,
}
zoek()                     -> kandidaten mét Toegangsbewijs en bronregistratieRef
verifieerVersies()         -> verse eTag/cTag-herlezing (de "ná"-controle)
verifieerBronregistratie() -> verse DB-stand van sharepoint_bronnen
verrijkWeergave()          -> alleen documenttype/-datum; géén URL, géén pad
```

De poort wordt niet uitgebreid: alle #413-weigeringen vallen in bestaande gronden
(`buiten_server_scope`, `geen_bewijs`, `v1..v5_*`, `versie_gewijzigd`, `versiestand_ontbreekt`).
Adapter-eigen afwijzingen (`mapping`, `root`, `lokalisatie`, `extractie`) gebeuren vóór de
poort, binnen `zoek()`, en verlaten de adapter uitsluitend als **tellers** in de diagnostiek.
Zo blijft de poort providerneutraal — de eis uit de kopnoot van `toelatingspoort.ts`.

### 3.2 Gegevensstroom en eigenaarschap van cancellation/deadline

Eigenaar blijft `voerVolledigeRetrievalUit()`: die maakt de grendel, leent hem uit en sluit hem
in `finally`. De adapter krijgt uitsluitend `ctx.signal` en:

* maakt **geen** eigen timer die langer loopt dan de beurtdeadline; een kortere armdeadline mag en wordt afgeleid van het resterende budget;
* controleert het signaal vóór elke netwerkpoging, tussen fasen en vóór elke download;
* doet **geen** retry na annulering, deadline, 401/402/403 of budgetuitputting; alleen 429/5xx kennen begrensde backoff, en elke poging telt tegen hetzelfde budget;
* gooit afbrekingen door als afbreking (`isAfbreking`), zodat de poort en de orkestratie ze niet als providerfout normaliseren.

Gegevensstroom: vraag → server-side filter uit de herlezen bron → POST → hits → normalisatie
URL → DB-index → verse item-`GET` (bevestiging URL + root/parent + fonds/tenant/actor +
eTag/cTag vóór) → begrensde in-memory download → eigen extractie → eTag/cTag ná → unieke
lokalisatie van het Microsoft-extract in de eigen extractie → `Bronresultaat` met
`Toegangsbewijs` → poort → selectie → citatie. Het Microsoft-extract zelf wordt **nergens**
`passage`; het bepaalt alleen wélke eigen passage wordt gekozen.

### 3.3 Private configuratie, tokenrollen, migratie en grants

* Tokens: uitsluitend de bestaande kluis (`microsoft_private`, rol `microsoft_vault`, eigen `Pool`, TLS met vastgepinde CA). Geen service-role, geen Supabase-client voor deze data.
* Nieuw in `microsoft_private`, alle `security definer` + `revoke … from public, anon, authenticated` + `grant execute … to microsoft_vault`:
  * `sharepoint_zoek_document_op_weburl(uuid, uuid, text)` — B-3;
  * `copilot_retrieval_lees_stand(uuid)` / `copilot_retrieval_registreer_uitkomst(uuid, uuid, text, uuid, jsonb)` — rolloutstand, 402-registratie, `geblokkeerd_tot`, inhoudsvrije telling.
* Nieuwe tabel `microsoft_private.copilot_retrieval_stand` (fonds_id, billing_status, consent_bewijs_op, geblokkeerd_tot, laatst_foutcategorie, configuratieversie). Geen vraag, geen URL, geen pad, geen extract.
* `fonds_feature_flags.flag_key = 'microsoft_copilot_retrieval'` voor de fondsflag; schrijfpad uitsluitend platformbeheer (variant C), niet via een fondsroute.
* Migraties worden per CLAUDE.md eerst in Supabase gedraaid en daarna pas code-deploy; de structurele gates (A–H) draaien na de grantwijziging.

### 3.4 Rollouttoestanden en foutcategorieën

Readiness is een **conjunctie**; elke ontbrekende term levert een eigen, niet-gissende stand:

| Stand | Voorwaarde | Gevolg |
|---|---|---|
| `uit` | globale kill switch aan, óf fondsflag uit, óf niet-Preview, óf fonds ≠ pgb | geen spoor, geen adapter, geen call |
| `billing_ontbreekt` | geen registratie, of laatste uitkomst 402 | geen call |
| `consent_ontbreekt` | verbinding mist `Files.Read.All` **of** `Sites.Read.All` | geen call |
| `configuratie_ongeldig` | bron inactief, root/drive/site onvolledig, filter faalt vormvalidatie | geen call |
| `tijdelijk_geblokkeerd` | `geblokkeerd_tot > now()` na 429/5xx/402 | geen call tot het venster verloopt |
| `gereed` | alle bovenstaande in orde | het spoor mag draaien |

Foutafbeelding op `RetrievalFoutcategorie`: 401 → `toestemming_geweigerd`; 402 →
`configuratiefout` (+ stand `billing_ontbreekt`); 403 → `toestemming_geweigerd`; 429 →
`rate_limit`; 5xx → `providerfout`; timeout → `timeout`; cancellation → `annulering`;
onbekende responsevorm → `configuratiefout`. De adapter raadt nooit tussen consent en licentie
— de HTTP-status is leidend en de stand volgt daaruit.

### 3.5 Copilot-primair naast de bestaande routes, zonder fail-open

In productie bestaat er vandaag **geen** tweede SharePoint-retrievalarm: DriveItem Search en
Microsoft Search leven uitsluitend in het spikeharnas en achter de Preview-smokebrug. Er is
dus niets om stil op terug te vallen, en dat blijft zo:

* het Copilot-spoor is een **apart spoor met een eigen adapter** (B-1c), niet een tweede weg binnen één adapter;
* bij mapping-, rechten-, versie- of lokalisatiefouten levert dat spoor simpelweg mínder of geen kandidaten. Er is geen OR-unie, geen providerwissel, geen tweede poging via een andere weg;
* de smokebrug, de documentenlijst en de preview-route blijven byte- en gedragsmatig ongewijzigd.

Lege uitslag versus fout:

| Uitkomst | Beurt | Verantwoording |
|---|---|---|
| `retrievalHits` leeg | gaat door | kwaliteitsuitkomst; teller `geen_resultaten` |
| kandidaten afgewezen op mapping/root/versie/lokalisatie/permissie | gaat door | kwaliteitsuitkomst; inhoudsvrije tellers per grond |
| 401/402/403/configuratie­fout | gaat door **zonder** SharePointbron, maar de meta markeert de bron expliciet als *niet geraadpleegd* | een stil weggevallen bron mag nooit op "er is niets gevonden" lijken |
| 429 / 5xx | idem, plus `geblokkeerd_tot` | storing, geen uitspraak over rechten |
| timeout / cancellation | **stopt de hele beurt** | bestaand gedrag van de grendel; geen terugval |

### 3.6 Auditprojectie en inhoudsvrije kostentellers

Per beurt in `retrieval_meta` (via `diagnostiek`, met de twee allowlists uit B-8): fonds, actor
en correlation-id staan er al; nieuw zijn uitsluitend **tellingen** — netwerkpogingen per
soort, latency (mediaan/p95 per beurt is zinloos bij n=1: alleen `latencyMs`), downloads,
bytes, throttles, retries, kandidaten vóór/na poort, afwijzingen per grond, resultaatcategorie
en een kostenindicatie `calls × tarief` (tarief uit configuratie; observatie, geen factuurbron).

Verboden in browser, audit en telemetry: vraag, passage, extract, bestandsnaam, pad, `web_url`,
`drive_id`, `item_id`, private bronref en elke ruwe Graph-response. De bestaande
`sharepoint_registreer_gebeurtenis()` weigert zulke inhoud al actief met een regex-check; de
nieuwe registratiefunctie krijgt dezelfde grendel.

Alarm-/dashboardcriteria: elke 401/402/403; 429-ratio boven drempel; budgetuitputting;
mapping­afwijzingen boven drempel (duidt op drift tussen register en tenant); en een
auditafronding waarin tellers niet optellen tot het aantal kandidaten.

### 3.7 Rollback- en activatievolgorde

Activatie (na akkoord, ná terugkeer van de admin): migraties → code-deploy naar Preview met
kill switch **aan** → readiness-pagina toont `uit` → PAYG/billing (stappen 1–5 van de
uitrolpoort) → tijdelijke consent (stap 6) → nulstand en fixtures controleren (stap 7) →
kill switch uit, fondsflag aan voor PGB Preview → `copilot_beslispoort_4` (max 4 calls) →
flag uit, grants intrekken, herstel bewijzen (stap 10).

Rollback is op elk moment één stap: de globale kill switch aan. Dat sluit vóór de
tokenaanvraag, dus ook bij een halfvoltooide activering. Daarnaast: fondsflag uit, en als
laatste redmiddel de migratie terug via het bijbehorende rollbackbestand (patroon
`supabase/rollbacks/…_ROLLBACK.sql`). De adapter zelf laat niets achter dat teruggedraaid moet
worden: er wordt geen inhoud, chunk, extract of embedding opgeslagen.

---

## 4. Aansluittabel: tranche → oplevering

| Tranche | Bestanden (nieuw/gewijzigd) | PR |
|---|---|---|
| T4-B adapterclient | `core/lib/microsoft-retrieval/copilot-client.ts` (endpointpin, filteropbouw, vormvalidatie, budget, foutnormalisatie) | PR-A |
| T4-C bewijsketen | `core/lib/microsoft-retrieval/keten.ts`, `…/mapping.ts`, `…/extractlokalisatie.ts` + migratie `sharepoint_zoek_document_op_weburl` | PR-A |
| T4-D poorten en kluis | `core/lib/microsoft-retrieval/readiness.ts`, `microsoft-config.ts` (B-4, keuze A/B), migratie `copilot_retrieval_stand` | PR-B |
| T4-E orkestratie | `core/lib/retrieval/contract.ts` (`Spoor.adapter`), `core/lib/retrieval/orkestratie.ts` (adapter per spoor, gedeelde `poortNu`), `core/lib/retrieval/toelatingspoort.ts` (optionele `poortNu`) | PR-C |
| T4-F beheer/audit | readinessroute + beheerpaneel, `core/lib/audit-meta.ts`, migratie `meta_projectie`, `rate-limit.ts`, `ratelimit-enforce.ts` | PR-D |
| T4-G verificatie | `tests/cross-tenant/copilot-retrieval-*.test.ts`, herschreven `scripts/sharepoint-retrieval-spike-boundary.test.mjs` (B-2) | in elke PR, gate-PR als sluitstuk |

Niets uit het ticket valt buiten deze tabel; de uitrolpoort (stappen 1–10) is bewust géén
tranche van #413 en krijgt een eigen ticket.

---

## 5. Wat deze tranche expliciet NIET doet

* Geen PAYG-, Azure- of billingconfiguratie; geen resource group; geen budgetmelding.
* Geen Entra-permission, geen delegated consent, geen grant — en geen route die er één start.
* Geen enkele live `copilot/retrieval`-call; alle tests zijn hermetisch, zonder netwerk en zonder DB.
* Geen Preview- of Productieflag geactiveerd; alles standaard uit en fail-closed.
* Geen productie- of klantdocument; uitsluitend de #385-fixtures en gegenereerde bytes.
* Geen opslag van extract, inhoud, chunk, prompt of embedding.
* Geen `/beta`, geen `sharePointEmbedded`, geen `/shares`, geen application permission, geen achtergrondcrawl.
* Geen wijziging aan de #353-smokebrug, de drie bestaande meetarmen of het spikeharnas.

---

## 6. Verificatie

`npm run typecheck`, `npm run sanity`, `npm run lint:boundaries`, `npm run test:xtenant`,
`npm run test:spike-boundary` (herschreven), `npm run security:secrets`, `npm run gates`,
`npm run build`, plus de structurele DB-gates A–H na de grantwijziging.

Karakteriseringsbewijs dat in elke PR meeloopt: de W322-goldens en de bestaande
retrieval-snapshots blijven byte-identiek zolang de poorten uitstaan (B-1, B-5).

---

## 7. Restrisico's

1. **Drift tussen register en tenant.** `web_url` veroudert; de verse item-lezing vangt dat fail-closed af, maar bij veel renames daalt de dekking. Zichtbaar als `mapping`-teller met alarmdrempel; niet oplosbaar zonder crawl, en een crawl is buiten scope.
2. **Duplicatie van veiligheidslogica** tussen spike en productie (B-11), gemitigeerd met gedeelde karakteriseringsfixtures.
3. **Geen SLA op PAYG-preview** en propagatietijd tot ~2 uur: de eerste activering kan zonder fout van onze kant falen. Stopregel: geen verborgen retry, elke extra probe vereist apart akkoord (uitrolpoort stap 9).
4. **B-1c raakt de kern van de orkestratie.** Het is additief en bewijsbaar inert, maar het is wel de meest ingrijpende wijziging van #413; PR-C verdient de zwaarste review.

---

## 8. Beslispunten — akkoord nodig vóór PR-A

| # | Vraag | Voorstel |
|---|---|---|
| D-1 | Adapter per spoor (B-1c) in de kern van de orkestratie? | **Ja**, additief, met byte-identiteitstest. Alternatief (composite) is aantoonbaar fail-open. |
| D-2 | Scope-constante `Sites.Read.All` nu voorbereiden (B-4)? | **Variant A**: constante nu, achter de volledige readiness-conjunctie, géén consentroute. **Variant B**: constante pas in de activeringstranche; #413 test uitsluitend tegen gestubde tokens. |
| D-3 | Migratie `sharepoint_zoek_document_op_weburl` + tabel `copilot_retrieval_stand` in #413? | **Ja** — zonder migratie is er geen schaalbare locatorstap (B-3) en geen niet-gissende billingstand (B-12). |
| D-4 | Boundarygate herschrijven (B-2)? | **Ja**, en strenger: één toegestane endpointplek, `/beta`/`sharePointEmbedded`/`/shares` structureel verboden in de hele productieboom. |
| D-5 | Besluitnotitie? | Ja — `decisions/0214-copilot-retrieval-primaire-kandidaatbron.md`, te schrijven bij PR-A. |
