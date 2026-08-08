# 0142 — Monitoring: leeslimiet via server-side uitdunning, periodekeuze 24 u / 7 dagen

- **Status:** Geaccepteerd
- **Datum:** 2026-08-08
- **Betrokkenen:** Merlin IJzerman (product/opdrachtgever)
- **Raakt:** `platform/lib/monitoring-lees.ts`, `platform/lib/monitoring-signalen.ts` (`dunTrendUit`), het dashboard (P4-light tranche B, blok D)

## Context

De trendlezing (`haalMonitoringOverzicht`) las tot 4000 snapshotrijen over een venster van zeven dagen. De rekensom klopt niet met die belofte: uptime schrijft 288 rijen per dag (platformbreed), de vier kwartiersignalen 4×96 en de drie uursignalen 3×24 **per fonds** — samen ± 744 rijen per dag bij één fonds, dus ± 5200 over zeven dagen. Dat is al méér dan 4000: de trend was bij één fonds al stil afgekapt op ± 5,4 dagen, terwijl de comment uitging van "vanaf twee fondsen". De periodekeuze zou dat zichtbaar maken en verergeren.

Tegelijk moet de payload naar de **client** begrensd blijven: het herontwerp filtert fonds en periode client-side (besluit dat het auditspoor niet met weergavehandelingen vervuilt), dus de langste periode wordt één keer gelezen en de kortere periode is een filter op diezelfde data.

## Besluit

1. **De trend wordt server-side uitgedund tot ten hoogste één punt per klokuur** (`dunTrendUit`) vóórdat de data de client bereikt. Zo blijft de payload begrensd (7 dagen → ≤168 punten per reeks) zonder een databaseobject en zonder de laatste stand te raken (die komt uit de nieuwste ruwe rij, niet uit de uitgedunde reeks).
2. **De server-side leescap gaat omhoog** naar een ruime waarde die een week over meerdere fondsen dekt. Dit is een leescap, geen client-payload: de uitdunning bepaalt wat de client krijgt.
3. **De bestaande `trendAfgekapt`-melding blijft leidend**, en het dashboard toont voortaan het **werkelijk gedekte aantal dagen** (`gedekteDagen`) in plaats van de gevraagde periode.
4. **De periodekeuze is 24 uur / 7 dagen** (standaard 7 dagen). Geen 30/90 dagen en geen vrije datumkeuze in deze tranche: 30/90 dagen vraagt een dagaggregaat in de database (datamodelimpact), en een datumkiezer suggereert een precisie die de meetvensters niet hebben.
5. **Bovengrens voor een latere periode-uitbreiding is de retentie van 180 dagen** (besluit [`0104`](./0104-retentie-app-errors-en-snapshots.md)): een periode die verder terugkijkt dan de retentie mag niet aanklikbaar zijn, want dan toont hij stilzwijgend minder.

## Overwogen alternatieven

- **Alleen de leeslimiet verhogen.** Verworpen als eindoplossing: dan gaat de volledige ruwe reeks mee naar de client, wat bij meer fondsen snel groeit.
- **Een SQL-view of dagaggregaat.** Dat is een databaseobject → documentatiehaak vuurt, gates A–H verplicht. Bewust uitgesteld naar de tranche die 30/90 dagen toevoegt; bij meer dan een handvol fondsen is dit de logische vervolgstap, niet een nóg hogere limiet.
- **Server-navigatie per periodeklik.** Verworpen: elke klik zou een extra auditpaar en databaselezing opleveren op precies de tabel die signaal 14 bewaakt.

## Gevolg

De periodekeuze herberekent de meting niet (het venster zit in de meting en wordt meegestempeld); ze bepaalt de lengte van de trendlijnen en de basis onder de periodesamenvatting. Ze raakt de ketenstatusbalk, de laatste stand en de status per rij niet — die gaan over "nu".
