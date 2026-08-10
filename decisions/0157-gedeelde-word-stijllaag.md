# 0157 — Gedeelde Word-stijllaag + echte lijsten in de export

- **Status:** Geaccepteerd
- **Datum:** 2026-08-10
- **Betrokkenen:** Merlin IJzerman (opdrachtgever), Claude Code (uitvoering)

## Context

De Word-export van een chat-antwoord/stuk (T2, `core/lib/antwoord-docx.ts`) leverde technisch valide OOXML, maar de opmaak was mager: geen consistente documentstijl, en opsommingen werden als tekstregels met streepjes weggeschreven in plaats van als echte Word-lijsten. Een bestuurlijk stuk moet er verzorgd uitzien en in Word verder bewerkbaar zijn (klikbare lijstniveaus, doorlopende nummering). Randvoorwaarde: de anti-fabricage-/herkomstlaag (0098/0133) en de citaatweergave (A4) blijven ongemoeid.

## Besluit

Een gedeelde stijllaag `core/lib/docx-primitieven.ts` draagt de OOXML-primitieven: een documentstijl (Calibri via `docDefaults`, navy accent `#1F3A5F` op koppen), `w:tblGrid` met vaste kolombreedtes, en **echte** lijsten via een `numbering.xml` (ongeordend + geordend, met per-geordende-lijst herstartende nummering). `antwoord-docx.ts` bouwt hierop voort. Het is een gedeelde renderlaag, geen tweede renderer (één interpretatie voor docx).

## Overwogen alternatieven

- **Streepjeslijsten als platte tekst laten** — verworpen: niet bewerkbaar als lijst in Word, oogt niet als een afgewerkt stuk.
- **Opmaak per exportfunctie dupliceren** — verworpen: divergentierisico; de afschrift-export (T6) en toekomstige exports moeten dezelfde stijl kunnen erven. (De afschrift-export staat nog niet op deze laag — geparkeerd als schuld.)
- **Een fondssjabloon nu al inbouwen** — uitgesteld: neutrale stijl met een configlaag-haak (conform 0133 A6) volstaat voor nu.

## Gevolgen

- **Geen migratie, geen datamodel-/RLS-wijziging.** Zuiver renderlaag.
- **Gedeelde laag geraakt:** de Word-export van chat-antwoorden en bureau-stukken erft de nieuwe stijl en echte lijsten; het scherm en het klembordpad blijven ongemoeid.
- **Openstaand (technische schuld):** `afschrift-docx.ts` (T6) draait nog niet op de gedeelde stijllaag; een blockquote-primitief ontbreekt nog in `docx-primitieven.ts`. Als aparte posten geparkeerd.
- **Verificatie:** golden-test `antwoord-docx.sanity.ts` groen (15/15) en visueel gerenderd. `tsc --noEmit` groen.

## Referenties

- Code: `core/lib/docx-primitieven.ts` (gedeelde stijllaag, `numbering.xml`), `core/lib/antwoord-docx.ts`. Commits `a13c12c` + merge `0dca24d` (B2); content ook aanwezig in `28622f7` (2026-08-10, `main`).
- Sanity: `antwoord-docx`.
- Eerdere besluiten: 0079 (één renderer), 0129/0133 (T2/T5 bureau-export & opmaak).
