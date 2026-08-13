# Werkopdracht: Processen-detail — UI-herinrichting (fase/stap-weergave, toelichting, dossier)

> WO-3 (UI). Vervolg op de al doorgevoerde WO-1 (engine/definitie) en WO-2 (UI-consumptie). Plak als eerste bericht in een Claude Code-sessie in de repo-root. Zie `WERKOPDRACHT-TEMPLATE.md`.

---

**Doel & context** — Herinricht de Processen-**detailpagina** zodat het scherm rustig opent en de navigatie los staat van de inhoud: het linkerpaneel wordt een schone **fase-accordeon**, de **fasebeschrijving** en toelichting verhuizen naar rechts, checklist en bewijsstukken openen **ingeklapt**, elk item is **uitklapbaar met toelichting (inzien + bewerken)**, en onderaan komt het generieke **dossier**. Alle fase- en stapnamen volgen de standaardset.

**Goedgekeurd ontwerp/plan** — Visuele referentie (leidend): `MOCKUP-processen-detail-v0.4.html`. Inhoud/definitie: `mvp/definities/pensioenfondsen/pf_wtp_invaarbesluit-2.0.0-standaardset.json` (fasen, stappen, checklist + bewijsstukken, elk met toelichting). Fasebeschrijving-afleiding en -override: `PROCEDURE-ENGINE-V2-ONTWERP.md` §6 (D8) en §7.1.

**Scope**
- **Wel — linker fase-accordeon:** hoofdfases als accordeon (romeins cijfer, naam, aantal stappen, status-pill, chevron) die uitklapt naar de stappen; géén beschrijvings-/toelichtingsblokken in het linkerpaneel; actieve fase open, stappen met verbindingslijn en statusduiding; actieve stap gemarkeerd.
- **Wel — twee weergaven rechts:** klik op een **fase** → toon **alléén de fasebeschrijving** (fase-weergave), niet het stapscherm; klik op een **stap** → toon het **stapscherm zónder** fasebeschrijving. De fasebeschrijving is bewerkbaar (generiek, per fonds aanpasbaar — D8).
- **Wel — toelichting onder de staptitel:** de toelichting van de stap staat onder de titel en is **bewerkbaar** (Wijzigen). Géén losse "Toelichting bij dit proces"-kaart.
- **Wel — ingeklapte secties:** Checklist, Bewijsstukken en Vergaderingen zijn **standaard ingeklapt**, met een samenvatting in de kop (bv. "Checklist · 0/8 voldaan · 8× bewijs vereist", "Bewijsstukken · 3 gevraagd · nog op te voeren").
- **Wel — items uitklapbaar:** elk **checklistitem** en elk **bewijsstuk** is uitklapbaar met zijn **toelichting** (inzien) + **Wijzigen**, plus "Checklistpunt/Bewijsstuk bewerken". Bewijsstukken heten **Bewijsstukken** (niet "bewijslast").
- **Wel — dossier onderaan:** generiek dossierblok: *Classificatie & onderbouwing* (in/uitklap), *Onderbouwing* met tabs **Aannames / Risico's / Voorwaarden / Acties / Dissent**, *Statusovergang*, *Audit-trail*, *Afschriften* — conform het bestaande Decision Object-dossier, ook voor het invaarproces.
- **Wel — definitieve namen:** fase- en stapnamen uit de standaardset (o.a. "Opdracht ontvangen en duiden", "Datakwaliteit beoordelen", "Voorgenomen invaarbesluit en opdrachtaanvaarding vormen", fase VI "Nazorg & verantwoording").
- **Niet:** backend/engine/datamodel-herontwerp (WO-1); AI-controles/AI-suggesties; het totaaloverzicht met afgeleide fase-status (dat zit in WO-2); readiness-ladder-herontwerp.

**Impactklasse** — **alleen UI-of-frontend.** Weging: geen migratie/policy/nieuwe tabel → documentatiehaak vuurt niet, `HANDOVER.md` volstaat; gates niet vereist. **Data-voorwaarde (te verifiëren in Plan-modus):** de weergave/bewerking van toelichting leunt op een `toelichting`-veld bij checklistitems én bewijsstukken, en op de fase-`generieke_beschrijving` + fonds-override (D8). Bestaan die velden al (uit de standaardset-seed / WO-1), dan is dit puur UI; ontbreken ze, dán is dat een kleine, aparte data-toevoeging (die wél de gates/documentatiehaak raakt) — meld dat als bevinding en houd het buiten deze UI-scope.

**Relevante bestanden / modules** — `mvp/app/(dashboard)/procedures/[id]/page.tsx`, `_components/StapPaneel.tsx`, `_components/StapRequirementsPaneel.tsx`, `_components/ReadinessLadder.tsx`, `_components/DecisionObjectHeader.tsx`, `_components/OnderbouwingsPaneel.tsx`, `_components/StatusOvergangPaneel.tsx`, `_components/DossierTijdlijn.tsx`/`AfschriftenPaneel.tsx` (dossier), evt. nieuwe componenten `FaseAccordeon`, `FaseWeergave`, `StapToelichting`, `ItemToelichting`. Claude Code verifieert tegen de werkelijke code.

**Guardrails (zie `CLAUDE.md`)** — UX consistent met bestaande patronen (design-tokens uit `globals.css`; status = kleur **én** woord **én** vorm, besluit 0097/0101; geen nieuwe UI-/chart-library); bewerk-/toevoeg-acties (checklistpunt, bewijsstuk, toelichting, fasebeschrijving) verschijnen alleen bij de juiste capability en leunen op de bestaande server-side gates (WO-1); client-side zichtbaarheid is nooit de enige bescherming; het dossier blijft de bestaande, append-only bron (niets aan de audit-trail wijzigen).

**In te zetten subagents** — `code-reviewer`; `ontwerp-sync-reviewer` vóór merge (houd `PROCEDURE-ENGINE-V2-ONTWERP.md` §7 in lijn met de gebouwde UI).

**Werkmodus** — begin in **Plan-modus**: lever eerst een implementatieplan (componenten, interactiemodel fase↔stap, welke velden gelezen/geschreven worden, de data-voorwaarde uit de impactklasse, testaanpak, risico's). **Wijzig pas na expliciet akkoord.**

**Definition of Done** — volg `CLAUDE.md` §Definition of Done. Opdracht-specifiek: gedrag en indeling komen overeen met `MOCKUP-processen-detail-v0.4.html`; fase- en stapnamen komen uit de standaardset; toelichting per stap/fase/checklistitem/bewijsstuk is zichtbaar én bewerkbaar (mits de data-voorwaarde vervuld is); secties openen ingeklapt; het dossier is volledig aanwezig; `HANDOVER.md` bijgewerkt.

**Openstaande punten** — als het `toelichting`-veld (checklist/bewijsstuk) of de fase-`generieke_beschrijving`/override nog niet bestaat, leg de benodigde data-toevoeging met eigenaar vast in `00 Overzicht en status/openstaande-punten-en-risicos.md` (aparte, kleine data-werkopdracht — buiten deze UI-scope). Idem voor de nog te bevestigen default-status in het dossier (mockup toont "In onderbouwing").

**Terugkoppeling** — rapporteer in het antwoordformat uit `CLAUDE.md` (samenvatting, aangepaste bestanden, RLS/security-impact [n.v.t.], audit-impact [n.v.t.], datamodel/migratie-impact [n.v.t. of: benodigde toelichting-velden], test/verificatie, openstaande risico's).
