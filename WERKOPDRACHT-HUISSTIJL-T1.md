## Werkopdracht: huisstijl tranche 1 — nieuwe kleurstelling + inklapbaar menu

**Doel & context** — Het portaal krijgt een modernere, lichtere uitstraling zonder dat de schermopzet verandert. Deze eerste tranche vervangt uitsluitend de **waarden** in de bestaande tokenlaag (accent van editorial-blue naar violet; navigatie van diep ink-navy naar licht), maakt de sidebar **inklapbaar** met titel-tooltips, en vervangt de emoji-iconen in de moduleregistry door een geometrische set die ook ingeklapt onderscheidbaar blijft. Geen enkele component, Tailwind-klasse of pagina-indeling wordt herschreven — dat is expliciet het uitgangspunt van deze tranche.

**Goedgekeurd ontwerp/plan** — Visuele referentie: `03 Functioneel ontwerp/Designrichtingen portaal/portaal-nieuwe-kleuren.html` (bestaande schermopzet van Home en AI-assistent, alleen hergekleurd, met de inklapbare sidebar). De volledige tokentabel staat in het derde tabblad van dat bestand. De tokenwaarden in §"Tokenwaarden" hieronder zijn **leidend** — die zijn gecorrigeerd op contrast en wijken op één punt af van de HTML-preview (zie `--muted`).

> **Let op bij het lezen van de preview:** het demofonds heet daar "Stichting Pensioenfonds Vitalis". Het echte demofonds is **Stichting Pensioenfonds Horizon** (slug `horizon`). De preview is illustratief; naam en cijfers zijn niet leidend.

---

### Scope

**Wel**

1. **Tokenwaarden in `app/globals.css`** — het `:root`-blok krijgt de nieuwe waarden uit §"Tokenwaarden". Tokennamen, structuur, de RGB-channel-opzet en de `@layer components`-blok (`si-*`) blijven **ongewijzigd**.
2. **Inklapbare sidebar** in `core/components/Sidebar.tsx` — hamburger in het logoblok, ingeklapte breedte `w-14`, titel als tooltip per item in ingeklapte stand, voorkeur bewaard in `localStorage`. De marge van de content in `app/(dashboard)/layout.tsx` (`md:ml-64`) beweegt mee.
3. **Iconen in `core/lib/module-registry.ts`** — de `icon`-velden vervangen door de geometrische set uit §"Iconen". De `iconSrc` van de AI-module (`/ai-assistent.png`) blijft ongewijzigd en houdt voorrang.
4. **Verschuiving van `--phase`** van paars naar teal, omdat `--accent` zelf paars wordt en de fase-markering per fase 5 bewust van accent onderscheiden moet blijven. Dit is een besluit dat een `decisions/`-entry vergt (zie §"Besluitpunten").
5. **Inventarisatie van bestaande `fonds_theming`-rijen** en, waar nodig, correctie — zie de tenant-risico's onder Acceptatiecriteria.
6. **Bijwerken van de tokenlaag-documentatie** die nu de oude waarden beschrijft (`TOKENLAAG-REFACTOR-PLAN.md`, `TOKENLAAG-FASE5-QA.md`, en de tech-stack-alinea in `HANDOVER.md` die `#234E70` en "navigatie diep ink-navy" noemt).

**Niet**

- **Geen dark mode.** Blijft buiten scope, conform `TOKENLAAG-REFACTOR-PLAN.md` §"Geen dark mode" en de tech-stack-alinea in `HANDOVER.md`. Geen `data-theme`, geen `prefers-color-scheme`, geen tweede tokenset.
- Geen wijziging aan de schermopzet, componentstructuur of informatiearchitectuur — de drie balken op het AI-scherm blijven zoals ze zijn.
- Geen wijziging aan `app/(public)/public.css` (marketingsite) of aan de publieke routes.
- Geen wijziging aan de beheer-/platform-surface (`platform/**`), behalve waar die aantoonbaar dezelfde `nav-*`-tokens erft en daardoor meebeweegt — dat gedrag alleen verifiëren, niet aanpassen.
- Geen nieuwe tokens, geen nieuwe Tailwind-kleurklassen, geen chart-/datavis-palet (cyan/sky/teal blijven bewust buiten de guard en buiten deze opdracht).
- Geen wijziging aan RLS, API-contracten, governance-logging, datamodel of migraties.

---

### Tokenwaarden

Vervang in `app/globals.css` uitsluitend de waarden. Formaat blijft de RGB-channel-triple.

```css
:root {
  /* ── Merk / basis ────────────────────────────────────────────────── */
  --paper-rgb: 244 245 250;
  --ink-rgb: 23 26 40;
  --muted-rgb: 100 106 136;          /* let op: donkerder dan de preview, zie contrast */
  --line-rgb: 228 231 241;
  --accent-rgb: 91 79 224;           /* was 35 78 112 (editorial blue) */
  --accent-ink-rgb: 68 58 192;
  --accent-tint-rgb: 238 237 252;
  --card-rgb: 255 255 255;

  /* ── App-surfaces ────────────────────────────────────────────────── */
  --app-bg-rgb: 244 245 250;
  --app-surface-rgb: 255 255 255;
  --app-line-rgb: 228 231 241;
  --app-line-strong-rgb: 210 214 230;
  --app-zebra-rgb: 248 249 253;

  /* ── Navigatie — van diep ink-navy naar licht ────────────────────── */
  --nav-rgb: 251 251 254;            /* was 18 42 64 */
  --nav-line-rgb: 228 231 241;
  --nav-text-rgb: 90 96 128;         /* inactief item; was licht op donker */
  --nav-text-active-rgb: 23 26 40;   /* actief item; was bijna-wit */
  --nav-accent-rgb: 91 79 224;
  --nav-active: rgba(91, 79, 224, 0.09);   /* was rgba(255,255,255,.08) — zie tenant-risico */

  /* ── Semantisch ──────────────────────────────────────────────────── */
  --ok-rgb: 15 143 96;      --ok-tint-rgb: 228 243 236;   --ok-ink-rgb: 11 115 80;
  --err-rgb: 206 61 87;     --err-tint-rgb: 251 235 238;  --err-ink-rgb: 166 47 69;
  --warn-rgb: 172 116 17;   --warn-tint-rgb: 250 241 223; --warn-ink-rgb: 133 90 13;

  /* ── Fase-markering — van paars naar teal (zie besluitpunt 1) ────── */
  --phase-rgb: 14 124 155;  --phase-tint-rgb: 226 240 245; --phase-ink-rgb: 10 97 120;

  --shadow-card: 0 1px 2px rgb(var(--ink-rgb) / 0.04), 0 10px 26px -18px rgb(var(--ink-rgb) / 0.35);
}
```

**Waarom `--muted` afwijkt van de preview.** De preview gebruikt `118 124 153`. Die waarde haalt 3,77:1 op `--app-bg` en 4,11:1 op `--card` — onder de AA-drempel van 4,5, en daarmee een **regressie** ten opzichte van de huidige 4,69:1. `text-muted` is na `text-ink` de meestgebruikte kleurklasse in de app, dus dit raakt vrijwel alle secundaire tekst. De waarde `100 106 136` haalt 4,87 / 5,30 / 5,04 (app-bg / card / zebra) en is daarom leidend.

**Doorgerekend contrast bij bovenstaande set** — alle veertien gecontroleerde combinaties halen AA:

| Combinatie | Ratio |
|---|---|
| `muted` op `app-bg` / `card` / `app-zebra` | 4,87 / 5,30 / 5,04 |
| `ink` op `app-bg` | 15,88 |
| wit op `accent` (knop, merkvierkant, avatar) | 5,77 |
| `accent` als linktekst op `card` | 5,77 |
| `accent-ink` op `accent-tint` | 6,95 |
| `ok-ink` / `warn-ink` / `err-ink` op eigen tint | 5,12 / 5,40 / 5,85 |
| `phase-ink` op `phase-tint` | 6,02 |
| `nav-text` op `nav` | 5,95 |
| `nav-text-active` op `nav` | 16,74 |

Verifieer deze tabel opnieuw ná implementatie tegen de daadwerkelijk toegepaste waarden; neem het resultaat op in `TOKENLAAG-FASE5-QA.md` (de bestaande contrasttabel daar beschrijft de oude set en klopt straks niet meer).

**Niet meegenomen, wél opgemerkt:** de rand van invoervelden (`app-line-strong` op `card`) haalt 1,45:1 tegen de 3,0 die WCAG 1.4.11 voor UI-componenten vraagt. Dit is **geen regressie** — de huidige set scoort 1,59 en zakt dus ook. Buiten scope van deze tranche; opnemen als openstaand punt.

---

### Iconen

In `core/lib/module-registry.ts`, veld `icon`:

| Module | Huidig | Nieuw |
|---|---|---|
| `home` | 🏠 | `⌂` |
| `stuurinformatie` | 📊 | `◐` |
| `klantbeeld` | 👥 | `◍` |
| `ai` | 🤖 | `✦` (`iconSrc` blijft leidend en ongewijzigd) |
| `bibliotheek` | 📚 | `▤` |
| `vergaderingen` | 📅 | `▦` |
| `notulen` | 📋 | `✓` |
| `procedures` | 📂 | `◧` |
| `risicomatrix` | 🛡️ | `◇` |
| `beheer` | ⚙️ | `⚙` |
| `governance` | 🔍 | `◎` |
| `assurance` | 🛡️ | `◇` |

De set is gekozen op onderlinge onderscheidbaarheid in ingeklapte stand (18–20 px, zonder label). `◔` is bewust niet gebruikt — die rendert onbetrouwbaar in sommige systeemfonts.

---

**Relevante bestanden / modules** — `app/globals.css` (tokenwaarden), `core/components/Sidebar.tsx` (inklappen + tooltips), `app/(dashboard)/layout.tsx` (`md:ml-64` meebewegen), `core/components/DashboardShell.tsx` (bestaande mobiele drawer-state; controleren op interferentie met de nieuwe inklapstand), `core/lib/module-registry.ts` (iconen), `platform/platform/(beveiligd)/layout.tsx` (erft `bg-nav`; alleen verifiëren). Documentatie: `HANDOVER.md`, `TOKENLAAG-REFACTOR-PLAN.md`, `TOKENLAAG-FASE5-QA.md`, nieuwe `decisions/0084`. Claude Code verifieert tegen de werkelijke code.

**Guardrails (zie `CLAUDE.md`)** — bevestig naleving van: RLS per `fonds_id` (alleen anon-key), append-only audit, human-in-the-loop, migratie-eerst-dan-deploy, snapshot-integriteit, geen schijnzekerheid. Specifiek voor deze opdracht:

- De inklapvoorkeur is **client-side UI-state** (`localStorage`) — geen serverstate, geen nieuwe tabel, geen governance-event. Als de implementatie hiervan afwijkt, is dat een besluit dat eerst voorgelegd moet worden.
- `npm run lint:colors` moet groen blijven. De guard (`scripts/check-brand-hex.mjs`) blokkeert legacy merk-hex, arbitrary-hex-classes én gemigreerde palette-classes inclusief `purple`/`violet`. De nieuwe accentkleur mag dus **uitsluitend** via de tokenlaag komen — geen `bg-violet-600`, geen `bg-[#5B4FE0]`.
- De theming-injectie in `app/(dashboard)/layout.tsx` (`dangerouslySetInnerHTML` met `themingCss`) en de allowlist in `core/lib/fonds-config-core.ts` blijven ongewijzigd. Alleen de basiswaarden veranderen.

**In te zetten subagents (zie `SUBAGENTS-ONTWERP.md` §4 trigger-matrix)** — `code-reviewer` (verplicht); `ontwerp-sync-reviewer` vóór merge (de tokenlaag-documenten beschrijven nu de oude waarden en lopen dus gegarandeerd uit de pas). `supabase-rls-reviewer` alleen inzetten als de inventarisatie van `fonds_theming` tot een datawijziging leidt; bij een pure leescontrole niet nodig. Geen migraties voorzien.

**Werkmodus** — begin in **Plan-modus**: lever eerst een implementatieplan (bestanden, RLS-impact = naar verwachting geen, migratie-impact = naar verwachting geen, testaanpak, risico's — waaronder expliciet: hoe de inklapstand zich verhoudt tot de bestaande mobiele drawer in `DashboardShell.tsx`, en welke bestaande `fonds_theming`-rijen door de nav-inversie geraakt worden). **Wijzig pas na expliciet akkoord.**

---

### Acceptatiecriteria

1. **Alleen waarden gewijzigd.** In `app/globals.css` zijn uitsluitend tokenwaarden aangepast; tokennamen, het RGB-channel-patroon en het `@layer components`-blok zijn identiek. `tailwind.config.ts` is ongewijzigd.
2. **Geen nieuwe kleuren buiten de tokenlaag.** `npm run lint:colors` is groen; de diff bevat geen nieuwe hex, geen arbitrary-hex-class en geen palette-class.
3. **Contrast aantoonbaar AA.** De tabel onder §"Tokenwaarden" is nagerekend tegen de geïmplementeerde waarden en opgenomen in `TOKENLAAG-FASE5-QA.md`. `--muted` haalt ≥4,5:1 op `app-bg`, `card` én `app-zebra`.
4. **Sidebar inklapbaar.** Hamburger klapt in en uit; in ingeklapte stand toont elk item zijn moduletitel als tooltip; de contentmarge beweegt mee zonder sprong; de voorkeur overleeft een herlaadbeurt. De bestaande mobiele drawer werkt ongewijzigd en interfereert niet.
5. **Iconen onderscheidbaar.** Alle elf modules zijn in ingeklapte stand zonder label van elkaar te onderscheiden; geen enkel icoon rendert als leeg blok of vervangingsteken.
6. **Tenant-theming gecontroleerd.** De bestaande rijen in `fonds_theming` zijn geïnventariseerd en per fonds is vastgesteld of de override nog werkt tegen de lichte navigatie. Twee concrete risico's expliciet nalopen:
   - een fonds dat `nav-rgb` naar een donkere waarde overschrijft, erft het nieuwe **lichte** `nav-text-rgb` en krijgt onleesbare menu-items — `--nav-active` staat namelijk **niet** in de allowlist (`THEMABARE_TOKENS`) en kan dus niet per fonds worden meegekleurd;
   - een fonds met een lichte `accent-rgb` (gekozen om op te lichten tegen het oude donkere navy) verdwijnt nu tegen wit.
   Bevindingen rapporteren; correctie alleen na akkoord.
7. **Visuele QA doorlopen.** De schermchecklist uit `TOKENLAAG-FASE5-QA.md` §"Visuele checklist per scherm" is afgevinkt, met bijzondere aandacht voor de schermen waar `--phase` betekenis draagt (procedures: fase-markers, dissent; vergaderingen: "oordeelsvorming"-badge).
8. **Geen functionele wijziging.** Geen wijziging in governance-events, RLS-policies, migraties, API-contracten of de moduleregistry-logica (alleen het `icon`-veld).
9. **Verificatie groen.** `./node_modules/.bin/tsc --noEmit --skipLibCheck`, `npm run lint:colors`, `npm run sanity` en `bash scripts/cross-tenant-ci.sh` zijn groen. De cross-tenant-suite draait als regressiecontrole: de opdracht raakt de theming-keten conceptueel, ook al wijzigt die code niet.

---

### Besluitpunten voor `decisions/0084`

Deze tranche bevat twee keuzes die een besluitregistratie vergen. Laatste bestaande entry is `0083`; verifieer het eerstvolgende vrije nummer.

1. **`--phase` verschuift van paars naar teal.** Fase 5 (commit `44afa61`) heeft `--phase` juist als eigen paarse token ingevoerd, expliciet onderscheiden van `accent`. Nu `accent` zelf paars wordt, vervalt dat onderscheid. Teal is gekozen omdat het de grootste hoekafstand houdt tot accent (violet), `ok` (groen) en `err` (rood). Gevolg: de betekenislaag "oordeelsvorming / in_evaluatie / dissent" krijgt een andere visuele drager dan bestuurders gewend zijn.
2. **De navigatie gaat van donker naar licht.** Het oorspronkelijke tokenlaag-plan koos een lichte, warme sidebar; bij implementatie is bewust gekozen voor "diep ink-navy chrome-frame". Deze tranche draait dat terug naar licht. Het plan waarschuwde destijds al: *"een lichte sidebar verankert visueel minder dan een donkere — zorg voor een duidelijke rechterrand en voldoende actief-contrast."* Borg dat expliciet via `nav-line` en het actieve item (`nav-active` + `border-nav-accent`), en noteer dit als bewust geaccepteerd effect.

Neem in beide gevallen ook de negatieve gevolgen op, conform `decisions/TEMPLATE.md` §Gevolgen.

---

**Definition of Done (zie `CLAUDE.md`)** — functionaliteit volgens bovenstaande acceptatiecriteria; RLS gecontroleerd (verwachting: geen impact, expliciet vaststellen); audit-logging aantoonbaar ongewijzigd; tests toegevoegd of gemotiveerd niet (verwachting: geen nieuwe unit-logica, dus motiveren); `tsc --noEmit --skipLibCheck` groen; `lint:colors` groen; `npm run sanity` groen; `bash scripts/cross-tenant-ci.sh` groen; tokenlaag-documentatie bijgewerkt (`TOKENLAAG-REFACTOR-PLAN.md`, `TOKENLAAG-FASE5-QA.md`) + ontwerp-sync-check groen; tech-stack-alinea in `HANDOVER.md` bijgewerkt (die noemt nu `#234E70` en "navigatie diep ink-navy"); `HANDOVER.md` release-historie aangevuld; `decisions/0084` aangemaakt.

**Documentatiehaak** — dit is een **kleine release** zonder architectuur-, data-, security- of tenant-impact. Volgens `CLAUDE.md` volstaat daarmee `HANDOVER.md` + de decision-entry; een volledige actualisatie van de `00–09`-set en de as-built Word-doc is **niet** aan de orde. Werk de marker in `00 Overzicht en status/doc-actualisatie-log.md` dus **niet** bij. Mocht de tenant-inventarisatie (criterium 6) alsnog tot een datawijziging leiden, dan verandert die weging — leg dat dan expliciet voor.

**Terugkoppeling** — rapporteer in het antwoordformat uit `CLAUDE.md` (samenvatting, aangepaste bestanden, RLS/security-impact, audit-impact, datamodel/migratie-impact, test/verificatie, openstaande risico's). Neem daarin op: (a) de nagerekende contrasttabel tegen de daadwerkelijk toegepaste waarden, (b) de uitkomst van de `fonds_theming`-inventarisatie per fonds, en (c) een korte voor/na-observatie van de sidebar in uitgeklapte én ingeklapte stand.
