# Fase 5 — palette→token migratie · QA-checklist

**Branch:** `feature/tokenlaag-fase-5-palette` (commit 606391f, 1 vóór op `main`)
**Automatisch geverifieerd (groen):** `lint:colors` = 0 overtredingen · Tailwind genereert alle nieuwe token-utilities · tsc = geen nieuwe fouten (enige melding `@vercel/analytics` is pre-existing, sandbox-only) · WCAG-contrast van tint/ink-combinaties en beheer-nav narekend (zie onder).

Wat overblijft is **visuele QA** — niet automatiseerbaar. Loop onderstaande schermen na op de dev-server.

## Wat er is gewijzigd
- **1490 wijzigingen in 76 bestanden**: named Tailwind palette-classes (`text-gray-500`, `bg-red-50`, `text-emerald-800`, …) → tokens.
  - grijstinten → `ink`/`muted`/`line`/`app-line`/`app-line-strong`
  - rood/rose → `err(-tint/-ink)`, emerald/groen → `ok(-tint/-ink)`, amber/geel/oranje → `warn(-tint/-ink)`, blauw/indigo → `accent(-ink/-tint)`
- **Nieuwe tokens**: `--ok/err/warn-tint` (badge-achtergrond) en `--ok/err/warn-ink` (leesbare tekst op tint).
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

## Openstaand besluit — bewust niet gemigreerd
1. **Paars/violet** (~33×, procedures & vergaderingen): betekenisdragende fase-kleur ("oordeelsvorming"/"in_evaluatie", dissent). Naar `accent` mappen zou de betekenis wegvagen. Keuze: (a) eigen token `--phase`/`--eval` toevoegen, of (b) laten staan. Guard blokkeert paars nu **niet**.
2. **Cyan/chart-kleuren**: datavis-palet, expliciet buiten scope (zoals in het oorspronkelijke plan).

## Borging
- `npm run lint:colors` handmatig groen. **Nog te doen**: aan CI of een pre-commit hook hangen (er is geen `.github/workflows` / husky) — anders vangt de guard pas bij een handmatige run.
