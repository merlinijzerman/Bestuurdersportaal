# 0170 — Reflectieconcept: feiten richten op het eigen punt + spiegelende slotvraag

- **Status:** Geaccepteerd (impl.; B-opt fit-vervolg)
- **Datum:** 2026-08-12
- **Betrokkenen:** Merlin (opdrachtgever), ontwikkeling

## Context

Bij live-validatie van de geoptimaliseerde reflectiefunctie viel op dat de conceptsectie **"Wat hierover al vaststond" niet aansloot op de eigen twijfel van de bestuurder**. Casus: de bestuurder twijfelde of het risicopreferentieonderzoek uit 2023 nog actueel genoeg was voor de Wtp-regeling; de feiten-sectie recite020erde vervolgens het complete wettelijk kader (art. 14b/14d, opbouwfase-standaardvariant, ABTN-startpunt) zonder één woord over actualiteit, onderzoek of spreiding. Feitelijk correct, maar het las als een samenvatting van het oorspronkelijke antwoord in plaats van een spiegel van *zijn* punt.

Oorzaak was geen bug maar een bewuste keuze uit [[0166]]: `SP_REFLECTIE_CONCEPT_REGELS` verbood expliciet een *relevantie-oordeel* (§F-rationale — voorkomen dat de AI zelf bepaalt wat belangrijk is). Bijeffect: een brede dump i.p.v. de feiten die op het eigen punt slaan.

## Besluit

Twee gerichte wijzigingen aan `SP_REFLECTIE_CONCEPT_REGELS` (gepind), goedgekeurd op exacte tekst:

1. **Feiten richten op het eigen punt.** "Geen relevantie-oordeel" is vervangen door: *kies en orden uit de reeds-geciteerde passages díe die raken aan wat de bestuurder zelf inbracht (zijn overweging of open vraag), en laat kaderinformatie weg die zijn punt niet raakt; ten hoogste vier korte passages.* Expliciet begrensd: **spiegelen, geen weging** — de assistent bepaalt niet wat zwaarder telt, legt geen nieuw verband tussen bronnen, en voegt geen feit, cijfer of conclusie toe. Dit is een **begrensde versoepeling** van het non-oordeel-principe: selecteren op "wat híj inbracht" is spiegelen (regie bij de bestuurder), niet de AI die importantie weegt.

2. **Spiegelende slotvraag.** Vóór de vaste privacy-slotzin komt precies: **"Herkent u zich in dit beeld, of mist er nog iets?"** — een *vaste* zin (niet modelgegenereerd), zodat er geen sturings- of validatierisico op de ongevalideerde, gestreamde conceptbeurt ontstaat. De openingsregel is aangepast van "u stelt geen vraag meer" naar "u stelt geen **nieuwe verdiepingsvraag** meer; de enige toegestane vraag is de vaste slotvraag onderaan". De vraag geeft de regie terug aan de bestuurder en versterkt daarmee het spiegel-uitgangspunt; ze is geen conclusie.

## Borging

- `core/lib/generatie-kern.ts` — nieuwe tekst; nieuwe sha256-pin `c3fa54c8…` in `generatie-kern.sanity.ts`.
- Content-guard uitgebreid (`generatie-kern.sanity.ts`): borgt dat "raken aan wat de bestuurder zelf heeft ingebracht" en "spiegelen, geen weging" aanwezig zijn, dat "geen relevantie-oordeel" **niet** terugsluipt, en dat de vaste slotvraag + "geen nieuwe verdiepingsvraag meer" letterlijk in de prompt staan.
- Alle bestaande concept-asserts blijven gelden (drie kopjes, tweede persoon, voorwaardelijke secties, vaste privacy-slotzin, geen 0113-labels, herkomstverbod).

## Gevolgen

- Geen datamodel-/RLS-/migratie-/loggingwijziging: puur prompt + guard. De lichte bronweergave ([[0166]]) en het non-markeringsprincipe ([[0112]]) blijven ongemoeid.
- De 0167-guardrails blijven intact: de feiten-sectie voegt nog steeds geen inhoud toe en is geen conclusie; de slotvraag is deterministisch en niet de verdiepingsvraag (die houdt zijn eigen validator + uitweg).
- Fit is nu een ontwerpkeuze i.p.v. toeval, maar de uitkomst blijft niet-deterministisch — dit is precies een signaal voor de post-hoc gebruikerstoets ([[0164]], criterium 5/8).

## Referenties

- `VOORSTEL-REFLECTIE-OPTIMALISATIE.md` §F · FO "Reflectiefunctie en verwijderbare gesprekken v1.0" §9.6/§9.7
- [[0166]] (conceptformat dat hiermee wordt verfijnd), [[0167]] (guardrails), [[0112]], [[0164]]
