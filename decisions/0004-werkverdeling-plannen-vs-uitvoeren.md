# 0004 — Werkverdeling: plannen in Cowork, uitvoeren in Claude Code

- **Status:** Geaccepteerd
- **Datum:** 2026-05-22
- **Betrokkenen:** Merlin Ijzerman

## Context

We werken in twee omgevingen: een Cowork-/plansessie (denken, analyseren, ontwerpen, documenteren) en Claude Code (werkt op de echte repository: bestanden, migraties, tests). Zonder expliciete afspraak ontstaan twee risico's: mooie plannen die niet aansluiten op de werkelijke code, of snel bouwen zonder voldoende governance- en productlogica. We willen een gecontroleerde wisselwerking met heldere rolverdeling.

## Besluit

**Plannen, ontwerpen en besluiten maken we samen in de plansessie (Cowork).** Dat omvat: analyse, requirements en acceptatiecriteria, functionele + technische ontwerpen (`*-ONTWERP.md`), besluit-entries (`decisions/`), governance, en agent-/promptdefinities. Hier wijzigen we **geen** applicatiecode, migraties of tests.

**Uitvoeren gebeurt in Claude Code**, op basis van een goedgekeurd plan/ontwerp: codewijzigingen, migraties, tests en refactors. De overdracht verloopt via een gestructureerde **werkopdracht** (`WERKOPDRACHT-TEMPLATE.md`), met de Werkmodus en de laag-A-subagents uit `CLAUDE.md`. Claude Code begint in **Plan-modus** en wijzigt pas na akkoord; na uitvoering werkt het de release-historie in `HANDOVER.md` bij en, bij een besluit, een entry in `decisions/`.

Bij een volgende plansessie blijven **code en migraties de bron van waarheid** — we toetsen de werkelijke staat, niet alleen het eerdere plan.

## Overwogen alternatieven

- **Alles in Claude Code (ook plannen)** — kan, maar mist de rustige denk-/governance-laag los van de code; vergroot het risico op snel bouwen zonder voldoende productlogica.
- **Alles in de plansessie (ook code)** — verworpen: deze omgeving werkt minder direct op de echte repository en mist de git-/test-/subagent-integratie van Claude Code.
- **Geen expliciete afspraak** — verworpen: leidt tot drift en onduidelijke verantwoordelijkheid.

## Gevolgen

- **Heldere rolverdeling**, minder drift, en menselijke besluitvorming blijft leidend.
- **Consistente overdracht**: elke opdracht aan Claude Code verloopt via de werkopdracht-template, zodat het goedgekeurde ontwerp, de relevante bestanden, de guardrails, de in te zetten subagents en de Definition of Done altijd meekomen.
- **`CLAUDE.md`-Werkmodus** krijgt een korte pointer naar deze handoff-conventie.
- **Lichte overhead** per handoff (template invullen), grotendeels gemitigeerd doordat het meeste al in het ontwerpdocument staat.

## Referenties

- `WERKOPDRACHT-TEMPLATE.md` (de handoff-brief naar Claude Code)
- `CLAUDE.md` (Werkmodus + Definition of Done)
- `SUBAGENTS-ONTWERP.md` (trigger-matrix: welke subagent bij welk type wijziging)
- `AI-GOVERNANCE-ONTWERP.md` (laag A — dev-subagents — versus laag B — governance-functies)
