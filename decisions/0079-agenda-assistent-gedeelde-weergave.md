# 0079 — Agenda-assistent deelt weergave met /ai (gedeelde renderer + doorklikbare bronnen)

- **Status:** Geaccepteerd
- **Datum:** 2026-07-20
- **Betrokkenen:** Merlin (opdrachtgever/PO), Claude (bouw)

## Context

Besluit 0036 (inline agendapunt-chat) accepteerde bewust een beperkte duplicatie van de marker-/bronrendering: `AgendapuntChat` kreeg een eigen, compacte renderer in plaats van een refactor van de ±1900-regel `ai/page.tsx`. Gevolg in gebruik: in de vergadering waren de bronnen onder een antwoord **statische kaarten zonder doorklik**, terwijl de volledige assistent (`/ai`) klikbare bronkaarten had die het originele document openen. Ook het rijke controlevlak "Onderbouwing en bronnen" (bronbasis, antwoordmodus, profielsturing, web-/kennisbronnen) ontbrak in de agenda. 0036 benoemde dit al als "geaccepteerde schuld" ("consolidatie kan later als gedeelde component") plus een open punt "bronweergave".

## Besluit

De antwoord- en bronweergave wordt geconsolideerd in één gedeeld component `app/(dashboard)/ai/_components/AntwoordWeergave.tsx` (de renderer met `[Bron N]`-pills en de doorklikbare `Bronkaart`), dat door zowel `/ai` als `AgendapuntChat` wordt gebruikt. De agenda hergebruikt daarnaast het bestaande `OnderbouwingPaneel`. Daarmee zijn de twee instappunten functioneel gelijk: doorklikbare bronnen (naar `/api/documents/[id]/bestand`), `[Bron N]`-pills die naar de kaart scrollen en die kort highlighten, en hetzelfde rijke controlevlak.

## Overwogen alternatieven

- **Minimale fix (alleen een `<a>` om de bestaande agenda-kaart)** — lost alleen het doorklikken op, houdt twee renderers en de UI-/metadata-divergentie in stand; afgewezen.
- **Volledige duplicatie in `AgendapuntChat`** — snel, maar herintroduceert precies de schuld die 0036 al benoemde; afgewezen.
- **Gedeeld component + volledige gelijktrekking (gekozen)** — één bron van waarheid, geen divergentie meer; `/ai` blijft gedragsbehoudend (renderer verbatim geëxtraheerd).

## Gevolgen

- **UI**: in de vergadering zijn bronnen doorklikbaar, pills scrollen+highlighten, en het volledige "Onderbouwing en bronnen"-paneel is gelijk aan `/ai`.
- **Onderhoud**: sluit de geaccepteerde schuld van 0036 en het open bronweergave-punt. `CitatieTekst.tsx` (de oude compacte renderer) is dode code geworden en verwijderd — geen enkel bestand importeerde het nog.
- **Bugfix**: de DOM-id's van bronkaarten en het onderbouwingsanker zijn geprefixt met `agendapuntId`. Op de vergaderpagina staan meerdere agendapunt-chats; zonder prefix waren id's als `bron-0-0` niet uniek en sprong `getElementById` naar de kaart van een ander agendapunt.
- **Verificatie**: `tsc --noEmit` en `eslint` groen; browser-smoke (doorklikken, scroll+highlight, meerdere agendapunten op één pagina) nog te doen.
- **Proces-incident**: commit `893748a` ("Stuurinformatie vervolg") overschreef `AgendapuntChat.tsx` per ongeluk met een oudere werkkopie (parallelle sessie niet op de laatste `main`), waardoor de gelijktrekking uit `24b321f` kort verloren ging; hersteld in `a1429f8`. Aandachtspunt: parallelle werkkopieën op de laatste `main` houden en gericht stagen (geen brede `git add -A` vanuit een verouderde staat).

## Referenties

- Code: `app/(dashboard)/ai/_components/AntwoordWeergave.tsx` (nieuw, gedeeld), `app/(dashboard)/vergaderingen/_components/AgendapuntChat.tsx` (gewijzigd), `app/(dashboard)/ai/page.tsx` (gebruikt het gedeelde component), `CitatieTekst.tsx` (verwijderd)
- Eerdere besluiten: 0036 (inline agendapunt-chat — dit besluit sluit de daarin benoemde geaccepteerde schuld + open bronweergave-punt), 0028 (agendapunt-toelichting als seed-context), 0071 (agendavoorbereiding streaming + bronmelding)
