# Tokenlaag-refactor — huisstijl gelijktrekken (app + beheer → bestuurdersportaal.com)

**Status:** plan ter review · **Scope:** light-thema, geen dark mode · **Doel:** één bron van waarheid voor kleur/typografie over marketing, app en beheer.

> ⚠️ **Waardes verouderd (huisstijl tranche 1, 2026-07-28, besluit 0084).** De concrete
> hex/kleurwaarden in dit document beschrijven de historische set en zijn **niet meer
> actueel**: `--accent` is nu **violet** (`91 79 224`, was `#234E70`), de navigatie is
> **licht met donkere navtekst** (was diep ink-navy) en `--phase` is **teal** (was paars).
> Het *principe* (rol-tokens, geen dark mode, één bron van waarheid) blijft ongewijzigd.
> Actuele waarden: `app/globals.css` (bron van waarheid) + de contrasttabel in
> `TOKENLAAG-FASE5-QA.md`.

---

## 1. Principe

Vandaag staan merkkleuren als **hardcoded hex** door de JSX (`bg-[#0f2744]`, `border-[#c9a84c]`, …). Dat maakt gelijktrekken onmogelijk zonder overal te zoeken-en-vervangen, en elke toekomstige merkwijziging opnieuw. De refactor introduceert een **semantische tokenlaag**: kleuren krijgen een betekenisnaam (`ink`, `accent`, `nav`, `line`), gedefinieerd op één plek (CSS-variabelen + Tailwind-thema). Componenten verwijzen naar de rol, niet naar de hex.

Kernregel: **een token beschrijft een rol, geen kleur.** `accent` is "de interactieve/primaire kleur" — vandaag blauw `#234E70`, morgen desgewenst iets anders, zonder één component aan te raken.

---

## 2. De tokenset (bron: `public.css` van de marketingsite)

Definieer in `app/globals.css` (vervangt het huidige `:root`-blok met `--navy`/`--gold`):

```css
:root {
  /* ── Merk / basis (uit public.css) ── */
  --paper:      #F6F3EC;   /* marketing-achtergrond */
  --ink:        #191815;   /* primaire tekst + koppen */
  --muted:      #6B6A63;   /* secundaire tekst */
  --line:       #D8D3C7;   /* rustige randen/scheidingen */
  --accent:     #234E70;   /* PRIMAIRE interactieve kleur (was navy-als-primary én goud) */
  --accent-ink: #1A3A57;   /* tekst op lichte accent-tint / hover */
  --accent-tint:#EAEFF4;   /* zachte accent-vulling (actieve rij, badge) */
  --card:       #FBFAF5;   /* verhoogd oppervlak */

  /* ── App-surfaces (functioneel, rustiger dan paper onder dichte data) ── */
  --app-bg:      #F1EEE7;
  --app-surface: #FBFAF5;
  --app-line:    #E2DCCF;
  --app-line-strong:#CFC8B8;
  --app-zebra:   #F6F3EC;

  /* ── Navigatie / sidebar (licht & warm — minimalistisch, gekozen variant) ── */
  --nav:            #EAE5DA;   /* lichte, warme sidebar-achtergrond (iets donkerder dan app-bg voor scheiding) */
  --nav-line:       #D8D3C7;   /* rechterrand sidebar */
  --nav-text:       #6B6A63;   /* inactief item */
  --nav-text-active:#1A3A57;   /* actief item (= accent-ink) */
  --nav-active:     rgba(35,78,112,0.10);  /* vulling actief item */
  --nav-accent:     #234E70;   /* accentlijn + merkvierkant */

  /* ── Semantisch ── */
  --ok:   #2E7D5B;
  --err:  #B23A48;
  --warn: #BA7517;

  /* ── Typografie (gevoed door next/font, zie §6) ── */
  --serif: var(--font-serif), Georgia, serif;
  --sans:  var(--font-sans), -apple-system, "Segoe UI", Roboto, sans-serif;

  --radius: 8px;
  --radius-sm: 5px;
}

body {
  font-family: var(--sans);
  background: var(--app-bg);
  color: var(--ink);
}
```

Registreer dezelfde tokens als Tailwind-kleuren zodat classes leesbaar worden (`bg-nav`, `text-ink`, `bg-accent`) in `tailwind.config.ts`:

```ts
theme: {
  extend: {
    colors: {
      paper:  "var(--paper)",
      ink:    "var(--ink)",
      muted:  "var(--muted)",
      line:   "var(--line)",
      accent: { DEFAULT: "var(--accent)", ink: "var(--accent-ink)", tint: "var(--accent-tint)" },
      card:   "var(--card)",
      app:    { bg: "var(--app-bg)", surface: "var(--app-surface)", line: "var(--app-line)", zebra: "var(--app-zebra)" },
      nav:    { DEFAULT: "var(--nav)", line: "var(--nav-line)", text: "var(--nav-text)", "text-active": "var(--nav-text-active)", active: "var(--nav-active)", accent: "var(--nav-accent)" },
      ok: "var(--ok)", err: "var(--err)", warn: "var(--warn)",
    },
    fontFamily: {
      serif: ["var(--font-serif)", "Georgia", "serif"],
      sans:  ["var(--font-sans)", "-apple-system", "Segoe UI", "sans-serif"],
    },
  },
},
```

> Verwijder de oude `navy`/`gold`-kleuren pas in fase 4, zodat bestaande classes tijdens de migratie blijven werken (geen big-bang).

---

## 3. Mapping oud → nieuw (rol-gebaseerd)

Feitelijke telling in `app/` + `components/`:

| Oude hex | Voorkomens | Rol nu | → Token |
|---|---|---|---|
| `#0f2744` `text-` | 358 | koppen/labels/tekst | `text-ink` (uitz.: link/nadruk → `text-accent`) |
| `#0f2744` `bg-` (in `Sidebar.tsx` + nav-layouts) | ~deel v/d 104 | sidebar-achtergrond | `bg-nav` |
| `#0f2744` `bg-` (knoppen/pills/actief elders) | ~deel v/d 104 | primaire actie | `bg-accent` |
| `#0f2744` `border-` | 73 | rand structureel / actief | `border-line` / `border-accent` |
| `#1a3858` `#1a3a5e` `#1a3a5c` `#163556` | 36 | navy hover/light | `hover:bg-accent` / `bg-nav-active` |
| `#c9a84c` (alle rollen) | 156 | goud = oud primair accent | `*-accent` (goud vervalt) |
| `#f0f3f8` | 23 | app-achtergrond | `bg-app-bg` |
| `#94a3b8` `#64748b` `#9ca3af` | 17 | slate grijs | `text-muted` |
| `#f1f5f9` `#e5e7eb` `#cbd5e1` `#d8e2ee` | 8 | lichtgrijze randen | `border-app-line` / `border-line` |
| `#ef4444` `#b91c1c` `#e48a94` | 9 | rood | `*-err` |
| `#16a34a` `#10b981` `#1d9e75` | 6 | groen | `*-ok` |
| `#f59e0b` `#ba7517` `#fac775` | 6 | amber | `*-warn` |
| chart-kleuren (`#7c3aed` `#14b8a6` `#0ea5e9` `#06b6d4` …) | ~12 | categorische datavis | **buiten scope** — apart chart-palet |

**Belangrijkste beslissing:** navy `#0f2744` splitst in drie rollen (`ink` / `nav` / `accent`). Goud `#c9a84c` gaat volledig naar `accent`; de kleur goud verdwijnt uit het systeem.

---

## 4. Fasering (geen big-bang)

**Fase 0 — Fundament (additief, 0 visuele wijziging).**
Voeg §2 toe náást de bestaande `--navy`/`--gold`. Nieuwe tokens beschikbaar, niets vervangen. Deploybaar en risicoloos.

**Fase 1 — Mechanisch (laag risico).**
Vervang de single-purpose kleuren: goud→`accent`, `#f0f3f8`→`app-bg`, slate-grijzen→`muted`/`line`, semantische kleuren→`ok`/`err`/`warn`. Dit is een veilige zoek-en-vervang (script in §5). Visueel effect: goud wordt blauw, achtergrond wordt warm.

**Fase 2 — Navy-triage (review vereist).**
De 535 navy-treffers, gesplitst per prefix/bestand:
- `Sidebar.tsx` + nav-layouts: dit is de **grootste inhoudelijke wijziging**, want de sidebar gaat van donker (navy, witte tekst) naar **licht** (`bg-nav` beige, donkere tekst). De witte tekst (`text-white`, `text-white/72`, …) draait om naar `text-nav-text` (inactief) en `text-nav-text-active` (actief); actief item krijgt `bg-nav-active` + `border-nav-accent`; merkvierkant/avatar → `bg-nav-accent`.
- Overige `bg-[#0f2744]` (knoppen, actieve pills) → `bg-accent`.
- Alle `text-[#0f2744]` → `text-ink`; loop daarna links/nadrukzinnen na → `text-accent`.
- `border-[#0f2744]`: structureel → `border-line`; actief/geselecteerd → `border-accent`.
Per bestand reviewen, niet blind globaal. **Let op:** door de licht-sidebar moeten alle witte-tekst- en witte-rand-classes ín de sidebar (`text-white*`, `border-white/*`, `bg-white/*`) worden omgezet naar de nieuwe nav-tokens — die volgen niet uit de navy-hex-mapping, dus expliciet in `Sidebar.tsx` nalopen.

**Fase 3 — Typografie.**
Voer `Newsreader`/`Inter` (bestaan al voor marketing) ook in app/beheer via de root-layout; zet paginatitels en kaartkoppen op `font-serif`, body op `font-sans`. Vervang `Segoe UI` in `globals.css`.

**Fase 4 — Opschonen & borgen.**
Verwijder `--navy`/`--gold` en de `navy`/`gold` Tailwind-kleuren. Voeg een lint-regel toe die kale hex in classes verbiedt (zie §7). Visuele QA over alle schermen (checklist §6).

---

## 5. Codemod (fase 1, veilig deel)

Draai vanuit `mvp/`. Maak eerst een branch. Dit dekt uitsluitend de single-purpose kleuren; navy wordt met opzet **niet** meegenomen.

```bash
# Alleen op bron, node_modules/.next uitgesloten.
FILES=$(grep -rlE "#(c9a84c|C9A84C|f0f3f8|94a3b8|64748b|9ca3af|f1f5f9|e5e7eb|cbd5e1|ef4444|b91c1c|16a34a|10b981|1d9e75|f59e0b|ba7517)" app components)

for f in $FILES; do
  sed -i '' -E \
    -e 's/#[cC]9[aA]84[cC]/var-accent/g' \
    -e 's/#[fF]0[fF]3[fF]8/var-app-bg/g' \
    -e 's/#(94[aA]8[bB]8|64748[bB]|9[cC][aA]3[aA]3)/var-muted/g' \
    -e 's/#(f1f5f9|e5e7eb|cbd5e1)/var-line/g' \
    -e 's/#(ef4444|b91c1c)/var-err/g' \
    -e 's/#(16a34a|10b981|1d9e75)/var-ok/g' \
    -e 's/#(f59e0b|ba7517)/var-warn/g' \
    "$f"
done
```

> Let op: bovenstaande vervangt de hex-string. In de praktijk wil je de héle Tailwind-class omzetten (`bg-[#c9a84c]` → `bg-accent`), niet alleen de hex. Doe dat met een class-bewuste codemod (jscodeshift of een gerichte `sed` per prefix: `bg-\[#c9a84c\]`→`bg-accent`, `border-\[#c9a84c\]`→`border-accent`, `text-\[#c9a84c\]`→`text-accent`). Het losse-hex-script hierboven is de vangnetvariant voor inline `style={{…}}`-gebruik. **Altijd `git diff` reviewen vóór commit.**

Aanbevolen, robuuster dan `sed`: één jscodeshift-transform die per attribuut (`className`, `style`) de mapping-tabel uit §3 toepast en een rapport uitdraait van niet-geclassificeerde treffers (met name navy) voor de handmatige fase 2.

---

## 6. Acceptatiecriteria

1. **Geen kale merk-hex meer** in `app/`+`components/` voor navy/goud/app-bg (grep = 0, m.u.v. het chart-palet dat expliciet buiten scope is).
2. **Eén accentkleur**: goud komt nergens meer voor; alle voormalige goud- en primair-navy-accenten zijn `accent`-blauw.
3. **Sidebar** is de lichte, warme `nav`-variant (beige) met donkere tekst en blauwe accentlijn + zachte accent-vulling op het actieve item; geen navy/blauwe achtergrondbalk en geen witte tekst meer.
4. **Koppen** gebruiken `font-serif`, body `font-sans`; `Segoe UI` verdwijnt uit `globals.css`.
5. **Consistentie over surfaces**: marketing, app en beheer delen dezelfde `--accent`, `--line`, typografieschaal en radii.
6. **Visuele QA** uitgevoerd op: login, stuurinformatie, klantbeeld, bibliotheek, vergaderingen, notulen, procedures, risicomatrix, beheer/catalogus, governance-log, AI-assistent. Geen contrast-regressies (WCAG AA: tekst ≥4.5:1).
7. **Geen dark mode** — bewust buiten scope; geen `data-theme`/dark-varianten toegevoegd in app/beheer.

---

## 7. Risico's & valkuilen

- **Overladen navy (grootste risico).** Blind vervangen geeft gelijke kleur aan koppen, sidebar en knoppen. Mitigatie: rol-gebaseerde triage (fase 2), per bestand reviewen, codemod-rapport van niet-geclassificeerde treffers.
- **Contrast op paper.** Voormalige navy-tekst (#0f2744) op wit had hoog contrast; `ink` (#191815) idem — oké. Maar `accent`-blauw op `app-bg` voor kleine tekst nalopen op AA.
- **Lichte sidebar — contrast & hiërarchie.** Inactief `nav-text` (#6B6A63) op beige (#EAE5DA) haalt ~AA voor gewone tekst maar is krap; check op ≥4.5:1 en overweeg iets donkerder muted indien nodig. Een lichte sidebar verankert visueel minder dan een donkere — zorg voor een duidelijke rechterrand (`nav-line`) en voldoende actief-contrast zodat de navigatie herkenbaar blijft.
- **Goud in betekenisdragende UI.** Check of goud ergens *status* aanduidde (bv. "premium"/"vastgesteld") i.p.v. puur accent; zo ja, expliciet naar een semantisch token mappen i.p.v. `accent`.
- **Chart-kleuren.** Bewust buiten scope gehouden; leg een apart categorisch datavis-palet vast als aparte taak, anders sluipt inconsistentie terug in grafieken.
- **Regressie voorkomen.** Voeg na fase 4 een ESLint-regel of CI-grep toe die `[#` in className blokkeert, zodat er geen nieuwe kale hex insluipt.
- **Marketing ongemoeid.** `public.css` is al de bron; niet aanraken behalve tokens exporteren. De app importeert de *waarden*, niet de `.bp-public`-scope.

---

## 8. Aanpak-samenvatting

| Fase | Inhoud | Risico | Reviewlast |
|---|---|---|---|
| 0 | Tokenfundament toevoegen | nihil | klein |
| 1 | Goud/grijzen/semantiek (codemod) | laag | diff-review |
| 2 | Navy-triage per rol | midden | per bestand |
| 3 | Typografie (serif/sans) | laag | visueel |
| 4 | Opschonen + lint-borging | laag | QA-checklist |

Geschatte doorlooptijd bij één ontwikkelaar: fase 0–1 ½ dag, fase 2 ½–1 dag (review-intensief), fase 3–4 ½ dag. Totaal ~1,5–2 dagen exclusief brede visuele QA.
