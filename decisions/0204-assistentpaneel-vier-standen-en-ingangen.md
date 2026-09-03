# 0204 — Het assistentpaneel: vier standen, één contextchip, zeven ingangen

- **Status:** Geaccepteerd
- **Datum:** 2026-09-03
- **Betrokkenen:** productowner (bestuurdersportaal), Claude Code
- **Volgt op:** [`0201`](./0201-assistent-in-drie-lagen.md) (P1a — de drie lagen)

## Context

P1a splitste de assistent in drie lagen, maar liet hem een *pagina*. Een bestuurder die bij
een risico of een agendapunt een vraag heeft, moet daarvoor de module verlaten. Tegelijk
draagt de agendapuntkaart een tweede, meegegroeide-noch-gelijkgetrokken gespreksimplementatie
(`AgendapuntChat.tsx`, 1.459 regels).

T1 zet de lagen uit 0201 aan het werk: de assistent wordt een paneel over elke module heen,
met een zichtbare contextchip. Dit besluit legt de keuzes vast die daarbij niet uit de
werkopdracht volgden of die er anders uitvielen dan geadviseerd.

## Besluit

### 1. Het paneel is een slot in `DashboardShell`, geen import

`core/` mag niet uit `app/` importeren (boundary T9), terwijl de presentatielaag in
`app/(dashboard)/ai/_components/` woont. `app/(dashboard)/layout.tsx` geeft het oppervlak
daarom als node door aan de schil (`assistentOppervlak`). Het alternatief — ~2.500 regels
presentatiecode naar `core/` verhuizen — zou een refactor van die omvang aan een UI-ticket
vastknopen.

De schil bepaalt alleen wannéér die node wordt gerenderd: **pas na de eerste opening**. Een
JSX-node mount niet bij het doorgeven maar bij het renderen, dus wie de assistent nooit
opent, betaalt geen enkele query en krijgt geen tweede Supabase-client. Ná de eerste opening
blijft het oppervlak gemount (alleen verborgen), zodat het gesprek een modulewissel én
sluiten/heropenen overleeft.

**Precies één instantie.** Twee zouden twee gesprekken zijn, twee Supabase-clients en twee
schrijvers naar dezelfde `gesprekken`-rij. `/ai` mag `useAssistent` daarom niet zelf
aanroepen; die route is nog uitsluitend een brug.

### 2. Volledig scherm ís de route `/ai`

De knop "volledig scherm" doet `router.push("/ai")`. Dat is een *zachte* navigatie binnen
dezelfde layout: het oppervlak blijft gemount en het gesprek loopt door — precies wat de
vervallen link "Openen in volledige assistent" niet kon. De route blijft daarmee deelbaar en
bookmarkbaar, en `/ai` houdt zijn startpunt (0085/0088).

De stand is dus geen kopie van de route maar dezelfde zaak, van twee kanten bekeken. Bij het
weglopen van `/ai` krimpt het paneel naar 400 px; zou het volledig blijven, dan dekt het de
module af waar de bestuurder net naartoe navigeerde.

### 3. Geometrie in CSS, niet in Tailwind

De breekpuntgrens van het paneel ligt op **900 px** — daaronder is er naast een paneel van
400 px geen module meer om in te blijven kijken, en vult het paneel de contentkolom. Die
grens bestaat niet in de Tailwind-schaal, en `tailwind.config.ts` is in deze release
eigendom van T3. De geometrie staat daarom onderaan `app/globals.css` in een eigen
`@layer components`; T3 werkt uitsluitend in het `:root`-tokenblok bovenaan. Twee regio's,
één bestand, schone merge.

De contentkolom **schuift op** (`margin-right`) en wordt niet overlapt. De bestaande
`transition-[margin]` op `<main>` — er voor de zijbalk-inklap — draagt die marge mee.

### 4. Eén contextchip, met de tweede scope eronder

`contextChipLabels()` uit P1a legde vast dat `/ai` bij een samengestelde context **twee**
chips toont; dat was bestaand gedrag, geen ontwerpkeuze, en P1a liet de keuze bewust open.

Het paneel toont **één** chip: het label volgt de meest specifieke context (dezelfde
precedentie als `bepaalContextSoort` en als de server), en de tweede scope verdwijnt niet
maar staat op de bronbereikregel eronder ("alle open risico's van het fonds · daarnaast
2 stukken"). Indikken tot één label zonder die regel zou een actieve documentscope
verzwijgen — dan leest de bestuurder één scope en krijgt hij een antwoord uit twee.

Fondsbreed heeft geen loslaatknop: er is niets om los te laten, en een kruisje dat niets doet
is erger dan geen kruisje.

### 5. De lege stand van het paneel is compact

Het startpunt (0085/0088) vraagt om `PortaalContext`, en die haalt alleen `/ai` server-side
op — vier à vijf query's die niet op elke dashboardpagina thuishoren. In het paneel van
400 px past het kaartenraster bovendien niet. Het paneel krijgt daarom een compacte lege
stand (begroeting + dezelfde generieke startvragen); de volle startpuntkaarten verschijnen
waar de gegevens er zijn, dus op `/ai`.

### 6. Eén ingang-component, één resolutiepad, één manifestvlag

Alle module-ingangen lopen door `AssistentIngang`. Het ingangenregister is alleen aftoetsbaar
als ze door hetzelfde component gaan — anders is "geen dubbele ingangen" een belofte in
proza.

Het is een `<a href>` en geen `<button>`, om drie redenen die alle drie uit de code komen:
`StapPaneel.tsx` zet zijn ingang bewust als anker neer omdat hij binnen een
`<fieldset disabled>` staat (een `<button>` zou daar uitgeschakeld zijn); midden-klik en
bookmarken blijven werken; en zonder paneel erboven is de link de val-terug. De gewone
linkerklik wordt onderschept.

Een ingang zet **zelf geen scope**: hij legt een aanvraag neer, die de gespreklaag verzilvert
met `resolveerAssistentContext()` — dezelfde resolver die de deeplinks gebruiken. Eén pad
voor knop én URL; twee paden zouden binnen een week uit elkaar lopen.

**De manifestvlag `ai` gaat over alle zeven ingangen**, het paneel en de knop rechtsonder.
Dat is netheid, geen beveiliging: de poort staat server-side in `/api/chat`
(`weigerAlsModuleUit`, r. 551).

### 7. `/ai` krijgt een paginagate — een bewuste herziening van 0085

0085 zag bewust af van een manifest-gate op `/ai`: de route was toen alleen via het nav-item
bereikbaar en het manifest verborg dat item al. Met T1 vervalt die redenering — staat de
module uit, dan verbergt de shell paneel, knop en ingangen, maar bleef `/ai` bereikbaar en
toonde hij een lege paneelstand. De route krijgt daarom `moduleBeschikbaar(fondsId, "ai")`
→ `notFound()`, gelijk aan het huispatroon in `vergaderingen/[id]/page.tsx` r. 92.

### 8. Eén doorlopend gesprek dat van context wisselt

Wisselt de bestuurder van agendapunt naar risico, dan verandert de chip en loopt het gesprek
door. Het auditspoor verliest niets: de scope gaat **per beurt** mee in
`governance_log.retrieval_meta` (`core/lib/audit-meta.ts` r. 122/127-130, 189/192). Een
gesprek per context zou de historie versnipperen zonder dat de audit er iets bij wint.

`gesprekken.document_scope` is één kolom per gesprek en krijgt daarmee een **smallere
betekenis**: de scope waarmee het gesprek het laatst actief was. Dat staat vastgelegd in
`supabase/schema.sql`; het DB-kolomcommentaar (`comment on column`, DDL) lift mee op de
migratie van T2, zodat T1 migratievrij blijft en er geen handmatige releasestap ontstaat voor
één regel tekst zonder functioneel effect.

### 9. `?intent=` / `?herkomst=` blijft ongemoeid — aansluiten verhuist naar T2

De werkopdracht adviseerde de module-ingangen de herkomst te laten zetten, zodat het
auditspoor voortaan vermeldt wáár een gesprek vandaan kwam. **Dat is in T1 niet haalbaar
zonder één van de twee guardrails te breken.** `/api/chat` logt `bron_intent_bron` en
`bron_intent_herkomst` uitsluitend als er óók een `bron_intent_override` is —
`app/api/chat/route.ts` r. 3184-3187 (`scopeActief || intentOverride === undefined ? null :
intentBron`) en r. 3814-3826. Een ingang die alleen de module meestuurt levert dus niets in
de log; een die óók `intent` zet, legt de bronintentie voor het hele gesprek vast met
vertrouwen "zeker" — een gedragswijziging, terwijl T1 gedragsneutraal is voor het gesprek.

T1 raakt het pad daarom niet aan. Een veld meesturen dat de route weggooit zou een tweede
dood pad planten náást het pad dat dit ticket opruimt. Het label "geopend vanuit …" in de
paneelkop is clientstaat in de paneelprovider; daar is geen payloadveld voor nodig.

**Dit is uitgesteld, niet afgewezen.** In T2 landt het in één keer en op één plek:
`bron_intent_bron`/`bron_intent_herkomst` loskoppelen van `intentOverride` (loggen zodra
`intentBron === "herkomst"`, ook bij een actieve scope), plus de ingangen die de module
meesturen. Eén auditreview — cross-tenant en audit-inventaris één keer langs in plaats van
twee — en T2 raakt de route toch al.

## Overwogen alternatieven

- **Het oppervlak naar `core/` verhuizen** in plaats van een slot. Verwerpt: ~2.500 regels
  presentatiecode verplaatsen om een importrichting te vermijden, in een ticket dat over de
  interface gaat. Het slot kost één prop.
- **Het paneel altijd mounten** in plaats van bij de eerste opening. Verwerpt: dan draait het
  profiel- en gesprekkenladen op élke dashboardpagina, ook voor wie de assistent nooit
  gebruikt.
- **Volledig scherm als pure clientstand**, zonder navigatie. Verwerpt: dan is de
  volledig-schermstand niet deelbaar, en `/ai` zou een tweede weergave van hetzelfde worden.
  Nu is de route de stand.
- **Een benoemde Tailwind-screen op 900 px.** Verwerpt: `tailwind.config.ts` is deze release
  van T3; een conflict in precies dat bestand is vermijdbaar.
- **Twee chips tonen zoals `/ai` vandaag doet.** Verwerpt voor het paneel: op 400 px is er
  geen ruimte, en een tweede chip naast de eerste is een rij die snel afkapt. De
  bronbereikregel draagt dezelfde informatie in leesbare vorm.
- **Het nav-item "AI Assistent" laten vervallen.** Verwerpt: dan verdwijnt ook de
  manifest-schakelaar waarmee een fonds de assistent uitzet, en het is de enige ingang die
  rechtstreeks naar de bookmarkbare volledig-schermstand gaat.

## Gevolgen

- De contextlaag en het gesprek leven boven de modules. Een bestuurder verlaat zijn stuk niet
  meer om iets te vragen.
- `AssistentClient.tsx` is niet langer het oppervlak maar de brug; het oppervlak heet
  `AssistentOppervlak.tsx`. De copy-pin in `core/lib/ai-begroeting-copy.sanity.ts` wees op
  het pad en is meeverhuisd — dat is precies het soort stille breuk waar een hernoeming voor
  zorgt.
- De componenttest die pinde dat er precies één `createClient` per render bestaat, is
  **bewust herbevestigd** in plaats van meegedreven: hij hangt nu aan het oppervlak in het
  harnas van beide providers, en de assertie weegt zwaarder dan eerst.
- De recente AI-vragen op de home openen het paneel **fondsbreed**, niet "op dat gesprek":
  die rijen komen uit een logtabel en dragen geen gespreks-id. Het register is op dat punt
  gecorrigeerd; het terughalen van dát gesprek staat als openstaand punt genoteerd.

## Openstaande punten

1. **Herkomst in het auditspoor** — route-ontkoppeling + module-ingangen, samen in **T2**.
2. **Een recente vraag op de home opent het bijbehorende gesprek** — vereist een gespreks-id
   in de logrij of een koppeling; eigenaar nog te beleggen.
3. **Bronintentie vanuit een module** hoort een zichtbare keuze in het paneel te zijn (een
   chip "alleen fondsbronnen"), geen onzichtbaar bijeffect van een knop.

## Referenties

- Werkopdracht: issue [#281](https://github.com/merlinijzerman/Bestuurdersportaal/issues/281)
- `core/components/assistent/README.md` — het ingangenregister (bindend)
- `VOORSTEL-ASSISTENTPANEEL-EN-VISUELE-LIJN-2026-09-03.md` §3;
  `ONTWERP-EEN-GENERIEKE-ASSISTENT-2026-09-03.md` §4 (beide in de projectmap)
- Besluiten 0084 (inklapstand), 0085/0088 (startpunt), 0151 (module-scope), 0201 (drie lagen)
