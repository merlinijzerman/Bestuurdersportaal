# 0150 — AI-leeswijzer bij het afschrift: niet-authoritatief en vastgesteld

- **Status:** Geaccepteerd
- **Datum:** 2026-08-09
- **Betrokkenen:** Merlin IJzerman, Claude Code

## Context

T6 fase 2 vervangt §2–4 van de afschrift-leeswijzer (hoe het proces verliep, wat is vastgelegd, bijzonderheden) door AI-tekst. Dat raakt precies het artefact dat reconstructie moet bewijzen: een LLM-samenvatting van een auditspoor introduceert een reconstructierisico. De randvoorwaarden: geen feit mag worden toegevoegd dat niet in de vastgelegde procesgegevens staat (laag A/B), de bundel moet áltijd genereren (ook zonder AI), en een mens moet verantwoordelijk blijven voor wat het portaal verlaat (human-in-the-loop, CLAUDE.md).

## Besluit

De AI-leeswijzer is **laag C**: gelabeld toelichtend en **niet-authoritatief**, uitsluitend gevoed door de deterministische feitenkaart (laag B), **guardrail-gecontroleerd**, met een **volledige deterministische terugval** en een **verplichte menselijke vaststelling** vóórdat de bundel wordt gebouwd.

## Overwogen alternatieven

- **AI-tekst rechtstreeks in de bundel, zonder guardrail/vaststelling** — snelst, maar laat het model feiten verzinnen in een auditstuk en verplaatst de verantwoordelijkheid naar de machine. Verworpen.
- **Vrije dossier-dump als modelinput** — geeft het model meer context maar ook meer ruimte om te fabriceren; de feitenkaart is bewust de enige, compacte input. Verworpen.
- **Geen AI (alleen sjabloon)** — de veilige ondergrens; dit is precies de terugval, niet het einddoel.

## Gevolgen

- **Guardrail (`core/lib/afschrift-guardrail.ts`):** een controle, geen afspraak — elke datum, elk getal en elke eigennaam/code in de gegenereerde §2–4 moet in de feitenkaart voorkomen. Zo niet, dan wordt de tekst geweigerd en valt de route terug op het sjabloon (`ai_leeswijzer=false`). Eigen `.sanity.ts`.
- **Altijd genereren:** lege `ANTHROPIC_API_KEY`, een call-fout of een guardrail-afkeuring leiden tot het deterministische sjabloon, nooit tot een fout richting de gebruiker.
- **Vaststelling:** de conceptleeswijzer wordt in een bewerkbaar tussenscherm getoond, geredigeerd en vastgesteld; pas dan bouwt de worker. De DB-CHECK `status='gereed' → ai_vastgesteld_door not null OR ai_leeswijzer=false` borgt dat ongelezen AI-tekst het portaal niet verlaat. De vastgestelde tekst (`ai_leeswijzer_tekst`) is wat in de bundel komt — ook als zij is geredigeerd.
- **Herkomst:** §6 van de leeswijzer draagt bij een AI-leeswijzer een herkomstblok (model, promptversie, generatietijdstip, sha256 van de tekst, vaststeller + datum); het statuskader wisselt dan naar de "voorbereid met AI, vastgesteld door ⟨naam⟩"-formulering.
- **Restrisico (R1):** sommige accountants eisen expliciete disclosure van AI-gebruik of wijzen AI-tekst af. Het herkomstblok dekt de disclosure; de bundel is zonder de leeswijzer volwaardig, en de sjabloonvariant is altijd beschikbaar.

## Referenties

- Werkopdracht T6 v1.0, fase 2 / ADR-4. Besluiten 0098 (herkomst constructief afgedwongen), 0025 (human-in-the-loop). `core/lib/afschrift-guardrail.ts`, `app/api/procedures/[id]/afschrift/concept/route.ts`, migratie `2026_08_09_afschrift_ai_tekst.sql`. [[0146-afschrift-als-vastgelegd-record]].
