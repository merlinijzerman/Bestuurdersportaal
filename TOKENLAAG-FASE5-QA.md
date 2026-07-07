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

## Contrast (WCAG AA, reeds narekend)
| Combinatie | Ratio | Oordeel |
|---|---|---|
| `*-ink` tekst op `*-tint` (ok/err/warn) | 6.2–7.3:1 | ✅ ruim |
| statustekst op app-bg (`-ink` gebruikt) | ≥5:1 | ✅ |
| beheer email `nav-text` op `bg-nav` | 6.9:1 | ✅ |
| beheer titel `nav-text-active` op `bg-nav` | 13.6:1 | ✅ |
| witte "P" op `nav-accent` vierkant | 4.4:1 | ✅ groot/bold (= app-sidebar) |

> Let op: gebruik voor **statustekst** altijd `text-*-ink`, niet `text-*` (de default `warn`/`ok` als kleine tekst zakt onder 4.5:1).

## Visuele checklist per scherm
Let telkens op: (a) statusbadges/pills — juiste kleur + leesbaar, (b) randen/scheidingen zichtbaar, (c) hover-states nog voelbaar, (d) geen "onzichtbare" grijs-op-grijs.

- [ ] Login (app) + Platform-login
- [ ] Beheer/back-office: **navy topbalk**, merkvierkant, uitlogknop, catalogus, rechten, contact-inbox, generieke bibliotheek
- [ ] Stuurinformatie / dashboard
- [ ] Klantbeeld (deelnemers, werkgevers, cohorten) — incl. maand-ontwikkeling grafiek
- [ ] Bibliotheek + zoeken
- [ ] Vergaderingen + agendapunten (let op **paarse** "oordeelsvorming"-badge, zie open punt)
- [ ] Notulen + segmentbeheer
- [ ] Procedures (dossierstatus, dissent, aannames, readiness-ladder) — **paarse** fase-markers
- [ ] Risicomatrix (pill-kleuren uit `risico-config.ts` — nu ok/warn/err-tint)
- [ ] Governance-log
- [ ] AI-assistent (onderbouwing, validatie)

## Openstaand besluit — afgehandeld / bewust niet gemigreerd
1. **Paars/violet** (~33×, procedures & vergaderingen): **BESLIST** → eigen `--phase`-token (tint/ink) toegevoegd en gemigreerd (commit `44afa61`). Betekenisdragende fase-kleur ("oordeelsvorming"/"in_evaluatie", dissent) blijft dus onderscheiden van `accent`. Guard blokkeert `purple/violet` nu ook.
2. **Cyan/chart-kleuren**: datavis-palet, expliciet buiten scope (zoals in het oorspronkelijke plan) — bewust níét geblokkeerd.

## Borging — geautomatiseerd (commit `44afa61`)
- `npm run lint:colors` groen. De guard draait nu automatisch via drie poorten:
  - **prebuild-gate**: `prebuild`→`lint:colors` blokkeert de Vercel-build bij een overtreding.
  - **git pre-commit hook**: `scripts/hooks/pre-commit` via `core.hooksPath` (gezet door `prepare` bij `npm install`); noodgeval-overslaan met `git commit --no-verify`.
  - **GitHub Actions CI**: `.github/workflows/lint-colors.yml` op elke push/PR.
