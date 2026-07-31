# 0097 — Twee toegankelijkheidstokens: `--mark` en `--app-line-control`

- **Status:** Geaccepteerd
- **Datum:** 2026-07-31
- **Betrokkenen:** Merlin (opdrachtgever), Claude (analyse en uitvoering)

## Context

De tokenlaag in `app/globals.css` kende tot nu toe drie randkleuren: `--line`
(228 231 241), `--app-line` (idem) en `--app-line-strong` (210 214 230). Die zijn
alle drie ontworpen als **decoratieve scheiding** — een hairline tussen tabelrijen,
de rand van een kaart. Ze zijn vervolgens ook gebruikt voor de rand van
**bedieningselementen**: de chips onder een antwoord, de knoppen in de actiebalk,
de verduidelijkingschips.

Daar loopt het mis. WCAG 2.1 stelt in **1.4.11 (Non-text Contrast)** een ondergrens
van **3:1** voor "visuele informatie die nodig is om componenten van de
gebruikersinterface te identificeren". Een decoratieve scheidslijn valt daar niet
onder; de rand die een knop als knop herkenbaar maakt, wel.

Nagerekend (WCAG 2.x, relatieve luminantie met sRGB-linearisatie):

| Kleur | Op `--app-surface` (wit) | Op `--app-zebra` |
|---|---|---|
| `--app-line-strong` — 210 214 230 | **1,45:1** | 1,38:1 |
| `--app-line-control` — 134 140 168 | **3,32:1** | **3,15:1** |

`--app-line-strong` haalt het dus met ruime marge níet. Dat is geen fout in dat
token — het is een goede scheidingslijn — maar het is de verkeerde kleur voor een
bedieningselement.

Het tweede token, `--mark` (250 232 190), hoort bij het markeren van passages in
lopende tekst. `--ink` op `--mark` haalt **14,3:1** en voldoet daarmee ruim aan
1.4.3 (≥ 4,5:1 voor bodytekst).

## Besluit

**Twee tokens toegevoegd aan `app/globals.css` en `tailwind.config.ts`:**

- `--mark-rgb: 250 232 190` → Tailwind `mark`
- `--app-line-control-rgb: 134 140 168` → Tailwind `app.line-control`

`--app-line-strong` blijft **ongewijzigd** en blijft in gebruik voor decoratieve
scheidingen en tabelranden. Er is dus niets vervangen; er is een rol bijgekomen die
er impliciet al was.

### Beide blijven buiten `THEMABARE_TOKENS`

De per-fonds theming-allowlist in `core/lib/fonds-config-core.ts` blijft
ongewijzigd. Reden: dit zijn **toegankelijkheidsafspraken, geen merkkeuzes**. Een
fonds dat `--app-line-control` zou mogen overschrijven, kan de 3:1-ondergrens
stukmaken zonder dat iemand het merkt — en dan is de maatregel weg terwijl het
token er nog staat. Dat is precies het patroon uit bevinding H-18 (een maatregel
die in de code stond maar niet werkte), en dat willen we hier niet herhalen.

### `--mark` heeft nog geen consument

Het token is toegevoegd zonder dat er één class op staat. Dat is bewust:

- Markeren in lopende tekst is een **functionele** ingreep, geen presentatie: er
  moet iets besluiten *wát* gemarkeerd wordt (het model of een validatielaag). Dat
  valt buiten deze tranche, en de visuele referentie
  ([`prototypes/ai-assistent-grafische-optimalisatie.html`](../prototypes/ai-assistent-grafische-optimalisatie.html))
  sluit het in de slotnoot expliciet uit met dezelfde motivering.
- De afspraak moet vastliggen vóórdat de eerste class wordt geschreven. Anders
  ontstaat er eerst een markering en pas daarna de vraag of hij leesbaar is.

**Bij gebruik geldt:** kleur is nooit de enige drager. Een markering krijgt altijd
ook een lijn of een tekstuele aanduiding. (Dit spiegelt requirement R9 uit de
ontwerpsessie-handover van 31-07-2026 — een extern document, niet in deze repo.)

## Borging

`core/lib/kleurcontrast.sanity.ts` (draait mee in `npm run sanity`) leest de
tokenwaarden uit `app/globals.css` en rekent de ratio's na. De suite:

- pint `--app-line-control` op ≥ 3:1 op zowel `--app-surface` als `--app-zebra`;
- pint dat `--app-line-strong` de 3:1 **niet** haalt — kantelt dat ooit, dan is de
  aanleiding voor dit besluit vervallen en moet het opnieuw tegen het licht;
- pint `--ink` op `--mark` op ≥ 4,5:1;
- controleert dat beide tokens **niet** in `THEMABARE_TOKENS` staan en wél in
  `tailwind.config.ts`.

Zo is het contrast een gecontroleerde eigenschap in plaats van een cijfer in een
rapport dat een half jaar later stil onjuist is.

## Gevolgen

- Eerste consument van `--app-line-control`: de kopieerknop uit besluit
  [`0098`](./0098-kopieren-uit-de-chat-zonder-logging.md).
- Het **retrofitten** van de bestaande chips en knoppen (vervolgvragen,
  verduidelijking, modusbalk — nu `border-line` of `border-app-line-strong`) is
  **niet** in deze tranche gedaan. Dat is een veegactie over meerdere schermen en
  hoort in een eigen tranche, met een eigen visuele controle.
- `npm run lint:colors` blijft groen. Er zijn wél twee hex-literals bijgekomen,
  in `core/lib/antwoord-klembord.ts` (`#c8ccd8`, `#f2f4f9`): dat is inline opmaak
  voor een EXTERN programma (Word/Excel), niet de tokenlaag van de applicatie —
  dezelfde lijn als de print-CSS in `core/lib/*-html.ts`. De guard blokkeert
  alleen legacy-merk-hex en arbitrary-hex-*classes*, dus dit valt er terecht
  buiten. De uitzonderingsnoot in `scripts/check-brand-hex.mjs` noemde alleen
  `lib/*-html.ts` — dubbel verouderd, want die bestanden staan sinds de
  T9-splitsing in `core/lib/` — en is bij deze tranche bijgewerkt.

## Referenties

- WCAG 2.1 SC 1.4.11 (Non-text Contrast), SC 1.4.3 (Contrast Minimum)
- `app/globals.css`, `tailwind.config.ts`, `core/lib/kleurcontrast.sanity.ts`
- Besluit [`0084`](./0084-huisstijl-t1-violet-accent-teal-fase-lichte-nav.md) — de
  huidige tokenlaag
