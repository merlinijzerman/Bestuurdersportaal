# 0003 — Laag-A-subagents als ontwikkel-werkwijze (review + ontwerpborging)

- **Status:** Geaccepteerd
- **Datum:** 2026-05-22
- **Betrokkenen:** Merlin Ijzerman

## Context

De codebase evolueert snel en ontwerpdocumenten lopen daardoor achter op de werkelijke code — `HANDOVER.md` benoemt zelf dat `schema.sql` achterloopt op de migraties. We willen gecontroleerde, aantoonbare ontwikkeling (RLS, append-only audit, AI-governance, ontwerpconsistentie) zonder het proces bureaucratisch te maken. Claude Code-subagents kunnen dit review- en ontwerpwerk consistenter maken, maar mogen de menselijke verantwoordelijkheid niet overnemen.

## Besluit

We richten een **lean set van zes kern-subagents** in als ontwikkel-werkwijze (laag A): `ontwerp-author`, `ontwerp-sync-reviewer`, `supabase-rls-reviewer`, `audit-evidence-reviewer`, `ai-governance-reviewer` en `code-reviewer`. Uitgangspunten: subagents adviseren/controleren/stellen op maar **besluiten nooit** (human-in-the-loop); reviewers zijn **read-only** (alleen `ontwerp-author` mag schrijven, uitsluitend in `*-ONTWERP.md`); de **code/migraties zijn de bron van waarheid**. Inzet wordt gestuurd door een trigger-matrix, met een expliciete "wanneer géén subagent"-regel om de workflow lean te houden. Twee optionele agents (`test-engineer`, `ai-literacy-ux-reviewer`) volgen in Fase 2; een `release-readiness-reviewer` is uitgesteld naar de pilotfase.

## Overwogen alternatieven

- **Geen subagents, alles handmatig reviewen** — verworpen: inconsistent en foutgevoelig bij een snel evoluerende codebase.
- **Alle agents tegelijk activeren + de AI-governance-functies formaliseren** — verworpen voor de MVP: te zwaar; de governance-functies zijn een organisatorische (laag B) zaak, niet een dev-tool.
- **Een aparte `security-reviewer`** — verworpen: security is expliciet ondergebracht in `code-reviewer`, `supabase-rls-reviewer` en `audit-evidence-reviewer` om de set niet te verzwaren.

## Gevolgen

- **Kwaliteit/governance:** consistentere review op RLS, auditability en AI-governance; ontwerpdrift wordt eerder gevonden via de `ontwerp-sync-reviewer`.
- **Werkwijze:** de Definition of Done in `CLAUDE.md` is aangevuld met "bij een niet-triviale feature: ontwerpdoc opgesteld/bijgewerkt en de ontwerp-sync-check groen", zodat opstellen én onderhouden een harde voorwaarde is.
- **Veiligheid:** read-only by default beperkt het risico dat een reviewer ongevraagd code wijzigt; `ontwerp-author` heeft een stopregel tegen schrijven buiten `*-ONTWERP.md`.
- **Geaccepteerde lichte proceslast:** gemitigeerd met de "wanneer géén subagent"-regel.
- **Activatie:** de zes kernagents staan in `.claude/agents/`. De `.claude/`-map is geblokkeerd voor de bestandstools van de Cowork-sessie; de bestanden zijn daarom eerst in `subagents/` aangemaakt en via de shell naar `.claude/agents/` verplaatst.

## Referenties

- `SUBAGENTS-ONTWERP.md` (v0.2 — definities, trigger-matrix §4, activatievolgorde §6)
- `AI-GOVERNANCE-ONTWERP.md` (laag A vs. laag B; menselijke functies)
- `CLAUDE.md` (Werkmodus + aangevulde Definition of Done)
- `.claude/agents/` (de zes kernagent-bestanden, geactiveerd voor Claude Code)
