# AI-antwoordweergave — Ontwerpdocument

- **Versie:** 0.1 · 31 juli 2026
- **Status:** Vastgelegd voor tranche 1 (parser-regressienet, tabel- en leesopmaak, kopiëren)
- **Bron van waarheid:** de code. Dit document beschrijft *wat en waarom*; bij afwijking wint
  `core/lib/antwoord-parser.ts` + `app/(dashboard)/ai/_components/AntwoordWeergave.tsx`.

## 1. Waar dit over gaat

Het portaal toont AI-antwoorden op twee plekken:

| Surface | Bestand | Container |
|---|---|---|
| Volledige assistent `/ai` | `app/(dashboard)/ai/_components/AssistentClient.tsx` | kolom `max-w-[1020px]` |
| Inline agendavoorbereiding | `app/(dashboard)/vergaderingen/_components/AgendapuntChat.tsx` | smal paneel, `max-h-96` |

Sinds besluit [`0079`](./decisions/0079-agenda-assistent-gedeelde-weergave.md) delen die
**exact dezelfde renderer**. Elke wijziging aan de weergave landt dus per definitie op beide
plekken; ze worden ook op beide plekken getest.

## 2. Architectuur — parser en renderer zijn gescheiden

```
antwoordtekst (markdown-subset uit het model)
        │
        ▼
core/lib/antwoord-parser.ts        ← PURE functies, geen React
   parseerBlokken(tekst) → Blok[]
   parseerInline(regel)  → InlineDeel[]
   numeriekeKolommen(tabel) → boolean[]
        │
        ├──────────────► AntwoordWeergave.tsx      → React/JSX (het scherm)
        └──────────────► core/lib/antwoord-klembord.ts → text/html + text/plain (klembord)
```

De parser zat tot 31-07-2026 verweven met JSX in het component en had **geen enkele
geautomatiseerde test**, terwijl hij twee schermen voedt. Hij is uitgetrokken naar
`core/lib` om drie redenen:

1. **Testbaarheid.** Een suite op de gerenderde HTML valt om bij elke opmaakwijziging; een
   suite op de AST legt structuur en semantiek vast en overleeft styling. Zie
   `core/lib/antwoord-parser.sanity.ts` (51 tests).
2. **Eén interpretatie.** De kopieerfunctie moet dezelfde tekst omzetten naar Word- en
   Excel-formaat. Twee parsers zouden uiteenlopen, met als zichtbaar gevolg dat wat je
   kopieert niet is wat je ziet.
3. **Laagscheiding.** `app/` mag `core/` importeren, andersom niet (boundary T9).

De extractie is gedragsneutraal uitgevoerd: een wegwerp-harness rendeerde 471 fixtures
(inclusief 400 streamprefixes) met de oude en de nieuwe code via `renderToStaticMarkup` —
**4.239 vergelijkingen, byte-identieke HTML**. Dat was een **eenmalige meting op
31-07-2026**; de harness had een kopie van de pre-extractie-code nodig en staat niet in
de repo, dus de meting is niet reproduceerbaar. Wat blijvend bewaakt wordt, is de AST —
zie `core/lib/antwoord-parser.sanity.ts`.

Let op de reikwijdte: byte-identiek gold voor de **extractiestap** (§2), niet voor de
tranche als geheel. De gerenderde DOM is daarna wél veranderd — zie §4.3.

### 2.1 De AST

```
Blok  = { soort:"alinea", inline }
      | { soort:"kop", niveau:1..6, inline }
      | { soort:"lijst", geordend:boolean, items }
      | { soort:"tabel", kop, rijen }

InlineDeel = { k, soort:"tekst", stukken }        // stukken: plat | vet | cursief | code
           | { k, soort:"bron", nummer }
           | { k, soort:"kennis", label, instantie }
           | { k, soort:"toelichting" }
           | { k, soort:"organisatieprofiel" }
```

`niveau` is getypeerd als `number`; dat het altijd 1..6 is, is een parser-invariant
(de regex is `#{1,6}`), geen typegarantie.

`k` is de oorspronkelijke splitsindex en voedt de React-key. Dat is geen detail: tijdens het
streamen wordt hetzelfde antwoord tientallen keren opnieuw geparseerd, en een verschuivende
key betekent een remount van een pill halverwege een zin.

## 3. Bekende eigenaardigheden — bevroren, niet gerepareerd

De sanity-suite legt het bestaande gedrag vast, **ook waar dat suboptimaal is**. Dit zijn
bevindingen voor een volgende tranche, geen bugs die stilletjes zijn opgelost:

| # | Gedrag | Gevolg |
|---|---|---|
| E1 | Een `<ol>` begint altijd bij 1 | `3. tekst` na een alinea toont "1." |
| E2 | Geneste lijsten worden platgeslagen | inspringing gaat verloren |
| E3 | Uitlijningsdubbelepunten (`\|---:\|`) worden genegeerd | uitlijning komt uit de celinhoud (§4.1) |
| E4 | Ragged rijen worden niet aangevuld of afgekapt | een rij met minder cellen rendert korter |
| E5 | `[Bron 0]` is altijd ongeldig (index −1) | toont de "⚠ Bron 0?"-markering |
| E6 | `**vet**` dat over een marker heen loopt wordt niet herkend | de marker splitst eerst |
| E7 | **Tabelflikker tijdens het streamen** | zie hieronder |

### E7 — tabelflikker

Een tabelrij telt pas als de regel op `\|` eindigt. Tijdens het streamen levert dat twee
zichtbare knippers op:

- **Scheidingsregel.** `\|---\|` is al een geldige scheiding voor een 1-koloms tabel;
  `\|---\|-` niet. De tabel verschijnt en verdwijnt dus per pipe tot de regel compleet is.
- **Laatste rij.** `\| 1 \|` is een complete rij van één cel; `\| 1 \| 2` is geen rij meer.
  Het rijaantal daalt daardoor tijdelijk, en de laatste regel toont kort het verkeerde
  aantal kolommen.

**Op regelgrenzen is het gedrag wél netjes** — dat is als eigenschap getest: de tabel
verschijnt zodra de scheidingsregel af is, groeit met één rij per regel, en eerder
geparseerde rijen wijzigen niet meer. Een eventuele oplossing (de laatste, nog
onafgemaakte regel negeren zolang het antwoord streamt) is bewust uitgesteld: stap 0 van
deze tranche mocht het gedrag niet wijzigen.

## 4. Opmaak

### 4.1 Tabellen

Een markdown-pipe-tabel rendert met de bestaande stuurinformatie-klassen `si-tabel` plus de
modifier **`si-tabel-gesloten`**. Die modifier bestaat omdat `.si-tabel` de tabel alleen
afsluit via `thead` (bovenhoeken) en `tfoot`/`.si-totaalrij` (onderhoeken en zijranden). Een
AI-tabel heeft geen totaalrij en zou dus open zijkanten en vierkante onderhoeken houden.
Bewust een aparte klasse: de bestaande stuurinformatie-tabellen blijven ongemoeid.

`.si-tabel` zet zelf geen `text-align` op `th`; alle gebruikers zetten die per cel. De
AI-renderer volgt die conventie (`text-left`, of `si-num`).

**Uitlijning is deterministisch en komt uit de celinhoud** — geen modelbeslissing, geen
promptinstructie. `numeriekeKolommen()` geeft een kolom `si-num` (rechts uitgelijnd,
tabulaire cijfers) als **alle** niet-neutrale bodycellen matchen op datum, bedrag,
percentage, kaal getal of duur ("6 weken"), en er minstens één zo'n cel is. Neutrale
cellen — leeg, `-`, `–`, `—`, `n.v.t.`, `nvt`, `n/a`, `onbekend`, `pm`, `p.m.` — breken
de kolom niet, maar dragen hem ook niet. De kopcel volgt de kolom.

De regel is bewust conservatief. Niet herkend (en dus links uitgelijnd): `circa 6 weken`,
`6 weken en 3 dagen`, `18-09-2026 (onder voorbehoud)`. Omgekeerd matcht het kale-getal-
patroon ook een referentie- of telefoonnummer; die krijgen dan rechtse uitlijning.

### 4.2 Leesritme

- **`.ai-lees`** — `max-width: 68ch` op alinea's, lijsten en koppen. Tabellen, bronkaarten
  en het onderbouwingspaneel houden de volle kolombreedte. In de smallere agendapuntchat is
  de container zelf al smaller; `max-width` laat die dan leidend zijn.
- **`tabular-nums`** staat op de hele leeskolom in plaats van op gedetecteerde getallen:
  deterministisch, geen heuristiek die soms misgrijpt.
- **`.ai-kop`** — kopjes met een rustig accentstreepje van 26 × 2 px erboven.

Koppen renderen als **`<h4>`**, niet meer als vetgedrukte alinea, zodat schermlezers erop
kunnen navigeren. Alle markdown-niveaus (`#` t/m `######`) landen op `h4`: de kopniveaus van
het model zijn geen documenthiërarchie en zouden de paginastructuur anders vervuilen.

### 4.3 Blokomhulling

Elk blok zit in een `<div class="ai-blok group">`. Die omhulling staat er **altijd** —
ook tijdens het streamen en ook wanneer er geen kopieerknop is. Reden: zou de wrapper
pas verschijnen zodra het antwoord af is, dan verandert op dat moment het elementtype
op elke key en bouwt React de hele antwoordboom opnieuw op, met een zichtbare hik aan
het eind van elk antwoord.

De omhulling draagt bovendien de leesmaat (`.ai-lees`, behalve bij tabellen) en
positioneert de kopieerknop absoluut in de rechterbovenhoek. Dat de maat op de
omhulling zit en niet op het blok is geen detail: anders zou de knop in `/ai` op de
rand van de 1020px-container landen in plaats van naast de tekst.

Eén CSS-valkuil die hieruit volgt en die is dichtgezet: `.ai-kop:first-child` zou door
de omhulling **elke** kop treffen (een kop is altijd het eerste kind van zijn eigen
wrapper) en zo het kopritme uitschakelen. De regel staat daarom op
`.ai-blok:first-child > .ai-kop`.

### 4.4 Tokens

Zie besluit [`0097`](./decisions/0097-tokens-mark-en-app-line-control.md): `--mark` en
`--app-line-control`, beide buiten `THEMABARE_TOKENS`, bewaakt door
`core/lib/kleurcontrast.sanity.ts`.

## 5. Kopiëren

Zie besluit [`0098`](./decisions/0098-kopieren-uit-de-chat-zonder-logging.md). Kern:

- twee formaten (`text/html` met echte `<table>`, `text/plain` met tabs), met twee
  terugvallen en eerlijke terugkoppeling over welk pad het werd. De drie
  uitkomsten zijn *"Gekopieerd, met opmaak en bronvermelding."*, *"Gekopieerd als
  tekst, met bronvermelding. Uw browser ondersteunt geen opgemaakte kopie."* en
  *"Kopiëren is niet gelukt."*;
- **bronnenlijst en herkomstregel zijn niet uitschakelbaar** — geen parameter, geen
  instelling, geen per-fonds configuratie, afgedwongen via een type-merk op
  `KopiePayload` én een runtime-controle in `schrijfNaarKlembord()`;
- de bronnenlijst steunt **niet alleen op `[Bron N]`-markers**: in de
  document-scope-modi verbiedt de systeemprompt die notatie, en een op markers
  gebaseerde lijst zou het antwoord daar ten onrechte als bronloos presenteren;
- **een kopieeractie wordt niet gelogd**; dat is een expliciet besluit met een aanvaard
  gevolg, en de herkomstregel in de tekst is daarvan de tegenhanger;
- alleen een **voltooide** generatie is kopieerbaar — niet tijdens het streamen, niet
  op de welkomsttekst, niet op een foutmelding en niet op een afgebroken antwoord.

## 6. Wat hier bewust NIET in zit

Deze tranche verandert **uitsluitend hoe bestaande data wordt getoond**. Ongewijzigd:
prompts, systeemprompt-blokken, retrieval, RPC's, filtering vóór retrieval, de zeven
antwoordmodi en hun detectie, document-scope, RLS, datamodel en migraties.

Uitgesteld naar een volgende tranche (visuele referentie
[`prototypes/ai-assistent-grafische-optimalisatie.html`](./prototypes/ai-assistent-grafische-optimalisatie.html),
annotaties 4 t/m 8): het hover-fragment op de
`[Bron N]`-pill, een afgeleid pill-label, de gestippelde concept-rand, de herziene
bronkaarten in twee kolommen, en de informatievere ingeklapte onderbouwingsbalk. Die vragen
óf een payloaduitbreiding (`documenttype`) óf een herziening van de bronkaart zelf.

## 7. Referenties

- Besluiten [`0079`](./decisions/0079-agenda-assistent-gedeelde-weergave.md),
  [`0097`](./decisions/0097-tokens-mark-en-app-line-control.md),
  [`0098`](./decisions/0098-kopieren-uit-de-chat-zonder-logging.md)
- ADR 0028 (`[Toelichting agendapunt]`), OP-4 (`[Organisatieprofiel]`), increment I-3
  (instantie op de kennis-pill)
- Suites: `core/lib/antwoord-parser.sanity.ts`, `core/lib/antwoord-klembord.sanity.ts`,
  `core/lib/kleurcontrast.sanity.ts`
