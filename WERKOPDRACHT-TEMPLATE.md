# Werkopdracht-template — overdracht van plansessie naar Claude Code

> Gebruik dit sjabloon om een hier (in Cowork) goedgekeurd plan over te dragen aan Claude Code. Plak de ingevulde werkopdracht als eerste bericht in een Claude Code-sessie in de repo-root. Zie ook `decisions/0004`.

---

## Werkopdracht: <korte titel>

**Doel & context** — (1–2 zinnen: wat gaan we bereiken en waarom)

**Goedgekeurd ontwerp/plan** — verwijzing naar het ontwerpdocument (`<naam>-ONTWERP.md`) of een korte samenvatting van de afgesproken aanpak. Dit is leidend.

**Scope**
- Wel: <wat er gebouwd/gewijzigd wordt>
- Niet: <wat expliciet buiten scope blijft>

**Impactklasse** — kies: **architectuur** / **data** / **security** / **tenant** / **alleen UI-of-frontend**. Vul dit in de plansessie in; het is een scopebeslissing, geen bouwbeslissing.

Deze klasse bepaalt twee dingen die anders pas achteraf blijken:

1. **Vuurt de documentatiehaak?** Bij architectuur-, data-, security- of tenant-impact wordt de projectdocumentatie geactualiseerd volgens `00 Overzicht en status/release-template.md` (de `00–09`-markdown én de as-built Word-doc als momentopname), en verschuift de marker in `00 Overzicht en status/doc-actualisatie-log.md` — **pas ná** de Word-doc-actualisatie, nooit vooruit. Bij een kleine release volstaat `HANDOVER.md`. Zie `CLAUDE.md` §Definition of Done, laatste bullet.
2. **Moeten de structurele gates draaien?** Bij een wijziging aan policies, grants, `SECURITY DEFINER`-functies of het datamodel is `supabase/checks/2026_07_31_r1_structurele_gates.sql` schoon draaien tegen de doeldatabase een niet-onderhandelbare eis, ook als "gates" verder buiten de scope van de opdracht vallen. Bouwen en controleren zijn twee verschillende dingen.

Weeg de klasse expliciet en leg de weging vast, ook als de uitkomst "klein" is — dat is het patroon dat `doc-actualisatie-log.md` al hanteert.

**Relevante bestanden / modules** — <paden die geraakt worden, voor zover bekend; Claude Code verifieert tegen de werkelijke code>

**Guardrails (zie `CLAUDE.md` §Niet-onderhandelbare guardrails)** — bevestig naleving; noem hier alleen wat voor déze opdracht bijzondere aandacht vraagt.

**In te zetten subagents (zie `SUBAGENTS-ONTWERP.md` §4 trigger-matrix)** — bijv. `supabase-rls-reviewer`, `audit-evidence-reviewer`, `ai-governance-reviewer`, `code-reviewer`; en `ontwerp-sync-reviewer` vóór merge.

**Werkmodus** — begin in **Plan-modus**: lever eerst een implementatieplan (bestanden, RLS-impact, migratie-impact, testaanpak, risico's). **Wijzig pas na expliciet akkoord.**

**Definition of Done** — volg `CLAUDE.md` §Definition of Done. **Neem die lijst hier niet over**; noem alleen de opdracht-specifieke invulling (welk ontwerpdoc, welk decision-record, welke tests). De lijst in `CLAUDE.md` is de gezaghebbende versie en wordt elke sessie geladen — een kopie in dit sjabloon loopt onvermijdelijk achter.

> *Waarom die regel er staat: tot 03-08-2026 stond hier een uitgeschreven kopie van de DoD. Die miste drie items uit `CLAUDE.md` — "UX consistent met bestaande patronen", de verplichte gate-run bij datamodelwijzigingen, en de hele documentatiehaak. Werkopdrachten die de kopie volgden, leverden daardoor aantoonbaar incompleet op (zie `openstaande-punten-en-risicos.md` OP-D2).*

**Openstaande punten** — nieuwe restrisico's, bewust uitgestelde onderdelen en interim-oplossingen worden opgenomen in `00 Overzicht en status/openstaande-punten-en-risicos.md`, **mét eigenaar**. Een punt dat alleen in de release-historie of in de terugkoppeling staat, geldt als niet belegd. *(Les uit OP-C1: een actie bleef vijf weken in een release-historie-regel hangen zonder opvolging.)*

**Terugkoppeling** — rapporteer in het antwoordformat uit `CLAUDE.md` (samenvatting, aangepaste bestanden, RLS/security-impact, audit-impact, datamodel/migratie-impact, test/verificatie, openstaande risico's).

---

### Voorbeeld (verkort)

> **Werkopdracht: readiness-badge op de procedure-lijstpagina**
> Doel: bestuurders zien in één oogopslag of een dossier besluitrijp is. Plan: zie `PROCEDURE-MVP1-ONTWERP.md` §5 (readiness-niveaus). Scope: alleen de lijstweergave, geen nieuwe readiness-logica. **Impactklasse: alleen UI** — geen migratie, geen policy, geen nieuwe tabel; documentatiehaak vuurt niet, `HANDOVER.md` volstaat; gates niet vereist. Begin in Plan-modus; zet `supabase-rls-reviewer` + `code-reviewer` in; DoD volgens `CLAUDE.md`. Wijzig pas na mijn akkoord.
