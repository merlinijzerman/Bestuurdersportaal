# 0158 — Herstel Word-exportknop op heropend/herladen stuk-gesprek

- **Status:** Geaccepteerd
- **Datum:** 2026-08-10
- **Betrokkenen:** Merlin IJzerman (opdrachtgever), Claude Code (uitvoering)

## Context

Na de releases van 2026-08-10 was de knop "Download als Word" verdwenen uit de assistent zodra een bureau-stuk-gesprek werd heropend uit de historie of na een refresh. Oorzaak: de knop is gegate op `magStukVoorbereiden` (capability `ai.stukvoorbereiding`, bureau-only) én op `stukContext` — en `stukContext` was efemere state die bij het openen van een bestaand gesprek of na een refresh niet werd hersteld. "Antwoord kopiëren" bleef zichtbaar, "Download als Word" niet (bevestigd via DOM-inspectie: `wordKnop` 0 → 3 na de fix).

## Besluit

De stuk-context wordt gereconstrueerd uit de gespreksgeschiedenis: `parseStukZin()` (inverse van `bouwStukZin()`) leest de eerste gebruikersbeurt terug naar `{stuksoort, onderwerp}`; `AssistentClient.tsx` zet `stukContext` bij het openen van een gesprek (uit historie) én op de restore-on-mount na een refresh. Geen nieuwe opslag, geen nieuw veld — de context wordt afgeleid uit wat er al staat.

## Overwogen alternatieven

- **`stukContext` persisteren in de database** — verworpen: overbodig; de eerste gebruikersbeurt draagt de stuksoort + het onderwerp al deterministisch (`bouwStukZin`), dus een inverse volstaat.
- **De knop alleen op de capability gaten (stukContext laten vallen)** — verworpen: dan zou de Word-knop ook verschijnen bij gewone chats van een bureau-gebruiker, buiten een stukcontext.

## Gevolgen

- **Geen migratie, geen datamodel-/RLS-wijziging.** Front-end + één pure helper.
- **`parseStukZin` is de round-trip-inverse van `bouwStukZin`** en dekt alle vier stuksoorten inclusief de meerwoordige "Toelichting bij een agendapunt" (regex `(.+?)`) en de onderwerploze variant; geeft `null` bij een gewone vraag.
- **Verificatie:** `stukvoorbereiding.sanity.ts` uitgebreid met round-trip- en negatieve tests; live geverifieerd op productie (knop terug op het heropende memo).

## Referenties

- Code: `core/lib/stukvoorbereiding.ts` (`parseStukZin`), `app/(dashboard)/ai/_components/AssistentClient.tsx` (`stukContextUitBerichten`, restore-paden). Commit `d8455ec` (2026-08-10, `main`).
- Sanity: `stukvoorbereiding`.
- Eerdere besluiten: 0129/0133 (T2/T5 bureau-export, `bouwStukZin`), 0086 (auto-restore begrensd tot browsersessie).
