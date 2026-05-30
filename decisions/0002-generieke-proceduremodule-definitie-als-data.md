# 0002 — Generieke proceduremodule: definitie als data, bouwblok-engine uitgesteld

- **Status:** Geaccepteerd (richting; implementatie volgt fase B e.v.)
- **Datum:** 2026-05-22
- **Betrokkenen:** Merlin Ijzerman

## Context

Procedure-templates zijn nu hardcoded in `lib/proces-templates.ts`; elke nieuwe of gewijzigde procedure vereist een code-deploy. De wens is een generieke proceduremodule die veel (pensioen)procedures ondersteunt — zonder onnodige complexiteit, en gebruiks- én beheervriendelijk. Reviewfeedback stelde voor om naast een data-registry een formele abstractielaag toe te voegen: herbruikbare bouwblokken + procedureprofielen + een compositiemechanisme (incl. `applicability_rules` / `override_policy`).

Belangrijke observatie: hergebruik en conditionele activatie bestaan al op requirement-niveau (`requirement_type` + `triggert_bij_*` op classificatie). Een bouwbloklaag op stap-niveau dupliceert dat mechanisme grotendeels één niveau hoger.

## Besluit

Procedure-**definitie als data**: één canoniek formaat (`ProcedureDefinitie`) + registry-tabellen (`procedure_templates` / `_stappen` / `_checklist`) met versionering. De engine, het Decision Object en de readiness-ladder blijven ongewijzigd en lezen voortaan uit de registry, met code-fallback tijdens de transitie. De eindgebruikerservaring loopt via een **intakewizard** die gebruikerstaal vertaalt naar classificatie, plus progressive disclosure per rol en drie vrijheidsniveaus.

De formele **bouwblok-compositie-engine wordt bewust uitgesteld**. Herbeoordeling op een vast moment (fase B2, ná het uitwerken van drie representatieve procedures) tegen meetbare go/no-go-criteria. Een generieke rules-engine (`applicability_rules` / `override_policy`) wordt sowieso niet gebouwd.

## Overwogen alternatieven

- **Hardcoded templates houden** — verworpen; dit is precies de bottleneck.
- **Direct een bouwblok-/profiel-compositielaag bouwen** — uitgesteld: premature abstraction vóór de concrete procedures zijn uitgeschreven, met risico op een tweede configuratiemodel dat het beheer juist compliceert. Het beloofde hergebruik bestaat grotendeels al op requirement-niveau.
- **Definitie-als-data zónder UX-laag** — onvoldoende; mist de eenvoud voor de eindgebruiker, die een kernvereiste is.

## Gevolgen

- **Gebruiks-/beheervriendelijkheid:** simpele intakebeleving aan de voorkant; geen tweede configuratie-/rules-engine om te onderhouden.
- **Reproduceerbaarheid:** snapshot-bij-start en `template_versie` blijven leidend; lopende procedures wijzigen niet mee.
- **Geaccepteerde schuld:** verlies van compile-time-zekerheid wordt opgevangen met Zod-validatie + tests; twee voorgestelde requirement-types (`external_submission`, `consultation`) mogen alleen toe als readiness-check én evidence-lijst ze daadwerkelijk meetellen.
- **Open vervolgbesluit:** de bouwblokkenlaag krijgt een eigen besluit-entry zodra fase B2 is afgerond (go of no-go op de criteria in het ontwerpdoc §11).

## Referenties

- `PROCEDURE-GENERIEK-ONTWERP.md` (v0.2 — §6 UX, §10 fasering, §11 uitgestelde bouwblokbeslissing met criteria)
- `lib/proces-templates.ts`
- `procedure_requirements` (migraties `2026_05_08_phase_1b_*` / `_1c_*`)
