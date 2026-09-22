# T4-F planreview — beheer, status en duurzame auditprojectie (#434)

**Status:** versie 3, ter beoordeling. Geen productiecode geschreven.

**Wijziging t.o.v. versie 2:** de validatie van `adapters` is **fail-closed** geworden. Versie 2
liet de sleutel weg en ging door; dat maakt een beurt volledig ogend terwijl juist de informatie
over een niet-geraadpleegde bron is verdwenen — dezelfde stille degradatie die T4-E moest
uitsluiten. Een ongeldige vorm levert nu een vaste, inhoudsvrije `configuratiefout`, zonder
antwoord en zonder citaten; het duurzame spoor krijgt alleen de categorie
`adaptermetadata_ongeldig`. De single-adapterroute blijft buiten het mechanisme en byte-identiek
(§4).

**Wijzigingen t.o.v. versie 1:** het voorstel om de migratie te laten vertrekken vanuit
`pg_get_functiondef()` is **ingetrokken** — dat maakt de inhoud van een migratiebestand
afhankelijk van de omgeving waarin zij draait (B-2, §7.1). De functie krijgt één canonieke
definitie in het bestand; `pg_get_functiondef()` is nu uitsluitend een fail-closed preflight op
een genormaliseerde hash, met een inhoudsvrije foutcategorie (§7.2). Verder: het bewijs ná de
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

### B-1 — de gate die #434 vraagt, bestaat niet

`core/lib/audit-meta.sanity.ts` vergelijkt `META_BASIS`, `META_BRON` en `META_INHOUD` onderling
en toetst ze tegen een verbodenlijst. **Zij leest geen enkele SQL.** Er is in dat bestand geen
verwijzing naar `supabase/migrations`, naar `.sql` of naar `c_basis`.

Wat er wél is: een commentaarregel in een van de migraties — *"Wijzig deze lijst NOOIT los van
audit-meta.ts."* Inmiddels is de functie **vijf keer** volledig herdefinieerd, elke keer met een
handmatige kopie van de hele lijst (B-2). Dat is een instructie aan de volgende lezer, en de
projecthistorie weet wat zulke instructies waard zijn: de les uit #322 luidt letterlijk dat een
nieuwe metasleutel zowel de TS-allowlist als de migratie op `meta_projectie` vereist — een les
die is geleerd doordat het een keer mis ging.

**De gate moet dus worden gebouwd, niet uitgebreid.** Twee lagen, en de tweede is de
gezaghebbende:

* **(a) app-laag, statisch.** Parse de `c_basis`-array uit de nieuwste migratie die
  `meta_projectie()` definieert en vergelijk hem met `META_BASIS`. Goedkoop, draait in elke
  CI-ronde, en vangt drift vóór de DB-laag überhaupt start.
* **(b) DB-laag, gezaghebbend.** Roep `public.meta_projectie()` aan op een proefobject en toets
  de UITKOMST: komt `adapters` terug op basisniveau, en komt geen enkel verboden veld terug.

Waarom (b) en niet alleen (a): CLAUDE.md is hier ondubbelzinnig — *"Toets de uitkomst in de
database, niet de intentie in de migratie. Een `revoke`, een policy of een comment in een
migratiebestand bewijst niets over productie: er is geen migratierunner en migraties worden
handmatig geplakt."* Een statische parse toetst een bestand; hij bewijst niets over de functie
die er werkelijk staat. (a) is dus een vroege waarschuwing, geen bewijs.

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

**Een eerdere versie van deze review stelde voor de migratie te laten VERTREKKEN vanuit
`pg_get_functiondef()` op de doeldatabase. Dat is ingetrokken.** De review wees terecht aan
waarom: dan is de inhoud van de migratie afhankelijk van de omgeving waarin zij draait, en kan
hetzelfde bestand op Preview en Productie verschillende SQL opleveren. Precies het probleem dat
zij moest oplossen, één laag dieper.

De migratie draagt dus **één canonieke definitie**, letterlijk in het bestand. Wat
`pg_get_functiondef()` wél mag zijn, is een **fail-closed preflight** — zie §7.

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

## 7. Migratie, preflight, verificatie, rollback

### 7.1 Eén canonieke definitie in het bestand

De migratie bevat de **volledige, letterlijke** definitie van `meta_projectie()` — de huidige
lijst plus `adapters`. Niets eraan wordt uit de doeldatabase afgeleid. Hetzelfde bestand levert
op elke omgeving dezelfde functie op; dat is de hele reden dat het een bestand is.

### 7.2 `pg_get_functiondef()` is een PREFLIGHT, geen bron

Vóór de migratie draait een controle die de **actief geïnstalleerde** functie vergelijkt met wat
wij verwachten:

* komt zij overeen met de verwachte huidige definitie, of met een **expliciet toegestane
  voorganger**, dan mag de migratie door;
* **bij onbekende drift breekt de migratie af** — fail-closed, want dan weten wij niet wat wij
  overschrijven, en `create or replace` is stil: hij vervangt zonder te melden wat er stond.

De vergelijking gebeurt op een **genormaliseerde hash** van de functietekst, niet op de tekst
zelf. De toegestane hashes staan als vaste lijst in de migratie. Bij een mismatch verschijnt
**uitsluitend een inhoudsvrije foutcategorie** — bijvoorbeeld `meta_projectie_drift` — en nooit
de functietekst, een sleutellijst of een metadatawaarde. Een migratie die bij het afbreken de
hele functie in een logregel zet, lekt precies wat zij moet bewaken.

*(Dat hier een hash wordt gebruikt is geen spanning met B-4. Daar gaat het om identifiers ván
brondocumenten in het auditspoor; hier om een integriteitsvergelijking van onze eigen SQL, die
nergens wordt opgeslagen.)*

### 7.3 Bewijs ná de migratie, op een ephemere database

De verificatie draait tegen een **uit de repo opgebouwde** wegwerpdatabase en toont vier dingen:

1. **alle bestaande toegestane sleutels zijn behouden** — dit is de controle die vier eerdere
   kopieerrondes nooit hebben gehad;
2. **`adapters` is toegevoegd** en komt op basisniveau terug;
3. **onbekende sleutels verdwijnen** — een proefobject met een niet-toegestane sleutel mag die
   niet in de projectie terugzien;
4. **de TS-allowlist en de SQL-projectie komen exact overeen** — niet "de SQL bevat ten minste
   de TS-lijst", maar gelijkheid in beide richtingen. Een sleutel die alleen in de SQL staat is
   even fout als een die alleen in TypeScript staat.

### 7.4 De CI-gate toetst de FUNCTIE, niet het bestand

De gate uit B-1 draait in de DB-laag en roept `public.meta_projectie()` werkelijk aan. Een
tekstvergelijking tegen een migratiebestand is uitdrukkelijk **niet** voldoende: dat bewijst dat
iemand het bestand goed heeft geschreven, niet dat de functie in de database die vorm heeft. Dat
onderscheid is in dit project met reden een regel — er is geen migratierunner.

De statische spiegel in de app-laag blijft bestaan als **vroege waarschuwing**: hij draait in
elke CI-ronde en meldt drift vóór de DB-laag start. Hij is nadrukkelijk geen bewijs.

Beide worden aangesloten in `scripts/cross-tenant-ci.sh`. Een controle die daar niet in staat,
draait niet in de gate — dat is bevinding C-01 uit de projecthistorie en de reden dat die regel
in CLAUDE.md staat.

### 7.5 Rollback

Herdefinitie naar de vorige canonieke vorm, eveneens letterlijk in het bestand, met dezelfde
preflight ervoor. De rollback moet aantoonbaar de projectie van vóór de migratie herstellen —
gemeten op dezelfde ephemere database, niet beredeneerd.

## 8. Bestandsgrenzen

| Bestand | Aard |
|---|---|
| `core/lib/rag.ts` | `adapters?: AdapterMeta[]` op `RetrievalMeta` |
| `core/lib/audit-meta.ts` | één regel in `META_BASIS` |
| `core/lib/audit-meta.sanity.ts` | de statische spiegel tegen de migratie (B-1a) |
| `core/lib/retrieval/orkestratie.ts` | `bouwAdapterMeta()` en de aansluiting in `bouwRetrievalMeta()` |
| `supabase/migrations/<datum>_434_meta_adapters.sql` | één canonieke definitie + de fail-closed preflight (§7.1-7.2) |
| `supabase/rollbacks/<datum>_434_meta_adapters_ROLLBACK.sql` | idem, terug naar de vorige canonieke vorm (§7.5) |
| `supabase/checks/<datum>_434_meta_adapters.sql` | het bewijs ná de migratie: behoud, toevoeging, weren, en gelijkheid TS↔SQL (§7.3) |
| `scripts/cross-tenant-ci.sh` | de nieuwe DB-suite aansluiten |
| beheerpagina + statusroute | §6 |

**Niet** geraakt: `core/lib/microsoft-retrieval/*` (T4-C/T4-D worden geconsumeerd), en de
activeringstranche.

---

## 9. Wat deze review níét heeft vastgesteld

* **Of `meta_projectie()` geneste objecten ongewijzigd doorlaat** (B-3). Ik heb de kop van de
  functie gelezen, niet haar volledige body. Dat moet vóór het ontwerp worden nagerekend, en het
  voorstel in B-3 — alles plat — is er juist op gericht dat die vraag er niet meer toe doet.
* **Welke definitie van `meta_projectie()` op Preview en Productie actief is.** Vijf migraties
  herdefiniëren haar en er is geen migratierunner, dus dit is uit de repo niet vast te stellen.
  Het is nu wél BELEGD in plaats van open: de preflight uit §7.2 stelt het vast op het moment
  van migreren en breekt fail-closed af bij onbekende drift. Wat deze review niet weet, weet de
  migratie straks wel — en zij gaat niet door zolang zij het niet weet.
* **Of de karakteriseringsgoldens ongewijzigd blijven.** `adapters` is optioneel en alleen
  aanwezig wanneer er iets te melden is, dus de verwachting is dat zij niet bewegen — maar dat is
  een verwachting. Ontstaat er een diff, dan is die een blokkade die eerst inhoudelijk wordt
  beoordeeld, niet een snapshotupdate.
* **Niets aan de Retrieval-kwaliteitsvraag.** #433 meldt dat de toegang groen is en SEM01 nul
  kandidaten geeft. T4-F raakt dat niet en lost het niet op; de canarymeting met
  `Zandloperbaken 12` blijft een afzonderlijke activeringsvoorwaarde.
