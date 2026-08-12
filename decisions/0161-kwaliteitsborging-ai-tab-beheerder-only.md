# 0161 — "Kwaliteitsborging AI"-tab (assurance-view) in het nav beheerder-only

- **Status:** Geaccepteerd
- **Datum:** 2026-08-12
- **Betrokkenen:** Merlin IJzerman (opdrachtgever), Claude Code (uitvoering)

## Context

De read-only assurance-view (AQL-4 scherm 9, module `assurance`, label "Kwaliteitsborging AI", `/governance/assurance`) stond in het navigatiemenu voor **álle** fondsrollen, zonder `rolVereist`. Dat was een bewuste keuze bij de bouw: de view geeft audit-/kwaliteitsinzage en een fonds mag zich daar niet per ongeluk van uitsluiten. In de huidige MVP voegt de view voor niet-beheerders echter nog niets toe (de inhoud is voor hen niet actiegericht) en vult het alleen het menu.

Randvoorwaarde die meeweegt: de module-registry is expliciet een **beschikbaarheids-registry, geen autorisatiemodel** (§9-kernrandvoorwaarde). `rolVereist` is louter UI-cosmetica; de echte autorisatie zit server-side in `requireCapability()` + RLS per route.

## Besluit

Zet `rolVereist: "beheerder"` op de `assurance`-module, net als `beheer` (Catalogus & organen) en `governance` (Governance Log). Daardoor tonen we de tab in het nav **alleen aan de beheerder**. De route en de server-side gate blijven ongewijzigd: de data komt uit het gecureerde endpoint `/api/aqlab/assurance`, dat zijn eigen autorisatie afdwingt.

## Overwogen alternatieven

- **Laten staan voor alle rollen** — verworpen: voegt in de MVP niets toe voor niet-beheerders en vertroebelt hun menu.
- **Module via het manifest uitzetten** — verworpen: `assurance` is `manifestBeheerbaar: false` (kern-audit-infra, zodat een fonds zich niet per ongeluk uitsluit), en manifest-uit zou de view óók voor de beheerder verbergen. Nav-rol is het juiste, fijnere instrument.
- **Harde server-side blokkade voor niet-beheerders toevoegen** — nu niet: het endpoint `/api/aqlab/assurance` reguleert de data al, en dit is een nav-opschoning, geen beveiligingswijziging. De route blijft dus via URL bereikbaar; kan later alsnog als aparte capability-gate.

## Gevolgen

- **Nav-only, geen beveiligingsverandering.** `rolVereist` is UI-cosmetica; `/governance/assurance` blijft technisch bereikbaar via directe URL, maar de data-autorisatie loopt onveranderd via het server-side endpoint. Geen RLS-/capability-/policy-wijziging.
- **Geen datamodel-/migratie-/audit-impact.** Alleen een registry-literal + comment.
- **Draait een eerdere ontwerpkeuze terug.** De registry-comment ("zichtbaar voor álle fondsrollen") is geactualiseerd naar de nieuwe beslissing; append-only-conventie van het besluitlog gerespecteerd (dit besluit staat los; 0161 documenteert de wijziging).
- **Terugdraaibaar:** `rolVereist` weghalen herstelt de zichtbaarheid voor alle rollen. Herzien zodra de assurance-view ook voor niet-beheerders actiegerichte waarde krijgt.

## Referenties

- Code: `core/lib/module-registry.ts` (`assurance.rolVereist`), `core/components/Sidebar.tsx` (r. 224, nav-filter `!rolVereist || rolVereist === gebruikerRol`), `app/(dashboard)/governance/assurance/page.tsx`, endpoint `app/api/aqlab/assurance`. Commit `7d97f9a` (2026-08-12, `main`).
- Kader: `core/lib/module-registry.ts` §9-randvoorwaarde (beschikbaarheids-registry ≠ autorisatie).
