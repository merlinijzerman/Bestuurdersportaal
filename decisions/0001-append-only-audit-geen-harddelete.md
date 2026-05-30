# 0001 — Append-only audit; Decision Objects niet hard-verwijderbaar

- **Status:** Geaccepteerd
- **Datum:** 2026-05-19
- **Betrokkenen:** Merlin Ijzerman; verwerkt n.a.v. `PROCEDURE-MVP1-AUDIT.md` v1.1

## Context

`governance_events` is append-only: triggers blokkeren elke UPDATE en DELETE. Tegelijk had de foreign key `governance_events.decision_id` aanvankelijk `on delete cascade` naar `decision_objects`. Bij een poging tot hard-delete van een Decision Object probeert Postgres de gekoppelde events te cascaderen → de no-delete-trigger gooit een exception → de hele delete faalt op een verwarrende manier. In de praktijk was een Decision Object daarmee al niet hard-verwijderbaar zodra er één event aan hing.

De vraag was niet alleen "hoe maken we delete weer mogelijk", maar principieel: **willen we hard-delete überhaupt toestaan** voor besluiten die in een formeel auditspoor zitten? Voor een platform dat zich positioneert op reproduceerbare besluitvorming raakt dit de kern van de propositie.

## Besluit

Decision Objects met een audit-trail zijn **principieel niet hard-verwijderbaar**. De FK `governance_events.decision_id` is gezet op `on delete restrict`, zodat het bestaande impliciete gedrag expliciet en intentioneel wordt. Annulering en afsluiting verlopen via status (`geannuleerd` / `afgewezen` / `afgesloten`), niet via delete. Demo- en testcleanup gebeurt via een aparte admin-only purge buiten de product-FK's om (nog te bouwen, geen acute behoefte).

## Overwogen alternatieven

- **`on delete cascade` (oorspronkelijk)** — botst met de no-delete-trigger en faalt onvoorspelbaar. Verworpen.
- **`on delete set null`** — werkt feitelijk niet: `set null` is een UPDATE op de child-rij en wordt door de no-update-trigger óók geblokkeerd. Verworpen.
- **`on delete restrict`** — maakt het gewenste gedrag expliciet; de foutmelding bij een poging tot delete is een schone FK-violation in plaats van een verwarrende trigger-exception. Gekozen.

## Gevolgen

- **Audit/reproduceerbaarheid:** versterkt — het auditspoor kan niet stilletjes verdwijnen.
- **Datamodel/migraties:** FK gewijzigd in `2026_05_19_review_followups.sql` (dynamische, idempotente FK-rename).
- **Beheer (geaccepteerde schuld):** demo-/testreset vraagt een aparte purge-functie/maintenance-script; ontwerp daarvan is een latere, kleine iteratie.
- **Guardrail:** vastgelegd in `CLAUDE.md` ("Hard-delete van Decision Objects met audit-trail — principieel uitgesloten").

## Referenties

- `PROCEDURE-MVP1-AUDIT.md` §5 (herframing v1.1)
- `supabase/migrations/2026_05_19_review_followups.sql`
- `HANDOVER.md` release-historie, 19 mei 2026
