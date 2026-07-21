# 0081 — Fix: stuk-upload aan een agendapunt zet vergadering_id (route↔trigger-contract)

- **Status:** Geaccepteerd
- **Datum:** 2026-07-20
- **Betrokkenen:** Merlin (opdrachtgever/PO), Claude (bouw)

## Context

Een stuk toevoegen aan een agendapunt faalde met de UI-melding "Kon document niet opslaan in database" (HTTP 500). De onderliggende oorzaak (zichtbaar in de Supabase/Vercel-logs) is de trigger `fn_document_agendapunt_vergadering_check` (migratie `2026_06_19_documenten_agendapunt_vergadering_trigger.sql`): die weigert een `documenten`-insert waarbij `agendapunt_id` is gezet maar `vergadering_id` niet exact de vergadering van dat agendapunt is. De uploadroute (`app/api/documents/upload/route.ts`) zette wél `agendapunt_id` maar nooit `vergadering_id` (bleef NULL) → de trigger gooide "Agendapunt X hoort niet bij de opgegeven vergadering <NULL> (maar bij Y)". Dit is een route↔trigger-contractmismatch die bestaat sinds de trigger (2026-06-19); de route is destijds niet meegewijzigd. Het pad "stuk uploaden bij een agendapunt" was daardoor stuk (eerder zichtbare samenvattingen waren seed-data).

## Besluit

De uploadroute leidt `vergadering_id` server-side af uit het agendapunt (`select vergadering_id from agendapunten where id = agendapunt_id`) en zet het mee in de `documenten`-insert. Lukt de lookup niet (agendapunt onbekend of geen toegang), dan faalt de upload met een duidelijke 400 in plaats van een generieke 500.

## Overwogen alternatieven

- **DB-side: de trigger `vergadering_id` laten auto-invullen bij NULL** — robuuster voor álle callers, maar wijzigt een bewust ingebouwde integriteitswaarborg (ontwerp-sync-bevinding D1) en vergt een migratie (migratie-eerst-dan-deploy) + rollback; te zwaar voor deze bug. Afgewezen; de route was de afwijkende partij.
- **Alleen de foutmelding verbeteren** — lost de bug niet op. Afgewezen.

## Gevolgen

- Stukken toevoegen aan een agendapunt werkt weer; `documenten.vergadering_id` wordt consistent gevuld (voldoet aan de trigger én de C-migratie-CHECK "agendapunt_id ⇒ vergadering_id aanwezig").
- Duidelijker falen (400 "Agendapunt niet gevonden of geen toegang") bij een ontoegankelijk/onbekend agendapunt i.p.v. een generieke 500.
- Route-only: geen migratie/tabel/kolom/RLS-wijziging; de trigger blijft ongewijzigd de integriteitswaarborg.
- **Verificatie:** `tsc --noEmit` + `eslint` groen; herhaal-upload in de UI na deploy handmatig bevestigen.
- **Openstaand:** de overige insert-paden op `documenten` controleren op dezelfde omissie; overweeg een regressietest op de trigger-contractregel.

## Referenties

- Code: `app/api/documents/upload/route.ts` (`vergadering_id`-afleiding + insert)
- Trigger: `supabase/migrations/2026_06_19_documenten_agendapunt_vergadering_trigger.sql` (`fn_document_agendapunt_vergadering_check`)
- Diagnose: Supabase-log "Agendapunt … hoort niet bij de opgegeven vergadering <NULL>"; route logt `console.error("Fout bij opslaan document:", docError)`
