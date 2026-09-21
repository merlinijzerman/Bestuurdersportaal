# T4-E planreview — centrale orkestratie en adapter-per-spoor (#426)

**Status:** versie 10, ter beoordeling. Geen productiecode geschreven.
**Herijkt op:** `origin/preview` `e159653` (bevat #424/T4-C, #425/T4-D,
#430/app365 Fase 1 en #431/post-contractcontrole).
**Datum:** 2026-09-21.

## Versiehistorie

**Deze review is meerdere keren herzien. Wat hieronder als INGETROKKEN staat, is nergens anders in dit
document meer voorgeschreven** — telkens één gezaghebbend algoritme, niet een stapel voorstellen.
Die regel is er niet voor niets: tot versie 5 bleven ingetrokken mechanismen in §2.4 staan naast
hun vervanger, waardoor het document zichzelf tegensprak.

| Versie | Wat veranderde | Wat daarvan later is ingetrokken |
|---|---|---|
| **10** *(deze)* | Verplichte herijking tegen de werkelijk gemergede T4-C/T4-D-contracten. D-6 beslist: security-relevante kandidaatverrijking draait vóór de definitieve servergrens en V1-V5; ná de poort bestaat alleen een gesloten weergavepatch. De oude claim dat route (a) vanzelf byte-identiek is, is ingetrokken: selectie-effecten worden gemeten en iedere semantische golden-diff blijft een aparte blokkade. De live SEM01-retry bevestigde indexgereedheid maar eindigde opnieuw fail-closed op HTTP 403; dat verandert de orkestratie niet. | **Post-poort `verrijkSelectie()` op een volledig `Bronresultaat`** — daarmee kon een reeds toegelaten grondslag alsnog wijzigen. |
| **9** | `verrijkWeergave()` krijgt het `Bronresultaat` niet meer in handen: hij ziet een read-only projectie en levert `WeergaveVerrijking[]` (`behouden` / `weglaten` / `verrijkt`). De orkestratie houdt het toegelaten resultaat zelf en patcht alleen `weergave`. Daarmee vervallen de `null`-sentinel, de refsnapshot en de verse-instantie-tegen-gedeelde-objecten. Nieuwe bevindingen B-6 (de versmalling is niet byte-identiek — `bronsoort` verandert vandaag ná de poort) en B-7 (`verrijkSelectie()` staat in dezelfde positie), besluit D-6, tests 28 en 29. | — |
| 8 | De `WeakMap`-sleutel is niet langer het object van de adapter maar een verse instantie die de orkestratie per occurrence maakt — een hook mag hetzelfde object op twee posities teruggeven. De refcontrole draait tegen een snapshot van vóór de hook, zodat een in-place mutatie niet met zichzelf wordt vergeleken. Tests 26 en 27. | — |
| 7 | De nul-chunkssemantiek van de Supabase-hook expliciet behouden: nul koppelingen ⇒ oorspronkelijke bronnen op alle posities; `null` alleen op ontbrekende posities; en `rang.positie` blijft een teller over de gekoppelde chunks (§2.4, tests 23-25). Test 16 herschreven naar het positionele contract, inclusief `undefined` en sparse array. | — |
| 6 | `verrijkWeergave()` wordt **positioneel**: uitvoer even lang als de invoer, `null` voor een weggelaten bron. Herkomst wordt op **positie** toegekend, nooit op `ref`. Eigenaar en levensduur van de request-lokale herkomststaat vastgelegd (§2.2). §2.4 teruggebracht tot één algoritme. Tests 20 t/m 22. | — |
| 5 | Herkomst van een ref-gebaseerde set naar een request-lokale `WeakMap` op de resultaat*instantie*; `primairPerGroep` vervallen; centrale deduplicatie ingetrokken. | **occurrence-toewijzing met een tweepuntersloop** — ambigu bij twee gelijke refs waarvan er één wegvalt; **contractregel "volgorde behouden"** — vervangen door de sterkere positionele regel |
| 4 | `meta.adapters` niet meer door T4-E aangesloten; T4-F voegt typeveld, allowlist, projectie en route atomair toe. | **centrale exact-ref-deduplicatie** — veranderde één-adaptergedrag bij ≥3 sporen |
| 3 | `equivalentieSleutel` → inerte `equivalentieClaim`; A-1 aangescherpt tot een aansluitverbod; globale ordinals. | **terugkoppeling via `(groep, ref)` met `ordinalPerGroep`** — een ref-sleutel is ná de citaatafkapping uitgewerkt |
| 2 | Twee ontwerpblockers verwerkt (§2.1, §2.2); besluiten D-1 t/m D-5; activeringsvoorwaarden A-1 t/m A-4. | **aaneenschakeling per groep** — veranderde de bronvolgorde |
| 1 | Eerste opzet: de tien onderwerpen uit #426, bevindingen B-1 t/m B-5. | **`Map<ref, Adaptergroep>`** — botste met de eis die zij moest inlossen |

---

## 0. Samenvatting

T4-E maakt de centrale retrievalorkestratie geschikt voor een tweede adapter per spoor. De
richting is in T4-A al vastgesteld (besluit D-1, bevinding B-1): **adapter per spoor**, niet een
composite adapter en niet een tweede `voerVolledigeRetrievalUit()`-aanroep. Deze review werkt
die richting uit tot exacte contractwijzigingen en toetst haar tegen de code zoals die er nu
werkelijk staat.

De uitwerking leverde **zeven blokkerende bevindingen** op. D-1 t/m D-6 leggen de
oplossingsrichting nu vast; B-1 en B-5 worden additief in T4-E gerepareerd. B-6 en B-7 zijn in
versie 10 samengebracht tot één volgorde-invariant: een veld waarop de poort beslist kan ná die
poort niet meer door een adapter worden gewijzigd.

Versie 1 bevatte zelf een fout die de review terecht ving: §2.2 stelde herkomstbinding op
spoorindex voor en §2.4 gebruikte vervolgens een `Map` op `ref`. Dat is exact de botsing die
§2.2 beweert op te lossen. De oorzaak was dat ik "herkomst" en "terugkoppeling na een
adapterhook" als twee losse problemen had behandeld terwijl het er één is. §2.2 en §2.4 zijn
herschreven rond één regel: **een adaptergroep wordt nooit uit een `ref` afgeleid, en elke
beurtbrede sleutelruimte wordt genest per groep.**

Bij het uitwerken daarvan kwamen twee feiten boven die versie 1 niet had: `verrijkWeergave()`
van de Supabase-adapter **laat bronnen vallen** die hij niet herkent, en `metaBasis.primaireRefs`
is een derde beurtbrede ref-sleutelruimte. Beide staan hieronder.

Versie 2 introduceerde vervolgens zelf een regressie: de groepen werden ná verrijking
*aaneengeschakeld*, en dat verandert de bronvolgorde zodra twee adapters elkaars resultaten
afwisselen (`A1, B1, A2` → `A1, A2, B1`). Die fout kwam voort uit dezelfde neiging als de eerste:
een deelprobleem oplossen — "welke hook krijgt welke bronnen" — en de eigenschap die daarbij
moest blijven gelden — "de volgorde ligt al vast" — niet expliciet maken. §2.4 doet dat nu wél,
met een globale ordinal die vóór de groepering wordt vastgelegd.

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
| T4-C (mapping, DriveItem, download, extractie, keten) | op `preview` via #424 | consumeren; **B-1 raakt dit** |
| T4-D (readiness, tokeninterface, rolloutpoorten) | op `preview` via #425; expand/contract op Preview afgerond | contract opnieuw getoetst; consumeren |
| T4-E | dit ticket | planreview herijkt; code pas na expliciet akkoord op versie 10 |
| T4-F (beheer, status, duurzame auditprojectie) | apart | **niet** stil meenemen |

De implementatievolgorde uit #426 is tot en met de verplichte herijking uitgevoerd. Productiecode
begint pas na expliciete goedkeuring van deze versie 10; de gemergede T4-C/T4-D-contracten zijn
dan de vaste basis en niet langer een open voorwaarde.

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
worden geteld.

Versie 3 en 4 losten dat op met een `primairPerGroep`-set. **Dat is niet genoeg, en de vierde
reviewronde wees precies aan waarom:** ná `verrijkWeergave()` worden de groepen weer één
`Bronresultaat[]`, en `bouwCitaties()` levert daaruit alleen `c.opgenomen`. Bij gelijke refs uit
twee groepen kan `bouwRetrievalMeta(c.opgenomen, …)` dán niet meer bepalen bij welke groep een
opgenomen bron hoorde — een ref-gebaseerde set, hoe genest ook, is op dat punt uitgewerkt.

**De herkomst hoort dus bij de RESULTAATINSTANTIE, niet bij de `ref`:**

```ts
interface Herkomst { groep: Adaptergroep; ordinal: number; primair: boolean; }
/** Request-lokaal. Nooit onderdeel van het publieke contract. */
const herkomst = new WeakMap<Bronresultaat, Herkomst>();
```

Dat werkt omdat `bouwCitaties()` de objectreferenties **behoudt**: `opgenomen.push(bron)`
(`citatie.ts:126`) duwt exact het object dat binnenkwam. De binding overleeft de afkapping
zonder dat zij ergens in `RetrievalUitkomst` terechtkomt — een `WeakMap` is niet serialiseerbaar
en kan dus ook niet per ongeluk meelekken naar de route of het auditspoor.

**De sleutel is een instantie die de ORKESTRATIE zelf maakt**, en sinds de versmalling in §2.4 is
dat geen tegenmaatregel meer maar een eigenschap: de adapter krijgt het `Bronresultaat` niet in
handen, dus álle instanties zijn van de orkestratie en elke occurrence is per constructie uniek.
Eerdere versies probeerden dit nog af te dwingen als regel voor de adapter — objectidentiteit is
nu juist een eigenschap die je in een interface niet kunt afdwingen, en dat is precies waarom de
vorm moest veranderen in plaats van de regel.

**Eigenaar en levensduur, expliciet.** De herkomststaat wordt gemaakt door
`voerVolledigeRetrievalUit()` — dezelfde eigenaar als de `Afbreekgrendel` — en via een **private
parameter** uitgeleend aan beide fasen. Zij leeft precies zo lang als het verzoek.

Twee alternatieven die er niet mogen komen, elk om een eigen reden:

* **niet moduleglobaal.** Een `WeakMap` op moduleniveau overleeft het verzoek en wordt gedeeld
  door élk gelijktijdig verzoek in hetzelfde proces. Twee beurten voor verschillende fondsen
  zouden dan in dezelfde staat schrijven. De sleutels zijn objecten en botsen niet, dus het zou
  waarschijnlijk werken — en dat is precies het gevaar: een tenantoverschrijdende structuur die
  niet faalt, wordt niet opgemerkt;
* **niet als veld op `RetrievalTussenresultaat`.** Dat type is via `Omit<…, "grendel">` ingebed
  in `RetrievalUitkomst` en verlaat dus de orkestratie: het gaat naar de route en wordt gelogd.
  Dezelfde redenering als bij de grendel, die om die reden bewust níét in het eindresultaat zit.

`metaBasis.primaireRefs` blijft ongewijzigd bestaan voor bestaande consumenten, maar wordt
intern niet meer geraadpleegd. `primairPerGroep` uit versie 3 **vervalt**: met de herkomst per
instantie is er geen tweede sleutelruimte meer nodig, en dus ook geen extra veld op `metaBasis`.
Dat is meteen één vormwijziging minder.

**Binnen** een groep hoeft `ref` NIET uniek te zijn, en er wordt ook niets gededupliceerd —
zie §2.4. Dezelfde passage kan in twee sporen van dezelfde adapter voorkomen, en dat blijft
precies zoals het vandaag is.

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

### 2.4 Verrijking per adaptergroep — de definitieve poort staat achteraan

Versie 9 versmalde alleen `verrijkWeergave()`. Dat was noodzakelijk maar niet voldoende:
`verrijkSelectie()` krijgt vandaag eveneens een volledig `Bronresultaat`, draait ná V1-V5 en
herbouwt dezelfde security-relevante velden. Een invariantcontrole ná de hook zou het huidige
Supabase-pad bovendien onmiddellijk afwijzen, omdat `bronsoort` daar aantoonbaar van `fonds`
naar `notulen` kan veranderen. Een controle die het geldige bestaande pad direct breekt, wordt
in de praktijk uitgezet; dat is geen houdbaar ontwerp.

**Besluit D-6 kiest daarom route (a), met één aanscherping:** alle verrijking die
`Bronresultaat` buiten uitsluitend `weergave` kan wijzigen, gebeurt vóór de definitieve
servergrens en vóór V1-V5. De poort beoordeelt de kandidaat zoals die werkelijk naar selectie,
prompt en citatie kan gaan. Ná de poort kan geen adapter meer bij identiteit, bewijs, versie,
passage, status, bronsoort of rang.

De volgorde per adaptergroep wordt:

1. `zoek()` levert de ruwe kandidaten;
2. een **voorgrens zonder I/O** verwijdert kandidaten die op hun ruwe, servercontroleerbare
   velden al buiten fonds-, document-, proces- of bronbeleid vallen. Dit is geen toelatingspoort
   en levert geen bewijs; hij voorkomt alleen dat een adapter voor een evident buitenscope-
   kandidaat verrijkings-I/O uitvoert;
3. de nieuwe pre-poorthook `verrijkKandidaten()` draait éénmaal per groep over alle overgebleven
   kandidaten, binnen hetzelfde afbreeksignaal. De hook mag kandidaten verrijken of weglaten,
   maar moet een volledig `Bronresultaat` teruggeven omdat juist die volledige vorm hierna wordt
   beoordeeld;
4. de centrale servergrens draait **opnieuw** op de verrijkte vorm;
5. V1-V5 plus de versieherlezing draaien éénmaal op de verrijkte kandidaatset, vóór
   kandidatenbegrenzing en selectie. Een geweigerde kandidaat kan dus nog steeds geen geldige
   kandidaat verdringen;
6. selectie, samenvoeging en contextafkapping gebruiken uitsluitend deze toegelaten vorm;
7. ná de poort bestaat alleen de gesloten `verrijkWeergave()`-patch hieronder.

`verrijkKandidaten()` vervangt het huidige post-selectiecontract `verrijkSelectie()`. Voor de
Supabase-adapter verhuizen parent-context, notulen- en documentmetadata naar deze fase. Dat kost
meer databasewerk omdat de verrijking vóór de eindselectie draait; het zoekresultaat is echter
al hard begrensd door het adaptercontract en alles deelt het resterende beurtbudget uit §2.8.
T4-E meet calls en latency in de hermetische suite en behandelt budgetoverschrijding als timeout,
niet als gedeeltelijk succes.

**Geen ongefundeerde byte-identiteitsclaim.** Route (a) houdt de eindvelden beschikbaar, maar
verplaatst hun berekening vóór de selectie. Daardoor kunnen titel, passage, bronsoort of
curatievelden de selectie anders beïnvloeden. Versie 9 noemde route (a) zonder voorbehoud
byte-identiek; die claim is ingetrokken. De bestaande goldens moeten eerst ongewijzigd groen
blijven. Ontstaat een verschil, dan is dat een semantische diff die vóór snapshotwijziging apart
wordt beoordeeld. Er wordt niet naar route (b) teruggevallen om de tests groen te krijgen.

**De post-poorthook is alleen presentatie:**

```ts
export type WeergaveVerrijking =
  | { type: "behouden" }
  | { type: "weglaten" }
  | { type: "verrijkt"; weergave: Bronresultaat["weergave"] };

export interface WeergaveKandidaat {
  readonly ref: string;
  readonly weergave: Readonly<Bronresultaat["weergave"]> | undefined;
}

verrijkWeergave?(
  ctx: RetrievalContext,
  kandidaten: readonly WeergaveKandidaat[],
): Promise<WeergaveVerrijking[]>; // positioneel, exact even lang
```

De orkestratie houdt het toegelaten resultaat zelf, maakt per occurrence een verse instantie en
past alleen `weergave` toe. `behouden`, `weglaten` en `verrijkt` zijn expliciete uitkomsten;
`undefined`, een sparse array of een lengteverschil is een configuratiefout. Geen enkele ref-
lookup bepaalt de positie of herkomst.

Na de gezamenlijke selectie krijgt ieder resultaat vóór groepering een globale ordinal en de
herkomst uit §2.2. De groepen worden alleen voor de presentatiehook uit elkaar gehaald; daarna
worden de overlevenden stabiel op ordinal samengevoegd. Zo blijven verweven groepen en gelijke
refs correct, terwijl de hook van groep A nooit een bron van groep B ziet.

De bronnummering bij twee adapters volgt daarmee nog steeds de gezamenlijke selectievolgorde:
primair spoor eerst, daarna de aanvullende sporen. Dat is geen cross-provider scorevergelijking,
maar wel deterministisch en reproduceerbaar. Zie A-4.

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

### 2.7 Metadata — T4-E bouwt de vorm, T4-F sluit hem aan

**Versie 3 was hier intern tegenstrijdig en de review wees dat terecht aan.** A-1 verbood
aansluiting op route en auditpad, terwijl deze paragraaf zei dat T4-E de sleutel in
`RetrievalMeta` zet, §2.10 `audit-meta.ts` wijzigde en B-4 sprak van "in de route-respons". Dat
kán niet samen: `RetrievalUitkomst.meta` **verlaat de orkestratie** — de routes lezen hem en het
auditspoor schrijft hem weg. Iets wat in `RetrievalMeta` staat is per definitie niet intern.

De knip ligt daarom een stap eerder:

**T4-E levert uitsluitend een pure, gesloten aggregatiefunctie** met haar eigen vorm:

```ts
/** Adapterdiagnostiek. Gesloten van vorm, inhoudsvrij, per beurt. */
export interface AdapterDiagnostiek {
  naam: RetrievalAdapter["naam"];
  methode: AdapterUitkomst["methode"];
  resultaatcategorie: Resultaatcategorie;          // vaste enum
  netwerkpogingen: number; latencyMs: number;
  downloads: number; bytes: number; throttles: number; retries: number;
  kandidatenVoorPoort: number; kandidatenNaPoort: number;
  opgenomen: number;                                // ná contextafkapping
  afwijzingen: Partial<Record<Afwijsgrond, number>>;
}

export function bouwAdapterDiagnostiek(…): AdapterDiagnostiek[];
```

**T4-E voegt niets toe aan `RetrievalMeta`, niets aan `audit-meta.ts`, en niets aan enige
routerespons.** De functie heeft in deze tranche geen productie-aanroeper.

**T4-F voegt daarna atomair toe:** het veld op `RetrievalMeta`, de regel in `META_BASIS`, de
migratie op `public.meta_projectie()` en de route-aansluiting. Atomair, want die vier horen bij
elkaar: een typeveld zonder projectie is een sleutel die per beurt verdwijnt, en een projectie
zonder allowlist valt op de sanity-test.

**De prijs hiervan, eerlijk benoemd.** Een geëxporteerde functie zonder productie-aanroeper is
dode code tot T4-F. Ik stel haar toch voor, om twee redenen: de gesloten-vorm-eis (alleen
enumwaarden, alle getallen `Number.isFinite`) en de herberekening ná contextafkapping zijn
precies de dingen die je vóóraf wilt vastleggen, niet tijdens een tranche die ook nog een
migratie doet. Wie dat te zwaar vindt, kan T4-E de functie óók laten weglaten en alles bij T4-F
leggen; dan verliest deze tranche twee tests en wint zij één minder bestand. Ik heb geen sterke
voorkeur en volg hierin de opdrachtgever.

Twee regels uit eerdere rondes die onverkort gelden:

* **`metaBasis.diagnostiek` blijft spoor 0.** Ongewijzigd, want dat borgt de byte-identiteit van bestaande snapshots.
* **De selectiegebonden teller `opgenomen` wordt berekend ná de contextafkapping**, over `c.opgenomen` — precies zoals `meta.geselecteerd` en `bronversie_audit` dat al doen. Beurtbrede providertellers (calls, kosten, throttles) zijn onafhankelijk van de afkapping.

**Bij T4-F blijft** verder: de beheerpagina, de statusroute, de duurzame auditprojectie en de
bijbehorende migratie.

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

1. **Structureel beperkt:** zolang geen enkel `Spoor.adapter` is gezet, is
   `effectieveAdapter(i)` voor elk spoor hetzelfde object en is er precies één adaptergroep.
   Dat houdt de nieuwe meervoudige-adapterlogica inert, maar garandeert op zichzelf **geen**
   byte-identiteit: de Supabase-verrijking verhuist immers vóór de definitieve poort en kan
   daardoor selectie beïnvloeden. De garantie komt daarom uit punt 2 en 3, niet uit een
   vermeende identieke control flow. Alle uitsluitend meervoudige-adaptervelden blijven
   optioneel en afwezig.
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
| `core/lib/retrieval/contract.ts` | additief: `Bronstatus`, `Bronstatusreden`, optioneel `bronstatus` op tussen-/eindresultaat, `equivalentieClaim?` op `Bronresultaat`. **Niet additief:** post-selectie `verrijkSelectie()` wordt vervangen door pre-poort `verrijkKandidaten()`; `verrijkWeergave()` wordt versmald tot een positionele, gesloten weergavepatch (§2.4) |
| `core/lib/retrieval/supabase-adapter.ts` | parent-context, notulen- en documentmetadata verhuizen naar `verrijkKandidaten()` vóór de definitieve poort. `verrijkWeergave()` levert daarna uitsluitend `WeergaveVerrijking[]`. De nul-koppelingstak blijft expliciet behouden; geen `filter(Boolean)` dat posities stil verschuift |
| `core/lib/retrieval/orkestratie.ts` | `Spoor.adapter` / `Spoor.bijBronfout`, effectieve adapter per spoor, ruwe voorgrens → verrijking → definitieve servergrens/V1-V5, herkomst per resultaatinstantie (request-lokale `WeakMap`), post-poort-weergavepatch per groep en de **pure** `bouwAdapterDiagnostiek()` zonder productieaanroeper. **Geen deduplicatie en geen aansluiting van `adapters`** — zie A-1 |
| `core/lib/retrieval/toelatingspoort.ts` | meervoudsvorm van `verifieerToelating()`, gedeelde `poortNu`, standenmaps per groep |
| `core/lib/microsoft-retrieval/adapter.ts` *(nieuw)* | de dunne wrapper om T4-C/T4-D |
| `tests/cross-tenant/retrieval-adaptergroepen.test.ts` *(nieuw)* | de twaalf vereiste tests |
| `core/lib/audit-meta.ts` | **niet geraakt.** De allowlistregel hoort bij T4-F, samen met het typeveld, de migratie en de route-aansluiting — zie §2.7 en A-1 |
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

**Besluit D-2, aangescherpt na de tweede reviewronde: deduplicatie mag nooit op een
ONBEVESTIGDE adapterclaim rusten.**

Versie 2 stelde een `equivalentieSleutel` voor met "onderdrukking wordt geteld" als mitigatie.
Dat is geen mitigatie maar een logregel: een geteld verlies is nog steeds een verlies, en de
verdwenen bron komt er niet mee terug. Een adapter zou zo de bron van een andere adapter uit het
antwoord kunnen duwen — precies het soort macht dat het providerneutrale contract elders
zorgvuldig wegneemt.

De vorm wordt daarom een **claim**, en een claim is inert:

```ts
// Bronresultaat
/**
 * Een BEWERING van de adapter dat dit resultaat hetzelfde onderliggende
 * document beschrijft als een ander resultaat met dezelfde waarde. Opaque en
 * providerneutraal.
 *
 * DIT VELD ALLEEN LEIDT NOOIT TOT DEDUPLICATIE. Het is een aanwijzing, geen
 * bewijs — dezelfde rol die het Microsoft-extract in T4-C speelt. Zou de
 * orkestratie erop dedupliceren, dan kan adapter A de bron van adapter B laten
 * verdwijnen door diens waarde te claimen.
 */
equivalentieClaim?: string;
```

**De voorwaarde waaronder dedup wél mag.** Twee kandidaten mogen pas als één document gelden als
de orkestratie dat **onafhankelijk van beide adapters** heeft vastgesteld: beide kandidaten zijn
gebonden aan dezelfde vertrouwde bronregistratie/documentbinding, langs het pad dat de poort
toch al verifieert (`bronregistratieRef` + een geslaagde V5-herlezing), en die binding komt uit
server-side gegevens waar geen adapter invloed op heeft.

**Die binding bestaat vandaag niet.** Supabase en Microsoft kennen geen gedeelde
documentregistratie; hun `bronregistratieRef`-waarden zitten in gescheiden namespaces. **Dus
dedupliceert T4-E niet, door constructie — niet door een uitgeschakelde vlag.** Beide bronnen
blijven staan.

**En hij wordt in T4-E ook niet geteld.** Versie 4 beweerde dat nog wel, maar dat kon niet
kloppen: `AdapterDiagnostiek` heeft er geen veld voor, en de helper waarin zo'n teller zou
landen heeft in deze tranche geen productieaanroeper (§2.7). Het veld wordt dus **alleen
vervoerd**. Een teller hoort bij de tranche die de diagnostiek werkelijk aansluit — T4-F — en
tot die tijd is "hoe vaak komt dit voor" een vraag die deze arm niet kan beantwoorden. Dat is
eerlijker dan een telling beloven die nergens terechtkomt.

Wat er nodig zou zijn om dit op te heffen hoort niet in T4-E: een server-side binding tussen de
twee registraties, opgebouwd uit gegevens die de adapters niet leveren. Dat is een eigen tranche
met een eigen afweging.

**Vijandige test (vereist):** adapter B geeft een resultaat terug met de `equivalentieClaim` van
een bron van adapter A. De bron van A **moet blijven staan**, met zijn eigen bronnummer en zijn
eigen weergavemetadata. De beperking A-2 blijft daarmee wat zij is: dubbele citaten zijn
mogelijk, en dat is de veilige kant van deze afweging.

### B-3 — `"meld"` is pas veilig als de route de bronstatus werkelijk toont

`bijBronfout: "meld"` betekent: doorgaan met een kleinere bronset, mits de gebruiker ziet dat er
een bron ontbreekt. T4-E kan het eerste afdwingen en het tweede niet — het tonen gebeurt in
`app/api/chat/route.ts` en `app/api/zoeken/route.ts`, en in de UI daarboven.

Zolang die weergave er niet is, is `"meld"` in de praktijk stille degradatie met een veld
erbij. **Voorstel:** T4-E levert `bronstatus` en een contracttest die eist dat `"meld"` zonder
gezette `bronstatus` onmogelijk is, maar `"meld"` blijft tot de UI-tranche **ongebruikt** —
elk spoor dat T4-E aanmaakt staat op `"stop"`. Daarmee is het veld gebouwd en het risico niet
genomen.

### B-4 — `adapters` hoort pas in de meta als de hele keten erachter bestaat *(opgelost)*

Uit #322 is de les vastgelegd: een nieuwe metasleutel vereist **zowel** een toevoeging in de
TS-allowlist (`core/lib/audit-meta.ts`) **als** een migratie op `public.meta_projectie()`.

Versie 3 probeerde dat te verzoenen met een gebruiksverbod (A-1) terwijl de sleutel wél in
`RetrievalMeta` zou worden gezet. Dat verzoent niets: `RetrievalUitkomst.meta` verlaat de
orkestratie, dus een sleutel daarin is aangesloten — of het gebruik nu gewenst is of niet. Een
verbod dat afhangt van de discipline van iedere volgende lezer, is geen grens.

**Opgelost in §2.7:** T4-E zet de sleutel helemaal niet. Het levert hoogstens de pure
aggregatiefunctie en haar vormgaranties; T4-F voegt typeveld, allowlist, databaseprojectie en
route-aansluiting **atomair** toe. Daarmee is er geen tussenstand waarin een halve sleutel
bestaat, en is A-1 een structurele eigenschap in plaats van een afspraak.

### B-6 — de versmalling is NIET vanzelf byte-identiek *(opgelost per D-6)*

`verrijkWeergave()` bouwt vandaag het **volledige** `Bronresultaat` opnieuw op uit de (inmiddels
verrijkte) chunk: `chunks.map((c, i) => behoudIdentiteit(chunkAlsBronresultaat(c, i)))`. Onder
de versmalling patcht de orkestratie alleen nog `weergave`. Wat vandaag óók verandert en
straks niet meer, geverifieerd in `rag.ts:1895-1940`:

| Veld | Waarom het vandaag verandert |
|---|---|
| **`bronsoort`** | `chunk.notulen ? "notulen" : "fonds"` — en `verrijkNotulenChunks()` zet `c.notulen = n` **in-place** (`rag.ts:2339`). Een bron die als `fonds` door de poort kwam, wordt ná die poort `notulen` |
| `versie` | volledig herbouwd, inclusief `gecontroleerdOp: new Date().toISOString()` in de hash-tak — een vers tijdstempel ná de V4-venstercontrole |
| `titel`, `status.*`, `curatie.*`, `documentIdentiteit.bron` | alle afgeleid van `d` (`documenten`), dat `verrijkDocumentmetadata()` aanvult |
| `rang.positie` | opnieuw geïndexeerd over de gefilterde reeks — zie de nul-chunksregels |

**`bronsoort` is de ernstigste.** Dat veld is precies wat `binnenCentraleServergrens()` toetst
tegen het bronbeleid van het fonds én tegen `capabilities.bronsoorten`. Een bron die als `fonds`
wordt toegelaten en als `notulen` in het antwoord belandt, is door een grens gegaan die op de
oude waarde is beoordeeld. Dat is bestaand gedrag, niet iets wat T4-E introduceert — maar het is
wel precies het gat dat de versmalling moet dichten, en het laat zien dat het gat niet
theoretisch is.

**Besluit D-6:** route (a). De verrijking die security-relevante velden raakt verhuist vóór de
definitieve servergrens en V1-V5; na de poort resteert alleen de gesloten weergavepatch uit
§2.4. Daarmee beoordeelt de poort de uiteindelijke kandidaat in plaats van een tussenstand.

De eerdere formulering "byte-identiek in het eindresultaat" was te stellig: doordat verrijkte
velden nu al vóór de selectie bestaan, kan ook de selectie veranderen. Daarom blijven alle
bestaande goldens ongewijzigd als acceptatiepoort. Een verschil is een vooraf te beoordelen
semantische diff, nooit een automatische snapshotupdate.

### B-7 — `verrijkSelectie()` staat in dezelfde post-poort-positie *(opgelost per D-6)*

Het versmallen van alleen `verrijkWeergave()` verplaatst het gat in plaats van het te sluiten.
De volgorde in `orkestratie.ts` is: `zoek()` → **toelatingspoort** (stap 2) → begrenzing →
selectie + `verrijkSelectie()` (stap 5) → `citeer()` → `verrijkWeergave()`. **Beide** hooks
draaien dus ná V1–V5, en `verrijkSelectie()` herbouwt het resultaat op precies dezelfde manier
(`supabase-adapter.ts:208`).

De post-poorthook `verrijkSelectie()` vervalt. Zijn werk verhuist naar de nieuwe
`verrijkKandidaten()` vóór de definitieve poort. Daardoor hoeft een invariantcontrole geen
legitieme bestaande transformatie te verbieden: de definitieve servergrens en V1-V5 toetsen de
getransformeerde vorm. Ná die poort is het contract typematig beperkt tot `weergave`, zodat een
securityveld niet alleen "verboden" is maar eenvoudigweg niet kan worden teruggegeven.

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
| **D-2** | Dubbele citaten niet als eindoplossing; providerneutrale equivalentiesleutel — en ná de tweede ronde: **dedup alleen bij een centraal bevestigde documentidentiteit**, niet op een adapterclaim. | B-2 herschreven. Het veld heet nu `equivalentieClaim` en is **inert**: het leidt nooit op zichzelf tot dedup. Dedup vereist dat de orkestratie de binding onafhankelijk van beide adapters vaststelt; die binding bestaat vandaag niet, dus T4-E dedupliceert niet — door constructie, niet door een vlag. Vijandige test vereist (nr. 15). Beperking A-2 in §5. In T4-E wordt de claim **alleen vervoerd, niet geteld** — een teller hoort bij de tranche die de diagnostiek aansluit. |
| **D-3** | `"meld"` bouwen maar niet gebruiken tot route en UI de status aantoonbaar tonen. | B-3 ongewijzigd; elk spoor dat T4-E aanmaakt staat op `"stop"`. Contracttest: `"meld"` zonder gezette `bronstatus` is onmogelijk. |
| **D-4** | `KetenTreffer` uitbreiden met grondslaggegevens, vastgelegd bij de **laatste geslaagde** grondslagcontrole. | B-1; de formulering "laatste geslaagde" is overgenomen in het voorstel, want juist dát moment is wat V4 toetst. |
| **D-6** | De verrijking die niet-weergavevelden raakt verhuist naar vóór de definitieve servergrens en V1-V5. Ná de poort mag alleen de gesloten weergavepatch bestaan. | §2.4 en B-6/B-7. Meer I/O is de bewuste prijs voor een poort die de uiteindelijke kandidaat beoordeelt. Byte-identiteit wordt niet verondersteld: bestaande goldens blijven de blokkade, en iedere diff vraagt vooraf semantisch akkoord. |
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
| **A-1** | **T4-E voegt `adapters` NIET toe aan `RetrievalMeta`, niet aan `audit-meta.ts` en niet aan enige routerespons.** Niet "wel zetten maar niet gebruiken" — dat was te vrijblijvend, want `RetrievalUitkomst.meta` verlaat de orkestratie en is daarmee per definitie aangesloten. T4-E levert hoogstens een pure aggregatiefunctie zonder productie-aanroeper. Een contracttest bewaakt dat `RetrievalMeta` de sleutel niet kent. | T4-F voegt **atomair** toe: typeveld op `RetrievalMeta`, regel in `META_BASIS`, migratie op `public.meta_projectie()` en de route-aansluiting — met de sanity-test die allowlist en projectie tegen elkaar houdt. |
| **A-2** | **Dubbele citaten van hetzelfde document over twee adapters heen blijven mogelijk.** T4-E dedupliceert niet over adaptergroepen heen, door constructie: een `equivalentieClaim` is een adapterbewering en mag nooit leiden tot het verdwijnen van een bron van een ándere adapter. Expliciete tijdelijke beperking, en bewust de veilige kant. | Een server-side documentbinding waarmee de orkestratie **onafhankelijk van beide adapters** kan vaststellen dat twee kandidaten hetzelfde document zijn. Eigen tranche, niet T4-E. |
| **A-3** | **`bijBronfout: "meld"` blijft ongebruikt** tot route én UI de `bronstatus` aantoonbaar tonen. Tot dan is elk spoor `"stop"`. | De UI-tranche, met een waarneembare weergave. |
| **A-4** | **De bronnummering bij twee adapters volgt de gezamenlijke SELECTIEvolgorde** (primair spoor eerst, dan de aanvullende), vastgelegd in globale ordinals vóór de groepering. Dat is geen gedeelde relevantieweging over providers heen — die bestaat niet, want de scores van twee providers zijn niet vergelijkbaar. | Een expliciet ontwerp voor cross-provider weging, als dat ooit gewenst is. Niet T4-E. |

---

## 6. Testplan tegenover de twaalf vereiste tests

| # | Vereiste | Hoe aangetoond |
|---|---|---|
| 1 | zonder spooradapter byte-identiek | bestaande suites ongewijzigd + expliciete `deepEqual`-test (§2.9 punt 3) |
| 2 | dichte poort → 0 adapter-/token-/netwerkcalls | tellende stubs; spoor wordt niet aangemaakt (`isBewustUit`) |
| 3 | gelijke `ref` uit twee adapters | twee adapters met bewust identieke refs; beide bronnen overleven, krijgen hun standen uit de eigen genestte map van hun groep, en de primair/aanvullend-splitsing blijft correct — die leest de `herkomst`-WeakMap, niet de `ref` |
| 4 | filter-/capabilitycontrole per effectieve adapter | adapter A ondersteunt filter X, B niet; alleen B's spoor valt uit |
| 5 | V5/versie eenmaal per unieke adapterbron | twee sporen op dezelfde adapter → hookteller is 1 |
| 6 | intrekking verwijdert alles op die grondslag | `verifieerBronregistratie` levert `verbonden: false`; alle bronnen van die groep vallen weg, de andere groep blijft |
| 7 | `verrijkWeergave` van A krijgt nooit bronnen van B | de gesloten weergavehook registreert ontvangen projecties; assertie op disjunctie |
| 8 | providerfout/readinessverlies zonder stille fallback | `bijBronfout: "stop"` → beurt stopt; `"meld"` → `bronstatus` verplicht aanwezig |
| 9 | timeout/annulering stopt alle groepen, geen fail-safe | telt calls ná de afbreking in beide groepen; moet 0 zijn |
| 10 | contextafkapping herbouwt per-adapter metadata uit werkelijk opgenomen bronnen | rechtstreeks op de pure `bouwAdapterDiagnostiek()`: met een afgekapte set telt `opgenomen` alleen wat in `contextTekst` staat. Niet via `meta`, want T4-E zet de sleutel daar niet (A-1) |
| 11 | diagnostiek inhouds- en identifiervrij, alle getallen finite | recursieve scan over de uitvoer van `bouwAdapterDiagnostiek()`: elke string moet in een enum zitten, elk getal `Number.isFinite` |
| 12 | goldens alleen na goedgekeurde semantische diff | karakterisering draait ongewijzigd; een verschil is een blokker, geen update |
| 13 | *(toegevoegd)* gemengde `bijBronfout` binnen één adaptergroep | opdracht met twee sporen op dezelfde adapter en verschillende standen → configuratiefout vóór elke adapter-, token- of netwerkcall |
| 14 | *(toegevoegd)* **VERWEVEN GROEPEN, mét een weggevallen bron** | selectie `A1, B1, A2, B2`; groep B laat `B1` vallen in `verrijkWeergave`. Verwacht: `A1, A2, B2` in díé volgorde, met de bronnummers die de globale ordinals voorschrijven. Een implementatie die per groep aaneenschakelt levert `A1, A2, B2` óók — daarom draait de test bovendien het spiegelgeval `B1, A1, B2` zonder uitval, waar concatenatie `B1, B2, A1` zou geven en de ordinalherstelling `B1, A1, B2` |
| 15 | *(toegevoegd)* **VIJANDIG: geclaimde equivalentie** | adapter B geeft een resultaat terug met de `equivalentieClaim` van een bron van adapter A. De bron van A blijft staan, met eigen bronnummer en eigen weergavemetadata; er verdwijnt niets |
| 16 | *(vervallen in v9)* positiebinding via refcontrole | **Niet meer van toepassing:** de hook ziet geen `Bronresultaat` meer, dus er is geen ref om te verwisselen. Vervangen door nr. 28 |
| 17 | *(toegevoegd)* A-1 | `RetrievalMeta` kent de sleutel `adapters` NIET; `core/lib/audit-meta.ts` is ongewijzigd t.o.v. `preview`; de routerespons bevat hem niet. Alle drie gemeten, want het verbod is structureel en niet afhankelijk van discipline |
| 18 | *(toegevoegd)* **dezelfde `ref` in twee sporen van dezelfde adapter** | (a) **drie sporen, één adapter**: de uitkomst moet **exact gelijk** zijn aan die van `preview` — geen dedup, geen verschoven nummering, beide voorkomens blijven. Dit meet de byte-identiteitseis op een spoorlijst die `Queries<T>` toestaat maar die vandaag geen productieaanroeper heeft; (b) **dezelfde drie sporen, verweven met een tweede adaptergroep**: de positionele toewijzing koppelt elk teruggegeven resultaat aan het juiste voorkomen, en de herkomst klopt ná de citaatafkapping |
| 19 | *(toegevoegd)* **herkomst overleeft de citaatafkapping** | kleine `maxContextTekens` met gelijke refs uit twee groepen; voor elke bron in `c.opgenomen` levert de `herkomst`-WeakMap de juiste groep, ordinal en primair-vlag. Negatieve controle: met een ref-gebaseerde lookup wordt deze test rood |
| 20 | `verrijkWeergave` met een LENGTEVERSCHIL | uitvoer korter of langer dan de invoer → configuratiefout, geen "best effort"-interpretatie |
| 21 | *(herzien in v10)* **VIJANDIG: dubbele `ref` waarvan er één wegvalt** | invoer `[R-primair, R-aanvullend]` (twee occurrences van dezelfde ref), de gesloten hook geeft `[weglaten, behouden]` terug. De overlevende moet de **aanvullende** herkomst krijgen, niet de primaire; `meta.chunks` en `meta.aanvullend` moeten dat weerspiegelen. Het spiegelgeval `[behouden, weglaten]` levert de primaire herkomst. Negatieve controle: een op `ref` matchende implementatie kiest in beide gevallen de eerste occurrence en wordt rood op één van de twee |
| 22 | *(toegevoegd)* eigenaarschap van de herkomststaat | de staat is niet bereikbaar buiten het verzoek: twee opeenvolgende beurten delen geen enkele herkomst, en `RetrievalUitkomst` bevat geen serialiseerbaar herkomstveld |
| 23 | *(toegevoegd)* **nul gekoppelde chunks** | geen enkele bron heeft een chunk → de hook levert `{ type: "behouden" }` op alle posities en de bronnen blijven ongewijzigd. Negatieve controle: een implementatie die hier `weglaten` teruggeeft maakt alles leeg en wordt rood |
| 24 | *(toegevoegd)* **gedeeltelijke koppeling** | `{ type: "weglaten" }` uitsluitend op de ontbrekende posities; de overige bronnen behouden hun plaats en krijgen hun eigen `weergave`-patch |
| 25 | *(herzien in v10)* **selectiegedrag na pre-poortverrijking** | dezelfde één-adapteropdracht draait op `preview` en op de nieuwe volgorde. De selectie, `rang.positie`, context en citaties moeten byte-identiek blijven; ieder verschil is een semantische-diffblokkade en wordt niet door een snapshotupdate opgelost |
| 26 | *(vervallen in v9)* hook muteert `invoer[i].ref` in-place | **Niet meer mogelijk:** de projectie is read-only en bevat geen muteerbaar resultaat. Vervangen door nr. 28 |
| 27 | *(vervallen in v9)* één gedeelde objectinstantie op twee posities | **Niet meer mogelijk:** de orkestratie maakt álle instanties zelf, dus elke occurrence is per constructie uniek |
| 28 | *(toegevoegd)* **VIJANDIG: hook probeert de grondslag te wijzigen** | de hook levert een `verrijkt`-patch waarin hij probeert `documentIdentiteit.id`, `versie`, `bronregistratieRef`, `toegangscontrole`, `passage`, `status` en `bronsoort` mee te geven. **Geen daarvan mag in het eindresultaat veranderen**; alleen de toegestane `weergave`-patch landt. Het type sluit het al uit — de test bewijst dat de runtime-toepassing dat óók doet en niet stilletjes spreidt |
| 29 | *(herzien in v10)* **definitieve poort ziet de verrijkte vorm** | een `verrijkKandidaten()`-stub wijzigt `bronsoort` van `fonds` naar `notulen`; met een beleid dat alleen `fonds` toestaat wordt de kandidaat na verrijking geweigerd. De spiegeltest met `notulen` toegestaan bereikt V1-V5 op de nieuwe vorm |
| 30 | *(toegevoegd in v10)* **geen post-poortmutatie** | een runtimekwaadwillige weergavepatch probeert naast `weergave` ook identiteit, bewijs, versie, passage, status, bronsoort en rang mee te geven. De toepassing neemt uitsluitend `weergave` over; alle andere velden blijven byte-gelijk aan de toegelaten instantie |

Daarnaast: `tsc`, boundaries, secretscan, security-baseline, volledige cross-tenant inclusief
DB-laag, karakterisering, E2E en productiebuild.

---

## 7. Wat deze review níét heeft vastgesteld

Eerlijkheidshalve, omdat een planreview die alleen zekerheden noemt een verkeerd beeld geeft:

* **De verplichte herijking is uitgevoerd.** PR #427 is gerebased op `origin/preview`
  `e159653`, inclusief de gemergede #424/T4-C- en #425/T4-D-contracten en de afgeronde
  expand/contractmigraties op Preview. De zeven readinessstanden, de volgorde
  readiness → tokenbevestiging → herlezing en de gelijkheidstoets op `verbindingVersie` zijn
  opnieuw tegen de werkelijke code gecontroleerd. B-1 en B-5 blijven reëel: `KetenTreffer`
  draagt nog geen grondslag en `Afbreekgrendel` kent nog geen resterende tijd.
* **De eerste structurele demoactivering verhuist naar `app365_m365_demo_copilot`** (ticket #428). Dat raakt T4-E niet: deze laag is en blijft fonds- en omgevingsneutraal — zij kent geen profiel, geen fonds en geen omgeving, alleen een adapter per spoor. De keuze wélke omgeving als eerste wordt geactiveerd hoort bij de activeringstranche.
* **De PGB-labstand is opnieuw live gemeten.** Beide begrensde indexscans waren groen:
  de inhoudscan vond en verifieerde `Zandloperbaken 12` binnen de geregistreerde root en de
  bestandsnaamscan vond `PGB407-DOC-101`. Daarna is exact één SEM01-Retrieval-poging
  verstuurd. Die eindigde ook ná het propagatievenster fail-closed op HTTP 403 als
  `copilot_toegang_geweigerd`; er is geen inhoudskandidaat beoordeeld. Daarmee is de index
  niet langer de blokkade en heeft een nieuwe retry zonder concrete entitlementcorrectie geen
  diagnostische waarde.
* **De live meting heeft niets bij Microsoft gewijzigd.** Geen consent, scopes, billing,
  licentie, featureflag of kill switch is aangepast; de runner heeft uitsluitend gelezen en
  één geautoriseerde Retrieval-call uitgevoerd.
* **`bronsoort: "sharepoint"` staat in geen enkel productie-bronbeleid.** Ook met T4-E volledig gebouwd levert de Copilot-arm dus niets, totdat een fonds die bronsoort krijgt. Dat is een bestaande inerte laag en T4-E verandert hem niet — maar het betekent ook dat "het werkt" pas in de activeringstranche aantoonbaar is.
* **De byte-identiteitsclaim is een claim tot hij gemeten is.** §2.9 beschrijft hoe; het bewijs komt pas met de code.
* **Versie 1 van deze review bevatte een ontwerpfout die ik zelf niet ving.** §2.2 stelde herkomst op spoorindex voor en §2.4 gebruikte vervolgens een ref-sleutel. Bij het herschrijven bleken er bovendien twee feiten te zijn die versie 1 niet kende: `verrijkWeergave()` laat bronnen vallen, en `primaireRefs` is een derde beurtbrede ref-sleutelruimte. Dat laatste was met een gerichte grep vindbaar geweest. Ik noem het hier omdat het iets zegt over de betrouwbaarheid van de rest: een planreview die op code steunt is zo goed als de plaatsen waar werkelijk is gekeken, en die verantwoording hoort erbij.
