# 0196 — Vitest als standaard voor nieuwe applicatietests

- **Status:** Geaccepteerd — lokaal en gehost bewezen in PR #219
- **Datum:** 2026-08-28
- **Betrokkenen:** Merlin (opdracht en akkoord op uitvoering), Codex (uitvoering)
- **Scope:** applicatietests in TypeScript; geen database-, RLS- of productielogicawijziging

## Context

De repository had veel waardevolle, los met `tsx` uitgevoerde
`*.sanity.ts`-suites, maar geen applicatietestrunner met filtering, parallelle
planning, gestandaardiseerde rapportage of coverage. WP1 vergelijkt daarom vijf
representatieve suites op dezelfde commit: pure logica, datagedreven gevallen,
foutpaden, async evaluatielogica en bron-/structuurinspectie.

## Besluit

1. Vitest 4.1.11 met V8-coverage is de standaard voor nieuwe pure
   applicatie-unit- en, vanaf WP2, componenttests.
2. De Node-omgeving is de default. DOM/browserglobals worden pas in het
   afzonderlijke WP2-harnas toegevoegd.
3. Bestaande standalone sanitysuites worden niet massaal gemigreerd. Migratie
   gebeurt bij inhoudelijke aanraking in batches van ongeveer 5–15 suites,
   steeds met aantoonbare testcasepariteit.
4. `node:test` blijft leidend voor cross-tenant-, workflow-, operationele en
   andere scriptcontracten die zelfstandig buiten Vitest moeten kunnen draaien.
5. Coverage is in WP1 informatief: regels, branches, functies en statements
   worden afzonderlijk gerapporteerd, zonder globale drempel. Een eventuele
   changed-linespoort krijgt pas na minimaal twee weken baseline een eigen
   besluit.
6. `vitest.config.mts` is bewust ESM-configuratie naast de CommonJS-package;
   daarmee wordt de Vite-configloaderwaarschuwing vermeden zonder het hele
   projectmodulemodel te wijzigen.

## Bewijs

- Voor en na migratie: exact 5 suites en 127 cases (11, 80, 5, 17 en 14).
- De pariteitsgate pint per suite het aantal cases én de SHA-256 van de
  gesorteerde testnamen.
- Een tijdelijk kapotte assertion maakte zowel `npm run test:unit` als
  `npm test` rood met exitcode 1; de wijziging is daarna hersteld.
- Gemeten geselecteerde runnerprocessen op dezelfde commit:
  - oude runner: cold 0,88 s, warm 0,45 s, vijf opeenvolgende Node-processen;
  - Vitest: cold 0,89 s, warm 0,57 s, één coördinator met maximaal vijf
    workerthreads.
- De eerste geselecteerde baseline is 85,17% regels, 76,23% branches, 85,14%
  functies en 84,91% statements. Deze cijfers zijn geen kwaliteitsclaim over
  de gehele applicatie.
- CI bewaart console-, JSON-, JSON-summary- en LCOV-uitvoer veertien dagen. De
  samenvatting en het artifact draaien met `always()`, terwijl de teststap zelf
  blokkerend blijft.
- Hosted security-baselinerun
  [#33167751627](https://github.com/merlinijzerman/Bestuurdersportaal/actions/runs/33167751627)
  is groen op Node 22. Het gedownloade artifact `vitest-coverage` bevatte alle
  vier rapportagevormen en exact dezelfde baseline als lokaal.

De runtime-steekproef is klein en laat nog geen versnelling zien. De keuze is
daarom gebaseerd op beheersbaarheid, diagnostiek, filtering, coverage en
opschaalbaarheid; WP5 meet de totale CI-doorlooptijd opnieuw.

## Alternatieven

- **Alle sanitysuites ineens migreren:** verworpen wegens groot reviewoppervlak
  en onnodig regressierisico.
- **De shellrunner uitbreiden met coverage:** verworpen; dit dupliceert
  testselectie, rapportage en workerplanning.
- **Alle tests naar Vitest verplaatsen:** verworpen; zelfstandige
  contracttests en operationele scripts hebben baat bij de ingebouwde,
  runneronafhankelijke `node:test`-laag.

## Gevolgen en rollback

- `npm test` voert de resterende sanitysuites, de vijf Vitest-suites en de
  contracttests uit.
- Nieuwe applicatietests gebruiken `*.test.ts`; bestaande `*.sanity.ts` blijft
  geldig totdat een gecontroleerde migratie plaatsvindt.
- Rollback is beheersbaar: zet de vijf bestanden terug naar `*.sanity.ts`, haal
  de Vitest-opdracht uit `test:unit` en verwijder config/dependencies. Er is
  geen productiedata, schema of applicatiegedrag terug te draaien.

## Referenties

- `vitest.config.mts`
- `scripts/verify-vitest-parity.mjs`
- `scripts/run-sanity.mjs`
- `scripts/render-vitest-coverage-summary.mjs`
- `.github/workflows/security-baseline.yml`
- projectdocument `08 Test en acceptatie/Geautomatiseerd testen/Resultaten/coveragebaseline-2026-08-28.md`
