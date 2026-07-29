# promo/ — promovideo van het Bestuurdersportaal

Reproduceerbare pipeline voor een teaser van ~69 seconden (7 scènes): Playwright
klikt een vast pad door de app en neemt per scène video op, Chromium rendert de
tekstoverlays in huisstijl, ffmpeg monteert het geheel.

Wijzigt de UI? Draai de opname opnieuw in plaats van opnieuw te filmen.

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
| `montage.sh` | ffmpeg-montage → 16:9 master + 4:5 LinkedIn-variant |

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

Resultaat: `promo/uit/promo-16x9.mp4` en `promo/uit/promo-4x5.mp4`.

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

## Timing en de AI-wachttijd

Het AI-antwoord duurt echt een aantal seconden. Die wachttijd wordt niet
weggeknipt maar **versneld** tot de scène op zijn doelduur uitkomt (`duurDoel`
in `promo-teksten.json`, maximaal ×3). De kijker ziet dus dat er verwerkt
wordt, zonder dat de video stilvalt. Wil je een scène langer of korter: pas
`duurDoel` aan en draai alleen `maak-overlays.mjs` + `montage.sh` opnieuw — de
opname hoeft niet opnieuw.

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
promo/uit/
promo/.werk/
promo/.auth/
```

De opnames kunnen fondsdata bevatten en `promo/.auth/staat.json` bevat een
geldige sessie — die horen niet in de repo. De scripts en teksten wél.
