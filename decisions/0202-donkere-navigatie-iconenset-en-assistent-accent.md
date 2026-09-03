# 0202 — Donkere navigatie, eigen lijn-iconenset en een assistent-accent

- **Status:** Geaccepteerd
- **Datum:** 2026-09-03
- **Betrokkenen:** opdrachtgever (plansessie + drie beslispunten), Claude Code (uitvoering)
- **Herziet:** [0084](./0084-huisstijl-t1-violet-accent-teal-fase-lichte-nav.md) op het punt van de lichte navigatie

## Context

De opmaak van het portaal moest professioneler en rustiger ogen, in de lijn van de
Microsoft-oplossing (`digitale-bestuurder-webapp`). Uit de vergelijking bleek dat het
verschil **niet in het lettertype** zit — beide gebruiken Inter — maar in vier dingen: een
donkere navigatiekolom die de content laat zweven, een ruimere type-schaal, één accent dat
exclusief van de assistent is, en een echte lijn-iconenset in plaats van Unicode-tekens.

Werkopdracht: issue [#282](https://github.com/merlinijzerman/Bestuurdersportaal/issues/282)
(T3), goedgekeurd ontwerp `VOORSTEL-ASSISTENTPANEEL-EN-VISUELE-LIJN-2026-09-03.md` §3.2 en
§6, visuele referentie `MOCKUP-assistentpaneel-v0.1.html`.

Randvoorwaarden: geen dark mode, geen wijziging aan navigatiegedrag, routes of
manifest-zichtbaarheid, contrast aantoonbaar WCAG AA (1.4.3) resp. ≥ 3:1 voor
bedieningselementen (1.4.11), en kleur is nooit de enige drager van betekenis
(besluit [0097](./0097-tokens-mark-en-app-line-control.md)).

## Besluit

1. **De navigatie gaat van licht terug naar donker** (`--nav-rgb: 11 29 47`), met lichte
   navtekst (`169 186 199`) en wit voor de actieve/merkregel. Dit draait de nav-inversie
   uit besluit 0084 om; de overige keuzes uit 0084 (navy accent, teal `--phase`) blijven
   staan.
2. **`--nav-accent` blijft navy en de teal accentrand krijgt een eigen token,
   `--nav-rail`.** De werkopdracht schreef in §2 voor dat `--nav-accent` zelf teal zou
   worden; dat is op dit punt onjuist en is niet gevolgd (het issue is bijgewerkt).
3. **Nieuw assistent-accent `--ai` / `--ai-500` / `--ai-tint` / `--ai-line`** (teal),
   uitsluitend voor AI-elementen. Bestuurlijke acties blijven navy (`--accent`).
   Niet themabaar per fonds.
4. **De Unicode-navigatietekens worden een eigen lijn-iconenset in de repo**
   (`core/components/icons/Icoon.tsx`), met paden ontleend aan Lucide onder de
   ISC-licentie — géén `lucide-react`-dependency.
5. **De procedure-componenten worden losgekoppeld van de chrome-tokens.** Zie §4 hieronder;
   dit repareert een bestaande, latente fout.

## Overwogen alternatieven

### Nav: licht houden (het standpunt van 0084)

0084 voerde twee argumenten aan voor de lichte nav. Beide zijn hier expliciet gewogen:

- *"Strijdig met de gevraagde lichtere uitstraling van tranche 1."* — De vraag is sindsdien
  veranderd: de toets tegen de Microsoft-oplossing wees uit dat "lichter" niet is wat het
  portaal professioneler maakt. Een donkere kolom naast lichte content **laat de content
  zweven**; een lichte kolom naast lichte content laat het scherm uit één ongedeeld vlak
  bestaan. Dat is de waarneming die tranche 1 nog niet had.
- *"Verankering wordt geborgd via de rechterrand (`--nav-line`) en het actieve item."* —
  Dit argument gaf 0084 zélf al toe dat een lichte zijbalk visueel minder verankert en dat
  daar compensatie voor nodig was. Met een donkere kolom vervalt de compensatie: de
  verankering komt uit het vlak zelf. Het argument pleit dus, achteraf gelezen, eerder vóór
  dan tegen deze omslag.

Wat 0084 wél goed zag en hier blijft gelden: een fonds dat `nav-rgb` themt zonder óók
`nav-text-rgb`/`nav-text-active-rgb` te zetten, krijgt onleesbare navtekst. Dat gold toen
in de richting licht→donker en geldt nu in de richting donker→licht. De Meridiaan-demoseed
zet beide en blijft daarmee correct.

### Iconen: `lucide-react` als dependency

De werkopdracht adviseerde dit (het is wat de referentie-oplossing gebruikt). Niet gekozen:
`HANDOVER.md` en `CLAUDE.md` leggen vast dat dit project geen visualisatiebibliotheken
gebruikt — alle visuals zijn pure SVG/HTML. Twaalf iconen rechtvaardigen geen uitzondering
op die regel, en de repo heeft een zware toeleveringsketen-borging (bundle-secrets,
malwarescan) waarin elke extra runtime-dependency meetelt. Bij een set van tientallen
iconen zou de afweging andersom uitvallen.

Drie randvoorwaarden bij die keuze, alle drie uitgevoerd:

1. **Paden ontleend aan Lucide** (ISC, overnemen toegestaan; licentietekst staat in
   `core/components/icons/LICENSE-lucide.txt`) in plaats van zelf getekend — zelfde
   optische grid, streekbreedte en eindvormen. Zelfgetekende iconen wijken onderling net
   iets af in gewicht, en dat zie je juist in een zijbalk waar ze onder elkaar staan.
2. **Eén component met een getypeerde icoonsleutel** (`type IcoonSleutel`). Een dertiende
   module is één regel in de registry plus één pad in de set, en TypeScript meldt een
   sleutel die niet bestaat. Dat haalt het onderhoudsbezwaar grotendeels weg.
3. **De AI-module gaat mee.** Die droeg `iconSrc: "/ai-assistent.png"` — een raster-PNG van
   128×128 met een cartoonafbeelding (een ijsblokje met een gezicht) tussen twaalf
   lijn-iconen van 18 px. Dat is vervangen door het set-icoon `sprankel`. Het
   `iconSrc`-mechanisme zelf blijft bestaan, nu in zijn eigenlijke rol: fondsspecifieke
   iconen.

### `--nav-accent` letterlijk teal maken (zoals §2 van het issue voorschreef)

Verworpen, en het issue is op dit punt gecorrigeerd. `--nav-accent` is in de code een
**vulkleur met witte tekst erop** — merkvierkant, avatar, badge, de logotegel van de
platform-back-office en twee platformknoppen — terwijl het in het prototype alléén een
randje van 3 px is. Zelfde naam, andere functie. Nagerekend:

| | contrast | eis |
|---|---|---|
| wit op `--nav-accent` navy `#234E70` | **8,77:1** | 4,5 (1.4.3) ✅ |
| wit op teal `#4FB4BB` | **2,45:1** | 4,5 ❌ |
| `--nav-rail` teal op `--nav` `#0B1D2F` | **6,97:1** | 3,0 (1.4.11) ✅ |

Eén token splitsen in twee is dus geen stijlkeuze maar de enige lezing waarin beide rollen
hun eis halen. `kleurcontrast.sanity.ts` pint dit paar vast, inclusief de negatieve kant
("de rail zou géén vulvlak mogen dragen"), zodat de reden voor de splitsing niet verdampt.

Conform 0097 draagt de teal rail de actieve staat bovendien **niet alleen**: `aria-current`,
witte tekst, een zwaarder gewicht en het gradiëntvlak dragen mee. Wie de kleur niet
waarneemt, ziet de actieve regel nog steeds.

## Gevolgen

### 1. Contrast — alle gewijzigde combinaties nagerekend

Vastgelegd als test in `core/lib/kleurcontrast.sanity.ts` (29 checks groen), gerekend op de
waarden in `app/globals.css`:

| Combinatie | Ratio | Eis |
|---|---|---|
| `--nav-text` op `--nav` | 8,56:1 | 4,5 ✅ |
| `--nav-text-active` (wit) op `--nav` | 17,06:1 | 4,5 ✅ |
| sectielabel `text-nav-text/80` op `--nav` | 5,95:1 | 4,5 ✅ |
| `--nav-text` op het hover-/lijnvlak | 6,85:1 | 4,5 ✅ |
| `--nav-rail` op `--nav` | 6,97:1 | 3,0 ✅ |
| wit op het actief-gradiëntvlak | 11,78:1 | 4,5 ✅ |
| wit op de badge (wit/15 over `--nav`) | 11,15:1 | 4,5 ✅ |
| `--ai` op wit / op `--app-bg` / wit erop / op `--ai-tint` | 5,62 / 4,96 / 5,62 / 4,95 | 4,5 ✅ |
| `--ai-500` op wit | 3,85:1 | 3,0 ✅ (grafisch); **niet** als tekst |
| `--ai-line` op wit | 1,45:1 | decoratief; controlerand blijft `--app-line-control` |
| `--ai` op `--nav` | 3,04:1 | **onbruikbaar in de chrome** |

Twee waarden uit het goedgekeurde prototype haalden de eis niet en zijn aangepast: het
sectielabel `#6d8496` kwam op 4,38:1 (bij 10 px gewone tekst — zakt door 1.4.3) en de
teal-als-vulkleur hierboven. `--ai-line` en `--ai-500` zijn als **negatieve** test
vastgepind, in dezelfde stijl als `--app-line-strong` in 0097: ze leggen vast waaróm het
token beperkt inzetbaar is.

### 2. Theming (T8)

`THEMABARE_TOKENS` blijft ongewijzigd: de vijf nav-tokens blijven brandbaar per fonds,
`--nav-rail` en de `--ai`-familie komen er **niet** in. Motivering: het assistent-accent is
een productafspraak (het onderscheid AI ↔ bestuurlijk), niet een merkkleur — een fonds dat
"AI" in zijn eigen kleur zet, maakt juist dat onderscheid stuk. `--nav-rail` is een
contrastafspraak. Beide volgen daarmee de lijn die 0097 al voor de toegankelijkheidstokens
trok.

### 3. Fondslogo's op een donkere nav — opgelost, niet "te controleren"

`Sidebar.tsx` waarschuwde hier zelf al voor: fondslogo's zijn overwegend donkere
woordmerken en vielen zonder lichte ondergrond weg op een donker nav-vlak. De brede
logostrook heeft daarom een lichte ondergrond terug (`bg-white/95`, afgeronde hoek). Zo
blijft élk fondslogo leesbaar zonder dat fondsen eerst een lichte logovariant hoeven aan te
leveren. Dat blijft wel wenselijk en staat als actie richting de fondsen op de
openstaande-puntenlijst — het is geen codewijziging.

### 4. Bestaande fout gerepareerd: de chrome-tokens waren niet privé

`FaseRail.tsx` en `FaseWeergave.tsx` (procesdetail) gebruikten de nav-tokens op een **licht**
oppervlak, met de motivering "in de kleuren van het hoofdmenu". Dat was al fout vóór deze
omslag: `nav-rgb`, `nav-line-rgb`, `nav-text-rgb`, `nav-text-active-rgb` en `nav-accent-rgb`
staan alle vijf in `THEMABARE_TOKENS`, dus **een fonds dat vandaag zijn navigatie donker
brandt, heeft nu al een onleesbaar procesdetail** — zonder dat iets dat meldt. De donkere
chrome maakte die latente fout alleen zichtbaar voor iedereen.

33 voorkomens zijn 1-op-1 naar de neutrale tokens gezet: `text-nav-text` → `text-muted`
(4,78:1 op `--app-bg`), `border-nav-line` → `border-line`, `bg-nav-line` → `bg-app-line`,
`bg-nav-active` → `bg-accent-tint` (`--ink` erop 13,39:1), `text-nav-text-active` →
`text-ink`, `bg-nav-accent` → `bg-accent` (wit erop 8,77:1). `--phase-*` is bewust **niet**
als vervanger gebruikt: dat token is semantisch (oordeelsvorming/in_evaluatie), geen
algemene neutrale kleur.

Dit valt buiten de bestandenlijst van de werkopdracht (§9) en hoort er toch bij: zonder deze
stap landt de donkere chrome mét een leesbaarheidsregressie.

### 5. Platform-back-office volgt de chrome — en één bug verdwijnt

`app/(platform)/platform/**` gebruikt dezelfde nav-tokens en krijgt dus een donkere header.
Dat is bewust geaccepteerd, niet ongemerkt: het is consistent en het repareert twee knoppen
in `BronnenWhitelistClient.tsx` die `bg-nav` met **witte** tekst combineerden — met de
lichte nav waren die wit-op-wit en daarmee onzichtbaar. De back-office draait als apart
Vercel-project (besluit 0066/Variant C); de wijziging is puur visueel.

### 6. Geen gedrags-, route- of manifestwijziging

Navigatiegedrag, routes, `defaultActief`/`manifestBeheerbaar`, `rolVereist`, het
`navigeerbaar: false`-filter (VEN-2, stemmen) en de inklap-/drawer-logica zijn ongemoeid.
Het `icon`-veld wisselt van `string` naar `IcoonSleutel` en heeft precies één consument
(`Sidebar.tsx`). Twee dubbel gebruikte tekens zijn daarbij verdwenen: `▦` stond op
Vergaderingen én Stemmen, `◇` op Risicomatrix én Kwaliteitsborging.

### 7. Bewust geaccepteerde schuld

- **"Kaartradius uniform 12 px" is alleen op de gedeelde klassen waargemaakt.** `.si-card`
  en `.si-kpi` gaan van 14 naar 12 px, gelijk aan de `rounded-xl` waarmee de losse kaarten
  in de schermen al zijn opgemaakt. Daarnaast staan ~596 `rounded-lg`-elementen (8 px) los
  in de schermen; die gelijktrekken is een sweep door alle schermen en valt onder "geen
  herindeling van inhoudelijke schermen" (§6 van de werkopdracht).
- **De afstemming app ↔ marketingsite wordt door dit besluit groter, niet kleiner.** De app
  krijgt koele surfaces met donkere chrome; `app/(public)/public.css` houdt bewust warme
  surfaces. Dat is een aparte afweging en staat op de openstaande-puntenlijst.

## Referenties

- Werkopdracht: issue #282 (T3), repo-kopie `WERKOPDRACHT-ASSISTENT-T3-OPMAAK.md`
- Ontwerp: `VOORSTEL-ASSISTENTPANEEL-EN-VISUELE-LIJN-2026-09-03.md` §3.2, §6; prototype
  `MOCKUP-assistentpaneel-v0.1.html`
- Herzien: [0084](./0084-huisstijl-t1-violet-accent-teal-fase-lichte-nav.md) (lichte nav)
- Blijft gelden: [0097](./0097-tokens-mark-en-app-line-control.md) (kleur
  nooit de enige drager; `--app-line-control` voor bedieningsranden),
  [0052](./0052-t9-code-scheiding-mapconventie-eslint-boundaries.md) (core/platform-grens)
- Code: `app/globals.css` (tokenlaag + `.overline` + kaartmaten), `tailwind.config.ts`,
  `core/components/icons/Icoon.tsx`, `core/components/Sidebar.tsx`,
  `core/lib/module-registry.ts`, `core/lib/kleurcontrast.sanity.ts`,
  `app/(dashboard)/procedures/_components/FaseRail.tsx` en `FaseWeergave.tsx`
