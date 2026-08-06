# Nulgrens-regressiepoort (G23 / FR-9) — bestuurdersstand

> **Type:** vaste, herhaalbare **poort vóór oplevering** die bewijst dat het
> assistentgedrag van de bestaande rollen (bestuurder, voorzitter, beheerder) niet
> wijzigt door de bureau-increments (T1/T2). De nulgrens is een **aantoonbaarheids­doel,
> geen belofte** (ontwerp §7.5, besluit
> [`0130`](../decisions/0130-nulgrens-harde-opleveringsvoorwaarde.md); dekking en
> slaagcriterium: besluit [`0132`](../decisions/0132-nulgrens-regressiepoort-dekking.md),
> B-9). Guardrail **G23** in het register
> [`../core/lib/guardrailkader.ts`](../core/lib/guardrailkader.ts).

## 1. De randvoorwaarde

> **Een bestuurder, voorzitter of beheerder krijgt na dit increment exact hetzelfde
> antwoord op exact dezelfde vraag als daarvoor.** (ontwerp §7.5)

Constructief geborgd: `TOON_BLOK` en alle bestaande `SP_*`-regels byte-voor-byte
ongewijzigd; de bureau-toon zit in een **apart, default-off** blok `TOON_BLOK_BUREAU`;
de zeven antwoordmodi en hun retrievalfilters ongewijzigd (er komt geen modus bij); de
bureau-taakinstructies staan in de **gebruikersprompt**, niet in de systeemprompt.

Omdat de bureau-taken in dezelfde chat-route en generatiekern landen, is "niets
gewijzigd" een **regressiedoel**, geen structurele garantie. Vandaar deze poort.

## 2. Het tweeledige slaagcriterium (B-9)

De poort is **groen** dan en slechts dan als **beide** legs groen zijn:

### (a) Byte-identieke prompts — geautomatiseerd

`npm run sanity` is groen op de sha256-pins in
[`../core/lib/generatie-kern.sanity.ts`](../core/lib/generatie-kern.sanity.ts):
`TOON_BLOK`, `NIEUW_ROL_GEDRAG`, `NIEUW_STRUCTUUR`, `NIEUW_TOON`, `SP_SPARRING_REGELS`,
`SP_REFLECTIE_REGELS`, `SP_REFLECTIE_CONCEPT_REGELS` en de statische
combineer-/dyn-assemblages zijn ongewijzigd. Kantelt één van deze zeven pins, dan is de
bestuurders-prompt of de assemblage veranderd en is de nulgrens **niet** gehaald. Dat de
T2-pins (`TOON_BLOK_BUREAU`, `static_bureau_documenten`) additief zijn en géén van de
bestaande zeven raken, is exact het byte-identiek-bewijs.

> Dit is de **diff**-leg: een deterministische, machinaal reproduceerbare vergelijking
> van de gepinde prompt-snapshots.

### (b) Gelijkblijvende eval-uitkomsten binnen de bestaande drempels — menselijk

De twee bestaande bestuurders-evalinstrumenten worden opnieuw afgetekend, met een
uitkomst **binnen dezelfde drempels** als vóór het increment:

| Instrument | Drempel | Tekent af |
| --- | --- | --- |
| [`document-doorgronden-gedrag.md`](./document-doorgronden-gedrag.md) | ≥ 2/3 per sectiecombinatie | acceptatiecriterium 14 |
| [`organisatieprofiel-gedrag.md`](./organisatieprofiel-gedrag.md) | 5/5 per casus | criteria 1/4/5 |

"Gelijkblijvend" betekent hier: dezelfde combinaties/casussen halen (minstens) dezelfde
drempel als bij de vorige aftekening. Een combinatie die eerder groen was en nu zakt, is
een **regressie** en blokkeert oplevering.

## 3. Wat deze poort NIET één-op-één meet (bewuste dekkingskeuze, B-9)

De poort is **smal** — op de bestaande instrumenten en op de prompt-byte-identiteit —
en dekt dus **niet** volledig af:

- **De zeven antwoordmodi niet elk afzonderlijk uitputtend.** De modi
  `feitelijk, bronoverzicht, historisch, duiding, besluitrijpheid, sparring,
  persoonlijke_voorbereiding` en hun retrievalfilters worden niet elk in een eigen
  regressiecasus gedekt; de twee evalsets bemonsteren specifieke combinaties, niet de
  volledige modus×filter-matrix. De byte-identiteit van de prompts (leg a) borgt dat de
  **instructie** per modus onveranderd is; dat de **uitkomst** per modus onveranderd is,
  wordt niet voor alle zeven afzonderlijk gemeten.
- **Geen numerieke output-diff.** Bij temperatuur 1.0 is het antwoord niet-deterministisch;
  de poort toetst gedrag binnen drempels, niet token-identieke output.
- **Eén indirecte koppeling blijft, en is geen gedragswijziging.** Krijgt het bureau
  `documents.status.change`, dan beïnvloedt bureau-handelen wél welke documentversie de
  assistent van de bestuurder als *actueel* ophaalt. Dat mechanisme bestond al tussen
  bestuurders (Increment I-2); wat verandert is de kring mensen die eraan draait, niet het
  assistentgedrag. Buiten de scope van deze poort, hier expliciet benoemd (ontwerp §7.5).

Dit is de dekking zoals vastgesteld in B-9: de nulgrens wordt aangetoond op de plek waar
hij het meest kan breken (de prompt-assemblage) en op de bestaande, afgetekende
instrumenten — niet als een volledige, uitputtende gedragsmatrix.

## 4. Uitvoering + aftekening

1. `npm run sanity` — leg (a). Slotregel "Alle sanity-suites groen" **en** de
   `generatie-kern`-pins ongewijzigd.
2. `document-doorgronden-gedrag.md` en `organisatieprofiel-gedrag.md` opnieuw draaien en
   aftekenen — leg (b).

- **Leg (a) byte-identieke prompts:** ▢ groen (`generatie-kern.sanity.ts` pins ongewijzigd) ▢ niet
- **Leg (b) document-doorgronden:** ▢ gelijk gebleven binnen ≥2/3 ▢ regressie — _…_
- **Leg (b) organisatieprofiel:** ▢ gelijk gebleven binnen 5/5 ▢ regressie — _…_
- **Poort-oordeel:** ▢ GROEN (beide legs) → oplevering toegestaan ▢ ROOD → blokkeert
- **Datum / commit-hash:** _…_
- **Reviewer:** _…_ · **Opdrachtgever-akkoord:** _…_

> Deze poort is een **harde opleveringsvoorwaarde** (B-3a, besluit `0130`). Rood = de
> bureau-increments mogen niet live tot de oorzaak is hersteld en de poort opnieuw groen is.
