# 0141 — Monitoringdashboard: aggregatie over fondsen uitsluitend op statussen

- **Status:** Geaccepteerd
- **Datum:** 2026-08-08
- **Betrokkenen:** Merlin IJzerman (product/opdrachtgever)
- **Raakt:** `platform/lib/monitoring-signalen.ts` (`aggregeerStatus`, `samenvattingPerDomein`, `kiesSlechtsteMeting`), het driedelige dashboard (P4-light tranche B, blok A)

## Context

Het herontworpen monitoringdashboard toont één rij per signaal en één ketenstatusbalk met vier domeintegels. Beide vragen om aggregatie over fondsen: de balk vat "hoeveel van de metingen wijken af" samen, en een rij bij "Alle fondsen" toont de slechtste status over de fondsen.

Aggregeren is hier een privacyval, geen cosmetische keuze. Zou er ergens over **waarden** worden geaggregeerd — een gemiddelde latency over fondsen, een som van rate-limit-incidenten — dan omzeilt dat de n-drempel uit besluit [`0055`](./0055-n-drempel-bij-gebruikssignalen.md): twee fondsen met n=6 worden samen n=12 en de suppressie is uitgehold, terwijl het dashboard blijft beweren dat de drempel geldt. Precies de signalen waar de drempel voor bedoeld is (gebruikssignalen) zouden zo per ongeluk toch een herleidbaar getal tonen.

Daarnaast is een groen gemiddelde over een rood fonds de klassieke dashboardleugen, en mag `onbekend` (verouderd of onderdrukt) nooit als groen meetellen.

## Besluit

1. **Er wordt nooit over waarden geaggregeerd, alleen over statussen.** De aggregatiefuncties (`aggregeerStatus`, `samenvattingPerDomein`) nemen uitsluitend `SignaalStatus` in; er is geen parameter waarlangs een getal de aggregatie in kan.
2. **Slechtste status wint**, met de ordening `rood > oranje > onbekend > groen`. Een lege verzameling is `onbekend`, nooit groen.
3. **`onbekend` telt nooit als groen** en verschijnt in een eigen teller (naast "afwijkend"), niet in de noemer van "in orde".
4. **De representatieve rij bij "Alle fondsen" is deterministisch**: `kiesSlechtsteMeting` kiest de slechtste status en breekt gelijke status op de laagste fondsnaam, zodat twee renders hetzelfde fonds tonen.
5. Deze regels leven als **pure functies** en zijn met **negatieve controles** in `monitoring-signalen.sanity.ts` vastgelegd (acceptatiecriteria 11 en 6), niet als codereview-opmerking.

## Overwogen alternatieven

- **Waarde-aggregaten tonen ("gemiddelde latency over alle fondsen").** Verworpen: holt de n-drempel uit en is bij MVP-fondsaantallen bovendien statistisch nietszeggend.
- **De aggregatie in de component laten leven.** Verworpen: een waarborg die in één regel componentlogica zit, is niet programmatisch na te rekenen — dezelfde reden als bij `maskeerTrendwaarde`.

## Gevolg

De ketenbalk en de tabel kunnen nooit een individu-herleidbaar getal reconstrueren via aggregatie. De payload naar de client bevat bovendien geen onderdrukte waarde (die wordt in de leeslaag op `null` gezet vóór serialisatie).
