# 0180 — Exacte append-only forkdeclaraties voor de platformauditketen

**Status:** Geaccepteerd  
**Datum:** 2026-08-15  
**Impact:** security, audit en continuïteit; additief datamodel, geen tenantdata

## Context

De historische `platform_event_log` bevat op Preview twee en op Productie een
afzonderlijk nog te registreren vertakking. De hashes zijn inhoudelijk geldig en
verwijzen niet naar ontbrekende events. Herschrijven, verwijderen of opnieuw
hashen zou het append-only bewijs juist aantasten. Tegelijk mag een validator
een historische afwijking niet generiek negeren, omdat dan ook een nieuwe fork
onopgemerkt geldig kan worden.

## Besluit

1. De actuele ketenkop staat in één transactioneel vergrendelde
   `platform_event_chain_state`; nieuwe events worden daardoor lineair
   geserialiseerd, onafhankelijk van tijdstip of UUID-volgorde.
2. Een historische fork is alleen geldig met één declaratie die de exacte
   `fork_prev_hash` en de volledige, gesorteerde set directe child-hashes
   vastlegt. Een subset, extra child, gewijzigde hash of declaratie zonder
   werkelijke fork faalt gesloten.
3. Forkdeclaraties zijn append-only. UPDATE en DELETE worden door grants, RLS en
   een owner-onafhankelijke immutabilitytrigger geblokkeerd.
4. De registry is platformglobaal en niet rechtstreeks toegankelijk voor
   `anon`, `authenticated` of `service_role`. Validatie loopt uitsluitend via
   een centrale `SECURITY DEFINER`-functie met gepinde `search_path` en zonder
   executegrant aan applicatierollen.
5. Generiek schema en omgevingsdata blijven gescheiden. Preview en Productie
   krijgen ieder een eigen, expliciete seed met hun werkelijk waargenomen
   forks. Een Preview-seed mag nooit op Productie worden toegepast.
6. Een rollback van de registry is alleen toegestaan zolang geen declaratie
   bestaat. Na registratie van bewijs faalt de rollback gesloten.
7. De validator controleert gezamenlijk hashherberekening, unieke hashes,
   roots, ontbrekende links, exact verklaarde forks, stale declaraties en de
   ketenkop/count/leaf-invariant. Nieuwe afwijkingen blijven blokkerend.

## Alternatieven

- **Historische events herhashen of verwijderen:** verworpen; dit vernietigt
  het oorspronkelijke auditbewijs.
- **Alle forks generiek toestaan:** verworpen; dit verbergt toekomstige
  regressies en maakt de ketencontrole betekenisloos.
- **Alleen een vrije incidentnotitie opslaan:** verworpen; tekst bewijst niet dat
  exact dezelfde parent/childstructuur is beoordeeld.
- **Eén checkpoint dat alleen de bladkoppen noemt:** verworpen voor deze fase;
  zonder exacte forkset kan een extra historische child ongemerkt blijven.

## Gevolgen en open acties

- Preview is met twee exacte declaraties groen, zonder bestaande events te
  muteren.
- De volledige §15 app- en DB-suite is vanaf een lege Supabase-Postgresdatabase
  groen; R1 registreert beide nieuwe tabellen expliciet als platformglobaal.
- Productie blijft ongewijzigd. De read-only inventarisatie en afzonderlijke
  Productie-seed zijn gereed; eerst volgen nog de restoretest en Merlins
  expliciete go/no-go. Vanaf Huisartsen-live is daarnaast Roberts tweede
  goedkeuring verplicht.
- De verklaring accepteert een historische uitzondering; zij bewijst niet dat
  iedere gebeurtenis inhoudelijk door een onafhankelijke reviewer is
  beoordeeld. Het gesaneerde incidentbewijs blijft daarom onderdeel van het
  herstel-/restore-dossier.
