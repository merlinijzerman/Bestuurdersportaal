# mvp/ — codebase + werkdocumentatie Bestuurdersportaal

**Laatst bijgewerkt:** 2026-08-28

## Wat deze map is

Deze map bevat **twee dingen tegelijk**:

1. **De codebase** van het Bestuurdersportaal — Next.js 15 (App Router) + Supabase (EU-Frankfurt) + Vercel, met Anthropic (AI-antwoorden), Mistral (embeddings + OCR) en Mailgun (contactnotificaties). Zie `SETUP.md` voor lokaal draaien.
2. **De werkdocumentatie** die met de code meebeweegt: `HANDOVER.md` (levend masterdocument), `CLAUDE.md` (werkinstructies en guardrails), de `*-ONTWERP.md`-documenten, `decisions/` en de securityplannen (`SECURITY-ROUTE-A-*.md`).

**Bron-van-waarheid-hiërarchie** (vastgelegd in `CLAUDE.md`): code + `supabase/migrations/` > `HANDOVER.md` > ontwerpdocumenten. `supabase/schema.sql` is documentatie en mag achterlopen.

## MVP-documenten (in deze map)

| Document | Inhoud |
|---|---|
| `mvp-definitie.md` | Wat de MVP is, wat hij aantoont en voor wie |
| `mvp-scope.md` | Binnen/buiten scope met status per onderdeel |
| `mvp-functionaliteiten.md` | Functionaliteitenoverzicht per module met status en bron |
| `mvp-beperkingen.md` | Bekende beperkingen + noodzakelijke stappen richting productiegeschiktheid |
| `mvp-demo-script.md` | Eerlijk, stapsgewijs demoscript langs de werkende functionaliteit |
| `mvp-acceptatiecriteria.md` | Toetsbare acceptatiecriteria per module + as-built status |

## Documentatiestructuur (bovenliggende mappen)

De gecureerde projectdocumentatie staat één niveau hoger, in de map "MVP bestuurdersportaal":

- `00 Overzicht en status` — statusbeeld per module, changelog, documentindex
- `01 Strategie en aanpak` — productvisie, doelgroepen, positionering, scope-en-afbakening
- `02 Architectuur` — as-is architectuur, AI-assistent FO/TO, AI-governance
- `03 Functioneel ontwerp` / `04 Technische inrichting` — ontwerpen en werkopdrachten per increment
- `05 Security en compliance` — as-is security, Route A
- `06 Roadmap` — `roadmap-overzicht.md`, `releaseplanning.md`, `backlog.md`, `releasehistorie.md`, `later-optimalisaties.md`
- `07 Compliance, privacy en juridisch` — DPIA-opzet, verwerkersregister
- `08 Test en acceptatie`, `09 Objectenmodel`, `Archief`

## Actuele status (samengevat, per 04-07-2026)

> **Aanvulling 02-08-2026:** de map `promo/` bevat sinds eind juli de bouwstraat voor de promovideo (drie varianten, Playwright-opnames, overlay-renderers, `montage.sh`) met een eigen `promo/HANDOVER.md`. Variant C staat sinds 2 augustus **live op de homepage** (besluit 0103); de gepubliceerde webversie zelf staat in `public/video/`. Let op: de bron- en audiobestanden in `promo/` zijn groot en vallen deels buiten `.gitignore` — zie `00 Overzicht en status/openstaande-punten-en-risicos.md` OP-E5.

Werkend en demonstreerbaar MVP (zie `mvp-functionaliteiten.md`); **niet productiegeschikt** — open punten: Route A-restpunten, ontbrekende browser-/componenttests, nog beperkte coverage, Mailgun-sandbox en compliance-acties. Zie `mvp-beperkingen.md` en `../06 Roadmap/backlog.md`.

## Geautomatiseerd testen

Gebruik Node 22 (`.nvmrc` en `engines.node`). Na `npm ci` zijn dit de centrale ingangen:

```bash
npm test               # snelle lokale unit- en contractsuites
npm run test:unit      # resterende sanitysuites + Vitest-applicatietests
npm run test:vitest    # alleen de gemigreerde Vitest-suites + pariteitsgate
npm run test:coverage  # informatieve V8-coverage voor geselecteerde productiecode
npm run test:contract  # tenant-, seed- en workflowcontracten zonder DB
npm run test:ops       # back-up/restore, platforminventory en scanner
npm run test:ci        # provider- en database-onafhankelijke PR-set
```

`npm run test:xtenant:ci` blijft de ingang voor de volledige app- en DB-laag. Zet daarbij `XTENANT_REQUIRE_DB=1` en gebruik uitsluitend een wegwerpbare testdatabase, nooit Productie. Bedieningsdetails en actueel bewijs staan in `../08 Test en acceptatie/Geautomatiseerd testen/`.
