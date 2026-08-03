# 0107 — Scheiding van auditspoor en chatinhoud als architectuurprincipe

- **Status:** Geaccepteerd
- **Datum:** 2026-08-04
- **Betrokkenen:** Productverantwoordelijke, IB, ontwikkeling

## Context

`governance_log` droeg zowel het append-only auditspoor als de chatinhoud (`vraag`, `antwoord`, `bronnen`). Die vermenging maakte twee tegengestelde eisen onverenigbaar: het spoor mag nooit muteren (append-only trigger blokkeert UPDATE en DELETE), terwijl de bestuurder zijn eigen gesprek moet kunnen verwijderen. Het gevolg was een schijnoplossing — "archiveren" zette `gearchiveerd = true` terwijl de knop een prullenbak toonde en de vraag gewoon bleef staan.

Daar kwam bij dat de vraag óók in `retrieval_meta.zoekvraag` staat en documenttekst in `sources[].fragment`. Alleen de drie kolommen verplaatsen zou de scheiding cosmetisch maken.

## Besluit

Spoor en inhoud worden twee objecten. `governance_log` houdt uitsluitend het onveranderlijke spoor (wie, wanneer, welke modus, welk model, geprojecteerde metadata); de inhoud verhuist naar `governance_log_inhoud`, die bewust **geen** append-only trigger krijgt en met het gesprek verwijderbaar is. De splitsing geldt ook binnen `retrieval_meta`, via de allowlist uit [[0114]].

## Overwogen alternatieven

- **Inhoud in `governance_log` laten en verwijderen toestaan** — zou de append-only-discipline breken die de hele auditketen draagt. Verworpen.
- **Alleen de drie kolommen verplaatsen** — laat de vraag in `retrieval_meta.zoekvraag` staan; lost het probleem niet op.
- **Anonimiseren in plaats van verwijderen** — een geanonimiseerde vraag blijft de vraag; dataminimalisatie vraagt weghalen, niet maskeren.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd fondspredicaat; er komt een gebruikersgebonden predicaat bovenop (zie [[0119]]).
- **Audit:** het spoor blijft volledig; `inhoud_aanwezig` maakt zichtbaar dát inhoud is verwijderd. Het integriteitszegel [[0115]] houdt de verwijderde tekst achteraf toetsbaar.
- **Datamodel:** expand/contract over drie migraties; de contract-stap is onomkeerbaar zonder geverifieerde kopie.
- **Bewust geaccepteerd:** rijen van vóór deze wijziging dragen hun inhoudsleutels nog in `retrieval_meta`; zij worden bij het LEZEN afgeschermd, niet herschreven — een UPDATE op een append-only tabel is precies wat we niet doen.

## Referenties

- `supabase/migrations/2026_08_04_a1_governance_log_inhoud.sql`, `…_a3_governance_log_contract.sql`
- Ontwerp v1.0 §5, technisch ontwerp §4.1
- [[0001]] (append-only audit, geen harddelete), [[0114]], [[0115]], [[0116]], [[0119]], [[0120]]
