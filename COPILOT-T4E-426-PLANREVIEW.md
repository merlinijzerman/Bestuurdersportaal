# T4-E planreview — centrale orkestratie en adapter-per-spoor (#426)

**Status:** versie 2, ter beoordeling. Geen productiecode geschreven.
**Vertakt van:** `origin/preview` `b3961ba` (bevat #424 / T4-C volledig).
**Datum:** 2026-09-21.

**Wijzigingen t.o.v. versie 1:** twee ontwerpblockers uit de review verwerkt (§2.2 en §2.1),
de vijf besluiten D-1 t/m D-5 verwerkt (§4), twee harde activeringsvoorwaarden toegevoegd (§5),
en de stand van #425 en de integratieregistry geactualiseerd (§7).

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

Versie 1 bevatte zelf een fout die de review terecht ving: §2.2 stelde herkomstbinding op
spoorindex voor en §2.4 gebruikte vervolgens een `Map` op `ref`. Dat is exact de botsing die
§2.2 beweert op te lossen. De oorzaak was dat ik "herkomst" en "terugkoppeling na een
adapterhook" als twee losse problemen had behandeld terwijl het er één is. §2.2 en §2.4 zijn
herschreven rond één regel: **een adaptergroep wordt nooit uit een `ref` afgeleid, en elke
beurtbrede sleutelruimte wordt genest per groep.**

Bij het uitwerken daarvan kwamen twee feiten boven die versie 1 niet had: `verrijkWeergave()`
van de Supabase-adapter **laat bronnen vallen** die hij niet herkent, en `metaBasis.primaireRefs`
is een derde beurtbrede ref-sleutelruimte. Beide staan hieronder.

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
| T4-D (readiness, tokeninterface, rolloutpoorten) | PR #425 op `0bc007c`, `OPEN` + `CLEAN`, 12/12 groen; resterende rollbackcorrectie open | contract bekend, nog één correctie te gaan |
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

**`bijBronfout` staat op het spoor maar geldt de ADAPTERGROEP.** Dat verschil is in versie 1
blijven liggen en het is een echt gat: fouten worden per groep afgehandeld — een adapter faalt
één keer, niet één keer per spoor — terwijl het beleid per spoor werd gedeclareerd. Twee sporen
op dezelfde adapter konden dus tegenstrijdige standen dragen zonder dat iets daarover oordeelde.

De natuurlijke plek voor dit veld is de groep, niet het spoor: "deze bron was niet te raadplegen"
is een eigenschap van de bron, niet van de vraag. Het ticket schrijft de vorm op `Spoor` voor,
dus die houd ik aan, met twee regels die de ambiguïteit wegnemen:

* **gemengde standen binnen één adaptergroep zijn ONGELDIG.** De orkestratie toetst dit vóór
  elke aanroep en werpt een configuratiefout — hetzelfde patroon als de bestaande
  `sporen.length === 0`-grendel, die ook een geval afvangt dat het type al verbiedt. Een
  opdracht die een tegenstrijdige bedoeling uitdrukt hoort luid te falen, niet stil te worden
  uitgelegd;
* **en als die controle ooit wordt omzeild, wint `"stop"`.** Fail-closed is de enige veilige
  kant: `"meld"` laat een beurt doorgaan met minder bronnen, en dat mag nooit de uitkomst zijn
  van een dubbelzinnige configuratie.

Waarom niet beurtbreed: een fonds kan het Supabase-pad hard nodig hebben en de Copilot-arm als
aanvulling beschouwen, of andersom. Eén beurtbrede stand zou die twee gelijkschakelen, en dan
bepaalt de zwakste bron het gedrag van de sterkste.

**Waarom `"stop"` de default is.** Een ontbrekend veld moet de veilige kant op vallen. De
tweede reviewronde op T4-A legde dit al vast: een provider- of readinessfout stopt standaard de
beurt; `"meld"` mag alleen met een door de route getóónde bronstatus. Dat laatste is een
UI-verplichting die T4-E niet zelf kan afdwingen — zie B-3.

### 2.2 Herkomstbinding — één regel, overal

**De regel.** *Een adaptergroep wordt nooit uit een `ref` afgeleid, en elke beurtbrede
sleutelruimte wordt genest per groep.*

Versie 1 formuleerde de helft daarvan en brak hem meteen daarna. Onderstaand staat hij volledig,
met alle plaatsen waar hij geldt.

**Waarom niet één samengestelde string.** `${groep}:${ref}` werkt alleen als het scheidingsteken
niet in een `ref` kan voorkomen, en een `ref` is per contract een opaque string zonder
vormbelofte. Een nesting — `Map<Adaptergroep, Map<string, T>>` — heeft die aanname niet nodig en
is even goedkoop.

**Waarom geen intern kandidaat-id.** Dat was mijn eerste gedachte en hij houdt geen stand:
`verrijkSelectie()` en `verrijkWeergave()` geven **nieuwe objecten** terug (zie hieronder), dus
noch objectidentiteit noch een aan het object geplakt id overleeft een hookaanroep. Een id zou
dus tóch via een sleutelruimte moeten worden teruggezocht — hetzelfde probleem, één laag dieper.

**De groep is altijd bekend uit de aanroepplaats, niet uit de data.** Elk spoor heeft een index,
elke index heeft een groep (`Map<RetrievalAdapter, Adaptergroep>` op **objectidentiteit**, niet
op naam — twee verschillend geconfigureerde instanties van dezelfde adapter mogen elkaars
standenmap niet delen). Hooks worden per groep aangeroepen met uitsluitend de bronnen van die
groep, dus wat terugkomt hoort per constructie bij die groep. Er valt nooit iets "op te zoeken".

**Alle beurtbrede sleutelruimtes, en wat ermee gebeurt:**

| Plek | Vandaag | Na T4-E |
|---|---|---|
| `verifieerToelating()` → `verifieerVersies(ctx, refs)` | één `refs`-lijst over álle sporen, één `Map<ref, stand>` | per groep een eigen lijst en een eigen map |
| `verifieerToelating()` → `verifieerBronregistratie(ctx, refs)` | idem | per groep |
| `metaBasis.primaireRefs: ReadonlySet<string>` | beurtbreed op `ref`; gebruikt in `bouwRetrievalMeta()` (r. 182-183) én in `citeer()` (r. 562) | blijft bestaan voor de vorm, maar is **niet langer het mechanisme**; zie hieronder |
| `perRef` in de selectie (`orkestratie.ts` stap 5) | per spoor opgebouwd | ongewijzigd — al per spoor, dus al per groep |
| `chunkPerRef` binnen de Supabase-adapter | adapterprivé | ongewijzigd — één namespace, niet onze zorg |

**`primaireRefs` is de derde sleutelruimte, en versie 1 noemde hem niet.** Hij splitst de
opgenomen bronnen in primair en aanvullend, wat `meta.chunks` en `meta.aanvullend` bepaalt. Een
`ref` uit groep B die toevallig gelijk is aan een primaire `ref` uit groep A zou als primair
worden geteld. Voorstel:

* `metaBasis` krijgt een **optioneel** `primairPerGroep: ReadonlyMap<Adaptergroep, ReadonlySet<string>>`, dat de beslissing draagt;
* het veld is **alleen aanwezig bij meer dan één groep**. Bij één groep is het afwezig en is `metaBasis` dus byte-identiek aan vandaag — dezelfde regel als bij `perAdapter[].geweigerd` en `meta.toelating`;
* `primaireRefs` blijft staan in zijn huidige vorm en betekenis voor bestaande consumenten, maar wordt intern niet meer geraadpleegd zodra `primairPerGroep` er is. Dat is bewust: het veld zit ín `RetrievalUitkomst` (via `Omit<RetrievalTussenresultaat, "grendel">`) en weghalen zou de uitkomstvorm breken.

**Gelijke `ref` uit twee adapters is hiermee structureel onschadelijk** — niet omdat botsing
onwaarschijnlijk is, maar omdat geen enkele beslissing meer op een beurtbrede `ref` rust.
Vereiste test 3 laat twee adapters bewust dezelfde `ref` teruggeven en eist dat beide bronnen
overleven, elk met hun eigen standen, en dat de primair/aanvullend-splitsing klopt.

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
alleen wélke adapter wordt aangeroepen: `effectieveAdapter(i)`. De groep is bekend uit de
spoorindex; er wordt niets opgezocht.

`verrijkWeergave()` is het echte werk. Vandaag roept `citeer()` één hook aan over **alle**
geselecteerde bronnen. Met twee adapters zou adapter A de weergavemetadata van de bronnen van B
mogen zetten — en dat is de laag die de citaten voedt.

**Een feit dat versie 1 miste en dat de eerste oplossing ongeldig maakt.** Ik stelde voor de
verrijkte resultaten "op `ref` terug te plaatsen in de oorspronkelijke volgorde". Dat is niet
alleen botsingsgevoelig; het kán sowieso niet, want `verrijkWeergave()` is géén
lengtebehoudende enrichment. De Supabase-implementatie (`supabase-adapter.ts:219`) doet:

```js
let chunks = geselecteerd.map((b) => chunkPerRef.get(b.ref)).filter(Boolean);
if (chunks.length === 0) return geselecteerd;          // andere lengte-semantiek
const resultaten = chunks.map((c, i) => …);            // kan KORTER zijn
```

Een bron die de adapter niet herkent **verdwijnt**. Positioneel terugkoppelen zou dus
weergavemetadata aan de verkeerde bron hangen, en een strikte lengte-invariant zou de bestaande
adapter breken.

**Het voorstel, zonder de signatuur van `citeer()` te breken:**

* `RetrievalTussenresultaat` krijgt intern `spoorNaarGroep` en `adapters` (de groepenlijst), plus — alleen bij meer dan één groep — de indeling van `geselecteerd` over groepen;
* `citeer()` verdeelt `tussen.geselecteerd` over de groepen **met behoud van de onderlinge volgorde binnen elke groep**, roept per groep de bijbehorende hook aan met uitsluitend die bronnen, en neemt het teruggegeven array **als de nieuwe set voor die groep** — inclusief eventueel weggevallen bronnen, precies zoals vandaag;
* de groepen worden daarna **aaneengeschakeld in volgorde van eerste voorkomen** in `tussen.geselecteerd`. Bij één groep is dat letterlijk de huidige aanroep met de huidige uitkomst — byte-identiek, zonder speciale tak;
* ontbreekt de groepsindeling (elke bestaande aanroeper), dan valt `citeer()` terug op de meegegeven `adapter` over alle bronnen: het huidige pad.

**De bronnummering volgt die aaneenschakeling.** Dat is een keuze met gevolgen: bij twee
adapters bepaalt de groepsvolgorde welke bronnen de lage nummers krijgen. Zij is deterministisch
(eerste voorkomen in de selectie) en daarmee reproduceerbaar, maar zij is niet hetzelfde als
"op relevantie door elkaar". Dat laatste zou een centrale herweging over adapters heen vereisen,
en daar bestaat geen gedeelde score voor — de rangschikking van twee providers is niet
vergelijkbaar. Ik stel de aaneenschakeling voor en benoem de beperking expliciet in §5.

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
voegt **geen** databaseobject toe en past `meta_projectie()` niet aan. Dat is een bewuste knip —
zie B-4 en de harde activeringsvoorwaarde **A-1** in §5: tot T4-F de projectie heeft toegevoegd,
mag `adapters` niet operationeel worden gebruikt.

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
   **Geen spoorvolgorde wordt hardgecodeerd** (besluit D-1). `metaBasis.methode` en
   `metaBasis.diagnostiek` blijven uit spoor 0 komen, wélk spoor dat ook is; de orkestratie
   kent geen "Copilot-spoor" en geen voorkeursvolgorde. Dat de eerste activering het
   Copilot-spoor áchteraan zet, is een keuze van de aanroeper en staat als zodanig in de
   activeringstranche — niet in deze laag. Gevolg dat benoemd moet worden: zet een aanroeper
   het Copilot-spoor vooraan, dan wordt `meta.methode` de Microsoft-methode. Dat is geen bug
   maar de bestaande semantiek van spoor 0, toegepast op een nieuwe situatie.
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
| `core/lib/audit-meta.ts` | één sleutel `adapters` in de allowlist (zie A-1: niet operationeel bruikbaar vóór T4-F) |
| `core/lib/microsoft-retrieval/keten.ts` | **besluit D-4:** additief `grondslag: { bronregistratieRef, configuratieversie, vastgesteldOp }` op `KetenTreffer`, gevuld bij de laatste GESLAAGDE grondslagcontrole |
| `core/lib/retrieval/afbreken.ts` | **besluit D-5:** `resterendMs()` op `Afbreekgrendel`, additief |

**Niet** geraakt: `core/lib/microsoft-retrieval/{driveitem,download,mapping,extractlokalisatie}.ts`
(consumeren, niet herimplementeren). `keten.ts` wordt uitsluitend additief uitgebreid volgens
besluit D-4 — geen herimplementatie van zijn beveiligingslogica. Evenmin de
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

### B-2 — kruis-adapter-duplicaten zijn vandaag niet detecteerbaar *(opgelost per D-2)*

De samenvoeging dedupliceert op `documentIdentiteit.id`:

```js
const primaireDocIds = new Set(primair.map(b => b.documentIdentiteit.id));
const aanvullend = …filter(b => !primaireDocIds.has(b.documentIdentiteit.id));
```

Twee adapters leiden die identiteit uit verschillende namespaces af. Een SharePoint-document dat
zowel in Supabase is geïndexeerd als via Copilot terugkomt, krijgt dus twee verschillende
identiteiten en wordt twee keer geciteerd — met mogelijk twee verschillende passages uit
hetzelfde stuk. Het antwoord oogt daardoor rijker in plaats van dubbel.

**Besluit D-2: een optionele, providerneutrale opaque equivalentiesleutel.**

```ts
// Bronresultaat
/**
 * OPTIONEEL en OPAQUE. Twee resultaten met dezelfde waarde beschrijven hetzelfde
 * onderliggende document. De orkestratie kent er geen betekenis aan toe, leidt er
 * niets uit af en logt hem niet — zij vergelijkt hem alleen op gelijkheid.
 */
equivalentieSleutel?: string;
```

Dedupregel over groepen heen: bij gelijke sleutel blijft de **eerste in spoorvolgorde** staan en
vervalt de latere. Deterministisch, en bij één adaptergroep verandert er niets.

**Het restrisico dat hierbij hoort en dat ik niet wegschrijf:** de sleutel komt van een adapter.
Een adapter in een vroeger spoor kan er in theorie een zetten die gelijk is aan die van een
latere adapter, en zo diens bron onderdrukken. De mitigatie is zichtbaarheid, niet preventie:
elke onderdrukking wordt geteld in `adapters[].onderdrukt_duplicaat`, zodat een arm die
stelselmatig een andere wegdrukt in het auditspoor opvalt. Volledige preventie zou een centrale,
providerneutrale documentidentiteit vereisen, en die bestaat niet zonder providerkennis in de
orkestratie te trekken.

**Zolang geen enkele adapter de sleutel levert, blijven beide bronnen staan.** Dat is een
expliciete tijdelijke beperking, geen eindtoestand — zie §5.

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
niet per ongeluk.

**Vastgelegd als harde activeringsvoorwaarde A-1** (§5): de sleutel mag niet operationeel worden
gebruikt — niet voor beheer, alarmering, facturering of rapportage — zolang T4-F de duurzame
projectie niet heeft toegevoegd. Anders zou een conclusie berusten op data die per beurt
verdwijnt. Dat het in §5 staat en niet alleen hier, is opzet: precies zo viel bij de herplanning
van het reviewrapport veertien R-nummers buiten elk plan — niet afgewezen, gewoon niet
meegenomen.

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

## 4. Genomen besluiten en hoe ze zijn verwerkt

| # | Besluit | Verwerking |
|---|---|---|
| **D-1** | De orkestratie moet **beide** spoorvolgordes ondersteunen; Copilot bij de eerste activering aanvullend, maar niet hardgecodeerd. | §2.9 punt 1. `metaBasis.methode`/`diagnostiek` blijven uit spoor 0, wélk spoor dat ook is. De laag kent geen "Copilot-spoor". De volgordekeuze verhuist naar de activeringstranche. |
| **D-2** | Dubbele citaten niet als eindoplossing; optionele providerneutrale opaque equivalentiesleutel; zolang die ontbreekt blijven beide bronnen staan als expliciete tijdelijke beperking. | B-2 herschreven; `Bronresultaat.equivalentieSleutel?` toegevoegd, dedup op eerste-in-spoorvolgorde, onderdrukking geteld in `adapters[]`. Beperking vastgelegd in §5. |
| **D-3** | `"meld"` bouwen maar niet gebruiken tot route en UI de status aantoonbaar tonen. | B-3 ongewijzigd; elk spoor dat T4-E aanmaakt staat op `"stop"`. Contracttest: `"meld"` zonder gezette `bronstatus` is onmogelijk. |
| **D-4** | `KetenTreffer` uitbreiden met grondslaggegevens, vastgelegd bij de **laatste geslaagde** grondslagcontrole. | B-1; de formulering "laatste geslaagde" is overgenomen in het voorstel, want juist dát moment is wat V4 toetst. |
| **D-5** | Eén `resterendMs()` op de bestaande afbreekgrendel. | B-5; additief op `maakAfbreekgrendel()`, geen gedragswijziging voor bestaande gebruikers. |

De twee ontwerpblockers uit dezelfde reviewronde zijn verwerkt in §2.2 (samengestelde sleutel /
nesting per groep, overal) en §2.1 (`bijBronfout` geldt de adaptergroep; gemengde standen zijn
ongeldig en `stop` wint als de controle wordt omzeild).

---

## 5. Harde activeringsvoorwaarden en tijdelijke beperkingen

Deze staan bewust in een eigen paragraaf. Het zijn geen risico's die "meegenomen worden", maar
voorwaarden die vóór activering aantoonbaar moeten zijn voldaan — precies het soort punt dat bij
een herplanning stil wegvalt als het alleen in een alinea staat.

| # | Voorwaarde / beperking | Opgeheven door |
|---|---|---|
| **A-1** | `meta.adapters` mag **niet operationeel worden gebruikt** — niet voor beheer, alarmering, facturering of rapportage — zolang T4-F de duurzame projectie niet heeft toegevoegd. Tot dan bestaat de sleutel in het geheugen en in de route-respons, maar niet in het auditspoor: elke conclusie eruit zou berusten op data die per beurt verdwijnt. | T4-F: migratie op `public.meta_projectie()` + toevoeging in `META_BASIS` (`core/lib/audit-meta.ts`), met de sanity-test die beide lijsten tegen elkaar houdt. |
| **A-2** | **Dubbele citaten van hetzelfde document over twee adapters heen blijven mogelijk** zolang geen adapter een `equivalentieSleutel` levert. Expliciete tijdelijke beperking, geen eindtoestand. | Beide adapters leveren de sleutel; daarna dedupliceert de orkestratie erop. |
| **A-3** | **`bijBronfout: "meld"` blijft ongebruikt** tot route én UI de `bronstatus` aantoonbaar tonen. Tot dan is elk spoor `"stop"`. | De UI-tranche, met een waarneembare weergave. |
| **A-4** | **De bronnummering bij twee adapters volgt de groepsvolgorde**, niet een gedeelde relevantie. Er bestaat geen vergelijkbare score over providers heen. | Een expliciet ontwerp voor cross-provider weging, als dat ooit gewenst is. Niet T4-E. |

---

## 6. Testplan tegenover de twaalf vereiste tests

| # | Vereiste | Hoe aangetoond |
|---|---|---|
| 1 | zonder spooradapter byte-identiek | bestaande suites ongewijzigd + expliciete `deepEqual`-test (§2.9 punt 3) |
| 2 | dichte poort → 0 adapter-/token-/netwerkcalls | tellende stubs; spoor wordt niet aangemaakt (`isBewustUit`) |
| 3 | gelijke `ref` uit twee adapters | twee adapters met bewust identieke refs; beide bronnen overleven, krijgen eigen standen uit hun eigen genestte map, en de primair/aanvullend-splitsing (`primairPerGroep`) blijft correct |
| 4 | filter-/capabilitycontrole per effectieve adapter | adapter A ondersteunt filter X, B niet; alleen B's spoor valt uit |
| 5 | V5/versie eenmaal per unieke adapterbron | twee sporen op dezelfde adapter → hookteller is 1 |
| 6 | intrekking verwijdert alles op die grondslag | `verifieerBronregistratie` levert `verbonden: false`; alle bronnen van die groep vallen weg, de andere groep blijft |
| 7 | `verrijkWeergave` van A krijgt nooit bronnen van B | hook registreert ontvangen refs; assertie op disjunctie |
| 8 | providerfout/readinessverlies zonder stille fallback | `bijBronfout: "stop"` → beurt stopt; `"meld"` → `bronstatus` verplicht aanwezig |
| 9 | timeout/annulering stopt alle groepen, geen fail-safe | telt calls ná de afbreking in beide groepen; moet 0 zijn |
| 10 | contextafkapping herbouwt per-adapter metadata uit werkelijk opgenomen bronnen | kleine `maxContextTekens`; `adapters[].opgenomen` telt alleen wat in `contextTekst` staat |
| 11 | diagnostiek inhouds- en identifiervrij, alle getallen finite | recursieve scan over `meta.adapters`: elke string moet in een enum zitten, elk getal `Number.isFinite` |
| 13 | *(toegevoegd)* gemengde `bijBronfout` binnen één adaptergroep | opdracht met twee sporen op dezelfde adapter en verschillende standen → configuratiefout vóór elke adapter-, token- of netwerkcall |
| 14 | *(toegevoegd)* `verrijkWeergave` die bronnen laat vallen | groep A laat er één vallen; de overige bronnen behouden hun eigen weergavemetadata en de citaatnummering blijft deterministisch |
| 12 | goldens alleen na goedgekeurde semantische diff | karakterisering draait ongewijzigd; een verschil is een blokker, geen update |

Daarnaast: `tsc`, boundaries, secretscan, security-baseline, volledige cross-tenant inclusief
DB-laag, karakterisering, E2E en productiebuild.

---

## 7. Wat deze review níét heeft vastgesteld

Eerlijkheidshalve, omdat een planreview die alleen zekerheden noemt een verkeerd beeld geeft:

* **#425 is nog niet definitief.** Deze review is geschreven tegen het T4-D-contract op `31514ce`. De PR staat inmiddels op `0bc007c`, `CLEAN` en 12/12 groen, en niet meer `BEHIND` — maar er staat nog een rollbackcorrectie open. **Deze planreview moet daarom ná die correctie opnieuw worden herijkt op de gecombineerde `preview`**, en dat is stap 3 uit de merge-orde van #426, geen formaliteit. Ik heb de contractaannames (`CopilotReadinessToestand`, `beoordeelReadiness()`, `readinessNogGeldig()`, de tokenbevestiging) niet opnieuw tegen `0bc007c` gelegd; dat hoort bij die herijking.
* **De integratieregistry loopt achter op de werkelijkheid.** `pgb_m365_lab_copilot` staat daar op `blocked_on_sharepoint_index`, terwijl de index gereed is en de feitelijke blokkade Copilot-toegang is (`copilot_toegang_geweigerd`). Dat blokkeert deze planreview niet — T4-E doet geen live call — maar het moet vóór een live smoke worden rechtgezet, anders stuurt de registry een volgende sessie naar het verkeerde probleem. Genoteerd als vervolgpunt, buiten de scope van dit ticket.
* **Ik heb geen enkele Microsoft-call gedaan** en niets aan consent, scopes, billing, flags of kill switch geraakt.
* **`bronsoort: "sharepoint"` staat in geen enkel productie-bronbeleid.** Ook met T4-E volledig gebouwd levert de Copilot-arm dus niets, totdat een fonds die bronsoort krijgt. Dat is een bestaande inerte laag en T4-E verandert hem niet — maar het betekent ook dat "het werkt" pas in de activeringstranche aantoonbaar is.
* **De byte-identiteitsclaim is een claim tot hij gemeten is.** §2.9 beschrijft hoe; het bewijs komt pas met de code.
* **Versie 1 van deze review bevatte een ontwerpfout die ik zelf niet ving.** §2.2 stelde herkomst op spoorindex voor en §2.4 gebruikte vervolgens een ref-sleutel. Bij het herschrijven bleken er bovendien twee feiten te zijn die versie 1 niet kende: `verrijkWeergave()` laat bronnen vallen, en `primaireRefs` is een derde beurtbrede ref-sleutelruimte. Dat laatste was met een gerichte grep vindbaar geweest. Ik noem het hier omdat het iets zegt over de betrouwbaarheid van de rest: een planreview die op code steunt is zo goed als de plaatsen waar werkelijk is gekeken, en die verantwoording hoort erbij.
