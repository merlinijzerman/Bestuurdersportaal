# 0194 — Nightly fidelity fail-closed als operationeel signaal

- **Status:** Geaccepteerd — fail-closed en GitHub-issuemelding bewezen; DB-doelstrategie herzien door besluit 0195
- **Datum:** 2026-08-28
- **Betrokkenen:** Merlin (opdracht), Codex (uitvoering)
- **Herziet:** het niet-blokkerende skip-/`continue-on-error`-deel van besluit 0046; optie A en de PR-gates blijven ongewijzigd

## Context

De gehoste optie-B-run uit besluit 0046 moest configuratiedrift zichtbaar maken, maar kon met `continue-on-error` rood worden zonder een rood jobsignaal. Zonder `TEST_DATABASE_URL` viel het script bovendien terug op alleen de app-laag en eindigde de bedoelde DB-fidelitycontrole groen zonder databasebewijs.

## Besluit

De scheduled/handmatige `nightly-fidelity`-job wordt fail-closed:

- geen `continue-on-error` op job of stap;
- een afzonderlijke preflight weigert ontbrekende, lege, onparseerbare en niet-PostgreSQL-URL's met uitsluitend de vaste categorieën `fidelity_config_missing` of `fidelity_config_invalid`;
- de suite krijgt `XTENANT_REQUIRE_DB=1` en mag de DB-laag dus niet overslaan;
- timeout en concurrency begrenzen de run;
- alleen na een volledig groene suite komt in de job summary te staan dat app- én DB-laag voltooid zijn;
- een contracttest leest de workflow als YAML en bewijst met een bewust verzwakte fixture dat verslapping wordt afgekeurd.
- een afzonderlijke job met uitsluitend `issues: write` opent of actualiseert na iedere niet-groene fidelityrun één herkenbaar GitHub-issue; de eerstvolgende groene run voegt herstelbewijs toe en sluit het issue.

De workflow blijft scheduled en is geen required PR-check. Rood blokkeert daarom geen pull request, maar is wel een operationeel incident dat volgens het runbook moet worden opgevolgd.

## Alternatieven

- **`continue-on-error` behouden en alleen waarschuwen:** verworpen; dit maskeert precies het fidelitysignaal.
- **Ontbrekende DB blijven behandelen als skip:** verworpen; een groen resultaat zonder DB-laag is geen fidelitybewijs.
- **Een extern meldkanaal toevoegen:** niet gekozen. De meldroute blijft binnen de repository via een automatisch beheerd GitHub-issue; daarvoor zijn geen webhook, persoonsgegevens of extra secrets nodig.
- **De gehoste run required maken voor PR's:** niet gekozen. Een gedeelde, externe testdatabase is hiervoor te veranderlijk; de ephemere optie-A-run blijft de mergegeschikte laag.

## Gevolgen

- Fouten in secretconfiguratie, bereikbaarheid, migraties, RLS of tenantgedrag zijn zichtbaar als rode nightlyrun.
- De database-URL wordt niet gelogd; alleen een vaste foutcategorie verschijnt.
- De oorspronkelijke generieke URL-controle kon Productie niet betrouwbaar herkennen; besluit 0195 vervangt dit door exacte binding aan Preview-ref, poolerhost en least-privilege gebruiker.
- Handmatige run [`#51`](https://github.com/merlinijzerman/Bestuurdersportaal/actions/runs/33160032080) op commit `2d7ae6f` stopte op 28 augustus 2026 vóór installatie en DB-aanroepen met uitsluitend `fidelity_config_missing`. Daarmee is fail-closed in de echte GitHub-omgeving bewezen.
- Historische constatering bij run #51: `TEST_DATABASE_URL` ontbrak. Dit secret en de aparte wegwerpdatabase zijn door besluit 0195 vervallen voor de nightlyroute.
- Handmatige run [`#52`](https://github.com/merlinijzerman/Bestuurdersportaal/actions/runs/33161616108) op commit `ff67a0b` bewees de meldroute: job `Nightly fidelity melden` werd groen en GitHub Actions werkte issue [`#217`](https://github.com/merlinijzerman/Bestuurdersportaal/issues/217) bij met uitsluitend run-, event-, branch- en commitmetadata. `OP-TST1` is daarmee gesloten.
- **Herziening 0195:** de ontbrekende wegwerp-DB is niet ingericht. Na expliciet akkoord gebruikt de nightly de bestaande vaste Preview uitsluitend via `drift_lezer`, met geforceerd read-only catalogusbewijs; de volledige muterende DB-gedragssuite blijft ephemeer. De historische runbewijzen hierboven blijven geldig voor fail-closed en melding.
- **Herstelbewijs:** run [#54](https://github.com/merlinijzerman/Bestuurdersportaal/actions/runs/33164927445) is volledig groen en heeft incident [#217](https://github.com/merlinijzerman/Bestuurdersportaal/issues/217) automatisch met herstelbewijs gesloten.

## Referenties

- `decisions/0046-cross-tenant-testsuite-testdb-strategie.md`
- `.github/workflows/nightly-fidelity.yml`
- `decisions/0195-vaste-preview-readonly-fidelity.md`
- `scripts/verify-preview-fidelity-env.mjs`
- `scripts/preview-fidelity-readonly.sh`
- `scripts/nightly-fidelity-workflow.test.mjs`
- `../08 Test en acceptatie/Geautomatiseerd testen/Runbooks/nightly-fidelity-opvolgen.md`
