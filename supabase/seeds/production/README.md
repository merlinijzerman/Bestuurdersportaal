# supabase/seeds/production/

Seeds die **uitsluitend op Productie** horen en die daar met de hand zijn
uitgevoerd. Ze staan hier om dezelfde reden als de andere seeds: zodat
`supabase migration up` en `supabase db diff` ze niet meenemen, en zodat de
CI-runner ze niet tegen de ephemere database aandraait — die selecteert alleen
`../migrations/`.

Deze map bestond nog niet toen `seeds/` werd ingericht. De README daar
anticipeerde hem wel: categorie C verhuist naar `preview/` *"met een aparte
productievastlegging"*. Dit is die vastlegging.

**Het verschil met `preview/` is niet cosmetisch.** Een preview-seed vult
fictieve inhoud en mag opnieuw worden gedraaid. Een productieseed raakt echte
data en is doorgaans append-only: opnieuw draaien is dan geen herstel maar een
tweede feit in het register. Lees de kop van het bestand voordat je iets doet.

## Uitvoering is een gebeurtenis, geen stap

Elk bestand hier noemt in zijn eigen kop welke voorwaarden gelden. Voor
`2026_08_15_platform_event_fork_declarations_seed_production.sql` zijn dat: het
projectref van Productie, uitvoering pas ná de generieke ketenkop- en
forkregistermigraties, een verse back-up/restoretest, en een expliciete
go/no-go. Vanaf Huisartsen-live komt daar een tweede goedkeuring bij.

Wordt een bestand hier toegevoegd, noteer dan in `HANDOVER.md` óf het al is
uitgevoerd. Een seed in deze map zegt uit zichzelf niets over de stand van de
database — dat was precies de verwarring die de ontbrekende
`fonds_licentie`-migratie veroorzaakte, en die valkuil werkt in beide richtingen.

## Inhoud

| Bestand | Uitgevoerd op Productie |
|---|---|
| `2026_08_15_platform_event_fork_declarations_seed_production.sql` | ja — bevestigd 2026-08-20 |

Terugdraaiscripts staan, net als alle andere, in `../../rollbacks/`.
