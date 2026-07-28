# 0084 — Huisstijl tranche 1: violet accent, teal fase-token, lichte navigatie

- **Status:** Geaccepteerd
- **Datum:** 2026-07-28
- **Betrokkenen:** opdrachtgever (plansessie), Claude Code (uitvoering)

## Context

Het portaal krijgt een modernere, lichtere uitstraling zonder wijziging van de
schermopzet. Tranche 1 vervangt uitsluitend de **waarden** in de bestaande
tokenlaag (`app/globals.css`), maakt de sidebar inklapbaar en vernieuwt de
module-iconen. Twee waardewijzigingen raken echter een eerder bewust genomen
besluit en vergen daarom een eigen registratie:

1. **Fase 5 (commit `44afa61`)** voerde `--phase` in als *eigen paarse* token,
   expliciet onderscheiden van `--accent` (toen editorial-blue `#234E70`). De
   fase-kleur draagt betekenis: "oordeelsvorming"/"in_evaluatie" en dissent
   (procedures, vergaderingen).
2. Het oorspronkelijke tokenlaag-plan (`TOKENLAAG-REFACTOR-PLAN.md`) koos een
   lichte, warme sidebar; bij implementatie is bewust gekozen voor een **diep
   ink-navy** chrome-frame (`--nav-rgb: 18 42 64`).

Randvoorwaarden: geen dark mode (blijft buiten scope), tokennamen/structuur
ongewijzigd, contrast aantoonbaar WCAG AA, en de per-fonds theming-allowlist
(`THEMABARE_TOKENS`) blijft ongewijzigd.

## Besluit

1. **`--accent` wordt violet** (`91 79 224`); daardoor vervalt het kleur­onderscheid
   met het paarse `--phase`. **`--phase` verschuift naar teal** (`14 124 155`),
   omdat teal de grootste hoekafstand houdt tot accent (violet), `ok` (groen) en
   `err` (rood) en zo als betekenislaag onderscheidbaar blijft.
2. **De navigatie gaat van diep ink-navy naar licht** (`--nav-rgb: 251 251 254`),
   met donkere navtekst (`--nav-text-rgb: 90 96 128` inactief, `23 26 40` actief)
   en violet als accent/actief-markering. Verankering wordt geborgd via de
   rechterrand (`--nav-line`) en het actieve item (`--nav-active` +
   `border-nav-accent`), conform de waarschuwing uit het oorspronkelijke plan dat
   een lichte sidebar visueel minder verankert dan een donkere.

## Overwogen alternatieven

- **`--phase` paars laten en accent níét violet maken** — verworpen: de nieuwe
  huisstijl is juist violet-gedreven; twee bijna-gelijke paarsen naast elkaar
  vernietigt het betekenisonderscheid.
- **`--phase` naar een tweede blauw/indigo** — verworpen: te dicht bij violet
  accent; onvoldoende hoekafstand.
- **Navigatie donker houden** — verworpen: strijdig met de gevraagde lichtere
  uitstraling van tranche 1.
- **`--nav-active` themabaar maken (allowlist uitbreiden)** — buiten scope
  gelaten: raakt de theming-keten en vergt een aparte security-afweging.

## Gevolgen

- **Betekenislaag verandert van drager.** Bestuurders die de paarse
  "oordeelsvorming"/dissent-markering gewend zijn, zien die nu in teal. Puur
  visueel; de semantiek en de tokennaam (`--phase*`) blijven identiek.
- **Contrast blijft AA.** Alle 13 gecontroleerde tekst/achtergrond-combinaties
  halen ≥4,5:1 tegen de daadwerkelijk toegepaste waarden (zie
  `TOKENLAAG-FASE5-QA.md`). `--muted` is bewust donkerder dan de HTML-preview
  (`100 106 136` i.p.v. `118 124 153`) om een regressie onder AA te vermijden.
- **Tenant-theming.** De inversie van de nav (donker → licht) raakt fondsen die
  via `fonds_theming` een *donkere* `nav-rgb` overschrijven zónder óók
  `nav-text-rgb`/`nav-text-active-rgb` te zetten: die erven nu donkere navtekst op
  een donker vlak → onleesbaar. In de repo betreft dit uitsluitend de **fictieve
  Meridiaan-demoseed** (`supabase/migrations/2026_07_09_t8_demo_fonds_seed.sql`;
  geen auth-gebruikers, "verwijderen vóór productie"). Op akkoord van de
  opdrachtgever **gecorrigeerd** via een aparte idempotente migratie
  (`2026_07_28_huisstijl_t1_meridiaan_nav_text.sql` + ROLLBACK): Meridiaan krijgt
  lichte navtekst afgestemd op zijn donkergroene nav (`nav-text-rgb 190 205 197`
  = 7,48:1, `nav-text-active-rgb 244 248 245` = 11,51:1 — beide AA). `--nav-active`
  staat níét in `THEMABARE_TOKENS` en blijft dus voor alle fondsen het globale
  (violet-9%) actief-vlak.
- **Hover-verankering (code-review-bevinding).** Op de lichte nav gaf
  `hover:bg-nav-line/40` te weinig contrast; de nav-hovers gebruiken nu de volle
  lijnkleur `hover:bg-nav-line` (bestaand token, geen nieuwe class) — een nette
  grijs-hover die ook op een donkere tenant-nav zichtbaar blijft.
- **Tailwind content-globs (bewuste afwijking van "tailwind.config.ts ongewijzigd").**
  De inklapbare sidebar verhuisde `md:ml-64` naar `core/components/` en introduceerde
  `md:w-14`/`md:ml-14`. Die classes werden niet gegenereerd omdat `tailwind.config.ts`
  sinds de T9-splitsing (besluit 0052) `core/`/`platform/`/`fondsen/` niet scande —
  een latente bug die deze tranche blootlegde. `core/**`, `platform/**` en `fondsen/**`
  zijn aan de content-globs toegevoegd (zelfde roots als de kleur-guard). Additief:
  het genereert alleen ontbrekende classes, verwijdert niets.
- **Geen dark mode.** RLS-/policy-model ongewijzigd. De Meridiaan-correctie is een
  cosmetische data-UPDATE op één bestaande, RLS-beschermde rij en produceert één
  append-only config-auditregel (versie 1→2). Verder: alleen tokenwaarden + UI-state
  (inklap-voorkeur in `localStorage`).

## Referenties

- `app/globals.css` (`:root`-tokenwaarden)
- `TOKENLAAG-REFACTOR-PLAN.md`, `TOKENLAAG-FASE5-QA.md`
- `decisions/0078` (stuurinformatie-opmaaklaag), fase 5-commits `606391f` / `44afa61`
- `core/lib/fonds-config-core.ts` (`THEMABARE_TOKENS`-allowlist, ongewijzigd)
