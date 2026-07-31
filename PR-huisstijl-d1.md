Accentkleur terug naar de navy-familie, uitgevoerd als **pure token-hercolorering**: alle tokennamen in `app/globals.css` blijven identiek, alleen de waarden verschuiven. Geen component, Tailwind-klasse of pagina aangepast — dat is precies wat de tokenlaag moet mogelijk maken, en meteen de toets of die belofte klopt. Hij klopt.

Besluitrecord: `decisions/0101-accentkleur-terug-naar-navy-d1-bestuursblauw.md`. **Herziet [0084](decisions/0084-huisstijl-t1-violet-accent-teal-fase-lichte-nav.md) gedeeltelijk** — alleen de accentkleur; de lichte navigatie-chrome blijft ongewijzigd.

## Wat wijzigt

| Token | Was | Wordt |
|---|---|---|
| `--accent-rgb` | 91 79 224 (violet) | **27 79 168** (navy) |
| `--accent-ink-rgb` | 68 58 192 | 20 57 111 |
| `--accent-tint-rgb` | 238 237 252 | 231 238 251 |
| `--ink-rgb` | 23 26 40 | 18 35 59 |
| `--muted-rgb` | 100 106 136 | 92 107 130 |
| `--app-bg-rgb` / `--paper-rgb` | 244 245 250 | 238 241 246 |
| `--app-line-strong-rgb` | 210 214 230 | 200 210 224 |
| `--app-line-control-rgb` | 134 140 168 | 120 134 156 |
| `--nav-active` | rgba(91,79,224,.09) | rgba(27,79,168,**.10**) |
| `--mark-rgb` | 250 232 190 | 255 233 168 |

Plus de semantische families (`--ok` / `--err` / `--warn`), dieper en koeler afgestemd. Volledige diff in `app/globals.css`.

## Twee dingen die aandacht verdienen bij review

**1. `--phase` blijft teal — bewust, tegen de eerste intuïtie in.**

Overwogen is om `--phase` terug te zetten naar plum (de waarde van vóór 0084), op de redenering dat teal en navy allebei in de koele hoek liggen. Nagerekend pakt dat andersom uit. Perceptueel verschil (CIELAB ΔE76) tussen `--accent` en `--phase`, ook onder gesimuleerde kleurenblindheid (Viénot/Brettel):

| | normaal | deuteranopie | protanopie |
|---|---|---|---|
| navy vs **teal** — volvlak | 45,9 | 34,4 | 37,0 |
| navy vs plum — volvlak | 18,7 | 24,0 | 15,1 |
| `accent-ink` vs **teal-ink** | 30,8 | 21,1 | 23,8 |
| `accent-ink` vs plum-ink | 18,2 | 10,6 | **5,3** |

Plum verergert het probleem in plaats van het op te lossen. Luminantiecontrast wees hier de verkeerde kant op (1,09 voor plum tegen 1,60 voor teal) omdat het licht/donker meet en geen kleurverschil — dat is precies waarom deze cijfers in het besluitrecord staan.

Wat blijft staan: `--accent-tint` en `--phase-tint` liggen op ΔE ≈ 5 en zijn als badge-*achtergrond* niet te scheiden. Het onderscheid komt van de `-ink`-tekst plus een tweede, niet-kleurgebonden drager — conform 0097. Dat is nu vastgelegd in een sanity-test.

**2. `--app-line-control` moest mee verschuiven — gevonden door onze eigen suite.**

De nieuwe `--app-bg` is donkerder, waardoor de oude waarde daarop op **2,93:1** uitkwam en door de 3:1-eis van WCAG 1.4.11 zakte. De sanity-suite uit 0097 ving dat, precies waarvoor die is gebouwd. Nieuwe waarde haalt 3,69:1 op `--app-surface`, 3,50:1 op `--app-zebra` en 3,26:1 op `--app-bg`. De afspraak uit 0097 is ongewijzigd; alleen de waarde die eraan voldoet is bijgesteld.

## Borging

- `core/lib/kleurcontrast.sanity.ts` — bevroren ratio's herrekend (1,45→1,53 · 14,28→13,14 · 5,40→7,16 · 5,01→6,42 · 6,06→7,71 · 3,32→3,69 · 3,15→3,50) en **vier tests toegevoegd**: AA voor `--ink`/`--muted` op beide dragende vlakken, accent als link én als knopvlak, elke `-ink` op zijn `-tint`, en een test die vastlegt dat `--accent` en `--phase` niet op luminantie te scheiden zijn. De nieuwe tests hebben bewust geen bevroren waarden — het zijn ondergrenzen, geen aanleidingen. **15/15 groen.**
- `scripts/toets-fondsthema.mjs` (nieuw) + `npm run lint:fondsthema` — toetst per-fonds theming-overrides tegen de basislaag op leesbaarheid (WCAG 1.4.3 / 1.4.11) én op verwarring (ΔE tot de semantische tokens, ook onder kleurenblindheid).
- `npm run lint:colors` groen, `tsc --noEmit` schoon.
- Twee hardcoded kleuren uit de vóór-tokenperiode opgeruimd: `.typing-dot` (`#5A6B7C`) en `.status-puls` (`rgba(35, 78, 112, …)`, het navy `#234E70`) volgen nu `--muted` respectievelijk `--accent-rgb`.

## Openstaand — bewust niet in deze PR

- **Fonds-theming is niet op echte data getoetst.** De waarden staan in `public.fonds_theming.tokens` (Supabase), niet in de repo. Het script draait op de demo-seed. Uitkomst daar, afgezet tegen de oude tokenlaag om erfenis van regressie te scheiden: **twee harde overtredingen die pre-existent zijn** (Meridiaan overschrijft `--nav` naar diep groen maar niet `--nav-text`/`--nav-text-active` → 2,28:1 en 1,28:1) en **één nieuwe verslechtering** (accent terracotta versus `--err` van ΔE 28,9 naar 17,9, doordat `--err` van rozerood naar baksteenrood schoof). Draai `npm run lint:fondsthema` op een DB-export vóór uitrol naar een fonds met een warm accent.
- `app/(public)/public.css` — de marketingsite heeft een eigen kleurenlaag en loopt nu uit de pas met de app.
- De literal kleuren in de export-/e-mail-HTML (`core/lib/*-html.ts`, `core/lib/email.ts`) — vallen bewust buiten de tokenlaag, zie de noot in `scripts/check-brand-hex.mjs`.
- **Typografie ongewijzigd.** De referentie gebruikt uitsluitend Inter; het portaal houdt Newsreader op koppen en KPI-waarden. Afgewogen en geparkeerd als apart merkbesluit.

## Let op bij review — deze branch bevat twee losstaande wijzigingen

Naast de huisstijl zit er functioneel AI-werk in dezelfde commit (`AntwoordWeergave.tsx`, `AssistentClient.tsx`, `AgendapuntChat.tsx`, `bronsamenvatting.*`, `rag.ts`, `decisions/0099`, `HANDOVER.md`). Dat is er tijdens het werk in geraakt en is bewust niet uit elkaar getrokken. Gevolg: een revert van deze PR raakt beide.

## Visuele referentie

- `03 Functioneel ontwerp/Designrichtingen portaal/richting-d-bestuursblauw.html` — Home, AI-assistent en Bibliotheek, met schakelaar D1 ↔ D2
- `03 Functioneel ontwerp/Designrichtingen portaal/richting-d-tokens.html` — tokenblad, contrasttoets en implementatie-impact
