# 0180 — Exacte append-only forkdeclaraties voor de platformauditketen

- **Status:** Geaccepteerd
- **Datum:** 2026-08-15
- **Impact:** security, audit en continuïteit; additief platformdatamodel

## Context

In historische platformauditketens zijn bekende vertakkingen aangetroffen. De hashes
van de betrokken events zijn inhoudelijk geldig. Events herschrijven, verwijderen of
opnieuw hashen zou het oorspronkelijke append-only bewijs aantasten. Een validator mag
de afwijking echter ook niet generiek negeren: dan kan een nieuwe, ongereviewde fork
ongemerkt geldig worden.

Exacte omgevingstellingen, hashes en uitvoerbewijs zijn operationele security-evidence
en horen in de private bewijslaag. Dit besluit legt alleen het publieke controlontwerp
vast.

## Besluit

1. De actuele ketenkop staat in één transactioneel vergrendelde
   `platform_event_chain_state`; nieuwe events worden lineair geserialiseerd.
2. Een historische fork is alleen geldig met een declaratie van de exacte
   `fork_prev_hash` en de volledige, gesorteerde set directe child-hashes. Een subset,
   extra child, gewijzigde hash of declaratie zonder werkelijke fork faalt gesloten.
3. Forkdeclaraties zijn append-only. Grants, RLS en een owner-onafhankelijke trigger
   blokkeren UPDATE en DELETE.
4. De registry is platformglobaal en niet rechtstreeks toegankelijk voor `anon`,
   `authenticated` of `service_role`. Validatie loopt via een centrale
   `SECURITY DEFINER`-functie met lege `search_path` en zonder direct execute-recht voor
   applicatierollen.
5. Schema en omgevingsbewijs blijven gescheiden. Preview en Productie gebruiken ieder
   een expliciete seed buiten `supabase/migrations/`; een seed kan daardoor niet door de
   generieke migratierunner op de verkeerde omgeving worden toegepast.
6. Een rollback van de registry mag alleen zolang geen declaratie bestaat. Na
   registratie van bewijs faalt de rollback gesloten.
7. De validator controleert gezamenlijk hashherberekening, unieke hashes, roots,
   ontbrekende links, exact verklaarde forks, stale declaraties en de ketenkop-/count-/
   leaf-invariant. Nieuwe afwijkingen blijven blokkerend.

## Gevolgen

- Historisch bewijs blijft intact; uitzonderingen zijn machineleesbaar, exact en
  begrensd in plaats van vrije incidenttekst.
- De production seed en rollback worden expliciet als omgevingsartefact vastgelegd.
- Een declaratie is geen inhoudelijke goedkeuring van ieder event. Reviewbewijs,
  hashes, omgevingstellingen en uitvoeringstijdstip blijven in de private
  securitylaag.

## Alternatieven

- **Events herhashen of verwijderen:** verworpen; vernietigt het oorspronkelijke
  auditbewijs.
- **Alle forks generiek toestaan:** verworpen; verbergt toekomstige regressies.
- **Alleen een vrije incidentnotitie:** verworpen; bewijst de beoordeelde structuur
  niet.
- **Alleen de bladkoppen registreren:** verworpen; een extra historische child kan dan
  onopgemerkt blijven.

## Referenties

- [`supabase/migrations/2026_08_15_platform_event_chain_head.sql`](../supabase/migrations/2026_08_15_platform_event_chain_head.sql)
- [`supabase/migrations/2026_08_15_platform_event_fork_declarations.sql`](../supabase/migrations/2026_08_15_platform_event_fork_declarations.sql)
- [`supabase/seeds/production/README.md`](../supabase/seeds/production/README.md)
