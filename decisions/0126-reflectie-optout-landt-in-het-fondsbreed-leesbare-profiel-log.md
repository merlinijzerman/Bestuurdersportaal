# 0126 — De reflectie-opt-out landt in het fondsbreed leesbare `profiel_log`

- **Status:** Geaccepteerd — **verfijning van [[0112]]; bewust aanvaard restrisico**
- **Datum:** 2026-08-05
- **Betrokkenen:** Productverantwoordelijke (besluitvormer), Ontwikkeling

## Context

FR-15 vraagt een permanente opt-out voor de proactieve reflectie-uitnodiging, en [[0121]] zegt waar die hoort: in het profiel, want *"een permanente opt-out is een uitgesproken voorkeur van de gebruiker, geen registratie van zijn gedrag"*.

Bij de bouw kwam een gevolg aan het licht dat in geen van beide besluiten staat. Profielmutaties lopen via `profiel_opslaan()`, die in dezelfde transactie een regel schrijft in `profiel_log` — en die tabel is **fonds-breed leesbaar** (policy `"lees profiel_log"`, migratie `2026_06_22_profiel.sql`). Een regel "deze bestuurder heeft zijn reflectie-uitnodiging uitgezet" is daarmee zichtbaar voor fondsgenoten.

Twee guardrails botsen:

- *Elke mutatie logt expliciet* (`CLAUDE.md`, append-only audit).
- *Geen reflectiemarkering in enige registratie* ([[0112]]).

## Besluit

Het veld `profielen.reflectie_uitnodiging` wordt gezet via de bestaande `profiel_opslaan()`, uitgebreid met `p_reflectie_uitnodiging`, en landt daarmee bij naam in `profiel_log` — net als `antwoordvoorkeur`, `standaard_ai_modus` en `detailniveau`. De auditguardrail wint.

## Overwogen alternatieven

- **Een eigen schrijfpad zonder `profiel_log`-regel** — verworpen: dat slaat een stil gat in het auditspoor van het profiel, en een uitzondering die alleen voor dít veld geldt is precies het soort afwijking dat later niemand meer kan uitleggen.
- **Loggen met een neutrale sleutel** ("een voorkeursveld gewijzigd") — verworpen als schijnoplossing: het verhult wat er staat zonder het risico weg te nemen, en maakt het auditspoor minder waar.
- **`profiel_log` versmallen tot de eigenaar** — verworpen binnen deze scope: dat raakt het hele profielauditspoor en is een eigen ontwerpvraag.
- **B-6 uitstellen** — verworpen: dan blijft FR-15 onvervuld en is de uitnodiging alleen per browsersessie te temperen, wat geen echte opt-out is.

## Gevolgen

- **Restrisico, expliciet aanvaard:** uit een `profiel_log`-regel kan een fondsgenoot afleiden dat iemand de reflectie-uitnodiging heeft uitgezet. Dat is een reflectie-**gerelateerd** signaal. Het is geen registratie van reflectie**gedrag**: het aantal keren dat een uitnodiging is getoond of weggeklikt wordt nergens vastgelegd, en of, hoe vaak en waarover iemand reflecteert blijft onzichtbaar — [[0112]] blijft op dat punt onaangeroerd.
- **De grens die hiermee wordt getrokken:** een voorkeur mag in het auditspoor, gedrag niet. Wie later een teller, een tijdstempel of een "laatst getoond"-veld wil toevoegen, valt aan de verkeerde kant van die grens.
- Er wordt niets gelogd wanneer de voorkeur ongewijzigd blijft: de parameter is `null` bij afwezigheid en de `update` laat de kolom dan staan. Een profielopslag die niets met reflectie te maken heeft, zet de opt-out dus niet per ongeluk terug.
- `profielen` heeft strikte eigen-rij-RLS en `vw_fondsleden` projecteert alleen `id/fonds_id/naam/rol`, dus de **waarde zelf** lekt niet — alleen de logregel van de wijziging.
- Datamodel: één kolom op `profielen` (default `true`) en één parameter op `profiel_opslaan` (9 → 10 argumenten, via drop + create zoals bij `p_naam`). Wijkt af van de impactomschrijving "één nieuwe tabel, geen wijziging aan bestaande" in de werkopdracht.

## Referenties

- `supabase/migrations/2026_08_05_b6_reflectie_optout.sql` (+ rollback)
- `app/api/profiel/route.ts`, `app/(dashboard)/profiel/page.tsx`
- Ontwerp v1.0 §9.1; FR-15
- [[0112]], [[0121]], [[0017]]
