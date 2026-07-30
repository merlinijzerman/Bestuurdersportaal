# promo/ — promovideo van het Bestuurdersportaal

Reproduceerbare pipeline voor een teaser van ~36 seconden (6 scènes): Playwright
klikt een vast pad door de app en neemt per scène video op, Chromium rendert de
tekstoverlays in huisstijl, ffmpeg knipt en monteert het geheel.

Wijzigt de UI? Draai de opname opnieuw in plaats van opnieuw te filmen.

**Belangrijk principe:** opnemen is niet monteren. De opnames mogen rustig en
volledig zijn; `montage.sh` knipt er per scène alleen de betekenisvolle
fragmenten uit en zoomt in op het relevante schermdeel. Kort opnemen levert
geen korte video op — het levert te weinig keuze op.

**Alle tekst staat in `promo-teksten.json`. Alle wankele selectors staan in
`scenes.ts` → `SELECTORS`. Nergens anders hoef je te zijn.**

Lees vóór de eerste opname `promo-script.md` — met name de preflight-checklist
(wat er ongemerkt in beeld komt) en de claimverantwoording.

## Bestanden

| Bestand | Rol |
|---|---|
| `promo-script.md` | Storyboard, claimverantwoording, preflight- en verificatiechecklist |
| `promo-teksten.json` | Bron van waarheid voor alle on-screen tekst en de scèneduur |
| `scenes.ts` | Klikpad per scène + het enige calibratiepunt voor selectors |
| `helpers.ts` | Zichtbare cursor, vloeiende muis, vloeiend scrollen, typen |
| `opname.spec.ts` | Neemt de scènes op (één browsercontext per scène) |
| `playwright.config.ts` | Losse config, zodat de opname nooit meelift in CI |
| `maak-overlays.mjs` | Rendert tekstkaarten en onderregels als PNG |
| `montage.sh` | ffmpeg-montage: fragmenten knippen, uitsnede, crossfades, 4 formaten |
| `maak-muziek.sh` | Genereert een rechtenvrije bedtrack (sinustonen, geen licentie nodig) |
| `toon-frames.sh` | Contactvellen per opname, om fragmenttijden af te lezen en te herijken |

## Eenmalige installatie

```bash
cd mvp
npm i -D @playwright/test
npx playwright install chromium      # vanuit mvp/ draaien, niet vanuit ~
```

Plus ffmpeg. Twee routes:

```bash
# a) systeembreed (vereist Homebrew)
brew install ffmpeg

# b) zonder Homebrew — als npm-dependency
npm i -D ffmpeg-static ffprobe-static
export FFMPEG=$(node -p "require('ffmpeg-static')")
export FFPROBE=$(node -p "require('ffprobe-static').path")
```

Bij route (b) moeten `FFMPEG` en `FFPROBE` gezet zijn in de shell waarin je
`montage.sh` draait; zonder die variabelen valt het script terug op `ffmpeg`
en `ffprobe` uit je PATH.

## Draaien

```bash
# 1. app draaien in een aparte terminal
npm run dev

# 2. opnemen (demo-account op het demofonds!)
PROMO_EMAIL='demo@voorbeeld.nl' PROMO_WACHTWOORD='...' \
  npx playwright test --config=promo/playwright.config.ts

# 3. overlays renderen
node promo/maak-overlays.mjs

# 4. monteren
bash promo/montage.sh
# met muziek:
PROMO_MUZIEK=~/Music/bed.mp3 bash promo/montage.sh
```

Resultaat: `promo/uit/promo-16x9.mp4` (master) plus `promo-1x1.mp4`,
`promo-4x5.mp4` en `promo-9x16.mp4`.

Omgevingsvariabelen: `PROMO_BASE_URL` (default `http://localhost:3000`),
`PROMO_EMAIL`, `PROMO_WACHTWOORD`, `PROMO_MUZIEK`.

## Wat je bij de eerste run mag verwachten

De navigatielabels komen uit `core/lib/module-registry.ts` en kloppen. De
selectors *binnen* een pagina (AI-invoerveld, exportknop) zijn een inschatting
en vragen vrijwel zeker één calibratieronde.

Een falende scène breekt de run niet af: hij wordt overgeslagen, gelogd in
`promo/opnames/opname-log.json`, en de montage laat hem weg. Je kunt dus
opnemen, kijken wat ontbreekt, `SELECTORS` bijstellen en opnieuw draaien.

Handig bij calibreren:

```bash
PWDEBUG=1 npx playwright test --config=promo/playwright.config.ts   # stap voor stap
npx playwright codegen http://localhost:3000                        # selectors opzoeken
```

## Fragmenten, uitsnede en timing

Elke opnamescène in `promo-teksten.json` heeft een `bron` (welke `.webm`), een
`duurDoel` en een lijst `fragmenten`:

```json
{ "van": 16.3, "tot": 22.8, "zoom": 1.7, "cx": 0.525, "cy": 0.564 }
```

- `van`/`tot` — seconden in de originele opname
- `zoom` — 1.0 is volledig beeld, 1.7 is stevig ingezoomd
- `cx`/`cy` — middelpunt van de uitsnede als fractie

Vuistregel voor `cy`: zet hem **lager** dan het inhoudelijke midden. Dan landt
de inhoud in de bovenste beeldhelft en blijft hij vrij van de tekstbalk onderin.

`duurDoel` is een vangnet, geen stuurmiddel: een scène die langer duurt dan zijn
doel wordt hooguit ×1,6 versneld. Wil je een scène korter, pas dan de fragmenten
aan — niet de doelduur.

Na een nieuwe opname verschuiven alle fragmenttijden. Herijken:

```bash
bash promo/toon-frames.sh     # contactvellen in promo/frames/
```

Wijzig je alleen tekst, timing of uitsnede, dan hoef je **niet** opnieuw op te
nemen: `node promo/maak-overlays.mjs` + `bash promo/montage.sh` volstaat.

## Formaat

Opgenomen op 1440×810 en geschaald naar 1920×1080. Dat is bewust: de UI wordt
daarmee groter in beeld en blijft leesbaar in een LinkedIn-feed op een
telefoon. Wil je pixelzuiver 1:1, zet `VIEWPORT` in `opname.spec.ts` op
1920×1080 en haal de schaalstap uit `montage.sh`.

## Niet in git

Voeg toe aan `.gitignore`:

```
promo/opnames/
promo/overlays/
promo/frames/
promo/uit/
promo/.werk/
promo/.muziek/
promo/.auth/
promo/muziek-bed.mp3
```

De opnames kunnen fondsdata bevatten en `promo/.auth/staat.json` bevat een
geldige sessie — die horen niet in de repo. De scripts en teksten wél.
