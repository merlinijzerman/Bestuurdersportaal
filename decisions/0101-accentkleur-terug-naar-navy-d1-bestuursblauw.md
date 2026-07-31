# 0101 — Accentkleur terug naar navy, gelijk aan de marketingsite (#234E70)

- **Status:** Geaccepteerd
- **Datum:** 2026-07-31
- **Betrokkenen:** Merlin (opdrachtgever), Claude (analyse en uitvoering)
- **Herziet:** [0084](./0084-huisstijl-t1-violet-accent-teal-fase-lichte-nav.md) — gedeeltelijk (alleen de accentkleur; de lichte navigatie blijft)
- **Raakt:** [0097](./0097-tokens-mark-en-app-line-control.md) — `--app-line-control` krijgt een nieuwe waarde, de afspraak zelf blijft

## Context

Besluit 0084 bracht twee dingen tegelijk: een **lichte** navigatie-chrome (was
diep ink-navy) en een **violet** accent (`91 79 224`, was navy `35 78 112`). De
lichte chrome heeft zich bewezen. Het violette accent riep de vraag op of het
past bij een bestuurdersportaal — een oordeel dat pas te vellen was toen er
schermen naast elkaar lagen.

Aanleiding voor deze tranche is een door de opdrachtgever aangeleverde
referentie-HTML met een navy accent op koelblauwe surfaces. Daaruit zijn drie
paletten uitgewerkt (D1 "Bestuursblauw", D2 "Grafiet & navy", D3 "Site-blauw") en
op drie schermen getoond: Home, AI-assistent en Documentbibliotheek.

Keuze is gevallen op **D3**: de surfaces van D1, maar het accent van de
**marketingsite** — `#234E70`, in `app/(public)/public.css` gedefinieerd als
`--accent` en gebruikt door `.btn-primary` (de knop "Neem contact op" op
bestuurdersportaal.com). Dat is het navy van vóór besluit 0084; de site is nooit
meegegaan in de violette wissel. Daarmee spreken app en site weer dezelfde taal,
en verdwijnt een merkbreuk die er sinds 0084 zat.

De wijziging is uitgevoerd als **pure token-hercolorering**: alle tokennamen uit
`app/globals.css` blijven identiek, alleen de waarden verschuiven. Geen component,
Tailwind-klasse of pagina is aangepast. Dat is precies wat de tokenlaag moet
mogelijk maken en meteen de toets of die belofte klopt — hij klopt.

## Besluit

**1. Het accent keert terug naar de navy-familie.**

| Token | Was (0084) | Wordt (D1) |
|---|---|---|
| `--accent-rgb` | 91 79 224 | **35 78 112** (`#234E70`) |
| `--accent-ink-rgb` | 68 58 192 | 26 58 84 |
| `--accent-tint-rgb` | 238 237 252 | 231 237 243 |
| `--ink-rgb` | 23 26 40 | 18 35 59 |
| `--muted-rgb` | 100 106 136 | 92 107 130 |
| `--app-bg-rgb` / `--paper-rgb` | 244 245 250 | 238 241 246 |
| `--line-rgb` / `--app-line-rgb` | 228 231 241 | 223 229 238 |
| `--app-line-strong-rgb` | 210 214 230 | 200 210 224 |
| `--app-zebra-rgb` | 248 249 253 | 247 249 252 |
| `--nav-rgb` | 251 251 254 | 255 255 255 |
| `--nav-active` | rgba(91,79,224,.09) | rgba(35,78,112,**.10**) |
| `--ok` / `--err` / `--warn` | zie diff | dieper, koeler afgestemd |
| `--mark-rgb` | 250 232 190 | 255 233 168 |

`--nav-active` gaat van .09 naar .10: navy op een licht vlak leest zwakker dan het
violet dat er stond, en het actieve menu-item mag niet verzwakken.

Contrast van het nieuwe accent: **8,77:1** op wit (zowel als linkkleur als met wit
erop op de primaire knop) en 10,02:1 voor `--accent-ink` op `--accent-tint`. Ruim
AAA, en beter dan zowel het violet (5,77) als het D1-blauw (7,69).

**2. `--phase` blijft teal — maar met een smallere marge dan bij D1, en dat is een
openstaand punt.**

Overwogen is `--phase` terug te zetten naar plum (de waarde van vóór 0084). Dat is
verworpen: plum ligt nóg dichter bij dit accent dan teal. Perceptueel verschil
(CIELAB ΔE76) tussen `--accent` en de kandidaten, als **slechtste waarde** over
normaal zicht, deuteranopie en protanopie:

| kandidaat voor `--phase` | vs `--accent` | vs `--ok` | vs `--err` | vs `--warn` |
|---|---|---|---|---|
| **teal `#0E7C9B`** (huidig) | **15,5** | 41,8 | 58,5 | 73,3 |
| plum `#654A96` | 14,1 | 51,3 | 75,3 | 89,7 |
| aubergine `#6B2D5C` | 7,3 | 22,7 | 52,2 | 64,7 |
| indigo-violet `#5B3FA8` | **30,4** | 69,4 | 91,0 | 106,1 |

Teal blijft staan omdat het van de bestaande opties de beste is en omdat wisselen
een betekenislaag raakt die verder gaat dan kleur. **Maar:** met het D1-blauw
(`#1B4FA8`) haalde teal nog 34,4 onder deuteranopie; met dit dovere, groenere navy
zakt dat naar **15,5**. Het accent en de fase-markering zijn daarmee voor
gebruikers met een rood-groenstoornis lastig te scheiden. Dat is de **prijs van de
merkconsistentie met de site** en hij is bewust betaald, niet over het hoofd gezien.

Zolang dit staat, geldt de eis uit 0097 onverkort en strenger dan voorheen: een
fase-markering draagt **altijd** een tweede, niet-kleurgebonden drager (label of
icoon). De sanity-suite legt vast dat de twee niet op luminantie te scheiden zijn.

**Openstaand:** de enige geteste kandidaat die wél ruim boven de verwarrings-
drempel uitkomt, is indigo-violet `#5B3FA8` (30,4 vs accent; 7,72:1 op wit). Dat
zou het violet uit 0084 terugbrengen — niet als accent maar als fase-kleur. Aan te
bevelen zodra iemand de consumenten van `--phase` langsloopt; niet in deze tranche
gedaan omdat het de betekenislaag raakt en een eigen review verdient.

**3. `--app-line-control` verschuift van `134 140 168` naar `120 134 156`.**

Niet uit smaak, maar omdat de nieuwe `--app-bg` (238 241 246) donkerder is dan de
oude (244 245 250). De oude waarde kwam daarop uit op **2,93:1** en zakte door de
3:1-eis van WCAG 1.4.11 heen. De sanity-suite uit 0097 ving dat — precies waarvoor
die is gebouwd. De nieuwe waarde haalt 3,69:1 op `--app-surface`, 3,50:1 op
`--app-zebra` en 3,26:1 op `--app-bg`. De **afspraak** uit 0097 is ongewijzigd;
alleen de waarde die eraan voldoet is bijgesteld.

**4. Twee hardcoded kleuren uit de vóór-tokenperiode zijn opgeruimd.**

`.typing-dot` stond op `#5A6B7C` en `.status-puls` op `rgba(35, 78, 112, …)` — het
navy `#234E70` van vóór 0084. Beide volgen nu `--muted` respectievelijk
`--accent-rgb`, zodat ze meebewegen met (fonds)theming in plaats van stil uit de
pas te lopen.

## Borging

- `core/lib/kleurcontrast.sanity.ts` — bevroren ratio's herrekend (1,45→**1,53** ·
  14,28→**13,14** · 5,40→**7,16** · 5,01→**6,42** · 6,06→**7,71** · 3,32→**3,69** ·
  3,15→**3,50**) en vier tests toegevoegd: AA voor `--ink`/`--muted` op beide
  dragende vlakken, accent als link én als knopvlak, elke `-ink` op zijn `-tint`,
  en een test die vastlegt dat `--accent` en `--phase` **niet** op luminantie te
  scheiden zijn — de reden dat kleur daar nooit de enige drager mag zijn.
  De nieuwe tests hebben bewust géén bevroren waarden: het zijn ondergrenzen, geen
  aanleidingen. **15/15 groen.**
- `scripts/toets-fondsthema.mjs` (nieuw) + `npm run lint:fondsthema` — toetst
  per-fonds theming-overrides tegen de basislaag op leesbaarheid (WCAG 1.4.3 /
  1.4.11) én op verwarring (ΔE tot de semantische tokens, ook onder
  kleurenblindheid).
- `npm run lint:colors` blijft groen; `tsc --noEmit` schoon.

## Gevolgen

- **Geen component-, API-, migratie- of RLS-wijziging.** De diff is de tokenlaag,
  de sanity-suite, het nieuwe script en één regel in `package.json`.
- **De fonds-theming is niet meegetoetst op echte data.** De waarden staan in
  `public.fonds_theming.tokens` (Supabase), niet in deze repo. Het script draait
  op de demo-seed en accepteert een DB-export. Uitkomst op de seed (Meridiaan,
  terracotta accent), afgezet tegen de oude tokenlaag om erfenis van regressie te
  scheiden:
  - **Twee harde overtredingen, pre-existent:** Meridiaan overschrijft `--nav`
    naar diep groen maar niet `--nav-text` / `--nav-text-active`, die op de lichte
    basiswaarde terugvallen → 2,28:1 en 1,28:1. Faalde ook vóór deze wijziging.
  - **Eén nieuwe verslechtering:** accent (terracotta) versus `--err` gaat van
    ΔE 28,9 naar 17,9, doordat `--err` van rozerood naar baksteenrood schoof.
    Relevant zodra een fonds met een warm accent live gaat.
- **Buiten scope gebleven:** `app/(public)/public.css` (de marketingsite heeft een
  eigen kleurenlaag en loopt nu uit de pas met de app) en de literal kleuren in de
  export-/e-mail-HTML (`core/lib/*-html.ts`, `core/lib/email.ts`) — die vallen
  bewust buiten de tokenlaag, zie de noot in `scripts/check-brand-hex.mjs`.
- **Typografie is niet gewijzigd.** De referentie gebruikt uitsluitend Inter; het
  portaal houdt Newsreader op koppen en KPI-waarden. Afgewogen en bewust geparkeerd
  als apart merkbesluit.

## Overwogen alternatieven

- **D1 "Bestuursblauw" (`#1B4FA8`)** — het blauw uit de aangeleverde referentie.
  Helderder en moderner, en scheidt véél beter van de fase-kleur (ΔE 34,4 onder
  deuteranopie tegen 15,5 nu). Afgevallen ten gunste van merkconsistentie met de
  marketingsite. Kort in productie geweest voordat op `#234E70` is overgestapt.
- **D2 "Grafiet & navy"** — zelfde navy-familie op neutrale, niet-blauwe surfaces.
  Rustiger onder dichte data; afgevallen omdat D1/D3 dichter bij de referentie liggen.
- **De warme surfaces van de site meenemen** (`--paper #F6F3EC`, `--ink #191815`,
  `--line #D8D3C7`) in plaats van alleen het accent. Zou app en site volledig
  gelijktrekken, maar is een aanzienlijk grotere ingreep onder dichte tabellen en
  is daarom apart gehouden.
- **`--phase` terug naar plum** — zie besluit 2 hierboven; verworpen op de cijfers.
- **`--app-bg` lichter maken** in plaats van `--app-line-control` donkerder, om de
  3:1 te halen. Verworpen: dan schuift de achtergrond weg van de referentie om een
  randkleur te sparen, terwijl die randkleur juist het token is dat voor deze eis
  bestaat.

## Referenties

- `03 Functioneel ontwerp/Designrichtingen portaal/richting-d-bestuursblauw.html` — de mockup (Home / AI / Bibliotheek, D1 ↔ D2 ↔ D3)
- `app/(public)/public.css` — `--accent: #234E70`, de bron van de gekozen kleur
- `03 Functioneel ontwerp/Designrichtingen portaal/richting-d-tokens.html` — tokenblad, contrasttoets en implementatie-impact
- WCAG 2.1 §1.4.3 (Contrast Minimum) en §1.4.11 (Non-text Contrast)
- Viénot, Brettel & Mollon (1999) — LMS-projectie voor dichromatische simulatie
