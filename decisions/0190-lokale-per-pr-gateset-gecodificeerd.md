# 0190 — Lokale per-PR-gateset gecodificeerd (incl. cross-tenant)

- **Status:** Geaccepteerd
- **Datum:** 2026-08-26
- **Betrokkenen:** Merlin IJzerman (opdrachtgever/eigenaar), Claude (analyse en uitwerking)

## Context

Bij het samenvoegen van P1b ([#166](https://github.com/merlinijzerman/Bestuurdersportaal/issues/166)) in de epic ging een **rode cross-tenant-check ongemerkt mee naar binnen**. P1b maakte `procedure_requirements.template_versie` NOT NULL, maar de gedragstoets `supabase/checks/2026_08_18_bewijsbinding.sql` voerde die kolom niet mee in zijn inserts; op de DB-laag van de §15 cross-tenant-suite gaf dat een NOT NULL-schending. Dat werd pas ontdekt tijdens P2, omdat de suite tussentijds niemand rood meldde.

Twee dingen kwamen samen. Ten eerste: bij de merge is gevraagd "de gates opnieuw te draaien", maar `scripts/cross-tenant-ci.sh` zat **niet** in de handmatige set die toen liep — en juist die check vangt tenantlekken en de DB-laag-invarianten. Ten tweede: de epic-stack wordt **bewust niet naar GitHub gepusht** tot P6 ([#171](https://github.com/merlinijzerman/Bestuurdersportaal/issues/171)). De GitHub-workflow `rls-cross-tenant.yml` draait weliswaar op elke push/pull_request, maar zonder push draait hij niet. De pre-merge-borging is in deze fase dus **lokaal**, en een lokale routine die alleen in iemands hoofd of in losse commando's bestaat, laat stil een check vallen.

## Besluit

De lokale per-PR/pre-merge-gateset wordt **gecodificeerd** in één entrypoint: `scripts/gates.sh` (`npm run gates`). Het bundelt de blokkerende set en spiegelt de GitHub-checks:

- `typecheck` (tsc),
- `sanity` (de `*.sanity.ts`-suites),
- `lint:colors` (merkkleur-hygiëne),
- `check-migratie-mapindeling.sh` (migrations/ bevat geen rollbacks/seeds),
- **`test:xtenant:ci` — de §15 cross-tenant-suite** (`scripts/cross-tenant-ci.sh`), incl. de DB-laag-gedragstoetsen (bewijsbinding, vaststelling-binding).

De DB-laag van de cross-tenant-suite draait écht mee zodra er een test-DB is (`TEST_DATABASE_URL=…`); zonder DB meldt de suite de DB-laag als overgeslagen — precies het gat dat dit besluit dicht, dus dat is een expliciete waarschuwing, geen stille skip. Draai de set vóór elke merge van een P-ticket in de epic.

## Overwogen alternatieven

- **Alleen op de GitHub-CI vertrouwen** — verworpen zolang de stack niet gepusht wordt: dan draait die CI niet, en juist dat is de situatie waarin het misging. Codificeren maakt de routine autoritatief onafhankelijk van waar hij draait.
- **De set als checklist in AGENTS.md/HANDOVER.md** — onvoldoende: een tekstchecklist is precies wat hier faalde. Een script faalt hard rood als een stap valt; proza niet.
- **Een pre-commit/pre-push git-hook die de volledige set draait** — verworpen als default: de cross-tenant DB-laag is te zwaar voor elke commit (vereist een test-DB/stack). De hook blijft `lint:colors`; `npm run gates` is de bewuste pre-merge-stap.

## Gevolgen

- Nieuw: `scripts/gates.sh`, npm-script `gates`. De cross-tenant-suite kan niet meer stil uit de set vallen — ze staat er met naam in en een ontbrekende DB is een zichtbare waarschuwing (`XTENANT_REQUIRE_DB=1` maakt 'm hard rood).
- De set is de lokale tegenhanger van de GitHub-gate; verandert de GitHub-gate, dan hoort deze set mee te bewegen (en omgekeerd).
- Herstel van het concrete incident: de `bewijsbinding.sql`-reconciliatie is teruggelegd bij de wijzigingen die haar veroorzaakten — `template_versie` als losse minifix op de epic (P1b-nazorg), de #160-indexcorrectie in PR-A ([#167](https://github.com/merlinijzerman/Bestuurdersportaal/issues/167)). Elke PR is daarmee weer op zichzelf groen.

## Referenties

- Script: `scripts/gates.sh`; suite: `scripts/cross-tenant-ci.sh`; workflow: `.github/workflows/rls-cross-tenant.yml`.
- Aanleiding: [[0188]] (P1b — template_versie NOT NULL), [[0189]] (#160-indexcorrectie in dezelfde tranche).
- EPIC [#164](https://github.com/merlinijzerman/Bestuurdersportaal/issues/164), P6 [#171](https://github.com/merlinijzerman/Bestuurdersportaal/issues/171).
