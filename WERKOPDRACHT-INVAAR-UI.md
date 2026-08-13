# Werkopdracht: Invaarprocedure — UI-consumptie in Processen-detail

> WO-2 van 2. Leunt op WO-1 (merge die eerst). Plak als eerste bericht in een Claude Code-sessie in de repo-root. Zie `WERKOPDRACHT-TEMPLATE.md`.

---

**Doel & context** — Laat de Processen-module de nieuwe engine tonen op **twee** plekken: (1) de **detailpagina** (meerdere parallelle actieve stappen, per-fase fasebeschrijving, aanpasbare checklist/bewijslast, `herbevestiging_nodig`) en (2) het **totaaloverzicht** (lijstpagina) met een **afgeleide fase-status** per proces — omdat er geen sequentiële cursor meer is. Zodat de bestuurder zowel per proces als over het hele portfolio in één blik ziet waar iets staat en wat aandacht vraagt.

**Goedgekeurd ontwerp/plan** — `mvp/PROCEDURE-ENGINE-V2-ONTWERP.md` §7 (engine-consumptie) **en §7.1 (afgeleide fase-status — leidende afleidingsregels)** + visuele referenties `MOCKUP-invaarprocedure-portaalstijl-v0.2.html` (detail) en `MOCKUP-processen-overzicht-v0.1.html` (totaaloverzicht). Leidend voor gedrag is de code die WO-1 oplevert.

**Scope**
- **Wel — detailpagina:** procesfasen-rail met **meerdere gelijktijdig actieve** stappen; **fasebeschrijving** (met fonds-override) boven elke fase; affordances **"checklistpunt toevoegen"** en **"bewijslasttype toevoegen"** (type-keuze + verplicht/blokkerend), zichtbaar alléén bij de juiste capability; **`herbevestiging_nodig`-badge**; heropen-actie op een afgeronde stap; per fase een **status-pill + bewijslast-dekkingsmeter**. Géén harde-gate-weergave (het invaarproces heeft geen blokkerende afhankelijkheden).
- **Wel — totaaloverzicht (lijstpagina):** per proces een **fasestrip** met afgeleide fase-status (Afgerond / In behandeling / Nog niet begonnen) + **aandachtsstip**, een **readiness-horde**, en een tellerregel **"X/N stappen · Y% verplichte bewijslast sluitend · aandachtspunten"**; bovenaan **portfolio-samenvattingstegels** (Lopend / Met aandacht / Tijdkritisch / Besluitrijp). De statussen worden **UI-afgeleid** volgens de regels in `PROCEDURE-ENGINE-V2-ONTWERP.md` §7.1 (geen nieuwe backend/tabellen).
- **Niet:** backend/engine/datamodel (WO-1); een server-side statusaggregatie (OB-E5, latere optimalisatie); AI-controles/AI-suggesties; readiness-ladder-herontwerp.

**Impactklasse** — **alleen UI-of-frontend**. Weging: geen migratie, geen policy, geen nieuwe tabel → de documentatiehaak vuurt **niet**, `HANDOVER.md` volstaat; structurele gates niet vereist. De autorisatie zit server-side (capability-checks uit WO-1); de UI toont/verbergt alleen.

**Relevante bestanden / modules** — detail: `mvp/app/(dashboard)/procedures/[id]/page.tsx`, `_components/StapPaneel.tsx`, `_components/StapRequirementsPaneel.tsx`, `_components/ReadinessLadder.tsx`, `_components/DecisionObjectHeader.tsx`; totaaloverzicht: `mvp/app/(dashboard)/procedures/page.tsx` (lijst); evt. nieuwe componenten `FaseBeschrijving`, `VereisteToevoegen`, `FaseStrip`, `ProcesStatusregel`, portfolio-tegels. Claude Code verifieert tegen de werkelijke code.

**Guardrails (zie `CLAUDE.md`)** — UX consistent met bestaande patronen (design-tokens uit `globals.css`; status = kleur **én** woord **én** vorm, besluit 0097/0101; geen nieuwe chart-library); toevoeg-/heropen-acties verschijnen alleen wanneer de gebruiker de capability heeft; client-side zichtbaarheid is **nooit** de enige bescherming (server-side gate uit WO-1 blijft leidend).

**In te zetten subagents** — `code-reviewer`; `ontwerp-sync-reviewer` vóór merge.

**Werkmodus** — begin in **Plan-modus**; **merge WO-1 eerst** (deze opdracht consumeert de nieuwe engine-API's/velden). Wijzig pas na expliciet akkoord.

**Definition of Done** — volg `CLAUDE.md` §Definition of Done. Opdracht-specifiek: UX consistent met de Processen-module; de afgeleide fase-status volgt exact de regels uit §7.1 (fase-status, aandachtsvlag, bewijslast-dekking, portfolio-aggregatie) en komt overeen met beide mockups (detail v0.2 + overzicht v0.1); leunt aantoonbaar op de WO-1-velden (`status`, `blokkerende_afhankelijkheden`, `bron`, instantie-requirements, fasebeschrijving, `fase_code`); `HANDOVER.md` bijgewerkt.

**Openstaande punten** — het **termijn-signaal** in de aandachtsvlag leunt op termijnen-als-data (review O2); tot die er zijn toont de vlag alleen heropend/ontbrekende-bewijslast. Een **server-side statusaggregatie** voor de portfolio-lijst (OB-E5) is een latere optimalisatie als de UI-afleiding over veel procedures traag wordt. Leg beide met eigenaar vast in `00 Overzicht en status/openstaande-punten-en-risicos.md`.

**Terugkoppeling** — rapporteer in het antwoordformat uit `CLAUDE.md` (samenvatting, aangepaste bestanden, RLS/security-impact [n.v.t.], audit-impact [n.v.t.], datamodel/migratie-impact [n.v.t.], test/verificatie, openstaande risico's).
