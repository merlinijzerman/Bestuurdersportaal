# Uitvoerinstructie — T14b-driftreparatie op Productie

| | |
|---|---|
| **Doel** | De drie T14b-hardeningsonderdelen alsnog op Productie zetten. |
| **Doelproject** | Productie `aebwiufuegsiwhwpdrfb` |
| **Branch** | `fix/t14b-productiedrift` (op `chore/migratie-mapindeling`) |
| **Migratie** | `supabase/migrations/2026_08_15_t14b_production_drift_repair.sql` |
| **Rollback** | `supabase/rollbacks/2026_08_15_t14b_production_drift_repair_ROLLBACK.sql` |
| **Impact** | `create or replace function` ×2 + één policy. **Geen schema- of datamutatie.** |
| **Vier ogen** | Merlin reviewt de PR; het mergen loopt via de vaste gang. |

## 1. Waarom dit apart staat van het T14b-uitvoerplan van 15 augustus

`PRODUCTIE-UITVOERPLAN-AUDITKETEN-T14B-2026-08-15.md` bundelt vier migraties:
ketenkop, forkverklaring, deze driftreparatie, en de Productie-seed met de
waargenomen hashes. Die bundel staat op **NO-GO** omdat de restore-oefening
vastliep — terecht, want stap 1, 2 en 4 raken de append-only auditketen en stap 4
is per ontwerp onomkeerbaar (de seedrollback faalt bewust gesloten).

Stap 3 — dit bestand — is van een andere orde:

| | Stap 1, 2, 4 | **Stap 3 (dit bestand)** |
|---|---|---|
| Schemamutatie | ja | **nee** |
| Datamutatie | ja (append-only insert) | **nee** |
| Terugdraaibaar | deels; seed bewust niet | **ja, gerichte rollback aanwezig** |
| Raakt de ketenintegriteit | ja | nee |

Daarom wordt stap 3 hier losgetrokken. Dat is een bewuste
proportionaliteitskeuze en geen omzeiling van de NO-GO: stap 1, 2 en 4 blijven
geblokkeerd tot de restore-oefening slaagt.

## 2. Wat er vandaag mis is — gemeten, niet aangenomen

Uitslag van `supabase/checks/2026_08_19_t14b_driftmeting.sql` op Productie,
19 augustus 2026:

| Onderdeel | Uitkomst |
|---|---|
| volledige rij-capture | **DRIFT** |
| no-op-guard | OK |
| actor-anti-spoofing op log-insert | **DRIFT** |
| RPC weigert JSON-null | **DRIFT** |
| RPC bron-allowlist op DB-niveau | **DRIFT** |

Gevolgen, in volgorde van ernst:

1. **Wijzigingen verdwijnen zonder spoor.** De capture bouwt een handgekozen
   veldenlijst; de no-op-guard vergelijkt diezelfde lijst. Verandert een kolom
   die er niet in staat, dan ziet de guard geen verschil en keert de trigger
   vroeg terug — er wordt **geen** logregel geschreven. Twaalf inhoudskolommen
   vallen daaronder, waaronder `kpi.toelichting`, `reeks.kleur` en `delta`:
   precies de velden die de duiding van een getal bepalen.
2. **Het log kan een andere actor dragen.** De policy bindt `gebruiker_id` niet
   aan `auth.uid()`. Een directe insert kan een collega als actor opvoeren.
   Samen met (1): echte wijzigingen verdwijnen, verzonnen wijzigingen kunnen
   erin, op andermans naam.
3. **JSON-null passeert de balanscheck.** `sum()` negeert nulls, dus een post op
   `null` maakt de balans "sluitend" en schrijft een NULL weg.
4. **`bron` alleen app-side gevalideerd.** De RPC is `security invoker` en via
   de Data API bereikbaar; een directe aanroep gaat langs de applicatie.

**Oorzaak.** `2026_07_17_t14b_stuurinfo_audit_hardening.sql` staat sinds 17 juli
op `main` en definieert alle drie de onderdelen. Productie draait nog de
voorganger. Geen latere migratie herdefinieert de functie of de policy — er is
niets overschreven. Een gemergede migratie heeft Productie nooit bereikt, en dat
bleef vier weken onopgemerkt omdat er geen versieregister is.

## 3. Veiligheidseigenschappen van de migratie

- **Eén transactie.** Het bestand opent met `begin;` en sluit met `commit;`.
- **Fail-closed eindcontrole.** Het slot-`DO`-block toetst vijf dingen en gooit
  `T14B_DRIFT_REPAIR_MISLUKT` als er één niet klopt: de capture gebruikt de
  volledige rij, de policy bindt de actor, de RPC valideert typen, `anon` heeft
  **geen** EXECUTE en `authenticated` heeft die **wel**. Faalt de controle, dan
  rolt de hele transactie terug en is er niets toegepast.
- **Gerichte rollback aanwezig**, die capture, policy en RPC terugzet naar de
  T14-basisversie en de grant-hygiëne intact laat.

## 4. Uitvoering

Voorwaarde vooraf: de PR is gereviewd (vier ogen) en gemerged, zodat het bestand
dat je plakt aantoonbaar op `main` staat. **Niet uitvoeren vanuit een werkboom** —
dat is precies hoe deze drift is ontstaan.

1. Verse Productieback-up, checksum genoteerd.
2. Nulmeting: `supabase/checks/2026_08_19_t14b_driftmeting.sql` op Productie.
   Verwacht: vier DRIFT.
3. `supabase/migrations/2026_08_15_t14b_production_drift_repair.sql` in één keer
   plakken in de SQL Editor van `aebwiufuegsiwhwpdrfb` en uitvoeren. Het bestand
   is transactioneel; niet opknippen.
4. Nameting: dezelfde check opnieuw. **Verwacht: alle vijf OK.** Is dat niet zo,
   dan is de eindcontrole ten onrechte gepasseerd — stop en onderzoek.
5. `supabase/checks/2026_07_31_r1_structurele_gates.sql` tegen Productie.
6. Eén gecontroleerde stuurinfo-wijziging via de applicatie, en controleer dat er
   nu wél een logregel verschijnt bij een aanpassing van een veld dat vóór deze
   migratie onzichtbaar was — bijvoorbeeld `toelichting` op een KPI. Dit is de
   enige stap die aantoont dat het gat werkelijk dicht is.
7. Uitvoering vastleggen: datum, tijd, back-upreferentie, uitvoerder, en de
   uitslag van 2 en 4.

## 5. Bij een rode nameting

Draai `supabase/rollbacks/2026_08_15_t14b_production_drift_repair_ROLLBACK.sql`.
Die zet capture, policy en RPC terug naar de T14-basisversie — dat is de
toestand van vóór stap 3, niet een lege toestand. Daarna: bewijs bewaren,
niet improviseren, en het T14b-uitvoerplan raadplegen voor de bredere keten.

## 6. Uitvoerrecord

```text
Back-upreferentie:
Nulmeting (verwacht 4× DRIFT):
Datum/tijd uitvoering:
Nameting (verwacht 5× OK):
Structurele gates:
Applicatietest toelichting-veld:
Uitvoerder:
Reviewer (vier ogen):
```
