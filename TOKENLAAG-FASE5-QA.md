# Fase 5 — palette→token migratie · QA-checklist

**Status:** gemerged + gepusht naar `main` (07-07-2026), commits `606391f` (palette→token) + `44afa61` (phase-token + guard-automatisering). Vercel-deploy loopt via push.
**Automatisch geverifieerd (groen):** `lint:colors` = 0 overtredingen · Tailwind genereert alle nieuwe token-utilities · tsc = geen nieuwe fouten (enige melding `@vercel/analytics` is pre-existing, sandbox-only) · WCAG-contrast van tint/ink-combinaties en beheer-nav narekend (zie onder).

Wat overblijft is **visuele QA** — niet automatiseerbaar. Loop onderstaande schermen na op de dev-server.

## Wat er is gewijzigd
- **1490 wijzigingen in 76 bestanden**: named Tailwind palette-classes (`text-gray-500`, `bg-red-50`, `text-emerald-800`, …) → tokens.
  - grijstinten → `ink`/`muted`/`line`/`app-line`/`app-line-strong`
  - rood/rose → `err(-tint/-ink)`, emerald/groen → `ok(-tint/-ink)`, amber/geel/oranje → `warn(-tint/-ink)`, blauw/indigo → `accent(-ink/-tint)`
- **Nieuwe tokens**: `--ok/err/warn-tint` (badge-achtergrond) en `--ok/err/warn-ink` (leesbare tekst op tint); `--phase(-tint/-ink)` voor de paarse fase-/oordeelsvormingsmarkers (commit `44afa61`).
- **Beheer-nav** (`platform/(beveiligd)/layout.tsx` + `Uitloggen.tsx`): blauwe topbalk → **donker navy chrome-frame** (`bg-nav`), gelijk aan de app-sidebar. Merkvierkant-contrastbug opgelost (was 1.00:1 → nu zichtbaar).
- **Guard** (`check-brand-hex.mjs`): blokkeert voortaan ook gemigreerde palette-classes.

## Contrast (WCAG AA) — bijgewerkt voor huisstijl tranche 1 (besluit 0084)

> De onderstaande tabel is **narekend tegen de daadwerkelijk toegepaste tokens** in
> `app/globals.css` (violet accent, teal fase, lichte nav). Alle 13 tekst/achtergrond-
> combinaties halen AA (≥4,5:1). De vorige tabel beschreef de oude (ink-navy) set en
> is vervangen.

| Combinatie | Ratio | Oordeel |
|---|---|---|
| `muted` op `app-bg` / `card` / `app-zebra` | 4.87 / 5.30 / 5.04 | ✅ |
| `ink` op `app-bg` | 15.88 | ✅ |
| wit op `accent` (knop / merkvierkant / avatar) | 5.77 | ✅ |
| `accent` als linktekst op `card` | 5.77 | ✅ |
| `accent-ink` op `accent-tint` | 6.95 | ✅ |
| `ok-ink` / `warn-ink` / `err-ink` op eigen tint | 5.12 / 5.40 / 5.85 | ✅ |
| `phase-ink` op `phase-tint` (teal) | 6.02 | ✅ |
| `nav-text` op `nav` (licht) | 5.95 | ✅ |
| `nav-text-active` op `nav` (licht) | 16.74 | ✅ |

> Let op: gebruik voor **statustekst** altijd `text-*-ink`, niet `text-*` (de default `warn`/`ok` als kleine tekst zakt onder 4.5:1).
>
> **`--muted` wijkt bewust af van de HTML-preview** (`100 106 136` i.p.v. `118 124 153`):
> de preview-waarde haalt 3,77 / 4,11 — onder AA en een regressie t.o.v. de oude 4,69.
> Omdat `text-muted` de meestgebruikte secundaire tekstkleur is, is de donkerder waarde leidend.
>
> **Niet meegenomen, wél opgemerkt (buiten scope):** de rand van invoervelden
> (`app-line-strong` op `card`) haalt **1,45:1** tegen de 3,0 die WCAG 1.4.11 voor
> UI-componenten vraagt. Dit is **geen regressie** (de oude set scoorde 1,59 en zakte
> ook al) — openstaand punt voor een latere tranche.

## Visuele checklist per scherm
Let telkens op: (a) statusbadges/pills — juiste kleur + leesbaar, (b) randen/scheidingen zichtbaar, (c) hover-states nog voelbaar, (d) geen "onzichtbare" grijs-op-grijs.

- [ ] Login (app) + Platform-login
- [ ] Beheer/back-office: **navy topbalk**, merkvierkant, uitlogknop, catalogus, rechten, contact-inbox, generieke bibliotheek
- [ ] Stuurinformatie / dashboard
- [ ] Klantbeeld (deelnemers, werkgevers, cohorten) — incl. maand-ontwikkeling grafiek
- [ ] Bibliotheek + zoeken
- [ ] Vergaderingen + agendapunten (let op de **teal** "oordeelsvorming"-badge — was paars, besluit 0084)
- [ ] Notulen + segmentbeheer
- [ ] Procedures (dossierstatus, dissent, aannames, readiness-ladder) — **teal** fase-markers (was paars, besluit 0084)
- [ ] Risicomatrix (pill-kleuren uit `risico-config.ts` — nu ok/warn/err-tint)
- [ ] Governance-log
- [ ] AI-assistent (onderbouwing, validatie)

## Openstaand besluit — afgehandeld / bewust niet gemigreerd
1. **Paars/violet** (~33×, procedures & vergaderingen): **BESLIST** → eigen `--phase`-token (tint/ink) toegevoegd en gemigreerd (commit `44afa61`). Betekenisdragende fase-kleur ("oordeelsvorming"/"in_evaluatie", dissent) blijft dus onderscheiden van `accent`. Guard blokkeert `purple/violet` nu ook. **Update huisstijl T1 (besluit 0084):** omdat `--accent` zelf violet werd, is `--phase` naar **teal** verschoven zodat het onderscheid met accent behouden blijft; de tokennaam en semantiek blijven gelijk.
2. **Cyan/chart-kleuren**: datavis-palet, expliciet buiten scope (zoals in het oorspronkelijke plan) — bewust níét geblokkeerd.

## Borging — geautomatiseerd (commit `44afa61`)
- `npm run lint:colors` groen. De guard draait nu automatisch via drie poorten:
  - **prebuild-gate**: `prebuild`→`lint:colors` blokkeert de Vercel-build bij een overtreding.
  - **git pre-commit hook**: `scripts/hooks/pre-commit` via `core.hooksPath` (gezet door `prepare` bij `npm install`); noodgeval-overslaan met `git commit --no-verify`.
  - **GitHub Actions CI**: `.github/workflows/lint-colors.yml` op elke push/PR.
