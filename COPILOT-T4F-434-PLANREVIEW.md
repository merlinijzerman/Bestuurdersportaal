# T4-F planreview — beheer, status en duurzame auditprojectie (#434)

**Status:** versie 4, ter beoordeling. Geen productiecode geschreven.

**Wijziging t.o.v. versie 3 — een CORRECTIE op een goedgekeurde review.** Versie 3 concludeerde
op basis van een **onvolledige code-inventarisatie** dat de pariteitsgate tussen de TS-allowlist
en `meta_projectie()` ontbrak. Dat is onjuist: die gate bestaat, in
`tests/cross-tenant/retrieval-toelatingspoort.test.ts`, en hij vergelijkt beide lijsten in twee
richtingen. B-1 is ingetrokken.

Daarmee verviel ook de migratiestrategie die op die aanname rustte. §7 is volledig vervangen: de
byte-gepinde `meta_projectie()` blijft ongemoeid, `adapters` gaat via `meta_basisniveau()` en
`meta_bronniveau()` volgens het patroon dat #367 al gebruikte, de `pg_get_functiondef()`-
hashpreflight en de canonieke herdefinitie zijn geschrapt, en er komt een onafhankelijke
SQL-vormvalidator plus gedragstests tegen de werkelijk geïnstalleerde wrappers. De bestaande
gate wordt uitgebreid, niet gedupliceerd.

**Wijziging t.o.v. versie 2:** de validatie van `adapters` is **fail-closed** geworden. Versie 2
liet de sleutel weg en ging door; dat maakt een beurt volledig ogend terwijl juist de informatie
over een niet-geraadpleegde bron is verdwenen — dezelfde stille degradatie die T4-E moest
uitsluiten. Een ongeldige vorm levert nu een vaste, inhoudsvrije `configuratiefout`, zonder
antwoord en zonder citaten; het duurzame spoor krijgt alleen de categorie
`adaptermetadata_ongeldig`. De single-adapterroute blijft buiten het mechanisme en byte-identiek
(§4).

**Wijzigingen t.o.v. versie 1:** het voorstel om de migratie te laten vertrekken vanuit
`pg_get_functiondef()` is **ingetrokken** — dat maakt de inhoud van een migratiebestand
afhankelijk van de omgeving waarin zij draait. *(De vervanging die versie 2 daarvoor koos — één
canonieke definitie plus een hashpreflight — is in versie 4 op haar beurt ingetrokken; zie §7.)* Verder: het bewijs ná de
migratie op een ephemere database met vier expliciete controles (§7.3), de CI-gate die de
werkelijk geïnstalleerde functie aanroept in plaats van bestandstekst te vergelijken (§7.4), de
eis dat `adapters` een gesloten array van platte records is met validatie vóór de auditlaag
(§4), en de vastlegging dat T4-F aggregeert per adapter en foutgrond — niet per bron (B-4).
**Vertakt van:** `origin/preview` `0e7b392` (de mergecommit van #432 / T4-E).
**Datum:** 2026-09-22.

---

## 0. Samenvatting

T4-E heeft `meta.adapters` bewust nergens aangesloten — niet op `RetrievalMeta`, niet op
`audit-meta.ts`, niet op `meta_projectie()` en niet op een routerespons. Dat was
activeringsvoorwaarde **A-1**, en het is precies de scope van dit ticket. T4-F sluit die keten
in één tranche, of niet.

De uitwerking levert **vier blokkerende bevindingen** op. De zwaarste is dat de gate die #434
vraagt — "houd typeveld, allowlist en databaseprojectie onderling gelijk" — **vandaag niet
bestaat**. Er staat een commentaarregel in een migratie die zegt dat je de lijsten niet los mag
wijzigen. Dat is discipline, geen grendel, en het is precies het soort maatregel waarvan dit
project al weet hoe het afloopt.

**Wat T4-F níét doet:** geen activering, geen tokenbron, geen consent-, billing-, permission- of
featureflagwijziging, geen tweede live Retrieval-call. De canarymeting met `Zandloperbaken 12`
is een afzonderlijke activeringsvoorwaarde en staat buiten dit ticket.

---

## 1. Uitgangsstand

| Tranche | Stand | Betekenis voor T4-F |
|---|---|---|
| T4-C (#424), T4-D (#425), T4-E (#432) | op `preview`, mergecommit `0e7b392` | consumeren |
| `meta.adapters` | bestaat nergens | **dit ticket** |
| Live smoke (#433) | **toegang groen**; SEM01 nul kandidaten; blokkade is `endpoint_toegankelijk_semantische_query_nul_resultaten` | raakt T4-F niet — er wordt niets aangeroepen |
| Canary `Zandloperbaken 12` | afzonderlijke activeringsvoorwaarde | **buiten scope** |

Dat de toegang inmiddels groen is, verandert aan deze tranche niets. T4-F voegt een
auditsleutel toe; of de Retrieval-arm kandidaten oplevert is een kwaliteitsvraag die langs een
andere lijn loopt. Die twee bewust gescheiden houden is ook het punt van #434.

---

## 2. Hoe de sleutel vandaag door de keten zou vallen

Vier plaatsen, en ze hangen aan elkaar:

| # | Plek | Rol |
|---|---|---|
| 1 | `RetrievalMeta` (`core/lib/rag.ts`) | het typeveld; zonder dit bestaat de sleutel niet |
| 2 | `META_BASIS` (`core/lib/audit-meta.ts`) | de TS-splitsing spoor/bron/inhoud |
| 3 | `public.meta_projectie(p_meta, p_bron)` | de SQL-leesprojectie, met een eigen `c_basis`-array |
| 4 | routerespons | wat de aanroeper te zien krijgt |

**Het faalgedrag is concreet en stil.** `splitsRetrievalMeta()` kent drie uitgangen. Een sleutel
die niet in een allowlist staat, valt naar `inhoud` — verwijderbaar mét het gesprek — en wordt
als `onbekend` gerapporteerd. Voeg je dus alleen (1) toe en niet (2), dan bestaat `adapters` in
het geheugen, verdwijnt hij uit het duurzame spoor zodra een gesprek wordt opgeruimd, en meldt
de sanity-test hem als onbekende sleutel. Voeg je (2) toe en niet (3), dan splitst TypeScript
hem correct maar toont de SQL-leesprojectie hem niet — of, voor oude rijen, juist wel op het
verkeerde niveau.

Dat is de reden dat #434 "atomair" eist, en het is geen stijlvoorkeur: elke deelverzameling van
deze vier levert een andere, stille fout op.

---

## 3. Blokkerende bevindingen

### B-1 — INGETROKKEN: de pariteitsgate bestaat wél

**Deze bevinding was onjuist en is de aanleiding voor versie 4.**

Versie 3 stelde dat de gate die #434 vraagt niet bestond. Dat berustte op een **onvolledige
code-inventarisatie**: ik keek in `core/lib/audit-meta.sanity.ts`, vond daar geen enkele
verwijzing naar SQL, en concludeerde daaruit dat er nergens in het project zo'n controle was.
Die conclusie volgde niet uit die waarneming.

**Wat er werkelijk staat**, in `tests/cross-tenant/retrieval-toelatingspoort.test.ts`:

> `test("PR-C — elke basis-/bronsleutel uit TypeScript staat óók in meta_projectie()")`

Die gate leest de **nieuwste** migratie die `meta_projectie()` definieert, parseert de arrays
`c_basis` en `c_bron`, telt de cumulatieve wrapper-uitbreidingen erbij op, en vergelijkt beide
lijsten **in twee richtingen** met `META_BASIS` en `META_BRON` — een sleutel die alleen in de SQL
staat is er even fout als een die alleen in TypeScript staat.

Hij is bovendien precies om deze reden gebouwd. Zijn eigen commentaar noemt twee gevallen waarin
het misging: `toelating` stond alleen in de TS-allowlist, werd opgeslagen en verdween bij het
lezen; `gateway` (#311 T3) verkeerde in dezelfde toestand.

**En hij werkt.** Op de implementatiebranch is hij de enige rode test, precies omdat `adapters`
in `META_BASIS` staat en nog niet in de databaseprojectie.

**Gevolg voor T4-F:** er wordt **geen tweede gate gebouwd**. De bestaande wordt uitgebreid. Twee
gates die hetzelfde bewaken, is één gate die de andere kan tegenspreken.

Wat van de oorspronkelijke bevinding overeind blijft, staat in §7.4: deze gate is **statisch** —
hij leest migratiebestanden, niet de geïnstalleerde functie. Dat gat is echt, maar het is een
aanvulling op een bestaande gate en niet de afwezigheid ervan.

### B-2 — `c_basis` moet volledig worden herschreven, niet aangevuld

`meta_projectie()` is `create or replace` met een literale `text[]`. Er is geen "voeg toe aan de
bestaande lijst"-vorm: de migratie herdefinieert de hele functie. Dat betekent dat de nieuwe
migratie een **volledige kopie** van de huidige lijst moet bevatten plus `adapters`, en dat
iedere sleutel die sinds de laatste herdefinitie is toegevoegd stilzwijgend verdwijnt als de
kopie niet klopt.

**VIJF migraties herdefiniëren deze functie**, elk met een volledige kopie van de lijst:

```
2026_08_04_a2_audit_least_privilege.sql
2026_08_05_t2_bureau_stukvoorbereiding.sql
2026_08_12_t3_retrieval_meta_selectie.sql
2026_08_17_vraagrouter_documentdekking.sql
2026_09_11_toelating_auditprojectie.sql     ← nieuwste in de repo
```

Vijf keer is de hele lijst overgetypt om er één sleutel aan toe te voegen. Dat is geen
schoonheidsfout: elke kopie is een gelegenheid om een sleutel te laten vallen, en niets in de
repo of de CI merkt dat op. **En welke definitie op Preview en Productie werkelijk actief is, is
uit de repo niet af te leiden** — er is geen migratierunner en migraties worden handmatig
geplakt.

**Versie 4: deze bevinding is grotendeels opgelost door de conventie zelf.** Het overtypen van
`c_basis` is niet meer aan de orde, want `meta_projectie()` wordt niet meer herdefinieerd — zij
is byte-gepind en uitbreidingen lopen via de wrappers (§7). De vijf historische kopieerrondes
blijven een feit, en de bestaande pariteitsgate dekt ze al af in twee richtingen.

Wat van B-2 overblijft is dus geen ontwerpvraag maar een observatie: **vijf keer overtypen is
vijf gelegenheden geweest om iets te laten vallen**, en de gate die dat had moeten opmerken is
er pas ná die rondes gekomen. De gedragstests uit §7.5 toetsen daarom expliciet dat álle
bestaande toegestane sleutels nog terugkomen — niet alleen de nieuwe.

Dit versterkt B-1: de gate die #434 vraagt zou niet alleen de nieuwe sleutel bewaken, maar voor
het eerst ook aantonen dat de vier bestaande kopieerrondes niets hebben laten vallen.

### B-3 — de vorm van `adapters` is genest, en de projectie is dat niet

`c_basis` is een platte lijst van sleutelnamen op het hoogste niveau. `adapters` is een **array
van objecten** met zelf weer een genest `afwijzingen`-object. Er bestaat in `audit-meta.ts` wel
een `SUB_NIVEAUS`-mechanisme voor geneste sleutels, maar of `meta_projectie()` een genest object
ongewijzigd doorlaat zodra de bovenste sleutel op de allowlist staat — of alleen het topniveau
filtert — is uit de kop van de functie niet af te lezen.

Dat is een feit dat vóór het ontwerp moet worden vastgesteld, want het bepaalt de vorm. Twee
uitkomsten:

* laat de projectie het genest object ongewijzigd door, dan is de inhoudsvrijheid van `adapters`
  volledig een verantwoordelijkheid van de TS-kant en moet de sanity daar uitputtend zijn;
* filtert zij per niveau, dan moet `SUB_NIVEAUS` mee en moet de SQL-spiegel dat ook kennen.

**Voorstel, en het is bewust het saaiste:** maak `adapters` **plat waar het kan**. Eén array van
objecten met uitsluitend scalaire velden, en `afwijzingen` als vaste set numerieke velden met
een voorvoegsel (`afwijzing_root`, `afwijzing_mapping`, …) in plaats van een genest object. Dat
sluit aan bij wat de bestaande auditprojectie voor de spike al deed — acht platte
`afwijzing_*`-velden — en het maakt de projectie een kwestie van één sleutel in plaats van een
nieuwe nestingsregel.

### B-4 — "geen hashes daarvan" sluit ook een identiteit uit die nuttig lijkt

#434 verbiedt identifiers **en hashes daarvan**. Dat raakt een veld dat je bij per-adapter-
diagnostiek vanzelf wilt toevoegen: iets waarmee je twee beurten over dezelfde bron kunt
vergelijken. Een gehashte bron-id zou dat oplossen en is precies wat de eis uitsluit.

Dat is terecht — een hash is een pseudoniem, geen anonimisering, en met een kleine bronset is
hij triviaal terug te rekenen — maar het betekent wel dat `adapters` **geen enkele correlatie
over beurten heen** mogelijk maakt.

**Vastgelegd (opdrachtgever, 22-09):** T4-F levert aggregatie **per adapter en per foutgrond**,
niet per SharePoint-bron. Structurele problemen per bron horen bij een afzonderlijk, streng
geautoriseerd beheerspoor — een eigen ontwerp met een eigen afweging, niet een veld dat hier
stilletjes bij komt.

---

## 4. De voorgestelde vorm

```ts
/** Per adaptergroep, per beurt. GESLOTEN, inhoudsvrij, PLAT — geen genest vrij object. */
export interface AdapterMeta {
  naam: "supabase-rag" | "microsoft-sharepoint";
  methode: RetrievalMeta["methode"] | "sharepoint_live" | "geen";
  resultaat: "treffers" | "leeg" | "niet_geraadpleegd";

  // Beurtbreed — ONAFHANKELIJK van de citaatafkapping.
  netwerkpogingen: number;
  latency_ms: number;
  downloads: number;
  bytes: number;
  throttles: number;
  retries: number;
  kandidaten_voor_poort: number;
  kandidaten_na_poort: number;
  afwijzing_root: number;
  afwijzing_mapping: number;
  afwijzing_binding: number;
  afwijzing_rechten: number;
  afwijzing_versie: number;
  afwijzing_download: number;
  afwijzing_extractie: number;
  afwijzing_lokalisatie: number;
  afwijzing_grens: number;

  // SELECTIEGEBONDEN — na de contextafkapping opnieuw berekend.
  opgenomen_passages: number;
  opgenomen_documenten: number;
}
```

**Gesloten array van PLATTE records, en dat is een eis en geen voorkeur.** `adapters` is een
array; elk element is een record met uitsluitend scalaire velden. Geen genest vrij object,
nergens — ook niet als "één klein extra veldje". Een vrij object is een plek waar later iets in
kan groeien wat niemand heeft goedgekeurd, en de projectie kan er niet op filteren.

**Validatie vóórdat de metadata de auditlaag bereikt.** Er is één plek die `AdapterMeta`
construeert, en die bouwt uit een vaste literale vorm — onbekende velden zijn daarmee door
constructie onmogelijk. Daarbovenop komt een totale validator die vóór het overhandigen toetst
dat élke veldnaam in de gesloten set zit en élke enumwaarde in haar eigen gesloten set, en dat
elk getal `Number.isFinite` is.

**Wat die validator doet als hij afgaat: de beurt stopt fail-closed.** Een ongeldige vorm levert
een vaste, inhoudsvrije `configuratiefout`; er vertrekt geen antwoord en er worden geen citaten
gevormd.

Versie 2 van deze review koos hier nog voor "de sleutel weglaten en doorgaan", met als argument
dat telemetrie een retrievalbeurt niet mag onderuithalen. **Dat argument is onjuist zodra T4-F
landt, en de review wees dat terecht aan.** Ná deze tranche is `adapters` geen vrijblijvende
telemetrie meer: hij draagt de zichtbare bronstatus en het duurzame auditspoor. De sleutel stil
weglaten maakt een beurt **volledig ogend terwijl juist de informatie over een niet-geraadpleegde
bron is verdwenen** — precies de stille degradatie die T4-E moest uitsluiten. Ik redeneerde over
telemetrie in het algemeen en verloor uit het oog dat deze tranche verandert wát die sleutel is.

De regels:

* een ongeldige vorm → vaste, inhoudsvrije `configuratiefout`;
* **geen routeantwoord en geen citaatvorming**;
* het duurzame foutspoor bevat uitsluitend een vaste categorie — `adaptermetadata_ongeldig` —
  en **nooit de afgewezen waarde**. Een validator die logt wát hij weigerde, lekt precies wat hij
  moest tegenhouden;
* **de bestaande single-adapterroute blijft hier buiten.** Het mechanisme grijpt alleen aan op
  het moment dat er een `adapters`-sleutel wordt geconstrueerd. Een beurt die er geen produceert,
  loopt ongewijzigd — byte-identiek, zoals de DoD eist.

**Vijandige test (vereist):** bied achtereenvolgens `NaN`, een onbekende enumwaarde, een extra
veld, een identifier en een genest object aan. Verwacht per geval: geen routeantwoord, geen
inhoudslekkage in respons of auditspoor, en wél de vaste foutcategorie.

**Twee soorten tellers, en het onderscheid is niet cosmetisch.** `bouwRetrievalMeta()` draait
tweemaal: in fase 1 over de selectie, en in `citeer()` opnieuw over `c.opgenomen` — ná de
afkapping. De onderste twee velden komen uit díé tweede berekening, precies zoals
`meta.geselecteerd` en `bronversie_audit` dat al doen. Zouden zij uit de eerste komen, dan
noemt het auditspoor passages die nooit naar het model zijn gegaan.

De beurtbrede tellers zijn per definitie onafhankelijk van de afkapping: een netwerkpoging die
is gedaan, is gedaan. Die reizen ongewijzigd mee.

**Inhoudsvrij, uitputtend:** elk veld is een vaste enumwaarde of een getal. Geen URL, ref, pad,
bestandsnaam, drive-/item-/bron-id, opaque identifier, tokenclaim, providerfouttekst, HTTP-body
of fragment — en geen hash daarvan (B-4). Een providerfout verschijnt als categorie in
`resultaat` en in de afwijstellers, nooit als boodschap.

---

## 5. `bron_niet_geraadpleegd`

T4-E levert al `RetrievalUitkomst.bronstatus`: adapternaam, bronsoort, `geraadpleegd` en een
gesloten reden. T4-F projecteert dat duurzaam onder de sleutel `bron_niet_geraadpleegd`.

| Beleid | Gedrag in T4-E | Projectie in T4-F |
|---|---|---|
| `"meld"` | beurt gaat door mét `bronstatus` | **zichtbaar** in de routerespons én in het auditspoor |
| `"stop"` | `BronNietGeraadpleegd` wordt geworpen vóór begrenzing, selectie en citaatvorming | er is geen antwoord en er zijn geen citaten; T4-F bevestigt dat in de projectie |
| niet gezet | één adaptergroep: bestaand gedrag; meer dan één: fail-closed | volgt het effectieve gedrag |

Dat `"stop"` niets oplevert is in T4-E geïmplementeerd en met vijandige tests vastgelegd. T4-F
voegt daar geen tweede mechanisme aan toe — een tweede plek waar hetzelfde wordt afgedwongen is
een plek waar de twee uiteen kunnen lopen.

---

## 6. Beheer- en statusweergave

Wat de pagina toont: per fonds welke adapters zijn geconfigureerd, de rolloutstand uit T4-D
(`uit` / `configuratie_ongeldig` / `consent_ontbreekt` / `billing_ontbreekt` /
`tijdelijk_geblokkeerd` / `gereed_onder_voorbehoud` / `gereed`), en de laatste uitkomst per bron
als gesloten categorie.

Wat zij **niet** toont: tokens, clientsecrets, tenant-id's, actor-object-id's, documentinhoud,
bestandsnamen, URL's en opaque refs. De readinessuitkomst van T4-D draagt die ook niet — zij is
een enum plus een `verbindingVersie` — dus de weergave kan niet per ongeluk meer tonen dan de
bron levert.

Toegang via de bestaande capabilitypoort; geen service-role, geen nieuwe route buiten
`withFondsRoute`.

---

## 7. De migratie volgt het BESTAANDE wrapperpatroon

**Versie 3 schreef hier een canonieke herdefinitie van `meta_projectie()` voor, met een
`pg_get_functiondef()`-hashpreflight. Dat is volledig ingetrokken.** Beide waren gebouwd op de
onjuiste aanname uit B-1, en beide wijken af van een conventie die in dit project al bestaat en
al is afgedwongen.

### 7.1 `meta_projectie()` blijft ongemoeid — zij is byte-gepind

De uitgebrachte definitie in `2026_09_11_toelating_auditprojectie.sql` is **vastgelegd op
sha256** in `retrieval-toelatingspoort.test.ts` (`#367 — uitgebrachte migratie/check blijven
bytegelijk`). Zij kan dus niet worden gewijzigd, en dat is opzet.

De conventie staat letterlijk in de pariteitsgate: *"Uitgebrachte `meta_projectie` blijft
immutabel. Latere uitbreidingen lopen daarom via de twee publieke wrappers en worden als
cumulatieve sleutelset meegenomen in deze pariteitsgate."*

Dat is geen theorie: #367 heeft langs precies die weg vier sleutels toegevoegd —
`correlation_id`, `contextbron_resolutie`, `evidence_audit` en `modelcontext_audit`.

### 7.2 `adapters` gaat via `meta_basisniveau()` en `meta_bronniveau()`

Een additieve migratie die **ná** de uitgebrachte sorteert, zodat een upgrade en een verse,
alfabetisch afgespeelde reeks dezelfde wrappers opleveren. Zij herdefinieert de twee wrappers,
die elk `meta_projectie()` aanroepen en daar de nieuwe sleutel **voorwaardelijk** aan toevoegen.

Geen hashpreflight, geen functieherdefinitie, geen vergelijking met de live installatie. Die
waren er om een risico af te dekken dat bij dit patroon niet bestaat: de uitgebrachte functie
wordt niet aangeraakt, dus er valt niets stil te overschrijven.

### 7.3 De SQL-vormvalidator — een tweede, onafhankelijke grendel

De sleutel wordt **alleen toegevoegd als haar vorm klopt**, getoetst in SQL. Dat is niet dubbelop
met de TypeScript-validator maar een tweede net: de TS-kant bewaakt wat wij schrijven, de
SQL-kant bewaakt wat er uit de database terugkomt — ook voor rijen die al bestonden.

Het patroon bestaat al. `contextbron_resolutie` toetst per veld het type, toetst de reden tegen
een gesloten lijst, en eist dat er **geen extra sleutels** zijn:

```sql
and ((p_meta->'contextbron_resolutie') - 'volledig'::text - 'reden'::text - 'kandidaatcap'::text) = '{}'::jsonb
```

Voor `adapters` dwingt de validator minimaal af:

1. **`adapters` is een BEGRENSDE array** — `jsonb_typeof = 'array'` met een harde bovengrens op
   het aantal elementen. Een ongelimiteerde array is een plek waar een beurt onbeperkt kan
   groeien;
2. **ieder element is een PLAT object met exact de toegestane sleutels** — het `- 'sleutel'`-
   patroon hierboven, toegepast op de volledige verzameling, zodat een extra of genest veld de
   hele sleutel laat vervallen;
3. **adapter-, status- en foutcategorieën komen uit gesloten enums** — `naam` en `resultaat`
   tegen een `in (...)`-lijst;
4. **tellers zijn niet-negatieve gehele getallen** — `jsonb_typeof = 'number'`, `>= 0`, en
   `floor() = waarde`. Een `NaN` overleeft JSON-serialisatie niet (hij wordt `null`) en valt
   daarmee al op de typecontrole;
5. **geen extra, geneste of identificerende waarden** — volgt uit (2), en de enige stringvelden
   zijn de drie enums uit (3). Er is dus geen veld waarin een URL, ref, pad of identifier kán
   staan.

Valt de vorm af, dan verschijnt `adapters` **niet** in de projectie. Dat is de SQL-kant van
fail-closed: liever geen sleutel dan een sleutel waarvan de vorm niet vaststaat.

### 7.4 De BESTAANDE pariteitsgate wordt uitgebreid

Geen tweede gate. De bestaande in `retrieval-toelatingspoort.test.ts` herkent wrapper-
uitbreidingen al met een patroon per sleutel:

```js
if (/meta_basisniveau[\s\S]*?jsonb_build_object\('evidence_audit'/.test(aanvullingen)) basis.add("evidence_audit");
```

`adapters` krijgt dezelfde regel. Daarmee blijft de tweerichtingsvergelijking intact: een sleutel
die alleen in TypeScript of alleen in de SQL staat, blijft rood.

**Wat die gate niet kan**, en dat is het enige dat van B-1 overeind blijft: hij leest
migratie**bestanden**. Dat bewijst dat iemand het bestand goed heeft geschreven, niet dat de
database die vorm heeft — en er is in dit project geen migratierunner. Daarom komen er
**gedragstests tegen de werkelijk geïnstalleerde wrappers**, in de DB-laag.

### 7.5 Gedragstests tegen de geïnstalleerde wrappers

Tegen een uit de repo opgebouwde wegwerpdatabase, aangesloten in
`scripts/cross-tenant-ci.sh` — een controle die daar niet in staat, draait niet in de gate:

1. een geldige `adapters`-waarde komt via `meta_basisniveau()` terug op basisniveau;
2. **alle bestaande toegestane sleutels komen nog steeds terug** — de controle die vier eerdere
   uitbreidingsrondes nooit hebben gehad;
3. onbekende sleutels verdwijnen;
4. elk van de vijf vormschendingen uit §7.3 laat `adapters` **vervallen** in plaats van
   gedeeltelijk door te laten;
5. `meta_bronniveau()` gedraagt zich gelijk aan `meta_basisniveau()` voor deze sleutel.

### 7.6 Rollback

Herdefinitie van beide wrappers naar hun vorige vorm — hetzelfde patroon, één stap terug. De
uitgebrachte `meta_projectie()` blijft ook bij een rollback ongemoeid. De rollback wordt
**gemeten** op dezelfde wegwerpdatabase, niet beredeneerd.

## 8. Bestandsgrenzen

| Bestand | Aard |
|---|---|
| `core/lib/rag.ts` | `adapters?: AdapterMeta[]` op `RetrievalMeta` |
| `core/lib/audit-meta.ts` | één regel in `META_BASIS` |
| `core/lib/audit-meta.sanity.ts` | de statische spiegel tegen de migratie (B-1a) |
| `core/lib/retrieval/orkestratie.ts` | `bouwAdapterMeta()` en de aansluiting in `bouwRetrievalMeta()` |
| `supabase/migrations/<datum>_434_meta_adapters.sql` | herdefinitie van `meta_basisniveau()` en `meta_bronniveau()` met de SQL-vormvalidator (§7.2-7.3). **Raakt `meta_projectie()` niet** |
| `supabase/rollbacks/<datum>_434_meta_adapters_ROLLBACK.sql` | beide wrappers één stap terug (§7.6) |
| `supabase/checks/<datum>_434_meta_adapters.sql` | gedragstests tegen de geïnstalleerde wrappers (§7.5) |
| `tests/cross-tenant/retrieval-toelatingspoort.test.ts` | één regel in de BESTAANDE pariteitsgate (§7.4) — geen tweede gate |
| `scripts/cross-tenant-ci.sh` | de nieuwe DB-suite aansluiten |
| beheerpagina + statusroute | §6 |

**Niet** geraakt: `core/lib/microsoft-retrieval/*` (T4-C/T4-D worden geconsumeerd), en de
activeringstranche.

---

## 9. Wat deze review níét heeft vastgesteld

* **Of `meta_projectie()` geneste objecten ongewijzigd doorlaat** (B-3). Ik heb de kop van de
  functie gelezen, niet haar volledige body. Dat moet vóór het ontwerp worden nagerekend, en het
  voorstel in B-3 — alles plat — is er juist op gericht dat die vraag er niet meer toe doet.
* **Welke definitie van `meta_projectie()` op Preview en Productie actief is.** Nog steeds niet
  uit de repo vast te stellen — maar het is niet langer relevant: T4-F raakt die functie niet.
  Wat wél wordt getoetst, is het gedrag van de geïnstalleerde WRAPPERS (§7.5), en dat is
  precies de laag die T4-F wijzigt.
* **Of de karakteriseringsgoldens ongewijzigd blijven.** `adapters` is optioneel en alleen
  aanwezig wanneer er iets te melden is, dus de verwachting is dat zij niet bewegen — maar dat is
  een verwachting. Ontstaat er een diff, dan is die een blokkade die eerst inhoudelijk wordt
  beoordeeld, niet een snapshotupdate.
* **Niets aan de Retrieval-kwaliteitsvraag.** #433 meldt dat de toegang groen is en SEM01 nul
  kandidaten geeft. T4-F raakt dat niet en lost het niet op; de canarymeting met
  `Zandloperbaken 12` blijft een afzonderlijke activeringsvoorwaarde.
