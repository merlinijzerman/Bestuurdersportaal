# 0120 — Correlatie via `gesprek_audit_id` zonder foreign key, nooit ge-update

- **Status:** Geaccepteerd
- **Datum:** 2026-08-04
- **Betrokkenen:** Ontwikkeling, IB

## Context

Om de chatinhoud bij een auditregel te kunnen verwijderen, moet bekend zijn welke auditregels bij welk gesprek horen. Er was geen enkele koppeling: `governance_log` had geen `gesprek_id` en de migratie die `gesprekken` introduceerde noemt de ontkoppeling expliciet als keuze.

De voor de hand liggende oplossing — een foreign key — botst frontaal met de append-only-discipline. `ON DELETE SET NULL` wordt door PostgreSQL als een UPDATE uitgevoerd en zou `fn_log_append_only()` laten vuren; `ON DELETE CASCADE` zou het auditspoor verwijderen bij het opruimen van een gesprek. `ON DELETE RESTRICT` zou verwijderen onmogelijk maken.

Daar kwam een tweede probleem bij: de chat-route kende het gesprek-id helemaal niet. De request-body had er geen veld voor, en bij een nieuw gesprek bestaat de rij nog niet — de browser schrijft `gesprekken` pas ná de stream. De eerste beurt van elk gesprek zou dus onkoppelbaar blijven.

## Besluit

`governance_log.gesprek_audit_id` is een kale `uuid`-kolom **zonder** foreign key, die na het schrijven nooit wordt ge-update. De client genereert het gesprek-id met `crypto.randomUUID()` vóór de eerste beurt, stuurt het mee in de chat-request en gebruikt hetzelfde id als expliciete `id` bij de insert in `gesprekken`.

## Overwogen alternatieven

- **Foreign key met `ON DELETE SET NULL`** — zie context; wordt als UPDATE uitgevoerd.
- **Pas koppelen vanaf de tweede beurt** — verworpen: juist de eerste vraag van een gesprek is vaak de meest persoonlijke, en die zou dan permanent onverwijderbaar zijn.
- **Server-side een gesprek aanmaken vóór de stream** — zou de route verantwoordelijk maken voor gespreksopslag die nu volledig client-side is; een grotere ingreep dan het probleem rechtvaardigt.

## Gevolgen

- **Datamodel:** een partiële index op de niet-lege waarden draagt de lookup in `verwijder_gesprek()`. Geen referentiële integriteit — bewust: de waarde blijft na verwijdering van het gesprek bestaan en geeft geen toegang tot verwijderde inhoud.
- **Client:** `AssistentClient` en `AgendapuntChat` houden nu een tweede ref bij (`gesprekBestaatInDb`), omdat een gezet id niet langer betekent "staat al in de database".
- **Bewust geaccepteerd:** interacties van vóór plateau A hebben `gesprek_audit_id = null` en zijn niet door de gebruiker te verwijderen. Benoemd in de verwijderdialoog en als restrisico.
- **Verificatie:** de rol-/capabilitysuite toetst structureel dat er géén FK van `governance_log` naar `gesprekken` bestaat, en gedragsmatig dat `gesprek_audit_id` na een verwijdering onveranderd is (AC-10).

## Referenties

- `supabase/migrations/2026_08_04_a1_governance_log_inhoud.sql`
- `app/api/chat/route.ts`, `app/(dashboard)/ai/_components/AssistentClient.tsx`
- `supabase/migrations/2026_06_07_gesprekken.sql:6-8` (de oorspronkelijke ontkoppeling)
- [[0001]], [[0107]], [[0116]]
