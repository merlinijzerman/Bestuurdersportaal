# #369: afzonderlijke Preview-reparatie

Doel: uitsluitend `portal_preview` (`swviwoytzvaqypieqgji`). Geen Productie,
geen Copilot-activatie en geen herhaling van de drie niet-verklaarde functieafwijkingen
uit #440. De werkende app roept de acht-parameter-RPC aan; op Preview ontbreekt
die nu. Het bestaande migratiebestand wordt niet gewijzigd.

## Gemeten uitgangspositie (23 september 2026, read-only)

- Host: `app.preview.bestuurdersportaal.com`; geen Productiehost volgens de
  #440-doelgrendel (`*.bestuurdersportaal.com` buiten `*.preview.bestuurdersportaal.com`).
- `comparison_run = 0`, `comparison_results = 0`.
- Oude vijf-parameterfunctie bestaat (`authenticated` mag uitvoeren, `anon` niet).
- Nieuwe acht-parameterfunctie en alle vijf #369-kolommen ontbreken.
- `auth.uid()` en `extensions.digest(text,text)` bestaan.

Deze feiten zijn een momentopname, geen blijvende toestemming. Herhaal de
preflight onmiddellijk vóór uitvoering. Stop bij élke andere uitkomst.

## Uitvoering, pas na afzonderlijk Preview-akkoord

1. Controleer in Supabase de projectnaam en ref buiten de SQL-editor:
   `bestuurdersportaal-preview`, `swviwoytzvaqypieqgji`. Gebruik nooit een
   algemene/laatst geopende editor zonder die bevestiging.
2. Draai `supabase/checks/2026_09_23_369_preview_preflight_readonly.sql`.
   Alleen `369_PRECHECK_GROEN` met `0/0` is doorgaan.
3. Plak ongewijzigd en volledig
   `supabase/migrations/2026_09_11_369_vergelijk_retrieval_audit.sql`.
   Verwachte SHA-256 van dat bestand:
   `aac2ff587c148d94b361964751cb4b524d4c717e6ff0fc609e7fcd6ed3cdda14`.
   Het bestand heeft één eigen transactie; stop bij de eerste fout. Geen andere
   oude migratie herhalen.
4. Draai `supabase/checks/2026_09_23_369_preview_postcheck_readonly.sql`.
   Eist de vijf kolommen, acht-parameterfunctie, RLS, DEFINER/search_path en
   de ingetrokken oude schrijfgrant. Leg de aantallen vast.
5. Herhaal, zodra PR #442 beoordeeld is, de #440-fingerprintscan: de
   #369-verschillen moeten weg zijn, zonder dat de overige `public`-afwijkingen
   veranderen. Draai daarnaast de R1-structurele en V3-grantscontroles volgens
   het releaseproces. Pas dan een gecontroleerde
   `/api/vergelijk`-smoke met een Preview-testaccount; leg run-id en foutcategorie
   intern vast, geen documentinhoud in het releaseverslag.

## Herstelpad

De bestaande rollback is in dit pakket fail-closed gemaakt: hij neemt eerst
een exclusief slot en weigert zodra een vergelijkrun of -resultaat bestaat.
Voor de eerste nieuwe run kan de rollback technisch de oude schema-/RPC-vorm
herstellen, maar de al gedeployde app verwacht dan nog steeds de acht parameters.
De gebruikersroute moet dan buiten gebruik blijven of samen met de code worden
teruggedraaid. Na de eerste run: **geen schema-rollback**; bewaar het append-only
auditspoor en herstel uitsluitend voorwaarts. De oude rollback zonder grendel
is onveilig: een wegwerptest bewees dat hij kolommen met bestaande auditdata
zonder fout verwijdert.

Dit pakket is voorbereiding. Er is geen SQL op Preview gewijzigd.
