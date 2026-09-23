# 0214 — Operationele adaptertellers zijn géén uitzondering op het auditbeleid

- **Status:** Geaccepteerd
- **Datum:** 2026-09-23
- **Betrokkenen:** productverantwoordelijke, ontwikkeling

## Context

De beheerstand van #434 T4-F (`/beheer/adapterstatus`) toont per bronadapter wat
die in de vastgelegde beurten heeft gedaan: netwerkpogingen, downloads, bytes,
afwijzingsgronden, opgenomen passages. Uitsluitend tellingen — geen vraag, geen
antwoord, geen bron, geen bestandsnaam, geen identifier.

Om die stand fondsbreed te kunnen tonen, moet zij ook de beurten van collega's
lezen. De RLS-policy op `governance_log` is
`gebruiker_id = auth.uid() or public.mag_audit(fonds_id)`, en `mag_audit()`
vereist de grant `governance_audit_read` uit [[0119]]. De beheercapability
`fonds.config.manage` verleent die niet.

Een eerdere versie van deze functie loste dat op met een rolgate
(`beheerder`/`voorzitter`) en zonder inzageregel. Dat botst op twee punten met
0119: dat besluit heeft "rol `beheerder` als autorisatie" expliciet verworpen
("een rol is permanent en grofmazig, terwijl auditinzage per persoon, per
periode en per aanleiding hoort te worden toegekend"), én het eist dat elke
inzage in andermans metadata een regel in `governance_audit_inzage` schrijft.
Daarmee lag de vraag op tafel: vormen deze operationele tellers een uitzondering?

## Besluit

Nee. De adapterstand valt volledig onder het auditbeleid van [[0119]].
`fn_adapterstand_fonds()` kent daarom exact hetzelfde tweedelige gedrag als
`lees_governance_audit()`: zonder `governance_audit_read` alleen de eigen
beurten en géén inzageregel; mét die capability het hele fonds en één regel in
`governance_audit_inzage`. De functie meldt in haar antwoord welke van de twee
zij heeft geleverd, zodat de weergave een eigen stand nooit als fondsstand kan
tonen.

## Overwogen alternatieven

- **Uitzondering: tellers zijn "maar metadata", dus een rolgate volstaat** —
  verworpen. Het blijft metadata over de beurten van collega's, en hoe vaak een
  bron faalde of hoeveel bytes iemand ophaalde is niet minder gevoelig omdat het
  een getal is. Een uitzondering "omdat het smal is" is bovendien het soort
  uitzondering dat groeit: de volgende weergave is weer net iets breder.
- **Een nieuwe, smallere capability `governance_adapterstand_read`** — verworpen
  voor nu. Het is verdedigbaar dat operationele tellers een lichter recht
  verdienen dan vraagtekst en bronreferenties, maar dat is een uitbreiding van
  het rolmodel met een eigen grant-administratie, een eigen toekenningsproces en
  een eigen beheer-UI-vraag. Dat hoort niet als bijvangst in een
  retrievaltranche te landen. Als de praktijk uitwijst dat `governance_audit_read`
  te zwaar is voor deze weergave, is dat een eigen ticket met een eigen besluit.
- **De beheerstand laten vallen** — verworpen: zonder zicht op wat de adapters
  deden, is de bronstatus uit T4-E alleen per beurt zichtbaar en nooit als
  patroon.

## Gevolgen

- **Zichtbaar gedragsverschil, en dat is het beoogde gedrag:** een beheerder
  zonder grant ziet op `/beheer/adapterstatus` alleen zijn eigen beurten, met een
  panel dat dat vóóraf uitlegt en het recht noemt dat ontbreekt — precies zoals
  `/governance` dat sinds 0119 doet. In de praktijk betekent dit dat de
  fondsbrede stand leeg blijft tot iemand de grant krijgt via de
  gedocumenteerde SQL-stap uit 0119; dat is geen omissie maar de kern van
  least-privilege.
- **Auditspoor:** elke fondsbrede lezing schrijft een regel in
  `governance_audit_inzage` met `scope = {"weergave":"adapterstand","limiet":n}`
  en `bronniveau = false`. Geen motivering: die is in 0119 aan bronniveau
  gekoppeld, en deze uitvoer is per definitie basisniveau.
- **Datamodel/migraties:** één nieuwe functie, geen nieuwe tabel, geen nieuwe
  capability, geen policywijziging. De functie is `volatile` omdat zij de
  inzageregel schrijft.
- **Bewust geaccepteerd:** de inzageregel wordt geschreven vóór de lezing en dus
  ook als de lezing daarna nul rijen oplevert. Een inzage die niets opleverde is
  nog steeds een inzage; het alternatief — pas loggen als er iets terugkomt —
  maakt het spoor afhankelijk van de uitkomst.

## Aanvaarding

Inhoudelijk goedgekeurd op 2026-09-23 door de productverantwoordelijke: de
adaptertellers vallen onder het bestaande auditbeleid van [[0119]].

Wat deze aanvaarding NIET is, expliciet: zij is geen toestemming om iemand
`governance_audit_read` toe te kennen, geen toestemming om een database te
wijzigen en geen merge-akkoord. Niemand krijgt die grant om deze pagina gevuld
te krijgen; zonder grant hoort de pagina eerlijk "alleen uw eigen beurten" te
tonen, en dat is het beoogde gedrag en niet een tijdelijke toestand.

## Referenties

- `supabase/migrations/2026_09_23_434_adapterstand_fonds.sql`
- `supabase/checks/2026_09_23_434_adapterstand_fonds.sql`
- `core/lib/retrieval/adapterstatus-lezer.ts`
- [[0119]] (least-privilege audittoegang met capabilities en inzagelogging),
  [[0102]] (definer-view als projectie), [[0213]] (retrievalcontract)
