# 0160 — Classifier-verfijning: begrip × wettelijke/fiscale toets → `gecombineerd` (Epic bronselectie, T2)

- **Status:** Geaccepteerd
- **Datum:** 2026-08-12
- **Betrokkenen:** Merlin IJzerman (opdrachtgever), Claude Code (uitvoering); compliance (her-accordering meetset — openstaand)

## Context

T1 ([`0159`](./0159-representatie-constraintlaag-bronselectie.md)) leverde het constraint-mechanisme, maar kiest de minima op basis van de bestaande classificatie. De gemelde casus — een reglementair begrip getoetst aan een wettelijk/fiscaal kader ("Valt een samenwonende partner onder ons partnerbegrip volgens de Pensioenwet?") — classificeerde in `bepaalBronsoortprofiel` (die de constraints stuurt) als **`generiek`** → `fondsMin 0` → nog steeds 0 fondsbronnen. Zonder T2 verandert er voor de casus dus niets zichtbaars.

Nulmeting (meetset-first, vóór het tunen) over de 14 `BRONKEUZE_NULMETING_T1`-vragen: `bepaalBronsoortprofiel` haalde **5/14** `gecombineerd`, `bepaalBronIntent` (framing/meldingen) **12/14**. Twee oorzaken in de weeg-classifier t.o.v. de reeds-geijkte intent-classifier: `FONDS_PATRONEN` kende `/\bonze\b/` maar geen kale `/\bons\b/` ("ons partnerbegrip / ons begrip" misten het fonds-signaal), en `GENERIEK_PATRONEN` miste kale `/\bwet\b/` (Wet verevening) en elk fiscaal-signaal ("fiscale grenzen/spelregels"). De fiscaal-lacune zat óók in `bepaalBronIntent`.

Randvoorwaarden: de classificatie is pure, uitlegbare NL-heuristiek (geen modelcall), geijkt tegen de geaccordeerde meetset met **asymmetrische compliance-drempels** (een fondsvraag stil als 'algemeen' = nul-tolerantie), en elke wijziging is meetset-first aan compliance voor te leggen.

## Besluit

Breid de **gecureerde patroonlijsten conservatief uit** zodat contrast-/begripsvragen als `gecombineerd` worden herkend, in **beide** classifiers, zodat constraints (weging) én promptframing hetzelfde kader zien:

- `weeg-bronsoort.ts` — `GENERIEK_PATRONEN += /\bde wet\b/, /\bwet\b/, /fiscaal|fiscale/`; `FONDS_PATRONEN += /\bons\b/, /\b(?:het|de) huidige\b/`.
- `vraagtype.ts` — `GENERIEK_INTENT_PATRONEN += /fiscaal|fiscale/`; `FONDS_INTENT_PATRONEN += /\b(?:het|de) huidige\b/` (framing gelijk aan de constraints).

Resultaat: **17/17** in beide classifiers over de (naar 17 uitgebreide) nulmeting; de geaccordeerde 72-vragen-meetset blijft **binnen alle drempels, ongewijzigd** (geen regressie). De twee classifiers blijven **bewust gescheiden** (Increment G-weging vs. Increment I-2-framing); alleen de patronen zijn dichter bij elkaar gebracht.

## Overwogen alternatieven

- **`bepaalBronsoortprofiel` laten delegeren aan `bepaalBronIntent`** — verworpen: dat trekt de persoonlijk-/portaalobject-ankers én de `onzeker → fonds`-fallback de retrieval-weging in, wat een veel bredere gedragswijziging is dan gevraagd en de bewuste Increment-G/I-2-scheiding doorbreekt (regressierisico op álle vragen).
- **Breed samenstellings-signaal (`\w+begrip`/`\w+definitie` als fonds-anker)** — verworpen (conservatieve keuze, opdrachtgever): vangt ook ankerloze contrastvragen, maar zou een zuivere definitievraag ("wat is een partnerbegrip?") ten onrechte fondsgericht kaderen. Grotere regressiekans, meer negatieve controls nodig.
- **Contrast → `gecombineerd` forceren als aparte regel** ("hoe verhoudt … tot …") — niet nodig voor de gemeten set: de pronoun/`het huidige`- + wet/fiscaal-signalen leveren `gecombineerd` al deterministisch, met kleiner regressie-oppervlak dan een forcerende regel die op vergelijkingen zonder extern kader vals kan vuren.
- **Kaal `/partnerbegrip/` als fonds-anker** — verworpen: onnodig (alle 14 items dragen ons/onze/het huidige) en zou "wat is een partnerbegrip?" fout fonds maken.

## Gevolgen

- **Geen RLS-/tenant-impact, geen migratie, geen auditwijziging.** Pure heuristiek-libs; het auditspoor (`retrieval_meta`) blijft T3.
- **Nog niet productie-actief.** T2 stuurt alleen wélke constraints T1 kiest; het effect is zichtbaar zodra de flag **`REPRESENTATIE_CONSTRAINTS`** aan staat (T1). Flag-off → geen productiegedragswijziging.
- **Meetset-first, non-graded.** `BRONKEUZE_NULMETING_T1` is uitgebreid van 14 → 17 (items 87–89 = ankerloze `het/de huidige`-varianten) en blijft buiten de pass/fail-drempels tot compliance de meetset her-accordeert; pas dán verhuizen de geaccordeerde items naar `BRONKEUZE_MEETSET`.
- **Geen regressie (geborgd).** De 72-vragen-runner blijft groen op alle geaccordeerde drempels (`fondsvraag→stil algemeen: 0`, `foutAuto: 0%`, `terugvraag: 15,3%`, `niet-stil-verkeerd: 100%`); nieuwe sanity-asserts pinnen de contrast-cases + negatieve controls (zuiver generiek/fonds ongewijzigd).
- **Bewust geaccepteerde grens.** Een volledig ankerloze variant zónder pronoun/`huidige` (bv. "het *gehanteerde* X-begrip") blijft `generiek`/`fonds`. Conservatieve keuze; de brede variant is beschikbaar als compliance dat later wil.

## Referenties

- Code: `core/lib/weeg-bronsoort.ts` (`bepaalBronsoortprofiel`, +sanity: contrast + negatieve controls), `core/lib/vraagtype.ts` (`bepaalBronIntent`), `core/lib/bronkeuze-meetset.ts` (`BRONKEUZE_NULMETING_T1`, 14→17). Commit `216bdf8` (2026-08-12, `main`).
- Sanity: `weeg-bronsoort.sanity.ts` (16 tests groen), `bronkeuze-classificatie.sanity.ts` (72-vragen-meetset binnen drempels).
- Eerder: [`0159`](./0159-representatie-constraintlaag-bronselectie.md) (T1, mechanisme — noemt T2 als gepaird vervolg), [`0014`](./0014-increment-i2-automatische-bronkeuze.md)/[`0016`](./0016-i2-aanscherpingen-na-review.md) (bronkeuze-classifier + asymmetrische drempels).
- Ontwerp: `RAG-VERBETERING-ONTWERP.md` (Fase 5). Bron: beslisnotitie bronselectie v0.4, Deel A.
- Vervolg: T3 (auditlog `retrieval_meta`), T4 (regime-weging), T5 (vergelijkmodus op `perSourceMin`); compliance-heraccordering vóór flag-on.
