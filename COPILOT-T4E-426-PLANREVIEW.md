# T4-E planreview — centrale orkestratie en adapter-per-spoor (#426)

**Status:** ter beoordeling. Geen productiecode geschreven.
**Vertakt van:** `origin/preview` `b3961ba` (bevat #424 / T4-C volledig).
**Datum:** 2026-09-21.

---

## 0. Samenvatting

T4-E maakt de centrale retrievalorkestratie geschikt voor een tweede adapter per spoor. De
richting is in T4-A al vastgesteld (besluit D-1, bevinding B-1): **adapter per spoor**, niet een
composite adapter en niet een tweede `voerVolledigeRetrievalUit()`-aanroep. Deze review werkt
die richting uit tot exacte contractwijzigingen en toetst haar tegen de code zoals die er nu
werkelijk staat.

De uitwerking levert **vijf blokkerende bevindingen** op. Vier daarvan zijn ontwerpbeslissingen
die ik niet zelfstandig hoor te nemen; één is een gat in het gemergede T4-C-contract waardoor
T4-E vandaag geen eerlijk toegangsbewijs zou kunnen bouwen.

**Het zwaarste punt vooraf (B-1):** `KetenTreffer` uit #424 draagt geen bewijsmoment, geen
bronconfiguratieversie en geen bronregistratiereferentie. `Toegangsbewijs` eist die drie. T4-E
zou ze dus moeten *verzinnen* — een bewijs construeren dat niet uit een waarneming komt. Dat is
precies het soort schijnzekerheid dat de toelatingspoort moet uitsluiten. Zonder een additieve
uitbreiding van T4-C is de Copilot-arm niet eerlijk aansluitbaar.

---

## 1. Uitgangsstand

| Tranche | Stand | Betekenis voor T4-E |
|---|---|---|
| T4-B (client, endpointpin, filter, fouten) | op `preview` | consumeren |
| T4-C (mapping, DriveItem, download, extractie, keten) | op `preview` via #424 (`b3961ba`) | consumeren; **B-1 raakt dit** |
| T4-D (readiness, tokeninterface, rolloutpoorten) | PR #425, `OPEN` + `BEHIND`, open reviewbevindingen | contract bekend, nog niet stabiel |
| T4-E | dit ticket | planreview nu, code ná merge van #424 + gecorrigeerde #425 |
| T4-F (beheer, status, duurzame auditprojectie) | apart | **niet** stil meenemen |

De implementatievolgorde uit #426 is aangehouden: productiecode begint pas nadat #425 is
gecorrigeerd, gemerged, en de gecombineerde T4-C/T4-D-contracten opnieuw zijn beoordeeld vanaf
een verse `origin/preview`.

---

## 2. De tien verplichte onderwerpen

### 2.1 De exacte contractwijziging

Drie toevoegingen in `core/lib/retrieval/contract.ts` en `core/lib/retrieval/orkestratie.ts`.
Alle drie **additief en optioneel**; een opdracht die ze weglaat gedraagt zich exact als vandaag.

```ts
// orkestratie.ts — Spoor (nu: { query, grenzen })
export interface Spoor {
  query: RetrievalQuery;
  grenzen: SelectiegrenzenPerQuery;
  /**
   * De adapter VOOR DIT SPOOR. Ontbreekt hij, dan geldt `opdracht.adapter`.
   * Dat is geen gemak maar de byte-identiteitsgarantie: zolang geen enkel
   * spoor dit veld zet, kan de orkestratie niet anders lopen dan vandaag.
   */
  adapter?: RetrievalAdapter;
  /**
   * Wat er gebeurt als DIT spoor zijn bron niet kon raadplegen. Gesloten
   * opsomming, geen vrije tekst, geen providerboodschap.
   *   "stop"  — de beurt stopt fail-closed (default, ook als het veld ontbreekt)
   *   "meld"  — de beurt gaat door, maar UITSLUITEND met een zichtbare
   *             `bronstatus` op de uitkomst; nooit stil.
   */
  bijBronfout?: "stop" | "meld";
}
```

```ts
// contract.ts — bronstatus op de uitkomst
/** Waarom een GEVRAAGDE bron niet in dit antwoord zit. Gesloten en inhoudsvrij. */
export type Bronstatusreden =
  | "bewust_uit"
  | "readiness_ontbreekt"
  | "token_ongeldig"
  | "providerfout"
  | "timeout"
  | "geannuleerd"
  | "geen_resultaten";

export interface Bronstatus {
  /** Adapternaam; vaste enum uit `RetrievalAdapter["naam"]`. */
  adapter: RetrievalAdapter["naam"];
  bronsoort: Bronsoort;
  geraadpleegd: boolean;
  reden: Bronstatusreden;
}

export interface RetrievalUitkomst extends Omit<RetrievalTussenresultaat, "grendel"> {
  // … bestaand …
  /**
   * Alleen aanwezig als er werkelijk iets te melden is. Een veld dat altijd
   * bestaat zou elke bestaande snapshot veranderen zonder iets te zeggen —
   * dezelfde regel als bij `perAdapter[].geweigerd` en `meta.toelating`.
   */
  bronstatus?: Bronstatus[];
}
```

`RetrievalTussenresultaat` krijgt hetzelfde optionele veld, zodat fase 2 het ongewijzigd kan
doorgeven.

**Waarom `bijBronfout` per spoor en niet per beurt.** Een fonds kan het Supabase-pad hard nodig
hebben en de Copilot-arm als aanvulling beschouwen, of andersom. Eén beurtbrede stand zou die
twee gelijkschakelen, en dan bepaalt de zwakste bron het gedrag van de sterkste.

**Waarom `"stop"` de default is.** Een ontbrekend veld moet de veilige kant op vallen. De
tweede reviewronde op T4-A legde dit al vast: een provider- of readinessfout stopt standaard de
beurt; `"meld"` mag alleen met een door de route getóónde bronstatus. Dat laatste is een
UI-verplichting die T4-E niet zelf kan afdwingen — zie B-3.

### 2.2 Herkomstbinding

**Het probleem, concreet.** `verifieerToelating()` bouwt vandaag één `refs`-lijst uit
`kandidatenPerSpoor.flat().map(k => k.ref)` en geeft die aan `adapter.verifieerVersies()`. De
teruggegeven `Map<string, …>` wordt op `ref` opgezocht. Met twee adapters zijn dat twee
namespaces in één sleutelruimte. Een ref is een string; botsing is niet uitgesloten en mag niet
worden aangenomen.

Datzelfde geldt voor `beoordeel()`, dat `Toegangsbewijs.resultaatRef === bron.ref` eist, en voor
de dedup in stap 5 van de orkestratie.

**De oplossing.** Herkomst wordt bijgehouden op **spoorindex**, en daaruit afgeleid op
**adaptergroep**:

```ts
/** Adapteridentiteit binnen deze beurt. NIET de naam: twee sporen kunnen
 *  dezelfde adapternaam hebben met een andere instantie. */
type Adaptergroep = number;

const effectieveAdapter = (i: number) => sporen[i].adapter ?? opdracht.adapter;
// Groepering op OBJECTIDENTITEIT, via een Map<RetrievalAdapter, Adaptergroep>.
// Op naam groeperen zou twee verschillend geconfigureerde instanties van
// dezelfde adapter samenvoegen — en dan deelt de ene de standenmap van de andere.
```

Elke kandidaat draagt intern zijn groep mee (`spoor → groep`), niet zijn `ref`. Alle
sleutelruimtes — versiestanden, bronregistratiestanden, dedup — worden **per groep** gehouden.

**Gelijke `ref` uit twee adapters is daarmee structureel onschadelijk**, en dat is
aantoonbaar te maken met een test die twee adapters bewust dezelfde `ref` laat teruggeven
(vereiste test 3).

### 2.3 Toelating en versiecontrole per adaptergroep

`verifieerToelating()` krijgt een derde vorm:

```ts
export async function verifieerToelating(
  ctx: RetrievalContext,
  adapters: readonly RetrievalAdapter[],      // index = adaptergroep
  kandidatenPerSpoor: readonly (readonly Bronresultaat[])[],
  spoorNaarGroep: readonly Adaptergroep[],
  poortNu?: number,                            // gedeeld over de hele beurt
): Promise<Poortuitkomst>
```

De bestaande enkelvoudige vorm blijft bestaan als dunne wrapper, zodat geen enkele bestaande
aanroeper wijzigt.

Vier invarianten:

1. **Eén `poortNu` per beurt**, gedeeld over alle groepen. Per groep een eigen `Date.now()` zou
   twee bronnen binnen één verzoek aan verschillende vensters toetsen, en dan is V4 niet meer
   één grens maar twee.
2. **Eén `capabilities()` per groep**, niet per beurt. `permissionProof`, `versiebeleid` en
   `ondersteundeFilters` zijn per adapter waar of onwaar; dat was precies de reden om een
   composite adapter te verwerpen (T4-A, B-1a).
3. **Gescheiden standenmaps per groep.** `Map<ref, ActueleVersiestand>` en
   `Map<ref, Bronregistratiestand>` worden nooit samengevoegd. Binnen een groep blijft de
   bestaande invariant: één herlezing per unieke `bronregistratieRef`, nooit per spoor.
4. **Eén hookaanroep per groep per verzoek.** Niet per spoor. Vereiste test 5 meet dit door de
   hook te tellen bij twee sporen op dezelfde adapter.

De foutafhandeling blijft ongewijzigd en dus **per groep**: een hook die gooit levert
`hookFout` voor díé groep; `isAfbreking(e)` gooit onverkort door en stopt de hele beurt.

### 2.4 `verrijkSelectie()` en `verrijkWeergave()` per adaptergroep

`verrijkSelectie()` draait vandaag al per spoor (`orkestratie.ts` stap 5) — daar verandert
alleen wélke adapter wordt aangeroepen: `effectieveAdapter(i)`.

`verrijkWeergave()` is het echte werk. Vandaag: `citeer(ctx, adapter, tussen, opdracht)` roept
één hook aan over **alle** geselecteerde bronnen. Met twee adapters zou adapter A de
weergavemetadata van de bronnen van B mogen zetten — en dat is de laag die de citaten voedt.

Voorstel, **zonder** de signatuur van `citeer()` te breken:

* `RetrievalTussenresultaat` krijgt een intern veld `herkomst: ReadonlyMap<string, Adaptergroep>` plus `adapters: readonly RetrievalAdapter[]`, gevuld door fase 1;
* `citeer()` groepeert `tussen.geselecteerd` op die herkomst en roept per groep de bijbehorende hook aan, **met uitsluitend de bronnen van die groep**;
* ontbreekt de herkomst (elke bestaande aanroeper), dan valt hij terug op de meegegeven `adapter` over alle bronnen — het huidige pad, byte-identiek.

De **volgorde** van `tussen.geselecteerd` blijft leidend voor de citaatnummering. De groepering
is een verdeling voor de hook, geen hersortering: de verrijkte resultaten worden op `ref`
teruggeplaatst in de oorspronkelijke volgorde. Zou de groepering de volgorde bepalen, dan
verschuift de bronnummering zodra een tweede adapter meedoet — en dat is precies wat de
karakteriseringsgoldens moeten bewaken.

### 2.5 Gedrag per situatie

| Situatie | Spoor aangemaakt? | Adapter-/token-/netwerkcall | Uitkomst | `bronstatus` |
|---|---|---|---|---|
| Bewust uit (kill switch of fondsflag dicht) | **nee** | 0 / 0 / 0 | ongewijzigd Supabase-antwoord | geen (er is niets gevraagd) |
| Readiness verloren (`configuratie_ongeldig`, `consent_ontbreekt`, `billing_ontbreekt`, `tijdelijk_geblokkeerd`) | ja | 0 token, 0 netwerk | `bijBronfout: "stop"` → beurt stopt; `"meld"` → door mét `bronstatus` | `readiness_ontbreekt` |
| Tokenfout (bevestiging faalt op tenant/actor/app/scope) | ja | 0 netwerk | idem | `token_ongeldig` |
| Providerfout (4xx/5xx, responsvorm) | ja | ≥1 netwerk | idem | `providerfout` |
| Ketendeadline verlopen | ja | ≥1 | `deadlineVerlopen` → behandeld als niet-volledig geraadpleegd | `timeout` |
| Beurtannulering | ja | — | **werpt**, geen fail-safe, geen vervolgpoging | n.v.t. |
| Gedeeltelijk resultaat (keten leverde treffers maar kapte af) | ja | ≥1 | treffers tellen mee, `bronstatus` meldt de afkapping | `timeout` |

Twee regels die hier niet uit de tabel mogen wegvallen:

* **`isBewustUit()` is de enige toestand waarin het spoor niet wordt aangemaakt.** Elke andere toestand levert een spoor dat zichtbaar faalt. Dat onderscheid komt rechtstreeks uit `rollout-core.ts` van T4-D en wordt hier niet opnieuw geïnterpreteerd.
* **Een gedeeltelijk resultaat is nooit stil.** `KetenTelling.deadlineVerlopen` uit #424 is precies het veld dat dit zegt; T4-E moet het lezen en naar `bronstatus` vertalen. Doet hij dat niet, dan is een afgekapte arm niet te onderscheiden van een arm die niets vond — en dat is de stille degradatie die #426 verbiedt.

### 2.6 Injectie van T4-C en T4-D

De Copilot-adapter is een **dunne wrapper** in `core/lib/microsoft-retrieval/` die:

* `voerKetenUit()` aanroept en zijn `KetenTreffer[]` naar `Bronresultaat[]` vertaalt;
* `capabilities()` eerlijk declareert: `permissionProof: true`, `versiebewijs: true`, `versiebeleid: { sterk: ["etag", "ctag"], gedegradeerd: [] }`, `bronsoorten: ["sharepoint"]`;
* `verifieerBronregistratie()` en `verifieerVersies()` implementeert bovenop dezelfde T4-C-primitieven;
* **geen** beveiligingslogica uit T4-C of T4-D dupliceert.

Alles wat een geheim raakt wordt **geïnjecteerd**, nooit gelezen in de route:

| Wat | Wie levert het | Wat de route ziet |
|---|---|---|
| access token | T4-D tokenbron, als `() => Promise<{accessToken}>` | niets |
| readiness | T4-D `beoordeelReadiness()`, op een server-side gelezen bewijs | alleen de toestand-enum |
| bronregistratie | `herleesBron()` via de fondsgebonden client | opaque ref |
| Graph-lezingen | `ItemLezer`, gesloten over het beurtsignaal | niets |

**Geen service-role in de retrievalroute.** De routes (`app/api/chat/route.ts`,
`app/api/zoeken/route.ts`) blijven op de anon-key met RLS. De privaatschema-lezingen van T4-D
lopen via `SECURITY DEFINER`-functies met een expliciete grant, niet via een service-role-client.
T4-E voegt daar niets aan toe; als de planreview van #425 op dat punt nog wijzigt, volgt T4-E.

### 2.7 Metadata — wat T4-E doet en wat bij T4-F blijft

**T4-E verzamelt intern**, conform §3.6 van de T4-A-planreview:

```
adapters: [{ naam, methode, resultaatcategorie,
             netwerkpogingen, latencyMs, downloads, bytes, throttles, retries,
             kandidaten_voor_poort, kandidaten_na_poort,
             afwijzingen: { <grond>: <aantal> } }]
```

Uitsluitend vaste enumwaarden en `Number.isFinite`-tellers. **Verboden, ook gehasht:** URL, pad,
bestandsnaam, drive-/item-/bron-id, opaque ref, tokenclaim, providerfouttekst, HTTP-body.
`KetenTelling` uit #424 voldoet al aan die vorm en is vrijwel één-op-één over te nemen.

Twee regels uit eerdere rondes die hier gelden:

* **`metaBasis.diagnostiek` blijft spoor 0.** Ongewijzigd, want dat borgt de byte-identiteit van bestaande snapshots. `adapters` staat ernáást, niet in plaats van.
* **Selectiegebonden tellers worden herbouwd na afkapping.** `bouwRetrievalMeta()` draait tweemaal; de tweede keer over `c.opgenomen`. De per-adapter aantallen opgenomen passages komen uit díé berekening — anders noemt het auditspoor bronnen die nooit naar het model gingen. Beurtbrede providertellers zijn onafhankelijk van de afkapping en reizen ongewijzigd mee.

**Bij T4-F blijft:** de beheerpagina, de statusroute, de duurzame auditprojectie en de migratie
op `public.meta_projectie()`. T4-E schrijft de sleutel `adapters` wél in `RetrievalMeta`, maar
voegt **geen** databaseobject toe en past `meta_projectie()` niet aan. Dat is een bewuste
knip — zie B-4, want zonder die migratie is `adapters` in het duurzame spoor niet zichtbaar.

### 2.8 Deadlines, annulering en resource-eigenaarschap

Het eigenaarschap blijft ongewijzigd: `voerVolledigeRetrievalUit()` maakt de `Afbreekgrendel`,
leent hem uit aan beide fasen en sluit hem in zijn `finally`. T4-E verandert daar niets aan —
dat model is in #322 met reden zo neergezet.

Wat T4-E moet regelen:

* **Elke adaptergroep krijgt hetzelfde `grendel.signal`.** Er komt geen tweede controller bij. De keten uit #424 heeft daarnaast haar eigen, kortere klok; die is een *sub*-budget en mag het beurtsignaal nooit overrulen. Dat klopt al: `voerKetenUit()` combineert beide met `AbortSignal.any` en laat een beurtafbreking altijd voorgaan.
* **De ketendeadline moet worden afgeleid van het resterende beurtbudget**, niet van haar eigen default. Anders start een keten van 15 s in een beurt die nog 3 s te gaan heeft. Zie B-5: `Afbreekgrendel` kent vandaag geen `resterendMs()`.
* **Annulering start geen fail-safe en geen vervolgpoging**, in geen enkele groep. Dat is besluit 0213 §4.4 en geldt onverkort; de bestaande `isAfbreking()`-doorgooiregels in de poort dekken het al.

### 2.9 Het bewijs dat niets verandert zonder tweede adapter

Dit is de bewijslast die T4-A aan D-1 verbond, en zij is de belangrijkste acceptatievoorwaarde.

1. **Structureel:** zolang geen enkel `Spoor.adapter` is gezet, is `effectieveAdapter(i)` voor elk spoor hetzelfde object, is er precies één adaptergroep, en valt `citeer()` terug op het bestaande pad. Alle nieuwe velden zijn optioneel en afwezig.
2. **Aantoonbaar:** de bestaande suites `retrieval-contract`, `retrieval-identiteit`, `retrieval-toelatingspoort`, `retrieval-golden-gevoeligheid` en de karakteriseringsgoldens draaien **ongewijzigd** door. Verandert één golden, dan is dat een semantische wijziging die vooraf moet worden goedgekeurd — nooit een testaanpassing achteraf.
3. **Expliciet gemeten:** een nieuwe test draait dezelfde opdracht twee keer — één keer zonder `Spoor.adapter`, één keer mét een `Spoor.adapter` die hetzelfde object is als `opdracht.adapter` — en eist `deepEqual` op `perAdapter`, `meta`, `bronverwijzingen`, `contextTekst` en `sentinel`. Dat toetst dat het nieuwe pad niet alleen *lijkt* op het oude maar het ook is.

### 2.10 Bestandsgrenzen en verwachte conflicten

| Bestand | Aard van de wijziging |
|---|---|
| `core/lib/retrieval/contract.ts` | additief: `Bronstatus`, `Bronstatusreden`, optioneel `bronstatus` op tussen-/eindresultaat |
| `core/lib/retrieval/orkestratie.ts` | `Spoor.adapter` / `Spoor.bijBronfout`, effectieve adapter per spoor, herkomst op spoorindex, per-groep dedup, `verrijkWeergave` per groep, `adapters`-aggregatie |
| `core/lib/retrieval/toelatingspoort.ts` | meervoudsvorm van `verifieerToelating()`, gedeelde `poortNu`, standenmaps per groep |
| `core/lib/microsoft-retrieval/adapter.ts` *(nieuw)* | de dunne wrapper om T4-C/T4-D |
| `tests/cross-tenant/retrieval-adaptergroepen.test.ts` *(nieuw)* | de twaalf vereiste tests |
| `core/lib/audit-meta.ts` | één sleutel `adapters` in de allowlist |

**Niet** geraakt: `core/lib/microsoft-retrieval/{keten,driveitem,download,mapping,extractlokalisatie}.ts`
(consumeren, niet herimplementeren) — met de uitzondering die B-1 beschrijft. Evenmin de
beheerpagina, de statusroute of `meta_projectie()`; die zijn van T4-F.

**Conflictverwachting #424 × #425: laag.** De bestandslijsten overlappen niet. #424 raakte
`keten.ts`, `download.ts`, `driveitem.ts` en twee testbestanden; #425 raakt `rollout-core.ts`,
`copilot-tokenbron.ts`, een eigen testbestand, twee scripts, `HANDOVER.md`, migraties en checks.
De enige gedeelde raakvlakken zijn `HANDOVER.md` (tekstueel) en `scripts/cross-tenant-ci.sh`
(#425 voegt toe, #424 raakte het niet). #425 staat wel `BEHIND` en moet dus in elk geval
rebasen; daarna is een gerichte hercontrole van de gecombineerde contracten nodig — dat is stap
3 uit de merge-orde van #426.

---

## 3. Blokkerende bevindingen

### B-1 — `KetenTreffer` draagt geen bewijs waarmee T4-E een `Toegangsbewijs` kan bouwen

**Dit is de zwaarste bevinding en zij raakt gemergede code.**

`Toegangsbewijs` (contract.ts) eist zes velden die uit een wáárneming moeten komen:
`resultaatRef`, `bronregistratieRef`, `gebruikerId`, `correlationId`, `gecontroleerdOp`,
`bronconfiguratieVersie`. De toelatingspoort toetst ze in V1–V5, en V5 herleest de stand
onder `bronregistratieRef`.

`KetenTreffer` uit #424 draagt: `ref`, `naam`, `mappad`, `bestandstype`, `passage`, `pagina`,
`paragraaf`, `versie`, `volgorde`. Géén bewijsmoment, géén configuratieversie, géén
bronregistratiereferentie.

De keten *kent* die waarden wel — `bronNu.configuratieversie` en het moment van de laatste
grondslagcontrole — maar geeft ze niet terug. T4-E zou ze dus moeten reconstrueren, en dat komt
neer op het minten van een bewijs dat niet uit een controle komt. Dan is `gecontroleerdOp` het
moment waarop de wrapper toevallig draaide in plaats van het moment waarop de grondslag is
vastgesteld, en toetst V4 een venster dat niets meer bewaakt.

**Voorstel:** `KetenTreffer` additief uitbreiden met
`grondslag: { bronregistratieRef: string; configuratieversie: number; vastgesteldOp: string }`,
gevuld op precies de plek waar de keten haar laatste grondslagcontrole doet. Dat is een kleine,
niet-brekende wijziging aan `keten.ts`, maar wel aan **gemergede** code — vandaar dat ik hier
akkoord voor vraag in plaats van het in T4-E mee te nemen (**D-4**).

### B-2 — kruis-adapter-duplicaten zijn vandaag niet detecteerbaar

De samenvoeging dedupliceert op `documentIdentiteit.id`:

```js
const primaireDocIds = new Set(primair.map(b => b.documentIdentiteit.id));
const aanvullend = …filter(b => !primaireDocIds.has(b.documentIdentiteit.id));
```

Twee adapters leiden die identiteit uit verschillende namespaces af. Een SharePoint-document dat
zowel in Supabase is geïndexeerd als via Copilot terugkomt, krijgt dus **twee verschillende
identiteiten** en wordt **twee keer geciteerd**, onder twee bronnummers, met mogelijk twee
verschillende passages uit hetzelfde stuk.

Dat is geen beveiligingsprobleem maar wel een antwoordkwaliteitsprobleem, en het valt niet
vanzelf op: het antwoord oogt rijker in plaats van dubbel.

Twee routes, beide met gevolgen:

* **(a) Accepteren en vastleggen.** Eenvoudig, eerlijk, en zichtbaar in de audit via `adapters`. Risico: de gebruiker ziet dubbele bronnen.
* **(b) Providerneutrale dedupsleutel.** Bijvoorbeeld de canonieke `webUrl`-afgeleide die T4-C al berekent. Maar die is providerspecifiek en hoort per contract níét in de orkestratie; hem daar introduceren zou de laag die bewust geen `DocumentChunk` kent alsnog providerkennis geven.

Ik heb hier geen voorkeur die ik zelfstandig mag opleggen (**D-2**).

### B-3 — `"meld"` is pas veilig als de route de bronstatus werkelijk toont

`bijBronfout: "meld"` betekent: doorgaan met een kleinere bronset, mits de gebruiker ziet dat er
een bron ontbreekt. T4-E kan het eerste afdwingen en het tweede niet — het tonen gebeurt in
`app/api/chat/route.ts` en `app/api/zoeken/route.ts`, en in de UI daarboven.

Zolang die weergave er niet is, is `"meld"` in de praktijk stille degradatie met een veld
erbij. **Voorstel:** T4-E levert `bronstatus` en een contracttest die eist dat `"meld"` zonder
gezette `bronstatus` onmogelijk is, maar `"meld"` blijft tot de UI-tranche **ongebruikt** —
elk spoor dat T4-E aanmaakt staat op `"stop"`. Daarmee is het veld gebouwd en het risico niet
genomen.

### B-4 — `adapters` in de meta zonder migratie is een halve sleutel

Uit #322 is de les vastgelegd: een nieuwe metasleutel vereist **zowel** een toevoeging in de
TS-allowlist (`core/lib/audit-meta.ts`) **als** een migratie op `public.meta_projectie()`. T4-E
mag geen databaseobjecten toevoegen en T4-F bezit de duurzame projectie.

Gevolg zoals het nu staat: `adapters` bestaat in het geheugen en in de route-respons, maar niet
in het duurzame auditspoor. Dat is verdedigbaar als tussenstand, mits het **expliciet** is en
niet per ongeluk. Ik stel voor het zo te doen en in T4-F te sluiten, met een regel in de
aansluittabel zodat het niet stil wegvalt — precies de fout die CLAUDE.md beschrijft bij de
herplanning waarbij veertien R-nummers buiten elk plan vielen.

### B-5 — de ketendeadline kan het resterende beurtbudget niet kennen

`Afbreekgrendel` biedt `signal`, `reden()`, `bewaak()`, `gesloten()` en `stop()` — geen
resterende tijd. `voerKetenUit()` verwacht een `deadlineMs`. Zonder resterend budget zou T4-E
ofwel de statische 15 s meegeven (te lang aan het eind van een beurt) ofwel zelf een tweede klok
bijhouden (twee waarheden).

**Voorstel:** `maakAfbreekgrendel()` krijgt een `resterendMs(): number`, berekend uit de
deadline die hij toch al kent. Additief, geen gedragswijziging voor bestaande gebruikers.
Alternatief is dat T4-E het budget doorgeeft vanuit `opdracht.timeoutMs` minus verstreken tijd,
maar dan staat de rekensom op twee plekken (**D-5**).

---

## 4. Beslissingen die ik aan u voorleg

| # | Vraag | Mijn advies |
|---|---|---|
| **D-1** | Is het Copilot-spoor **primair** of **aanvullend**? Dit bepaalt de bronnummering én `metaBasis.methode`, die vandaag uit spoor 0 komt. | **Aanvullend.** Dan blijft `meta.methode` de Supabase-methode, blijft de bestaande nummering intact en is de byte-identiteit bij één adapter triviaal aantoonbaar. |
| **D-2** | Kruis-adapter-duplicaten (B-2): accepteren, of een providerneutrale dedupsleutel? | **Accepteren en vastleggen**, met zichtbaarheid in `adapters`. Een providerspecifieke sleutel in de orkestratie doorbreekt de laagscheiding die besluit 0213 juist aanbracht. |
| **D-3** | `bijBronfout: "meld"` nu al bruikbaar maken, of bouwen-maar-niet-gebruiken tot de UI-tranche? | **Bouwen, niet gebruiken** (B-3). |
| **D-4** | `KetenTreffer` additief uitbreiden met de grondslaggegevens (B-1) — een wijziging aan gemergede T4-C-code? | **Ja, en het is blokkerend.** Zonder die drie velden kan T4-E geen eerlijk toegangsbewijs bouwen. |
| **D-5** | `resterendMs()` op `Afbreekgrendel` (B-5)? | **Ja.** Eén rekensom op één plek. |

---

## 5. Testplan tegenover de twaalf vereiste tests

| # | Vereiste | Hoe aangetoond |
|---|---|---|
| 1 | zonder spooradapter byte-identiek | bestaande suites ongewijzigd + expliciete `deepEqual`-test (§2.9 punt 3) |
| 2 | dichte poort → 0 adapter-/token-/netwerkcalls | tellende stubs; spoor wordt niet aangemaakt (`isBewustUit`) |
| 3 | gelijke `ref` uit twee adapters | twee adapters met bewust identieke refs; beide bronnen overleven en krijgen eigen standen |
| 4 | filter-/capabilitycontrole per effectieve adapter | adapter A ondersteunt filter X, B niet; alleen B's spoor valt uit |
| 5 | V5/versie eenmaal per unieke adapterbron | twee sporen op dezelfde adapter → hookteller is 1 |
| 6 | intrekking verwijdert alles op die grondslag | `verifieerBronregistratie` levert `verbonden: false`; alle bronnen van die groep vallen weg, de andere groep blijft |
| 7 | `verrijkWeergave` van A krijgt nooit bronnen van B | hook registreert ontvangen refs; assertie op disjunctie |
| 8 | providerfout/readinessverlies zonder stille fallback | `bijBronfout: "stop"` → beurt stopt; `"meld"` → `bronstatus` verplicht aanwezig |
| 9 | timeout/annulering stopt alle groepen, geen fail-safe | telt calls ná de afbreking in beide groepen; moet 0 zijn |
| 10 | contextafkapping herbouwt per-adapter metadata uit werkelijk opgenomen bronnen | kleine `maxContextTekens`; `adapters[].opgenomen` telt alleen wat in `contextTekst` staat |
| 11 | diagnostiek inhouds- en identifiervrij, alle getallen finite | recursieve scan over `meta.adapters`: elke string moet in een enum zitten, elk getal `Number.isFinite` |
| 12 | goldens alleen na goedgekeurde semantische diff | karakterisering draait ongewijzigd; een verschil is een blokker, geen update |

Daarnaast: `tsc`, boundaries, secretscan, security-baseline, volledige cross-tenant inclusief
DB-laag, karakterisering, E2E en productiebuild.

---

## 6. Wat deze review níét heeft vastgesteld

Eerlijkheidshalve, omdat een planreview die alleen zekerheden noemt een verkeerd beeld geeft:

* **#425 is nog niet stabiel.** Ik heb het T4-D-contract gelezen op `origin/codex/423-t4d-oauth-tokenkluis` (`31514ce`), maar die PR staat `BEHIND` met open bevindingen. Elke aanname over `CopilotReadinessToestand`, `beoordeelReadiness()` of de tokenbevestiging kan nog wijzigen. Stap 3 van de merge-orde — hercontrole van de gecombineerde contracten — is dus geen formaliteit.
* **Ik heb geen enkele Microsoft-call gedaan** en niets aan consent, scopes, billing, flags of kill switch geraakt.
* **`bronsoort: "sharepoint"` staat in geen enkel productie-bronbeleid.** Ook met T4-E volledig gebouwd levert de Copilot-arm dus niets, totdat een fonds die bronsoort krijgt. Dat is een bestaande inerte laag en T4-E verandert hem niet — maar het betekent ook dat "het werkt" pas in de activeringstranche aantoonbaar is.
* **De byte-identiteitsclaim is een claim tot hij gemeten is.** §2.9 beschrijft hoe; het bewijs komt pas met de code.
