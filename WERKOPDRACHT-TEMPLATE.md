# Werkopdracht-template — overdracht van plansessie naar Claude Code

> Gebruik dit sjabloon om een hier (in Cowork) goedgekeurd plan over te dragen aan Claude Code. Plak de ingevulde werkopdracht als eerste bericht in een Claude Code-sessie in de repo-root. Zie ook `decisions/0004`.

---

## Werkopdracht: <korte titel>

**Doel & context** — (1–2 zinnen: wat gaan we bereiken en waarom)

**Goedgekeurd ontwerp/plan** — verwijzing naar het ontwerpdocument (`<naam>-ONTWERP.md`) of een korte samenvatting van de afgesproken aanpak. Dit is leidend.

**Scope**
- Wel: <wat er gebouwd/gewijzigd wordt>
- Niet: <wat expliciet buiten scope blijft>

**Relevante bestanden / modules** — <paden die geraakt worden, voor zover bekend; Claude Code verifieert tegen de werkelijke code>

**Guardrails (zie `CLAUDE.md`)** — bevestig naleving van: RLS per `fonds_id` (alleen anon-key), append-only audit, human-in-the-loop, migratie-eerst-dan-deploy, snapshot-integriteit, geen schijnzekerheid.

**In te zetten subagents (zie `SUBAGENTS-ONTWERP.md` §4 trigger-matrix)** — bijv. `supabase-rls-reviewer`, `audit-evidence-reviewer`, `ai-governance-reviewer`, `code-reviewer`; en `ontwerp-sync-reviewer` vóór merge.

**Werkmodus** — begin in **Plan-modus**: lever eerst een implementatieplan (bestanden, RLS-impact, migratie-impact, testaanpak, risico's). **Wijzig pas na expliciet akkoord.**

**Definition of Done (zie `CLAUDE.md`)** — functionaliteit volgens requirements; RLS gecontroleerd; audit-logging meegenomen; tests toegevoegd of gemotiveerd niet; `tsc --noEmit --skipLibCheck` groen; ontwerpdoc bijgewerkt + sync-check groen; `HANDOVER.md` release-historie bijgewerkt; bij een besluit een `decisions/`-entry.

**Terugkoppeling** — rapporteer in het antwoordformat uit `CLAUDE.md` (samenvatting, aangepaste bestanden, RLS/security-impact, audit-impact, datamodel/migratie-impact, test/verificatie, openstaande risico's).

---

### Voorbeeld (verkort)

> **Werkopdracht: readiness-badge op de procedure-lijstpagina**
> Doel: bestuurders zien in één oogopslag of een dossier besluitrijp is. Plan: zie `PROCEDURE-MVP1-ONTWERP.md` §5 (readiness-niveaus). Scope: alleen de lijstweergave, geen nieuwe readiness-logica. Begin in Plan-modus; zet `supabase-rls-reviewer` + `code-reviewer` in; DoD volgens `CLAUDE.md`. Wijzig pas na mijn akkoord.
