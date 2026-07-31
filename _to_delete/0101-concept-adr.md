# 0101 — Accentkleur terug naar navy (richting D1 "Bestuursblauw")

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
referentie-HTML met een navy accent op koelblauwe surfaces. Daaruit zijn twee
paletten uitgewerkt (D1 "Bestuursblauw", D2 "Grafiet & navy") en op drie schermen
getoond: Home, AI-assistent en Documentbibliotheek. Keuze is gevallen op **D1**.

De wijziging is uitgevoerd als **pure token-hercolorering**: alle tokennamen uit
`app/globals.css` blijven identiek, alleen de waarden verschuiven. Geen component,
Tailwind-klasse of pagina is aangepast. Dat is precies wat de tokenlaag moet
mogelijk maken en meteen de toets of die belofte klopt — hij klopt.

## Besluit

**1. Het accent keert terug naar de navy-familie.**

| Token | Was (0084) | Wordt (D1) |
|---|---|---|
| `--accent-rgb` | 91 79 224 | **27 79 168** |
| `--accent-ink-rgb` | 68 58 192 | 20 57 111 |
| `--accent-tint-rgb` | 238 237 252 | 231 238 251 |
| `--ink-rgb` | 23 26 40 | 18 35 59 |
| `--muted-rgb` | 100 106 136 | 92 107 130 |
| `--app-bg-rgb` / `--paper-rgb` | 244 245 250 | 238 241 246 |
| `--line-rgb` / `--app-line-rgb` | 228 231 241 | 223 229 238 |
| `--app-line-strong-rgb` | 210 214 230 | 200 210 224 |
| `--app-zebra-rgb` | 248 249 253 | 247 249 252 |
| `--nav-rgb` | 251 251 254 | 255 255 255 |
| `--nav-active` | rgba(91,79,224,.09) | rgba(27,79,168,**.10**) |
| `--ok` / `--err` / `--warn` | zie diff | dieper, koeler afgestemd |
| `--mark-rgb` | 250 232 190 | 255 233 168 |

`--nav-active` gaat van .09 naar .10: navy op een licht vlak leest zwakker dan het
violet dat er stond, en het actieve menu-item mag niet verzwakken.

**2. `--phase` blijft teal — 0084 houdt op dit punt wél stand.**

Overwogen is om `--phase` terug te zetten naar plum (de waarde van vóór 0084), op
de redenering dat teal en navy allebei koel zijn. Nagerekend pakt dat andersom
uit. Perceptueel verschil (CIELAB ΔE76) tussen `--accent` en `--phase`, ook onder
gesimuleerde kleurenblindheid (Viénot/Brettel):

| | normaal | deuteranopie | protanopie |
|---|---|---|---|
| navy vs **teal** — volvlak | 45,9 | 34,4 | 37,0 |
| navy vs plum — volvlak | 18,7 | 24,0 | 15,1 |
| `accent-ink` vs **teal-ink** | 30,8 | 21,1 | 23,8 |
| `accent-ink` vs plum-ink | 18,2 | 10,6 | **5,3** |

Plum lost het probleem niet op maar verergert het: bij protanopie is plum-ink
praktisch niet van accent-ink te onderscheiden. Teal scheidt ruim. **Luminantie-
contrast is hier een misleidende maat** — het meet licht/donker, niet kleurverschil;
op die maat leek plum juist beter (1,09 vs 1,60). Dat is de reden dat de eerste
analyse de verkeerde kant op wees en waarom deze cijfers hier staan vastgelegd.

Wat blijft staan: `--accent-tint` en `--phase-tint` liggen op ΔE ≈ 5 en zijn als
badge-**achtergrond** niet te scheiden. Het onderscheid komt van de `-ink`-tekst
plus een tweede, niet-kleurgebonden drager (label of icoon) — conform 0097.

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

- **D2 "Grafiet & navy"** — zelfde navy-familie op neutrale, niet-blauwe surfaces.
  Rustiger onder dichte data; afgevallen omdat D1 dichter bij de referentie ligt.
- **`--phase` terug naar plum** — zie besluit 2 hierboven; verworpen op de cijfers.
- **`--app-bg` lichter maken** in plaats van `--app-line-control` donkerder, om de
  3:1 te halen. Verworpen: dan schuift de achtergrond weg van de referentie om een
  randkleur te sparen, terwijl die randkleur juist het token is dat voor deze eis
  bestaat.

## Referenties

- `03 Functioneel ontwerp/Designrichtingen portaal/richting-d-bestuursblauw.html` — de mockup (Home / AI / Bibliotheek, D1 ↔ D2)
- `03 Functioneel ontwerp/Designrichtingen portaal/richting-d-tokens.html` — tokenblad, contrasttoets en implementatie-impact
- WCAG 2.1 §1.4.3 (Contrast Minimum) en §1.4.11 (Non-text Contrast)
- Viénot, Brettel & Mollon (1999) — LMS-projectie voor dichromatische simulatie
