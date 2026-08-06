# 0136 — Statusverklaring bij ingest: een document dat buiten het portaal al is vastgesteld

- **Status:** Geaccepteerd
- **Datum:** 2026-08-06
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder), Claude (uitvoering/advies)
- **Relatie:** vult de statustransitietabel uit Increment C aan (`core/lib/document-status-transities.ts`, TO v1.2 §3.1, FO §6). Raakt de conceptregel niet. Adresseert **OP-C1** uit `00 Overzicht en status/openstaande-punten-en-risicos.md`.

## Context

Bij het inrichten van de demo-omgevingen werd een pensioenreglement geüpload. De assistent antwoordde: *"Geen ACTUELE fondsbron gevonden, maar er zijn wel 2 stukken over dit onderwerp met de status concept of ter bespreking."*

Dat is geen fout. Een upload begint altijd op `concept`, en alleen `vastgesteld` en `van_kracht` gelden als actuele bron. Het filter deed precies wat het moet doen, en de melding (besluit 0091) was eerlijk over wat er buiten het antwoord bleef.

Het probleem zit een laag dieper. De keten `concept → ter_bespreking → ter_besluitvorming → vastgesteld → van_kracht` modelleert een document dat **in het portaal ontstaat** en via bestuurlijke besluitvorming rijpt. Dat klopt voor een bestuursvoorstel dat het fonds zelf opstelt. Maar een pensioenreglement, jaarverslag of ABTN die je uploadt, is buiten het portaal al vastgesteld — vaak jaren geleden, door een bestuur, in een vergadering die niets met dit portaal te maken had.

Zo'n document door de keten duwen betekent vier statuswijzigingen doorlopen die elk een regel in `document_metadata_log` achterlaten. Het resultaat is een auditspoor dat suggereert dat het stuk in dit portaal ter bespreking is geweest, ter besluitvorming is gebracht en vervolgens is vastgesteld. **Dat is geen strengere controle, dat is een gefabriceerde besluitvormingsgeschiedenis** — en daarmee schadelijker voor de aantoonbaarheid dan een expliciete verklaring bij aanlevering.

De praktische aanleiding weegt mee maar is niet doorslaggevend: met drie demofondsen en tien tot vijftien documenten per fonds gaat het om ongeveer 180 handmatige statuswijzigingen.

## Besluit

We voegen twee transities toe vanaf de bestaande pseudo-herkomst `upload`:

| van | naar | redenplicht | capability | actuele bron erna |
|---|---|---|---|---|
| `upload` | `vastgesteld` | ja | `documents.status.change` | ja |
| `upload` | `van_kracht` | ja | `documents.status.change` | ja |

De uploader verklaart bij aanlevering dat het stuk buiten het portaal al is vastgesteld, en zegt erbij waarom. Zonder verklaring blijft het gedrag exact zoals het was: de DB-default zet `concept`.

**De keten vanuit `concept` wordt niet verruimd.** Er ontstaat geen sprong binnen de keten; dit is een aparte herkomst.

## Overwogen alternatieven

- **Eén sprong vanuit `concept` naar vastgesteld/van_kracht**, achter een aparte capability met redenplicht. Kleinste ingreep in de UI — het bestaande dropdownmenu had gewoon meer opties gekregen. Afgevallen omdat het de keten zelf verruimt: een document dat al ín besluitvorming is, zou dan met één handeling actuele bron kunnen worden. Het onderscheid tussen "dit stuk is elders vastgesteld" en "dit stuk slaat stappen over" zou uit het auditspoor verdwijnen.
- **Vrije statuskeuze voor de beheerder**, transitietabel adviserend. Snelst te bouwen, maar de tabel is dan geen controle meer — inclusief de DB-trigger en de sanity-tests die hem borgen. Voor een product dat governance als propositie voert, is dat het verkeerde onderdeel om los te draaien.
- **Niets doen en de keten doorlopen.** Verdedigbaar als je alleen naar de controle kijkt, maar het levert een onwaar auditspoor op en kost bij de demo-inrichting circa 180 handelingen.
- **Bulkroute gebruiken** (`/api/documents/bulk-metadata`, bestaat al, max 200 per batch, zonder UI). Lost het volume op, niet het waarheidsprobleem: er staan dan nog steeds vier gefabriceerde overgangen per document in het log. Blijft bruikbaar voor bestaande documenten.

## Gevolgen

- **Code.** `core/lib/document-status-transities.ts`: twee regels + `toegestaneIngestStatussen()`. `app/api/documents/upload/route.ts`: drie server-side poorten (staat in de tabel, rol heeft de capability, reden aanwezig) plus een auditregel. `app/(dashboard)/bibliotheek/page.tsx`: veld "Status bij aanlevering" met een redenveld dat verschijnt zodra je iets anders dan concept kiest.
- **Migratie.** `2026_08_06_status_bij_ingest.sql` werkt uitsluitend de SQL-tweeling `fn_document_status_transitie` bij. Functioneel niet nodig — de statusovergang-trigger staat op `before update of status` en een upload heeft geen oude status — maar de kop van de oorspronkelijke migratie schrijft voor dat de spiegel 1-op-1 gelijk blijft. Een spiegel die stilzwijgend achterloopt, is geen betrouwbare tweede lezing meer.
- **Audit.** Eén regel in `document_metadata_log` met `veld_naam='status'`, `oude_waarde='upload'`, `nieuwe_waarde` = de verklaarde status, `wijzig_type='status'`, `rag_impact=true` en de opgegeven reden. `oude_waarde='upload'` is het onderscheidende kenmerk: daaraan zie je dat de status bij aanlevering is verklaard en niet via de bestuurlijke keten is gelopen. Best-effort geschreven — een mislukt auditlog draait een geslaagde upload niet terug, maar landt wel in de serverlog.
- **RLS/tenant-isolatie:** ongewijzigd. Beide routes draaien op de anon-key onder de bestaande policies.
- **Rechten.** `documents.status.change` zit bij beheerder, voorzitter, bestuurder én bestuursbureau. Wie die capability niet heeft, krijgt een 403 met de instructie om als concept te uploaden.
- **Bewust geaccepteerd / open:**
  - *De verklaring wordt niet geverifieerd.* Er is geen controle dat het stuk werkelijk elders is vastgesteld — de reden is een menselijke verklaring, geen bewijs. Dat is een aanvaard restrisico: hetzelfde geldt voor elke reden bij elke statuswijziging in het bestaande model.
  - *Vier rollen mogen dit.* Ook `bestuurder` kan bij aanlevering een status verklaren. Dat volgt uit de bestaande capability-toekenning en is hier niet versmald; wil je dat strakker, dan is een eigen capability de weg.
  - *Geen vier-ogen.* Past bij de huidige interim-stand (besluit 0026) en hoort thuis in de her-introductie-gate vóór echte bestuurders.
  - *OP-C1 is hiermee verzacht, niet gesloten.* Documenten die al op `concept` staan, moeten nog steeds langs de keten of via de bulkroute.

## Verificatie

- `tsc --noEmit --skipLibCheck` = exit 0; `eslint` op de laaggrenzen = exit 0.
- `core/lib/document-status-transities.sanity.ts` uitgebreid van 17 naar 22 tests, waaronder een **regressiepin** die vastlegt dat `concept → vastgesteld`, `concept → van_kracht`, `ter_bespreking → …` en `ter_besluitvorming → van_kracht` verboden blijven. Zou de keten ooit alsnog worden verruimd, dan valt die test om.
- Verder geborgd: de ingest-verklaring levert altijd een actuele bron op, vraagt altijd een reden, en vraagt de statuswijzig-capability in plaats van `upload`.
- **Openstaand mensenwerk:** browsersmoke — een reglement uploaden met "van kracht" plus reden, controleren dat de assistent het direct als actuele bron gebruikt, en de auditregel nakijken op `oude_waarde='upload'`.

## Referenties

- `core/lib/document-status-transities.ts` + `.sanity.ts`
- `app/api/documents/upload/route.ts`, `app/(dashboard)/bibliotheek/page.tsx`
- `supabase/migrations/2026_08_06_status_bij_ingest.sql` (+ ROLLBACK)
- `supabase/migrations/2026_06_18_documentstatus_metadata.sql` (oorspronkelijke tabel, trigger en SQL-spiegel)
- `00 Overzicht en status/openstaande-punten-en-risicos.md` — OP-C1
- [`0091`](./0091-eerlijke-melding-uitgefilterde-bronnen.md) (de melding die dit zichtbaar maakte), [`0026`](./0026-p2-light-her-introductie-gate.md)
