# 0144 — Ingest-doorlooptijd = `eind − aangemaakt` (inclusief wachttijd), niet `eind − start`

- **Status:** Geaccepteerd
- **Datum:** 2026-08-08
- **Betrokkenen:** Merlin IJzerman (product/opdrachtgever)
- **Raakt:** `platform/lib/monitoring-signalen.ts` (`ingestDuren`), `platform/lib/monitoring-queries.ts` (`meetIngestDoorlooptijdP95`), nieuw signaal `ingest_doorlooptijd_p95`

## Context

Het nieuwe signaal `ingest_doorlooptijd_p95` meet hoe lang een document erover doet om doorzoekbaar te worden. Er zijn twee klokken:

- **`eind − aangemaakt`** = de ketenduur die de gebruiker ervaart, **inclusief** de wachttijd in de wachtrij;
- **`eind − start`** = alleen de rekentijd, exclusief wachttijd.

`eind − start` poetst de wachttijd juist weg op het moment dat de wachtrij vol staat — precies de verkeerde kant op, en dezelfde fout als het meten van alleen de eindgeneratie bij de AI-latency.

Daarbij zijn er randgevallen die een p95 stil vervalsen: `Number(null) === 0` is finiet en niet-negatief, dus een job zonder `start` of `eind` zou een doorlooptijd van 0 of "nu − 1970" opleveren (de faalvorm uit `MONITORING-P5-ONTWERP.md` §13). En `overgeslagen` jobs zijn niet verwerkt en horen niet in de doorlooptijd.

## Besluit

1. **De doorlooptijd is `eind − aangemaakt`** (inclusief wachttijd). De **rekentijd** (`eind − start`) gaat als tweede getal in `meta.rekentijd_p95_ms`, zodat de decompositie zichtbaar is — het verschil tussen beide is de wachttijd.
2. **Expliciet gefilterd** (in de pure `ingestDuren`, met sanity-negatiefcontrole): jobs met status `overgeslagen`, jobs zonder `start`/`eind`/`aangemaakt`, en negatieve duur (klok-anomalie).
3. **Betekenisdrempel, geen privacydrempel.** Onder **vijf** afgeronde jobs geen percentiel — een p95 over drie documenten is de traagste van drie. Dit staat los van de n-drempel uit besluit [`0055`](./0055-n-drempel-bij-gebruikssignalen.md): C3 leunt op documenten, niet op bestuurders. De UI toont hiervoor een eigen reden ("te weinig waarnemingen voor een percentiel"), zichtbaar onderscheiden van een `n<10`-onderdrukking.
4. **Dekkingsvoorbehoud:** meet de ketenduur, niet de rekentijd; op het generieke-bibliotheekpad bestaan per-stap-jobs, op het fondspad één job voor de hele keten, dus een uitsplitsing per fase is niet platformbreed beschikbaar.

## Overwogen alternatieven

- **`eind − start` (rekentijd).** Verworpen: verbergt de wachttijd precies wanneer die het meest knelt.
- **De n-drempel (0055) hergebruiken voor de betekenisdrempel.** Verworpen: dat verwatert waar 0055 voor staat (privacy) en zou de UI-reden ten onrechte als privacymaatregel laten lezen.

## Gevolg

De doorlooptijd volgt aantoonbaar de wachttijd (sanity-fixture met lange wachttijd, korte rekentijd). Samen met `ingest_stilstand` (besluit apart in dezelfde tranche) dicht dit het detectiegat dat een stilgevallen worker onzichtbaar liet zolang er minder dan tien documenten wachtten.
