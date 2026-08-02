# Promovideo Bestuurdersportaal — handover

Stand van zaken op 2 augustus 2026. Geschreven om zonder voorkennis verder te
kunnen. De onderbouwing van individuele keuzes staat in de `_let_op`- en
`_herijkt`-velden in de tekstenbestanden; dit document beschrijft alleen de
structuur, de commando's en wat er nog open staat.

---

## 1. Drie varianten, volledig gescheiden

| | Variant A | Variant B | Variant C |
|---|---|---|---|
| Status | akkoord | ter beoordeling | in bewerking |
| Verhaallijn | product-eerst | verantwoordbaarheid opent | draaiboek v4, negen scènes |
| Palet | navy `#12233B` + blauw `#234E70` | navy `#0B1F3A` + goud | navy `#0B1F3A` + goud |
| Geluid | stem + muziek | alleen muziek | alleen stem |
| Formaten | 9:16, 16:9, 1:1, 4:5 | 9:16 | 9:16 |
| Teksten | `promo-teksten.json` | `promo-teksten-b.json` | `promo-teksten-c.json` |
| Overlays | `maak-overlays.mjs` | `maak-overlays-b.mjs` | `maak-overlays-c.mjs` |
| Renderen | in `maak-overlays.mjs` | `render-overlays.mjs` | `render-overlays.mjs` |
| Opnames | `opnames/`, `opnames-9x16/` | `opnames-9x16-b/` | `opnames-9x16-c/` |
| Uitvoer | `uit/`, `uit-9x16/` | `uit-9x16-b/` | `uit-9x16-c/` |

`montage.sh` kiest de map op basis van `PROMO_VARIANT`. Variant A is de
standaard (`a`, geen achtervoegsel); elke andere waarde krijgt `-<letter>`
achter alle mapnamen. **A en B niet meer aanraken** — die zijn af.

---

## 2. Bouwen

Eerst de overlays, dan de montage. De overlays schrijven `plan.txt`, en dat
bestand stuurt de montage aan.

```bash
cd "…/MVP bestuurdersportaal/mvp"

# Variant C (9:16, met stem)
PROMO_VARIANT=c node promo/render-overlays.mjs
PROMO_VARIANT=c PROMO_LAYOUT=verticaal PROMO_PUSH=0 \
  PROMO_STEM=promo/stem-c-def.wav PROMO_STEM_START=0 \
  bash promo/montage.sh

# Variant B (9:16, muziek)
PROMO_VARIANT=b node promo/render-overlays.mjs
PROMO_VARIANT=b PROMO_LAYOUT=verticaal PROMO_PUSH=0 \
  PROMO_MUZIEK=promo/muziek-rust.mp3 bash promo/montage.sh

# Variant A liggend (16:9 + 1:1 + 4:5)
node promo/maak-overlays.mjs
PROMO_STEM=promo/stem.mp3 PROMO_MUZIEK=promo/muziek-rust.mp3 \
  bash promo/montage.sh
```

`render-overlays.mjs` is de Playwright-aandrijving voor B en C: die twee
`maak-overlays-*.mjs` zijn alléén modules met de HTML-generatoren erin, ze
schrijven zelf geen PNG's en geen `plan.txt`. Variant A heeft die aandrijving
wél in `maak-overlays.mjs` zitten en draait daarom met `node
promo/maak-overlays.mjs`. De `_lokaal-overlays-*.mjs`-bestanden zijn géén
alternatief: die roepen een Chromium-binary aan op een pad dat alleen in de
cloudomgeving bestaat.

Een montage duurt ongeveer vier minuten. De uitvoer heet altijd
`promo-9x16.mp4`; hernoem hem zelf naar `promo-9x16-c.mp4` en dergelijke.

### 2a. Renderen buiten de Mac

Alles hierboven gaat uit van de Mac: Playwright geïnstalleerd, netwerk open.
In een cloudomgeving geldt dat meestal niet. Wat je daar tegenkomt:

- **Playwright is er niet en valt niet te installeren** — het npm-register is
  vaak geblokkeerd. `npx playwright install` en `npm i @playwright/test` falen.
- **Google Fonts is geblokkeerd** (403). Zie 2b, dit is niet onschuldig.
- **ffmpeg is er meestal wél**, net als een Chromium-binary uit een
  voorgeïnstalleerde Playwright-cache.

Er is géén kant-en-klaar script in de repo voor die situatie. De
`_lokaal-overlays-*.mjs`-bestanden waar eerdere versies van dit document naar
verwezen, bestonden alleen in een cloudsessie en staan hier niet — niet zoeken,
en niet opnieuw aanmaken op de oude leest.

**Waarom niet.** Die shims schoten de PNG's met `chrome --headless
--screenshot`. Dat werkt alleen als je precies weet hoeveel vensterhoogte
Chromium voor zijn eigen chroom reserveert, want `--window-size` telt dat mee.
Die waarde is versiegebonden: bij de Chromium uit de Playwright-cache van juli
was het 74 px, bij Chromium 141 is het 87 px. En zelfs mét de juiste
compensatie blijft er een verschuiving van ongeveer 13 px over. Voor een
overlay die op de pixel over een opname wordt gelegd is dat niet acceptabel —
het venster komt scheef te staan ten opzichte van het beeld eronder.

**De juiste route is het DevTools-protocol.** Start Chromium met
`--remote-debugging-port`, open een pagina over CDP, zet de viewport met
`Emulation.setDeviceMetricsOverride` en schiet met `Page.captureScreenshot`.
Dan zet je de viewport exact, precies zoals Playwright het intern doet, en is
er geen compensatie nodig. Zet `captureBeyondViewport: false` en geef de
achtergrond expliciet transparant mee voor de tekstlagen.

Vind het Chromium-pad met `ls /opt/pw-browsers/` of
`find / -name chrome -type f 2>/dev/null | head`.

Wie die renderer schrijft: leg hem naast `render-overlays.mjs` en laat hem
dezelfde generatoren en hetzelfde `plan.txt`-formaat gebruiken. De montage
daarna is identiek.

### 2b. Lettertypen — hier gaat het stil mis

De opmaak van B en C laadt **Inter** (en B ook **Newsreader**) via een
`@import` van Google Fonts, midden in de gegenereerde HTML. Mislukt die
download, dan valt de browser terug op `system-ui` **zonder foutmelding**. Je
krijgt dus gewoon een render, alleen met andere letters, andere breedtes en
andere regelafbrekingen dan de versie die is goedgekeurd.

Variant A heeft dit probleem niet — die gebruikt alleen systeemlettertypen
(`-apple-system`, Georgia). Maar dáár zit een spiegelbeeldig risico: op de Mac
is `-apple-system` San Francisco, op Linux iets anders. **Variant A ziet er in
een cloudomgeving dus niet uit zoals op de Mac.** Render A bij voorkeur op de
Mac.

Controleer na elke render in een nieuwe omgeving één kaart:

```bash
ffmpeg -y -v error -i promo/overlays-9x16-c/01-opening.png \
  -vf "crop=900:200:56:600" /tmp/font.png
```

Bekijk `/tmp/font.png` naast een goedgekeurde render. Inter heeft een rechte
kleine-a en een korte staart aan de g; valt hij terug op een systeemletter, dan
zie je dat meteen aan de kopregel.

Is Google Fonts geblokkeerd, dan zijn er twee uitwegen: het lettertype lokaal
meeleveren en de `@import` vervangen door een `@font-face` met een
`file://`-verwijzing, of de overlays op de Mac renderen en alleen de montage
elders draaien. Die tweede is verreweg de eenvoudigste — de PNG's zijn klein en
de montage heeft alleen ffmpeg nodig.

---

## 3. Opnemen

```bash
read -r "PROMO_EMAIL?E-mailadres: "
read -rs "PROMO_WACHTWOORD?Wachtwoord: "
export PROMO_EMAIL PROMO_WACHTWOORD PROMO_BASE_URL="http://localhost:3000"

# alles opnieuw, staand
PROMO_VIEWPORT=1080x1200 PROMO_OPNAMEDIR=opnames-9x16 \
  npx playwright test --config=promo/playwright.config.ts

# één scène opnieuw
PROMO_SCENES=04-ai PROMO_VIEWPORT=1080x1200 PROMO_OPNAMEDIR=opnames-9x16-c \
  npx playwright test --config=promo/playwright.config.ts
```

Zonder `PROMO_VIEWPORT` en `PROMO_OPNAMEDIR` neemt hij liggend op (1440×810
naar `opnames/`). `PROMO_SCENES` laat de overige `.webm`'s staan, zodat je niet
alle fragmenttijden opnieuw hoeft uit te meten.

`PROMO_AI_KEUZE=vragen` laat de assistent *Kritische vragen* kiezen in plaats
van een samenvatting. Variant C heeft dat nodig; A en B niet.

---

## 4. Wat er nog moet gebeuren aan variant C

**Blokkerend, in deze volgorde:**

1. **Rol van *Beheerder* naar *Bestuurder*** in het portaal, en het label
   **"Bestuurdersportaal MVP"** uit de demo-build. Beide staan in beeld en
   ondermijnen de boodschap richting bestuurders. Portaalwijziging.
2. **Klikpad voor scène 5** schrijven in `scenes.ts`: de bestuurder typt een
   eigen inbreng in het veld *Inbreng vooraf* en neemt zichtbaar één AI-vraag
   níét over. Dit is volgens het draaiboek het belangrijkste detail van de hele
   film. Nu staat er een plaatshouder: het beeld toont de velden maar er gebeurt
   niets, terwijl de stem zegt dat u uw eigen inbreng formuleert.
3. **Opnameronde** voor `05-vergadering` (scène 5 en 6) en `06-proces`. Die
   laatste duurt maar 13,6 seconden en dat is te kort — scène 7 draait nu op
   een herhaalde laatste seconde om de overgang naar het eindscherm niet te
   abrupt te maken. Neem hem opnieuw op met een paar seconden rust onderaan.
4. **Fragmenttijden herijken** na elke opname. Ze verschuiven altijd.

**Openstaand besluit — de beloftekaart ademt niet.**

Scène 8 heeft te weinig lucht: negen woorden op krap vier seconden effectieve
beeldtijd. Dat is leesbaar maar gehaast, en het is juist het moment waarop de
kijker moet landen. De scène zelf verlengen kan niet zonder de stem uit de pas
te laten lopen, dus de oplossing zit aan de geluidskant: **schuif zin 8 en 9
anderhalve seconde op in `stem-c-def.wav`.**

Dat is puur `adelay` op de bestaande segmenten — geen nieuwe opname, geen
kwaliteitsverlies, volledig herhaalbaar. De knippunten van de negen zinnen in
`stem-c7.mp3` staan hieronder; alleen de laatste twee plaatsingen wijzigen.

| Zin | Uit `stem-c7.mp3` | Lengte | Plaatsing nu | Voorstel |
|---|---|---|---|---|
| 1 | 1,58 | 3,73 | 0,50 | ongewijzigd |
| 2 | 7,11 | 4,42 | 5,40 | ongewijzigd |
| 3 | 13,28 | 5,68 | 12,40 | ongewijzigd |
| 4 | 20,71 | 7,29 | 20,50 | ongewijzigd |
| 5 | 29,73 | 5,37 | 29,00 | ongewijzigd |
| 6 | 36,83 | 6,02 | 36,00 | ongewijzigd |
| 7 | 44,49 | 6,76 | 43,50 | ongewijzigd |
| 8 | 52,86 | 4,74 | 50,10 | **51,60** |
| 9 | 59,33 | 4,57 | 55,10 | **56,60** |

Verhoog daarbij `duur` van `08-belofte` naar 5,5 en van `09-cta` naar 8,3 in
`promo-teksten-c.json` — dan valt zin 9 nog ruim binnen de eindkaart. De film
wordt er ongeveer anderhalve seconde langer van; 64 seconden is prima.

**Lever de nieuwe `stem-c-def.wav` als apart bestand op**, zodat hij naast de
huidige beluisterd kan worden vóór aftekening. Overschrijf de oude niet.

**Daarna nog:**

- Losse `.srt` met de volledige VO-tekst bij de versie met stem (§8 draaiboek).
- Versie met korte ankers in plaats van volledige captions (export A).
- Engelse captionlaag — de vertaaltabel staat in het draaiboek.

---

## 5. Vaste valkuilen

**Het e-mailadres van het ingelogde account.** In `06-proces` staat de kop van
de proceduredetailpagina met CO-EIGENAARS en daaronder het adres. De expositie
verschuift per opname: bij de staande opname van 1 augustus stond hij van 6,50
tot 6,67s in beeld, bij de liggende van 6,83 tot 7,33s. **Controleer dit na
élke nieuwe opname** met een OCR-sweep over de bovenste 300 px:

```bash
mkdir -p /tmp/k && ffmpeg -v error -i promo/opnames-9x16/06-proces.webm \
  -vf "fps=6,crop=1080:300:0:0" /tmp/k/k%03d.png
cd /tmp/k && for f in *.png; do
  r=$(tesseract "$f" stdout 2>/dev/null | grep -oiE "[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|co-eigenaar")
  [ -n "$r" ] && echo "$f : $r"
done
```

Doe dezelfde sweep over de eindmontage voordat je iets deelt.

**Laagvolgorde in de overlays.** De montage legt de opname bóven de
achtergrondlaag en daar de tekstlaag overheen. Alles wat over het portaalvenster
heen moet — scrim, rail, captions — hoort in de *tekstlaag*. Staat het in de
achtergrond, dan wordt het door de opname afgedekt en zijn de witte captions
onleesbaar op de lichte interface.

**Voice-over knippen.** Eén MP3 met alle zinnen werkt alleen als de pauzes
tússen de zinnen duidelijk langer zijn dan die binnen een zin. Vraag ElevenLabs
om `<break time="1.5s" />` tussen de alinea's; dan is 1,5 s tegen hooguit 0,9 s
eenduidig. Zonder dat verschil is automatisch splitsen onbetrouwbaar en zet je
de knip gegarandeerd verkeerd. De losse zinnen worden daarna met `adelay` op hun
scène gezet en als één wav aan `PROMO_STEM` meegegeven, met
`PROMO_STEM_START=0`.

**Scènes kunnen alleen versneld worden, niet vertraagd.** Is er minder
bronmateriaal dan de streefduur, dan wordt de scène gewoon korter en loopt de
stem uit de pas. Reken vooraf uit of het past.

**zsh.** Geen `#`-commentaar in geplakte blokken, en geen `pkill` in een
samengesteld commando — dat doodt je eigen shell voordat de rest draait.

---

## 6. Losse eindjes

- De gouden railpunt in variant C verspringt per scène in plaats van continu te
  glijden. Continue beweging vraagt een overlay per frame; de montage werkt met
  één stilstaand beeld per scène.
- De tellerbalk in scène 6 telt niet op van nul. Dat doet het portaal niet, en
  namaken zou gedrag tonen dat het product niet heeft.
- De knop op de eindkaart is goud, niet rood. In geen van de paletten zit rood.
- Scène 7 draait op een herhaalde laatste seconde van `06-proces` omdat er niet
  meer materiaal is. De pagina staat daar stil, dus het leest als een hold — maar
  het is een noodgreep die met een nieuwe opname vervalt.
- Een knop in een video is niet klikbaar. Zet de CTA als eerste zin van de
  LinkedIn-post met een echte link, of gebruik de campagneknop van het platform.
- `bestuurdersportaal.com` staat in beeld maar is nooit geverifieerd.
- §8 van `promo-script.md` — het weglaten van het MVP-voorbehoud — wacht nog op
  een commerciële of juridische aftekening.

---

## 7. Bestanden die je nodig hebt

```
promo/
  promo-teksten.json      promo-teksten-b.json      promo-teksten-c.json
  maak-overlays.mjs       maak-overlays-b.mjs       maak-overlays-c.mjs
  render-overlays.mjs     montage.sh                scenes.ts
  opname.spec.ts
  helpers.ts              playwright.config.ts      toon-frames.sh
  stem.mp3                stem-c7.mp3               stem-c-def.wav
  muziek-rust.mp3         promo-script.md           README.md
```

`stem-c-def.wav` is de geknipte en geplaatste voice-over van variant C;
`stem-c7.mp3` is de onbewerkte opname (stem Roland) waar hij uit komt. De
eerdere opnames `stem-b.mp3` en `stem-c.mp3` tot en met `stem-c6.mp3` zijn
bewaard maar niet in gebruik.

De `_lokaal-overlays*.mjs`-bestanden zijn alleen voor een omgeving zonder
Playwright. Op de Mac gebruik je de gewone `maak-overlays*.mjs`.
