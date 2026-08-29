# 0195 — Onvervulbare `evaluation`-vereiste, het `ai_validation`-gat, en de vervullingspad-poort in de definitielaag

- **Status:** Geaccepteerd
- **Datum:** 2026-08-29
- **Betrokkenen:** Merlin IJzerman (opdrachtgever/eigenaar), Claude (analyse en uitwerking)

## Context

De verkenning voor [#192](https://github.com/merlinijzerman/Bestuurdersportaal/issues/192) (kiezer-UI voor het koppelen van bestaande artefacten) liep vast op één vraag: hoe ontstaan `decision_evaluations`-rijen eigenlijk? De kiezer kan alleen een *bestaand* feit aanbieden; bestaat er geen aanmaakpad, dan is de affordance een doodlopende weg. De vraag kende drie uitkomsten (lifecycle-gecreëerd → gewone kiezer; alleen seed → uitgeschakelde affordance mét reden; tóch een pad → gewone kiezer), met de opdracht dat vóór het bouwen van die tak vast te stellen — en meteen te checken of een lópende procesdefinitie het type `evaluation` gebruikt, want dan staat er vandaag een onvervulbare vereiste in omloop.

Beide vragen zijn beantwoord tegen de code (migraties leidend). Dit besluit legt de uitkomst vast, ontkoppeld van #192 zelf: het overleeft elke rebase of herbouw van die branch.

## Besluit

**1. `evaluation` is vandaag decoratief — geen aanmaakpad.** `decision_evaluations` (`supabase/migrations/2026_05_07_decision_object.sql:244`) wordt door **geen enkel** runtime-pad gevuld: geen API-route (`app/api/decisions/[id]/` kent `assumptions`, `risks`, `conditions`, `ai-interactions` — géén `evaluations`), geen lifecycle-/statustransitie, geen RPC/SECURITY DEFINER-insert, en geen productseed. De enige `insert` in de hele repo staat in een check-bestand (`supabase/checks/2026_08_27_p3c_afwijking.sql:293`) dat daarvoor eerst de binding-trigger uitzet. Het type is wél volledig bedraad (CHECK-enum, `REQUIREMENT_BRON[evaluation] → decision_evaluations`, `core/lib/requirement-bron.ts:51`); alleen de datavulling ontbreekt sinds introductie.

**2. `ai_validation` zit in dezelfde klasse, met één nuance.** `decision_ai_interactions` heeft een *validatie*flow — een **PATCH** die een bestaande rij valideert (`app/api/decisions/[id]/ai-interactions/[aiid]/route.ts`) — maar **geen aanmaak-affordance**: er is geen POST/insert-route; repo-breed is de enige insert opnieuw datzelfde check-bestand. Bevestigd als bekend gat in `HANDOVER.md:441` / `:1170` ("er is geen aparte INSERT-route voor `decision_ai_interactions`"). Er is dus een pad om te valideren, maar niets dat er iets in zet.

**3. De kiezer toont een type zonder vervullingspad als uitgeschakelde affordance mét reden — niet als gewone kiezer, en niet afwezig.** Voor `evaluation` (en, tot een aanmaakpad bestaat, `ai_validation`) betekent dat: de knop staat er, uitgeschakeld, met de reden "voor dit type bestaat nog geen manier om een feit vast te leggen" en waar mogelijk de route eruit. Dezelfde filosofie als het I1-slot en het drie-toestanden-onderscheid uit [[0193]] §7 (*geen vereisten gekoppeld* ≠ *vervuld* ≠ *iets open*): geen stille geruststelling, geen raadselachtige lege lijst. Afwezigheid van de affordance zou de gebruiker laten raden; een gewone kiezer met een altijd-lege lijst is een doodlopende weg.

**4. De definitielaag (importer, fase C) moet waarschuwen zodra een auteur een requirement-type zonder vervullingspad kiest.** Dit was in [[0193]] §7 al voorzien als toekomstige importvalidatie; het is nu geen theoretisch punt meer maar een **aangetoond geval**. De poort: bij het invoeren/publiceren van een definitie faalt (of waarschuwt hard) de importer wanneer een gekozen `requirement_type` geen runtime-aanmaakpad heeft, zolang dat pad ontbreekt. Zo kan een nieuwe definitie niet opnieuw een onvervulbare vereiste in omloop brengen.

**5. Release-voorwaarde vóór P6: `beleidswijziging_beleggingsbeleid` stap 6 moet opgelost zijn.** De seed `supabase/migrations/2026_05_08_phase_1b_template_requirements.sql:139` zet in `procedure_requirements` een vereiste `requirement_type='evaluation'`, **verplicht=true, blokkerend=true**, op stap 6 van de lópende template `beleidswijziging_beleggingsbeleid` (`core/lib/proces-templates.ts:298`, stap 6 "Implementatie & evaluatie"). Requirements worden op `template_code` geconsumeerd (`core/lib/decision.ts:539`) en op gebonden `decision_evaluations`-rijen geteld (`core/lib/decision.ts:706`). Omdat besluit 1 zegt dat zulke rijen nooit ontstaan, draagt elke procedure uit die template vandaag een **permanent onvervulbare blokkerende gate** op stap 6. Vóór P6 geldt: **óf `evaluation` krijgt een vervullingspad, óf die vereiste wordt uit de definitie gehaald.** Promoveren met een aantoonbaar onvervulbare vereiste erin is niet uit te leggen aan het eerste fonds dat dat proces draait. Op de P6-lijst ([#171](https://github.com/merlinijzerman/Bestuurdersportaal/issues/171)) naast [#192](https://github.com/merlinijzerman/Bestuurdersportaal/issues/192), [#207](https://github.com/merlinijzerman/Bestuurdersportaal/issues/207) en [#208](https://github.com/merlinijzerman/Bestuurdersportaal/issues/208).

## Overwogen alternatieven

- **`evaluation` als gewone kiezer bouwen (uitkomst a/c).** Verworpen: er is geen aanmaakpad, dus de lijst is per constructie altijd leeg. Dat is precies de doodlopende weg die de lege-staat-eis van #192 wil vermijden. De reeds bestaande #192-branch koos dit (KANDIDAAT_BRON met `evaluation`/`ai_validation` als kiesbaar) — dat wordt bij de reconciliatie gecorrigeerd naar besluit 3.
- **De onvervulbare vereiste stilzwijgend laten staan tot iemand `evaluation` een pad geeft.** Verworpen: een blokkerende gate die nooit groen kan worden is geen "nog te bouwen feature" maar een defect zodra een fonds die template draait. Het hoort expliciet op de P6-poort, niet in een backlog zonder datum.
- **De importer-waarschuwing uitstellen tot er een tweede geval is.** Verworpen: het geval is er al (besluit 5). Een structurele poort voorkomt herhaling; een incident-correctie niet.

## Gevolgen

- **#192 (kiezer-UI):** de `evaluation`- en `ai_validation`-takken worden uitgeschakelde affordances mét reden (besluit 3), niet gewone kiezers. Dit is een concrete correctie op de bestaande, nog niet gepushte branch `feat/192-kiezer-ui-koppelen`.
- **Definitielaag (fase C):** krijgt een vervullingspad-poort (besluit 4) als importvalidatie, in het verlengde van [[0193]] §7.
- **P6:** een extra release-blokkade (besluit 5) — zie de openstaande-punten (OB-E15/E16/E17) en [#171](https://github.com/merlinijzerman/Bestuurdersportaal/issues/171). Geen datamodel- of RLS-wijziging in dit besluit zelf; het is een vaststelling plus drie afgeleide acties.
- **Geen gebruiker geraakt vandaag:** er zijn nog geen fondsen in productie aangesloten (vgl. OB-E14), dus de onvervulbare gate leeft alleen op de epic-branch. Het venster is bekend en begrensd, niet stil.

## Referenties

- Verkenning #192: kandidaten-route + kiezer-UI; verdict (b) seed-only voor `evaluation`.
- Code/migraties: `supabase/migrations/2026_05_07_decision_object.sql:244` (tabel), `supabase/migrations/2026_05_08_phase_1b_template_requirements.sql:139` (de onvervulbare seed), `core/lib/proces-templates.ts:298` (live template), `core/lib/requirement-bron.ts:51` (bronmap, één bron van waarheid), `core/lib/decision.ts:539` (consumptie) / `:706` (telling), `app/api/decisions/[id]/ai-interactions/[aiid]/route.ts` (PATCH-only), `HANDOVER.md:441`/`:1170` (bevestigd `ai_validation`-gat).
- Aanpalende besluiten: [[0189]] (vervulling via gebonden feit), [[0193]] (§7 drie-toestanden-weergave + toekomstige importvalidatie), [[0194]] (#214-a schrijfpoort, P4-statusbesluiten).
- Issues: EPIC [#164](https://github.com/merlinijzerman/Bestuurdersportaal/issues/164), P6 [#171](https://github.com/merlinijzerman/Bestuurdersportaal/issues/171), [#192](https://github.com/merlinijzerman/Bestuurdersportaal/issues/192), [#207](https://github.com/merlinijzerman/Bestuurdersportaal/issues/207), [#208](https://github.com/merlinijzerman/Bestuurdersportaal/issues/208).
