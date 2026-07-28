# 0086 — Auto-restore van het laatste AI-gesprek begrensd tot de browsersessie

- **Status:** Geaccepteerd
- **Datum:** 2026-07-28
- **Betrokkenen:** Merlin (opdrachtgever/PO), Claude (bouw)

## Context

De AI-assistent deed bij elke mount een **auto-restore** (Fase B2): hij haalde het meest recente niet-gearchiveerde gesprek op (query op `bijgewerkt`, zonder sessie- of tijdsbesef) en zette dat volledig terug — berichten, scope en antwoordmodus. Gevolg: wie vorige maand een vraag stelde, landde na het inloggen weer in dat oude gesprek en zag het nieuwe **AI-startpunt** (besluit 0085) nooit. De auto-restore maakte het startpunt onbereikbaar voor iedere terugkerende gebruiker.

Randvoorwaarde: Fase B2-persistentie zelf mag niet verzwakken (alle gesprekken blijven bewaard en bereikbaar), en de oplossing mag geen serverstate, tabel, RLS- of auditgevolg introduceren.

## Besluit

De auto-restore wordt begrensd tot de **browsersessie**. Het actieve gesprek wordt bijgehouden in `sessionStorage` (per tab, sleutel in `core/lib/ai-sessie.ts`) in plaats van uit de database te worden afgeleid. Bij mount herstelt `/ai` **alleen** als er in déze browsersessie een markering is, en dan precies dát gesprek (op id). De markering wordt gezet bij het openen van een gesprek uit de lade en bij het opslaan/bijwerken van een gesprek, en expliciet **gewist bij uitloggen** (`core/components/Sidebar.tsx`). Fase B2 blijft volledig intact: alle gesprekken staan in de gesprekken-lade en zijn met één klik terug te halen — alleen het *automatisch terugzetten* vervalt.

Gedragsmatrix: opnieuw inloggen → startpunt; nieuw tabblad → startpunt; binnen dezelfde sessie weg van `/ai` en terug → lopend gesprek blijft; gesprek kiezen uit de lade → dat gesprek laadt (zoals nu).

## Overwogen alternatieven

- **Auto-restore laten zoals hij was** — houdt het startpunt onbereikbaar voor terugkerende gebruikers; verworpen.
- **Auto-restore volledig verwijderen** — dan blijft ook binnen één sessie (weg-en-terug via een brondocument) niets staan; onnodig streng. Verworpen.
- **Serverstate (kolom "laatst_actief" / een sessietabel)** — zwaarder, raakt datamodel/RLS/audit voor een puur UI-concern. Verworpen ten gunste van client-side `sessionStorage`.

## Gevolgen

- **UX (positief):** een terugkerende gebruiker ziet het startpunt in plaats van een oud gesprek; binnen een sessie blijft context wél bewaard.
- **UX (bewust geaccepteerd nadeel):** wie zijn gesprek van gisteren wil hervatten, moet dat nu **zelf uit de gesprekken-lade kiezen**. Dat is één extra klik; de persistentie zelf is niet teruggedraaid.
- **Persistentie:** Fase B2 ongewijzigd — geen gesprek wordt minder bewaard. Dit is expliciet vastgelegd zodat later niemand concludeert dat de persistentie is verzwakt.
- **Data/RLS/audit:** géén. Puur client-side UI-state (`sessionStorage`); geen serverstate, tabel, RLS-policy of governance-event.
- **Verificatie:** `tsc` groen. Handmatig te bevestigen (vereist inlog): de gedragsmatrix hierboven met opnieuw inloggen, nieuw tabblad en weg-en-terug binnen één sessie.

## Referenties

- Code: `core/lib/ai-sessie.ts` (nieuw, sleutel), `app/(dashboard)/ai/_components/AssistentClient.tsx` (markeer/wis + begrensde restore), `core/components/Sidebar.tsx` (wissen bij uitloggen).
- Eerdere besluiten: **0085** (AI-startpunt P1 — dit besluit maakt dat startpunt bereikbaar voor terugkerende gebruikers), Fase B2 (persistente gesprekken).
