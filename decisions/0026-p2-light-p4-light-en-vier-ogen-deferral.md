# 0026 — P2-light + P4-light scope en bewuste vier-ogen-deferral

- **Status:** Geaccepteerd
- **Datum:** 2026-06-26
- **Betrokkenen:** Merlin IJzerman (producteigenaar/architect), platformteam

## Context

De platform-back-office (Increment P) heeft P0 (fundament) en P1 (generieke curatie) gebouwd; van P2/P3 bestaan dunne beheerschermen (standaardcatalogus, capability grant/revoke), maar de increments zelf niet. De eerstvolgende brok is gekozen onder twee randvoorwaarden: (1) **demo-pragmatisme** — zichtbare waarde boven vooruitgebouwde plumbing; (2) **één fonds** — de FO stelt zelf dat tenant-/identiteitsbeheer (P3) pas tot z'n recht komt bij ≥2 fondsen.

Tegelijk is vier-ogen in de FO de verplichte guard op precies de gevoeligste handelingen: configuratie/feature-flags met autorisatie-/AI-routing-/compliance-impact, zware-cap-grants en identity-creatie. Vier-ogen volledig bouwen kost tijd die de demo nu niet nodig heeft. De vraag: kunnen we vier-ogen verantwoord uitstellen zonder security-schuld te creëren?

Randvoorwaarden die meewegen: harde platform/tenant-scheiding (RLS per `fonds_id` ongemoeid), audit-on-audit (`platform_event_log` append-only + hashketen), dataminimalisatie (aggregaat-first), en de no-regret-discipline uit de B14-beslisnotitie (B→C, 3b→3a) zodat opschalen additief blijft.

## Besluit

We bouwen nu **A′ (P2-light: veilige feature-flags, alleen `laag`/`midden`-impact)** en **P4-light (read-only portefeuilledashboard, aggregaat-first, live berekend)**, beide op bestaande, niet-zware capabilities (`platform.config.manage`, `platform.observability.read`). **Vier-ogen, alle `hoog`-impact handelingen, slice B (tenant-/fondsbeheer) en slice C (UI-identity-creatie + zware-cap-grant) worden doorgeschoven** — onder de harde voorwaarde dat de schema-hooks blijven staan en er een her-introductie-gate geldt vóór productie/fonds 2.

## Overwogen alternatieven

- **Vier-ogen nu volledig bouwen (FO-conform, geen deferral)** — verworpen: kost bouw-/reviewtijd voor een workflow die in een één-fonds-demo geen functie heeft; de zware caps zitten toch al niet in het actieve UI-pad.
- **Vier-ogen uitstellen én tóch `hoog`-impact flags/grants toelaten** — verworpen: dat verplaatst geen werk maar levert security-schuld op (een compliance-/autorisatieflag zonder guard). Precies de "B werkt dus blijft stilzwijgend permanent"-valkuil.
- **Optie 1 (P2/P3 numeriek afmaken: A′ + slice B)** — niet gekozen: tenant-CRUD op één fonds is grotendeels vooruitgebouwde plumbing met beperkte demo-impact.
- **Optie 2 (A′ + P4-light, demo-waarde voorop)** — gekozen: meeste zichtbare cross-fonds waarde op data die al bestaat, minste vooruitgebouwde plumbing.

## Gevolgen

- **Datamodel/migraties**: alleen `platform_feature_flags` nieuw; geen tabellen voor P4-light (live aggregatie). Geen wijziging aan tenant-tabellen/RLS.
- **Autorisatie**: geen nieuwe capability, geen seed-wijziging. `hoog`-impact flag-activatie wordt server-side geweigerd met foutcode `vier_ogen_vereist`; de UI biedt het niet aan. Deze blokkade is de zichtbare markering dat vier-ogen nog open staat.
- **No-regret (bewust geaccepteerde schuld, gemitigeerd)**: `platform_identity_capabilities.vier_ogen_door` (nullable), de self-grant/self-approval-CHECKs en de guards `valideerGrant`/`valideerRevoke` blijven in code/schema. Her-introductie van vier-ogen is daardoor een **guard-flip, geen migratie**.
- **Her-introductie-gate (hard)**: vier-ogen moet actief zijn vóór het eerste van — productiegebruik met echte fondsdata, fonds 2, externe platformmedewerkers, of P10-support. Tot dat moment blijven slice B/C en `hoog`-impact handelingen doorgeschoven.
- **AVG**: P4-light leest cross-tenant uitsluitend geaggregeerd (counts, geen documentinhoud, geen per-bestuurder-gegevens) via service-role achter de wrapper; doorklik naar fondsinhoud (`platform.logs.read`, audit-on-audit) blijft geblokkeerd tot P6. Bij latere uitbreiding: dataminimalisatie-drempel overwegen (geen weergave onder *n* gebruikers) — relevant bij kleine fondsen.
- **Beheer-/gebruikservaring**: bestuurders/platformbeheer krijgen één cross-fonds stoplichtbeeld + per-fonds feature-flags zonder deploy; de governance-strengheid (vier-ogen) komt terug bij de eerste productionele/2e-fonds-stap.

## Referenties

- FO v0.3 §9 (P2 + change control §9.2), §11 (P4), §21 (datamodel/tests).
- `04 Technische inrichting/Bestuurdersportaal - Increment P2-light en P4-light werkopdracht en bouwticket v1.0.md`.
- `mvp/lib/platform-capabilities.ts` (caps + `ZWARE_CAPABILITIES` + `platformbeheer`-profiel), `mvp/lib/platform-grant-regels.ts` (guards).
- `decisions/0006` (B14 Optie A), `0021` (P0), `0022` (P1); B14-beslisnotitie `00 Overzicht en status/… (B14) v0.2`.
