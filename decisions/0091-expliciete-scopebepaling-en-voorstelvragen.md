# 0091 — Expliciete scopebepaling (startvraag + module-herkomst) en voorstelvragen buiten de actueel-filter

- **Status:** Geaccepteerd
- **Datum:** 2026-07-30
- **Betrokkenen:** opdrachtgever (Merlin IJzerman), Claude (analyse + uitvoering)

## Context

Twee waarnemingen uit echt gebruik, dezelfde dag, met dezelfde onderliggende oorzaak:
het systeem **reconstrueert** met patronen wat het portaal al **weet**, en meldt de
uitkomst van een filter als een uitspraak over de werkelijkheid.

**(A) Onnodige terugvraag, ook op onze eigen copy.** De bronkeuze (0014/0016, uitgebreid
bij 0070 en 0090) valt zonder fonds- of generiek signaal terug op
`{ intent: "fonds", vertrouwen: "onzeker" }` → blokkerende verduidelijkingsvraag. Gemeten
tegen de vier vragen uit `GENERIEKE_STARTVRAGEN` (0089) gingen er **twee mis**:

- *"Welke stappen doorloopt een besluit — van beeldvorming naar oordeels- en
  besluitvorming?"* → `fonds/onzeker` → de bestuurder klikt een door ons voorgestelde
  vraag aan en krijgt een tegenvraag terug.
- *"Waar moet ik als bestuurder op letten bij een voorstel dat om een besluit vraagt?"*
  → `fonds/zeker` via `PERSOONLIJK_INTENT_PATRONEN` (`\bmoet ik\b`, 0090), terwijl het
  een generieke governance-vraag is.

Scherpere patronen lossen dit niet op — dat is getest, inclusief een bredere lookahead
op `moet ik`. Een regex kan de bedoeling van onze eigen copy niet raden, terwijl die
bedoeling bij het schrijven al vaststaat. Hetzelfde geldt voor de module-context: wie
vanuit de risicomatrix een vraag stelt, vraagt naar het eigen fonds — die kennis was
aanwezig en werd weggegooid.

Aanvullend gemeten op 18 realistische portaalvragen (besluiten, agendapunten, notulen,
stukken, risico's, openstaande acties): **17 van de 18** vielen in de twijfelbak. De
geaccordeerde meetset (54 vragen) bevat **nul** portaalobject-vragen, dus de drempel
"terugvraag ≤ 20%" meet groen op een populatie die het echte gebruik niet representeert.
Dat is een aparte constatering; het verbreden van de patronen raakt de her-accordering
en is hier **niet** gedaan (zie *Buiten scope*).

**(B) "Geen fondsdocumenten gevonden" terwijl het stuk er is.** De vraag *"Welke
bestuursvoorstellen liggen er voor wijziging van het beleggingsbeleid?"* leverde de
melding `geen_fondstreffer` op, terwijl het bestuursvoorstel in de bibliotheek stond —
**status `concept`**. Oorzaak, geverifieerd in de keten:

1. `bepaalAntwoordmodus` herkent de vraag niet → `feitelijk`.
2. `retrievalModusVoor("feitelijk")` → `actueel`.
3. De RPC-clausule onder `p_modus='actueel'`
   (`2026_07_10_t10_retrieval_review_verval.sql`) eist
   `documentstatus in ('vastgesteld','van_kracht')` — de **harde conceptregel**
   (FO §6 / TO §3.1, `isActueleBronStatus`, Increment C/0009).
4. Een *bestuursvoorstel* is per definitie nog niet vastgesteld → het valt **vóór de
   ranking** weg en is voor de aanroeper onzichtbaar.

De filter werkt dus exact zoals ontworpen; de **melding** is het probleem. "Geen
relevante fondsdocumenten gevonden" leidt tot de omgekeerde conclusie van de
werkelijkheid, en dat is schadelijker dan een terugvraag: het ziet eruit als een
bevinding. Dit is dezelfde bodem als de openstaande post-deploy-actie bij Increment G
(20-06-2026, HANDOVER release-historie): *"zolang relevante documenten op
`status='concept'` staan (C-backfill), geeft de default actueel-modus lege antwoorden;
promoot de demo-stukken bewust"* — vijf weken open gebleven.

Randvoorwaarden die meewegen: de harde conceptregel mag niet verwateren (een concept is
en blijft geen actuele bron), geen schijnzekerheid, append-only audit en herleidbaarheid
naar **wie** de scope koos, RLS/tenant-isolatie ongemoeid, en de geaccordeerde
classificatiedrempels (0014/0016, sign-off 2026-06-22) mogen niet breken.

## Besluit

**Besluit 1 — expliciete scopebepaling gaat vóór heuristiek.** Waar het portaal de
bron-intentie al kent, sturen we die mee als bevestigde intentie in plaats van de
heuristiek te laten gokken:

- **Startvragen dragen hun eigen intentie.** `GENERIEKE_STARTVRAGEN` gaat van
  `readonly string[]` naar `readonly Startvraag[]` (`{ vraag, intent }`); alle vier op
  `algemeen`. De intentie reist als `bron_intent_override` mee — hetzelfde mechanisme
  als de verduidelijkingschip, dus **geen wijziging in de geaccordeerde classificatie**
  en geen her-accordering.
- **Module-herkomst als ingang.** `/ai?intent=fonds&herkomst=<module>` zet de bevestigde
  intentie voor het gesprek. Knop "Vraag de AI hierover" op Vergaderingen, Risicomatrix
  en Processen; Bibliotheek had al `?doc=` en Vergaderingen al `?agendapunt=`.
  Precedentie: chip of startvraag in díe beurt > herkomst van het gesprek. "Nieuw
  gesprek" wist de herkomst.
- **Zichtbaar en wegklikbaar.** Een herkomst-chip in de kopbalk ("Vanuit Risicomatrix ·
  uw fonds ×"). Zonder die zichtbaarheid verschuift het schijnzekerheidsrisico van de
  classificatie naar de UI.
- **Auditspoor verfijnd.** `retrieval_meta.bron_intent_override` (boolean, 0016) zei
  alleen *dat* er is voorgezet. Nu ook `bron_intent_bron: "chip" | "startvraag" |
  "herkomst"` + `bron_intent_herkomst` (moduleslug, whitelist-gevalideerd server-side).

**Besluit 2 — voorstelvragen verlaten de actueel-filter, en een nulmelding wordt
eerlijk.**

- `isVoorstelvraag(vraag)` + `retrievalModusVoorVraag(modus, vraag)`: een vraag naar de
  **staat** van een stuk (voorstel, concept, "ter besluitvorming", "wat ligt er voor",
  "nog niet vastgesteld", agendastuk) die anders op `actueel` zou uitkomen, krijgt
  retrievalmodus **`besluitvorming`** — de modus waarin de RPC de actualiteitsfilter
  laat vallen (`p_modus is distinct from 'actueel'`).
- **Alleen de retrievalmodus schuift op, niet de antwoordmodus.** Zie besluitpunt 1.
- **Schaduwtelling bij nul treffers.** `telNietActueleFondstreffers` (`core/lib/rag.ts`)
  telt, uitsluitend in het nul-treffergeval en alleen als de actueel-filter daadwerkelijk
  actief was, hoeveel **niet-actuele fondsstukken** over het onderwerp bestaan. Vindt hij
  er, dan **vervangt** de melding `niet_vastgestelde_stukken` de misleidende
  `geen_fondstreffer`, met de titels als hint en één chip "Neem deze niet-vastgestelde
  stukken mee" (herstelt de vraag met `modus: 'alles'`).

## Besluitpunt 1 — alleen de retrievalmodus, niet de antwoordmodus

Een voorstelvraag naar antwoordmodus `besluitrijpheid` sturen zou de filter ook laten
vallen, maar verandert daarnaast de promptframing, het tokenbudget, de inline-melding
`onzekerheid_besluit` **en** activeert de Decision Object-injectie (`route.ts` toetst op
`antwoordmodus === "besluitrijpheid"`, Increment G/0013). Dat is een veel grotere
gedragswijziging dan het doel vraagt: we willen alleen dat niet-vastgestelde stukken
zichtbaar worden. `retrievalModusVoorVraag` laat `retrievalModusVoor` ongemoeid (API-
stabiliteit, bestaande sanity-tests) en is een aparte, pure functie.

## Besluitpunt 2 — de conceptregel verwatert niet

Wat wél verandert is *welke documenten een antwoord kunnen bereiken*. Dat is een
governance-relevante wijziging en daarom expliciet afgebakend:

- Een concept wordt **nooit** een actuele bron. De definitie in TO §6.1 en
  `isActueleBronStatus` blijft ongewijzigd; er is geen tweede definitie bijgekomen.
- Concepten komen alleen in beeld (a) bij een vraag die expliciet naar niet-vastgestelde
  stukken vraagt, of (b) na een expliciete klik van de bestuurder.
- De bronkaarten dragen hun statuslabel (concept / ter bespreking) mee, dus er ontstaat
  geen beeld van vastgesteld beleid.
- De schaduwtelling **beweert** niets: hij noemt aantal en titels van wat is
  weggelaten, en levert geen bronvermelding — het antwoord is er niet op gebaseerd.

## Besluitpunt 3 — `/voorstel(?:len)?\b/` zonder leidende woordgrens

`\bvoorstel\b` matcht **niet** op "bestuursvoorstellen": in Nederlandse samenstellingen
staat geen woordgrens vóór het kernwoord. Zelfde overweging als bij de plicht-patronen
(0070). Precies de casus die dit ticket aanleiding gaf zou anders langs de fix heen
zijn gegaan; een sanity-test op "bestuursvoorstellen" borgt het.

## Besluitpunt 4 — schaduwtelling FTS-only en fail-safe

De telling draait met `hybrideAan = false` → `zoekViaFTS`, dus **zonder embedding-call**:
één goedkope RPC, en alleen in het geval waarin we nu een misleidend antwoord geven. FTS
heeft smallere recall dan hybride; vindt de telling niets (of faalt hij), dan valt het
gedrag terug op de bestaande melding. Een onderschatting leidt dus tot het huidige
gedrag, **nooit** tot een bewering over stukken die er niet zijn.

## Overwogen alternatieven

- **Patronen verbreden (portaalobject-ankers: besluiten, agendapunten, notulen, stukken,
  risicomatrix, procedures).** Gemeten variant haalde 54/54 op de meetset met alle
  drempels groen en loste 11 van 11 realistische portaalvragen op. **Niet nu gedaan:**
  het raakt de geaccordeerde classificatie en vereist her-accordering, en de meetset moet
  eerst representatief worden (portaalobject-vragen toevoegen). Meetset-first, conform de
  werknotitie van 15-07-2026.
- **Terugvraag helemaal verlaten ("antwoord-eerst").** Aantrekkelijk — de twijfelbak
  levert al `intent: fonds`, en met de combineren-vloer zou een fondsgericht antwoord met
  automatische terugval op algemene kennis volgen. **Uitgesteld:** het is een
  beleidswijziging op door compliance geaccordeerd gedrag (FO §11a), en zonder actieve
  relevantie-ondergrens (R1.5, `RELEVANTIE_DREMPEL`/`RERANK` staan default uit) kan een
  zwakke, semi-relevante treffer een algemene vraag fondsgericht framen — schadelijker
  dan een terugvraag, want het lijkt onderbouwd. Volgorde afgesproken met de
  opdrachtgever: eerst deze release, dan rerank + drempel meten, dan antwoord-eerst.
- **Demodocumenten op `vastgesteld` zetten.** Nodig als datastap (zie Gevolgen), maar
  **geen** oplossing voor voorstellen: die horen concept te zijn. Het zou het symptoom
  wegnemen en de foutmelding laten staan.
- **Statusfilter standaard verruimen naar `alles`.** Verworpen: dat sloopt de
  conceptregel en levert precies de schijnzekerheid die Increment G voorkwam.
- **Startvragen door de heuristiek laten classificeren met scherpere patronen.** Getest
  en verworpen: twee van vier blijven mis; zie Context.

## Gevolgen

- **Pure lagen:** `core/lib/startvragen.ts` (+ `.sanity.ts`, 6 tests) — objectmodel met
  intentie, inclusief een test die borgt dat de generieke set nooit stil `fonds` wordt.
  `core/lib/vraagtype.ts` — `isVoorstelvraag`, `retrievalModusVoorVraag`, meldingtype
  `niet_vastgestelde_stukken` + `meldingNietVastgesteldeStukken(aantal)`;
  `vraagtype.sanity.ts` van 58 naar **70** tests. `core/lib/rag.ts` —
  `telNietActueleFondstreffers` + `RetrievalMeta`-uitbreiding.
- **Route:** `app/api/chat/route.ts` — body `bron_intent_bron`/`bron_intent_herkomst`
  (whitelist) en `neem_niet_vastgestelde_mee`; retrievalmodus via
  `retrievalModusVoorVraag`; schaduwtelling + meldingvervanging; `verbreding` in het
  `meta`- en `done`-event; auditvelden in `retrieval_meta`.
- **UI:** `Startpunt.tsx` (objectmodel), `AssistentClient.tsx` (herkomst-state + chip,
  verbredingschip, `kiesVerbreding`), en knoppen in `vergaderingen/page.tsx`,
  `risicomatrix/page.tsx`, `procedures/page.tsx`.
- **Classificatiedrempels ongewijzigd gehaald:** meetset 54/54, fondsvraag→stil-algemeen
  0, foute zekere auto-keuze 0%, terugvraag 16,7%, niet-stil-verkeerd 100%.
- **RLS/tenant-isolatie:** ongemoeid. De schaduwtelling gebruikt dezelfde RPC's
  (`security invoker`) met dezelfde server-side `fondsId`; `bronsoort: ['fonds']` is een
  additief AND-predicaat. Geen verbreding van leesrechten.
- **Audit:** additief in `governance_log.retrieval_meta` (jsonb) —
  `bron_intent_bron`, `bron_intent_herkomst`, `niet_vastgesteld{documenten,chunks,
  meegenomen}`. Append-only ongemoeid, geen nieuw event-type.
- **Geen migratie, geen schema-/RLS-/policywijziging.** `tsc --noEmit --skipLibCheck`
  exit 0. **Gedeployed 2026-07-30.**
- **Nieuw gedocumenteerde beperking:** beide zoek-RPC's hebben `where d.actief = true`
  **onvoorwaardelijk**, buiten de modus-check om. Een **gearchiveerd** (gedeactiveerd)
  document is in geen enkele modus vindbaar — ook niet met `alles`, ook niet na de
  verbredingschip. Voor de aanleidende casus niet aan de orde (het stuk stond op
  `concept`, bevestigd door de opdrachtgever), maar het is een reële grens: "welke
  voorstellen liggen er in het archief" is onbeantwoordbaar. Als openstaand punt belegd.
- **Openstaande datastap (overgenomen van Increment G):** staat het merendeel van de
  Horizon-bibliotheek op `concept`, dan demonstreert het portaal vooral zijn eigen
  filter. De melding is nu eerlijk, maar de voorraad `vastgesteld`/`van_kracht` moet
  bewust gepromoveerd worden. Verplaatst naar `openstaande-punten-en-risicos.md` — een
  actie die vijf weken in een release-historie-regel blijft hangen, wordt niet gezien.
- **Bewust geaccepteerde schuld:** de meetset blijft niet-representatief voor
  portaalobject-vragen; de terugvraag-drempel meet daardoor gunstiger dan het echte
  gebruik. Belegd als vervolg (meetset uitbreiden → patronen → her-accordering).
- **Onderhoudslast:** elke nieuwe startvraag en elke nieuwe module-ingang vraagt een
  bewuste intentiekeuze. Opgenomen in de reviewchecklist; de sanity-test op de generieke
  set is het vangnet.

## Aanvulling 30-07-2026 (tweede ronde, na terugkoppeling uit gebruik)

Na de eerste deploy bleven conceptdocumenten in de praktijk onvindbaar. Twee oorzaken,
allebei in dit besluit hersteld:

**1. De trigger van de schaduwtelling was verkeerd.** De telling liep op
`bronnen.length === 0`, maar bij een fondsvraag levert retrieval vaak wél **generieke**
treffers (Pensioenwet, DNB-guidance) terwijl er geen enkel fondsstuk doorheen komt. De
telling sloeg dan niet aan en het antwoord bleef *"de bronnen die ik ken zijn zonder
uitzondering generieke kaders"* — exact het geval waarvoor de melding bedoeld was.
Trigger is nu **nul FONDStreffers** (`chunks.filter(c => c.documenten.bibliotheek !==
"generiek")`), niet nul treffers totaal.

**2. De uitzondering was te smal: catalogusvragen ontbraken.** `isVoorstelvraag` vangt
alleen vragen met een voorstel-/conceptsignaal. Een **inventarisvraag** — "welke
documenten/stukken zijn er over X?" — heeft dat signaal niet en bleef daardoor op
`actueel` staan, terwijl juist die vraag naar wat er **bestaat** vraagt en niet naar wat
geldend beleid is. Gemeten op tien realistische formuleringen viel de helft nog buiten de
fix. Daarom: een vraag met antwoordmodus **`bronoverzicht`** krijgt retrievalmodus
**`alles`** (in `retrievalModusVoorVraag`, niet in `retrievalModusVoor` — de basisfunctie
blijft stabiel). Een inventaris hoort volledig te zijn; de statuslabels op de bronkaarten
dragen de nuance. Daarnaast zijn de `bronoverzicht`-patronen verbreed met vormen die in
echt gebruik langskwamen: *"zijn er documenten/stukken/bronnen/voorstellen …"*, *"hebben
we documenten/stukken/iets …"*, *"wat hebben we over …"*, *"welke informatie is er …"*.

Meetset-gating opnieuw gedraaid: 54/54, alle geaccordeerde drempels ongewijzigd gehaald.
`vraagtype.sanity` van 70 naar **71** tests. Wat nog steeds op `actueel` blijft: vragen
zonder enig staat- of inventarissignaal ("Is er al iets bekend over …?"). Daarvoor is de
schaduwtelling (nu met de juiste trigger) het vangnet: die meldt dat er niet-vastgestelde
stukken zijn en biedt de verbredingschip.

## Referenties

- Code: `core/lib/startvragen.ts` (+ `.sanity.ts`), `core/lib/vraagtype.ts`
  (+ `.sanity.ts`), `core/lib/rag.ts`, `app/api/chat/route.ts`,
  `app/(dashboard)/ai/_components/Startpunt.tsx`,
  `app/(dashboard)/ai/_components/AssistentClient.tsx`,
  `app/(dashboard)/{vergaderingen,risicomatrix,procedures}/page.tsx`.
- Filterclausule: `supabase/migrations/2026_07_10_t10_retrieval_review_verval.sql`
  (`p_modus='actueel'`), `core/lib/document-status-transities.ts`
  (`ACTUELE_BRON_STATUSSEN`, `isActueleBronStatus`).
- Besluiten: [`0014`](./0014-increment-i2-automatische-bronkeuze.md) (automatische
  bronkeuze), [`0016`](./0016-i2-aanscherpingen-na-review.md)
  (schijnzekerheid-guardrail + `bron_intent_override`),
  [`0070`](./0070-bronkeuze-plicht-patronen-en-meetset-uitbreiding.md) (meetset +
  compound-patronen), [`0090`](./0090-ai-contextbesef-persoonlijke-intentie-en-portaalstand.md)
  (persoonlijk anker), [`0089`](./0089-ai-taken-p2-voorbeeldvragen-en-document-doorgronden.md)
  (startvragen — dit besluit herziet het datamodel van `GENERIEKE_STARTVRAGEN`),
  [`0013`](./0013-increment-g-keuzes.md) (modusfamilie + actuele-bron-definitie),
  [`0009`](./0009-increment-c-keuzes.md) (documentstatus, harde conceptregel),
  [`0073`](./0073-retrieval-reranker-haiku-en-gelijktijdige-activering.md) (R1.3–R1.6).
- Ontwerp: `03 Functioneel ontwerp/Bestuurdersportaal - Doorontwikkeling v2 functioneel
  ontwerp v1.3.md` (§11a, §11c — de opsomming van uitzonderingen wordt zeven),
  `04 Technische inrichting/Bestuurdersportaal - Doorontwikkeling v2 technisch ontwerp
  v1.2.md` (§6.1), `AI-assistent - verbeterpunten notitie 2026-07-15.md` (onderwerp 1).
