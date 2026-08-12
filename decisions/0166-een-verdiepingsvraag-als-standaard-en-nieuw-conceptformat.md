# 0166 — Eén verdiepingsvraag als standaard, verdieping op initiatief, en een nieuw conceptformat

- **Status:** Geaccepteerd (impl.; B-opt tranche 2c/2d/2e)
- **Datum:** 2026-08-12
- **Betrokkenen:** Merlin (opdrachtgever), ontwikkeling
- **Herziet:** ontwerp v1.0 §9.6 (de vraagstrategie en de conceptweergave)

## Context

De as-built flow stuurde feitelijk naar drie verdiepingsvragen: de conceptweergave was alleen bereikbaar bij het beurtplafond (de chatroute riep `concept` pas aan bij beurt 3). Netto: drie keer doorvragen, of geen opbrengst — het voelde als een intake (VOORSTEL §E, H-2). Het concept was bovendien één vloeiende alinea met één kop; het maakte niet zichtbaar welke zin van de bestuurder kwam en welke uit de bevroren bronset (VOORSTEL §F).

## Besluit

**Eén vraag als standaard; de bestuurder beslist over de tweede (VOORSTEL §E, model A+C).**

- Na **elk** reflectieantwoord bouwt de chatroute het concept op — niet meer alleen bij het bereikte plafond. Server-side gestuurd door de gevraagde actie (`antwoord` → concept), niet door het model of de client.
- Onder het concept staat **"Nog een stap verdiepen"** (actie `verdiepen`): één extra verdiepingsvraag op initiatief van de bestuurder. `verdiepen` keert terug naar `verdieping_{beurt}`, zodat het volgende antwoord doortelt.
- Het **beurtplafond van 3 blijft** een harde, server-side guardrail — nu geen stuurmiddel meer maar een vangnet. De knop verdwijnt bij beurt 3; de RPC weigert `verdiepen` én een vierde `antwoord` óók als de client het toch probeert.

Het voorstel-onderdeel B ("systeem oordeelt dat één extra vraag nuttig is") is **verworpen**: dat is een oordeel over de inbreng van de bestuurder — de gatekeeping die deze functie niet mag doen — en per ontwerp onmeetbaar (VOORSTEL §E).

**Nieuw conceptformat (VOORSTEL §F).** Het concept krijgt drie kopjes, twee voorwaardelijk:

- **"Uw overweging"** — ten hoogste vijf zinnen, zo veel mogelijk in de eigen woorden van de bestuurder, in de **tweede persoon** (nooit de ik-vorm namens hem: dat hoort pas in plateau C).
- **"Wat hierover al vaststond"** — alléén bij een bevroren bronset; uitsluitend passages die in het eerdere antwoord al zijn aangehaald, met `[Bron N]`. Neutralere formulering dan "relevant" (dat is een oordeel).
- **"Wat u nog wilde toetsen"** — alléén als de bestuurder zelf een open vraag benoemde; een echo in de verleden tijd, geen agenda.

De letterlijke slotzin blijft. Prompt: `SP_REFLECTIE_CONCEPT_REGELS` vervangen, nieuwe sha256-pin, uitgebreide content-guard.

**Lichte bronweergave tijdens reflectie (VOORSTEL §F / ANTWOORDPAD §4, tranche 2f).** Een reflectiebeurt is visueel lichter: geen volle bronbalk/onderbouwingspaneel. Bevat de beurt een dossieruitspraak, dan één gedempte regel die uitklapt. **Uitsluitend weergave** — de beurt wordt onveranderd gelogd, zonder reflectiemarkering ([[0112]]); de weergavestand wordt afgeleid uit de live flowstatus, nooit uit een opgeslagen markering.

## Gevolgen

- Transitietabel: nieuwe actie `verdiepen` (`conceptweergave → verdieping_{beurt}`, geweigerd bij beurt ≥ 3). Spiegel in `core/lib/reflectie-flow.ts` + sanity; SQL in `reflectie_transitie` (migratie `2026_08_12_bopt2_reflectie_ingangen.sql`), gedragstoets blok AC-18h.
- `SP_REFLECTIE_CONCEPT_REGELS` gewijzigd → nieuwe pin (vers berekend) + content-guard in `generatie-kern.sanity.ts`.
- `SP_REFLECTIE_REGELS` (de verdiepingsbeurt zelf) is **niet** gewijzigd in deze tranche; de attributieplicht en de adaptieve vraagkeuze zijn tranche 3.
- De beurt reist mee in het done-event zodat de client "Nog een stap verdiepen" kan verbergen bij het plafond; nooit client-side afgeleid.

## Referenties

- `VOORSTEL-REFLECTIE-OPTIMALISATIE.md` §E, §F · `VOORSTEL-REFLECTIE-ANTWOORDPAD.md` §4 · ontwerp v1.0 §9.6/§9.7
- [[0110]] (transitietabel), [[0112]] (geen reflectiemarkering), [[0164]]
